import type { Context, Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import type { Db } from './db.js';
import {
  SMS_CODE_LEN,
  SMS_DAY_MS,
  SMS_MAX_ATTEMPTS,
  SMS_MSG_BAD_CODE,
  SMS_MSG_SEND_FAILED,
  SMS_RESEND_MS,
  SMS_TTL_MS,
  genSmsUsername,
  hashSmsCode,
  isValidPhone,
  maskPhone,
  newSmsCode,
  renderSms,
  type SmsRuntime,
} from './sms.js';
import { START_ENERGY } from '../shared/game.js';

/** app.ts 里已有的会话/用户能力，原样注入，保持两处登录逻辑一致 */
export interface SmsDeps {
  db: () => Db;
  sms: SmsRuntime;
  now: () => number;
  body: (c: Context) => Promise<Record<string, unknown>>;
  clientIp: (c: Context) => string;
  currentUser: (c: Context) => Promise<{ id: number } | undefined>;
  startSession: (c: Context, userId: number) => Promise<string>;
  publicUser: (userId: number) => Promise<unknown>;
  throttled: (key: string) => boolean;
  noteFailure: (key: string) => void;
  clearFailures: (key: string) => void;
}

const err = (c: Context, message: string, status: ContentfulStatusCode = 400, extra: Record<string, unknown> = {}) =>
  c.json({ error: message, ...extra }, status);

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

export function registerSmsRoutes(app: Hono, d: SmsDeps) {
  const { sms } = d;
  const hash = (phone: string, purpose: string, code: string) => hashSmsCode(sms.codeSecret, phone, purpose, code);

  /** 校验验证码并作废（原子）。任何失败原因都只返回 false，对外统一提示。 */
  const consume = async (phone: string, purpose: 'login' | 'bind', code: string, userId: number | null): Promise<boolean> => {
    const db = d.db();
    const now = d.now();
    const row = await db.get<{ id: number; code_hash: string; attempts: number; expires_at: number; user_id: number | null }>(
      `SELECT id, code_hash, attempts, expires_at, user_id FROM sms_codes
       WHERE phone = ? AND purpose = ? AND status = 1 AND used_at IS NULL ORDER BY id DESC LIMIT 1`,
      [phone, purpose],
    );
    if (!row || row.expires_at <= now || row.attempts >= SMS_MAX_ATTEMPTS) return false;
    if (purpose === 'bind' && row.user_id !== userId) return false;
    const bumped = await db.run('UPDATE sms_codes SET attempts = attempts + 1 WHERE id = ? AND used_at IS NULL AND attempts < ?', [
      row.id,
      SMS_MAX_ATTEMPTS,
    ]);
    if (bumped.changes !== 1) return false;
    const a = Buffer.from(row.code_hash);
    const b = Buffer.from(hash(phone, purpose, code));
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
    const used = await db.run('UPDATE sms_codes SET used_at = ? WHERE id = ? AND used_at IS NULL', [now, row.id]);
    return used.changes === 1;
  };

  const phoneOwner = async (phone: string) =>
    (await d.db().get<{ user_id: number }>('SELECT user_id FROM user_phones WHERE phone = ?', [phone]))?.user_id ?? null;

  const findOrCreateUser = async (phone: string): Promise<{ id: number; registered: boolean }> => {
    const db = d.db();
    const existing = await phoneOwner(phone);
    if (existing !== null) return { id: existing, registered: false };
    const pwd = await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10);
    for (let i = 0; i < 8; i++) {
      const username = genSmsUsername(phone);
      try {
        const id = await db.tx(async (t) => {
          const info = await t.run('INSERT INTO users (username, password_hash, energy, coins, created_at) VALUES (?, ?, ?, 0, ?)', [
            username,
            pwd,
            START_ENERGY,
            d.now(),
          ]);
          await t.run('INSERT INTO user_phones (user_id, phone, created_at) VALUES (?, ?, ?)', [info.lastId, phone, d.now()]);
          return info.lastId;
        });
        return { id, registered: true };
      } catch {
        const raced = await phoneOwner(phone);
        if (raced !== null) return { id: raced, registered: false };
      }
    }
    throw new Error('could not allocate a username for sms signup');
  };

  app.get('/api/sms/info', (c) =>
    c.json({
      enabled: sms.enabled,
      mock: sms.enabled && sms.mock,
      codeLength: SMS_CODE_LEN,
      resendSeconds: SMS_RESEND_MS / 1000,
      expiresMinutes: SMS_TTL_MS / 60000,
    }),
  );

  app.post('/api/sms/send', async (c) => {
    if (!sms.enabled) return err(c, '短信登录暂未开放', 503);
    const db = d.db();
    const b = await d.body(c);
    const phone = str(b.phone);
    const purpose = b.purpose === 'bind' ? 'bind' : 'login';
    if (!isValidPhone(phone)) return err(c, '请输入正确的 11 位手机号');
    let userId: number | null = null;
    if (purpose === 'bind') {
      const u = await d.currentUser(c);
      if (!u) return err(c, '请先登录', 401);
      userId = u.id;
      const owner = await phoneOwner(phone);
      if (owner !== null && owner !== u.id) return err(c, '该手机号已绑定其他账号', 409);
    }
    const ip = d.clientIp(c).slice(0, 64);
    const now = d.now();
    const code = newSmsCode();

    // 先占位（status=0）再检查频率：并发请求里 id 较大的一方会被拒绝
    const { lastId: id } = await db.run(
      'INSERT INTO sms_codes (phone, purpose, code_hash, ip, user_id, status, expires_at, created_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)',
      [phone, purpose, hash(phone, purpose, code), ip, userId, now + SMS_TTL_MS, now],
    );
    const reject = async (message: string, status: ContentfulStatusCode = 429, extra: Record<string, unknown> = {}) => {
      await db.run('DELETE FROM sms_codes WHERE id = ?', [id]);
      return err(c, message, status, extra);
    };
    const count = async (sql: string, args: unknown[]) => (await db.get<{ n: number }>(sql, args as never))?.n ?? 0;

    const last = (await db.get<{ t: number | null }>('SELECT MAX(created_at) AS t FROM sms_codes WHERE phone = ? AND status <> 2 AND id < ?', [phone, id]))?.t;
    if (last != null && last > now - SMS_RESEND_MS) {
      const wait = Math.ceil((last + SMS_RESEND_MS - now) / 1000);
      return reject(`操作太频繁，请 ${wait} 秒后再获取验证码`, 429, { retryAfter: wait });
    }
    const since = now - SMS_DAY_MS;
    if ((await count('SELECT COUNT(*) AS n FROM sms_codes WHERE phone = ? AND status <> 2 AND created_at > ?', [phone, since])) > sms.phoneDailyLimit)
      return reject('该手机号今日获取验证码次数已达上限，请明天再试');
    if ((await count('SELECT COUNT(*) AS n FROM sms_codes WHERE ip = ? AND created_at > ?', [ip, since])) > sms.ipDailyLimit)
      return reject('当前网络今日获取验证码次数已达上限，请明天再试');
    if ((await count('SELECT COUNT(*) AS n FROM sms_codes WHERE status <> 2 AND created_at > ?', [since])) > sms.totalDailyLimit) {
      console.error('[sms] global daily limit reached');
      return reject('短信服务繁忙，请稍后再试', 503);
    }

    const res = await sms.send(phone, renderSms(sms, code)).catch((e) => ({ ok: false, detail: `exception: ${(e as Error).message}` }));
    if (!res.ok) {
      await db.run('UPDATE sms_codes SET status = 2 WHERE id = ?', [id]);
      console.error(`[sms] send failed for ${maskPhone(phone)}: ${res.detail}`);
      return err(c, SMS_MSG_SEND_FAILED, 502);
    }
    await db.run('UPDATE sms_codes SET status = 1 WHERE id = ?', [id]);
    await db.run('UPDATE sms_codes SET used_at = ? WHERE phone = ? AND purpose = ? AND used_at IS NULL AND id < ?', [now, phone, purpose, id]);
    if (Math.random() < 0.02) await db.run('DELETE FROM sms_codes WHERE created_at < ?', [now - 3 * SMS_DAY_MS]);
    return c.json({ ok: true, resendSeconds: SMS_RESEND_MS / 1000, expiresMinutes: SMS_TTL_MS / 60000 });
  });

  const parseCreds = async (c: Context): Promise<{ phone: string; code: string } | Response> => {
    const b = await d.body(c);
    const phone = str(b.phone);
    const code = str(b.code);
    if (!isValidPhone(phone)) return err(c, '请输入正确的 11 位手机号');
    if (!/^\d{6}$/.test(code)) return err(c, '请输入 6 位数字验证码');
    return { phone, code };
  };

  app.post('/api/sms/login', async (c) => {
    if (!sms.enabled) return err(c, '短信登录暂未开放', 503);
    const creds = await parseCreds(c);
    if (creds instanceof Response) return creds;
    const key = `smsv:${d.clientIp(c)}`;
    if (d.throttled(key)) return err(c, '尝试次数过多，请 10 分钟后再试', 429);
    if (!(await consume(creds.phone, 'login', creds.code, null))) {
      d.noteFailure(key);
      return err(c, SMS_MSG_BAD_CODE, 400);
    }
    d.clearFailures(key);
    const { id, registered } = await findOrCreateUser(creds.phone);
    const token = await d.startSession(c, id);
    return c.json({ user: await d.publicUser(id), token, registered });
  });

  app.post('/api/sms/bind', async (c) => {
    if (!sms.enabled) return err(c, '短信登录暂未开放', 503);
    const u = await d.currentUser(c);
    if (!u) return err(c, '请先登录', 401);
    const creds = await parseCreds(c);
    if (creds instanceof Response) return creds;
    const key = `smsv:${d.clientIp(c)}`;
    if (d.throttled(key)) return err(c, '尝试次数过多，请 10 分钟后再试', 429);
    if (!(await consume(creds.phone, 'bind', creds.code, u.id))) {
      d.noteFailure(key);
      return err(c, SMS_MSG_BAD_CODE, 400);
    }
    d.clearFailures(key);
    try {
      await d.db().tx(async (t) => {
        await t.run('DELETE FROM user_phones WHERE user_id = ?', [u.id]);
        await t.run('INSERT INTO user_phones (user_id, phone, created_at) VALUES (?, ?, ?)', [u.id, creds.phone, d.now()]);
      });
    } catch {
      return err(c, '该手机号已绑定其他账号', 409);
    }
    return c.json({ ok: true, phone: maskPhone(creds.phone) });
  });

  app.get('/api/sms/phone', async (c) => {
    const u = await d.currentUser(c);
    if (!u) return err(c, '请先登录', 401);
    const row = await d.db().get<{ phone: string }>('SELECT phone FROM user_phones WHERE user_id = ?', [u.id]);
    return c.json({ phone: row ? maskPhone(row.phone) : null });
  });
}
