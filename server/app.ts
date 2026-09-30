import { Hono, type Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import type { DB } from './db.js';
import {
  ITEMS,
  MAX_WISH_LENGTH,
  START_ENERGY,
  TOPUP_PACKS,
  checkinReward,
  stageOf,
  type PrayerTag,
  type PublicUser,
} from '../shared/game.js';

const SESSION_COOKIE = 'qifu_session';
const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;
const TAG_LIMIT = 300;

interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  energy: number;
  coins: number;
  streak: number;
  last_checkin: string | null;
  created_at: number;
}

export interface AppOptions {
  db: DB;
  timeZone?: string;
  now?: () => number;
}

export function createApp({ db, timeZone = 'Asia/Shanghai', now = Date.now }: AppOptions) {
  const app = new Hono();

  const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const dayOf = (ms: number) => dayFormat.format(new Date(ms));
  const today = () => dayOf(now());
  const yesterday = () => dayOf(now() - 24 * 3600 * 1000);

  const hashToken = (t: string) => crypto.createHash('sha256').update(t).digest('hex');

  const failures = new Map<string, { count: number; until: number }>();
  const throttled = (key: string) => {
    const f = failures.get(key);
    return !!f && f.count >= 8 && f.until > now();
  };
  const noteFailure = (key: string) => {
    const f = failures.get(key);
    if (f && f.until > now()) f.count++;
    else failures.set(key, { count: 1, until: now() + 10 * 60 * 1000 });
  };

  const getUser = (id: number) => db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;

  const toPublic = (u: UserRow): PublicUser => {
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM prayers WHERE user_id = ?').get(u.id) as { n: number };
    return {
      id: u.id,
      username: u.username,
      energy: u.energy,
      coins: u.coins,
      streak: u.last_checkin === today() || u.last_checkin === yesterday() ? u.streak : 0,
      checkedInToday: u.last_checkin === today(),
      prayerCount: n,
      stage: stageOf(n),
    };
  };

  const startSession = (c: Context, userId: number) => {
    const token = crypto.randomBytes(32).toString('base64url');
    db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(
      hashToken(token),
      userId,
      now() + SESSION_TTL_MS,
    );
    setCookie(c, SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'Lax',
      path: '/',
      maxAge: SESSION_TTL_MS / 1000,
      secure: c.req.header('x-forwarded-proto') === 'https',
    });
  };

  const currentUser = (c: Context): UserRow | undefined => {
    const token = getCookie(c, SESSION_COOKIE);
    if (!token) return undefined;
    const row = db
      .prepare('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?')
      .get(hashToken(token)) as { user_id: number; expires_at: number } | undefined;
    if (!row) return undefined;
    if (row.expires_at < now()) {
      db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
      return undefined;
    }
    return getUser(row.user_id);
  };

  const body = async (c: Context): Promise<Record<string, unknown>> => {
    try {
      const b = await c.req.json();
      return b && typeof b === 'object' ? (b as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  };

  const fail = (c: Context, message: string, status: 400 | 401 | 402 | 409 | 429 = 400) => c.json({ error: message }, status);

  const clientIp = (c: Context) => c.req.header('x-forwarded-for')?.split(',')[0].trim() ?? 'local';

  app.post('/api/register', async (c) => {
    const b = await body(c);
    const username = typeof b.username === 'string' ? b.username.trim() : '';
    const password = typeof b.password === 'string' ? b.password : '';
    if (!/^[\p{L}\p{N}_-]{2,20}$/u.test(username)) return fail(c, '用户名需为 2-20 位的字母、数字、汉字、下划线或短横线');
    if (password.length < 6 || password.length > 72) return fail(c, '密码长度需在 6-72 位之间');
    const key = `reg:${clientIp(c)}`;
    if (throttled(key)) return fail(c, '操作过于频繁，请稍后再试', 429);
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) return fail(c, '用户名已被使用', 409);
    const hash = await bcrypt.hash(password, 10);
    try {
      const info = db
        .prepare('INSERT INTO users (username, password_hash, energy, coins, created_at) VALUES (?, ?, ?, 0, ?)')
        .run(username, hash, START_ENERGY, now());
      noteFailure(key);
      startSession(c, Number(info.lastInsertRowid));
      return c.json({ user: toPublic(getUser(Number(info.lastInsertRowid))!) });
    } catch {
      return fail(c, '用户名已被使用', 409);
    }
  });

  app.post('/api/login', async (c) => {
    const b = await body(c);
    const username = typeof b.username === 'string' ? b.username.trim() : '';
    const password = typeof b.password === 'string' ? b.password : '';
    const key = `login:${clientIp(c)}:${username.toLowerCase()}`;
    if (throttled(key)) return fail(c, '尝试次数过多，请 10 分钟后再试', 429);
    const u = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as UserRow | undefined;
    const ok = u ? await bcrypt.compare(password, u.password_hash) : false;
    if (!u || !ok) {
      noteFailure(key);
      return fail(c, '用户名或密码错误', 401);
    }
    failures.delete(key);
    startSession(c, u.id);
    return c.json({ user: toPublic(u) });
  });

  app.post('/api/logout', (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.json({ ok: true });
  });

  app.get('/api/me', (c) => {
    const u = currentUser(c);
    return c.json({ user: u ? toPublic(u) : null });
  });

  app.get('/api/config', (c) => c.json({ items: ITEMS, packs: TOPUP_PACKS, maxWishLength: MAX_WISH_LENGTH }));

  app.post('/api/checkin', (c) => {
    const u = currentUser(c);
    if (!u) return fail(c, '请先登录', 401);
    const tx = db.transaction(() => {
      const fresh = getUser(u.id)!;
      if (fresh.last_checkin === today()) return null;
      const streak = fresh.last_checkin === yesterday() ? fresh.streak + 1 : 1;
      const gained = checkinReward(streak);
      db.prepare('UPDATE users SET energy = energy + ?, streak = ?, last_checkin = ? WHERE id = ?').run(
        gained,
        streak,
        today(),
        u.id,
      );
      return gained;
    });
    const gained = tx();
    if (gained === null) return fail(c, '今天已经签到过了', 409);
    return c.json({ gained, user: toPublic(getUser(u.id)!) });
  });

  app.post('/api/pray', async (c) => {
    const u = currentUser(c);
    if (!u) return fail(c, '请先登录', 401);
    const b = await body(c);
    const item = ITEMS.find((i) => i.id === b.item);
    if (!item) return fail(c, '请选择祈福道具');
    const text = typeof b.text === 'string' ? b.text.trim() : '';
    if (!text) return fail(c, '请写下你的心愿');
    if ([...text].length > MAX_WISH_LENGTH) return fail(c, `心愿最多 ${MAX_WISH_LENGTH} 字`);

    const tx = db.transaction(() => {
      const fresh = getUser(u.id)!;
      const balance = item.currency === 'energy' ? fresh.energy : fresh.coins;
      if (balance < item.cost) return { error: item.currency === 'energy' ? '能量不足，去签到或使用福币道具吧' : '福币不足，请先充值' };
      if (item.currency === 'energy') {
        db.prepare('UPDATE users SET energy = energy - ? + ? WHERE id = ?').run(item.cost, item.reward, u.id);
      } else {
        db.prepare('UPDATE users SET coins = coins - ?, energy = energy + ? WHERE id = ?').run(item.cost, item.reward, u.id);
      }
      const { n } = db.prepare('SELECT COUNT(*) AS n FROM prayers').get() as { n: number };
      const info = db
        .prepare('INSERT INTO prayers (user_id, item_type, text, position, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(u.id, item.id, text, n, now());
      return { id: Number(info.lastInsertRowid), position: n };
    });
    const res = tx();
    if ('error' in res) return fail(c, res.error!, 402);
    const user = toPublic(getUser(u.id)!);
    const tag: PrayerTag = {
      id: res.id!,
      itemType: item.id,
      text,
      position: res.position!,
      username: u.username,
      createdAt: now(),
      mine: true,
    };
    return c.json({ tag, reward: item.reward, user });
  });

  app.post('/api/topup', async (c) => {
    const u = currentUser(c);
    if (!u) return fail(c, '请先登录', 401);
    const b = await body(c);
    const pack = TOPUP_PACKS.find((p) => p.id === b.pack);
    if (!pack) return fail(c, '请选择充值档位');
    db.transaction(() => {
      db.prepare('UPDATE users SET coins = coins + ? WHERE id = ?').run(pack.coins, u.id);
      db.prepare('INSERT INTO topups (user_id, pack_id, coins, created_at) VALUES (?, ?, ?, ?)').run(u.id, pack.id, pack.coins, now());
    })();
    return c.json({ added: pack.coins, demo: true, user: toPublic(getUser(u.id)!) });
  });

  app.get('/api/prayers', (c) => {
    const me = currentUser(c);
    const rows = db
      .prepare(
        `SELECT p.id, p.item_type, p.text, p.position, p.created_at, p.user_id, u.username
         FROM prayers p JOIN users u ON u.id = p.user_id
         ORDER BY p.id DESC LIMIT ?`,
      )
      .all(TAG_LIMIT) as Array<{ id: number; item_type: PrayerTag['itemType']; text: string; position: number; created_at: number; user_id: number; username: string }>;
    const { total } = db.prepare('SELECT COUNT(*) AS total FROM prayers').get() as { total: number };
    const { recent } = db.prepare('SELECT COUNT(*) AS recent FROM prayers WHERE created_at > ?').get(now() - 24 * 3600 * 1000) as { recent: number };
    const tags: PrayerTag[] = rows.reverse().map((r) => ({
      id: r.id,
      itemType: r.item_type,
      text: r.text,
      position: r.position,
      username: r.username,
      createdAt: r.created_at,
      mine: me?.id === r.user_id,
    }));
    return c.json({ tags, total, recent24h: recent });
  });

  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: '服务器开小差了，请稍后再试' }, 500);
  });

  return app;
}
