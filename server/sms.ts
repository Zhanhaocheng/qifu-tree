import crypto from 'node:crypto';
import fs from 'node:fs';

// 手机号短信验证码：配置、发送层（美联软通 5C）、表结构。路由见 smsRoutes.ts。
// 接口依据官方文档《美联软通5C平台接口文档20170222版》3.1 HTTP 发送接口：
//   POST https://m.5c.com.cn/api/send/index.php
//   username / password_md5（32 位，小写）/ apikey / mobile / content（含签名的全文）/ encode=UTF-8
//   返回 success:msgid = 提交成功；error:xxx = 失败。
// 凭据只从环境变量读取（Vercel 项目设置里配置），绝不写进代码或 Git。要换短信平台只改 providerSend()。

export const SMS_CODE_LEN = 6;
export const SMS_TTL_MS = 5 * 60 * 1000;
export const SMS_RESEND_MS = 60 * 1000;
export const SMS_MAX_ATTEMPTS = 5;
export const SMS_DAY_MS = 24 * 3600 * 1000;
export const SMS_MSG_BAD_CODE = '验证码错误或已过期';
export const SMS_MSG_SEND_FAILED = '短信发送失败，请稍后再试';

export const DEFAULT_SMS_URL = 'https://m.5c.com.cn/api/send/index.php';
export const DEFAULT_SMS_SIGN = '【阳光互联】';
export const DEFAULT_SMS_TEMPLATE = '{sign}您的验证码是{code}，{minutes}分钟内有效。';

/** 独立于 users 表的新表；db.ts 启动时执行（CREATE ... IF NOT EXISTS，可重复） */
export const SMS_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS sms_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT NOT NULL,
    purpose TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    ip TEXT NOT NULL DEFAULT '',
    user_id INTEGER,
    status INTEGER NOT NULL DEFAULT 0,
    attempts INTEGER NOT NULL DEFAULT 0,
    expires_at INTEGER NOT NULL,
    used_at INTEGER,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sms_codes_phone ON sms_codes(phone, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_sms_codes_ip ON sms_codes(ip, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_sms_codes_created ON sms_codes(created_at)`,
  `CREATE TABLE IF NOT EXISTS user_phones (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    phone TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL
  )`,
];

export interface SmsSendResult {
  ok: boolean;
  /** 仅写服务器日志，绝不返回给用户 */
  detail: string;
}
export type SmsSender = (phone: string, content: string) => Promise<SmsSendResult>;

export interface SmsRuntime {
  enabled: boolean;
  mock: boolean;
  send: SmsSender;
  sign: string;
  template: string;
  codeSecret: string;
  phoneDailyLimit: number;
  ipDailyLimit: number;
  totalDailyLimit: number;
}

const flag = (v: string | undefined, dflt = false) => (v === undefined || v === '' ? dflt : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase()));
const posInt = (v: string | undefined, dflt: number) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : dflt;
};

export const isValidPhone = (s: string) => /^1[3-9]\d{9}$/.test(s);
export const maskPhone = (p: string) => `${p.slice(0, 3)}****${p.slice(-4)}`;

export function normalizeSign(raw: string | undefined): string {
  let sign = (raw ?? '').trim() || DEFAULT_SMS_SIGN;
  if (!sign.startsWith('【')) sign = `【${sign}】`;
  return sign;
}

export function renderSms(rt: Pick<SmsRuntime, 'sign' | 'template'>, code: string): string {
  const tpl = rt.template.includes('{code}') ? rt.template : DEFAULT_SMS_TEMPLATE;
  let text = tpl.split('{sign}').join(rt.sign).split('{code}').join(code).split('{minutes}').join(String(SMS_TTL_MS / 60000));
  if (!text.includes('【')) text = rt.sign + text;
  return text;
}

/** 6 位验证码：crypto.randomInt 加密安全且无取模偏差 */
export const newSmsCode = () => String(crypto.randomInt(0, 10 ** SMS_CODE_LEN)).padStart(SMS_CODE_LEN, '0');

export function hashSmsCode(secret: string, phone: string, purpose: string, code: string): string {
  return crypto.createHmac('sha256', secret).update(`${phone}:${purpose}:${code}`).digest('hex');
}

export function genSmsUsername(phone: string): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  let suffix = '';
  for (let i = 0; i < 4; i++) suffix += alphabet[crypto.randomInt(0, alphabet.length)];
  return `${phone.slice(0, 3)}_${phone.slice(-4)}_${suffix}`;
}

/** mock：不联网；写入 SMS_MOCK_OUTBOX（每行一个 JSON），没配路径就打印到控制台。仅供开发/测试。 */
function mockSender(outbox: string): SmsSender {
  return async (phone, content) => {
    const line = JSON.stringify({ phone, content, at: Date.now() });
    if (outbox) fs.appendFileSync(outbox, line + '\n');
    else console.log('[sms-mock]', line);
    return { ok: true, detail: 'mock' };
  };
}

function providerSender(env: Record<string, string | undefined>): SmsSender {
  const url = env.SMS_API_URL?.trim() || DEFAULT_SMS_URL;
  const fields = () => ({
    username: env.SMS_USERNAME!.trim(),
    password_md5: env.SMS_PASSWORD_MD5!.trim().toLowerCase(),
    apikey: env.SMS_APIKEY!.trim(),
  });
  return async (phone, content) => {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded;charset=utf-8' },
        body: new URLSearchParams({ ...fields(), mobile: phone, content, encode: 'UTF-8' }).toString(),
        signal: AbortSignal.timeout(12000),
      });
      const text = (await res.text()).replace(/^\uFEFF/, '').trim();
      if (res.ok && text.toLowerCase().startsWith('success')) return { ok: true, detail: text.slice(0, 80) };
      return { ok: false, detail: `http ${res.status} ${text.replace(/\s+/g, ' ').slice(0, 160)}` };
    } catch (e) {
      return { ok: false, detail: `transport: ${(e as Error).message}` };
    }
  };
}

export function credentialsReady(env: Record<string, string | undefined>): boolean {
  return !!env.SMS_USERNAME?.trim() && !!env.SMS_APIKEY?.trim() && /^[0-9a-f]{32}$/i.test(env.SMS_PASSWORD_MD5?.trim() ?? '');
}

export function smsFromEnv(env: Record<string, string | undefined> = process.env): SmsRuntime {
  const mock = flag(env.SMS_MOCK);
  const enabled = flag(env.SMS_ENABLED, true) && (mock || credentialsReady(env));
  return {
    enabled,
    mock,
    send: mock ? mockSender(env.SMS_MOCK_OUTBOX?.trim() ?? '') : enabled ? providerSender(env) : async () => ({ ok: false, detail: 'sms disabled' }),
    sign: normalizeSign(env.SMS_SIGN),
    template: env.SMS_TEMPLATE?.trim() || DEFAULT_SMS_TEMPLATE,
    codeSecret: env.SMS_CODE_SECRET?.trim() || crypto.createHash('sha256').update(`qifu-sms|${env.TURSO_AUTH_TOKEN ?? ''}|${env.SMS_APIKEY ?? ''}`).digest('hex'),
    phoneDailyLimit: posInt(env.SMS_PHONE_DAILY_LIMIT, 10),
    ipDailyLimit: posInt(env.SMS_IP_DAILY_LIMIT, 30),
    totalDailyLimit: posInt(env.SMS_TOTAL_DAILY_LIMIT, 3000),
  };
}
