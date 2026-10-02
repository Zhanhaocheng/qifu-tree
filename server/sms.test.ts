import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from './app.js';
import { memoryDb } from './db.js';
import { smsFromEnv, renderSms, newSmsCode, normalizeSign, type SmsRuntime } from './sms.js';

// 测试里的手机号都是现场拼出来的号段，并且发送层是假的：不会联网，更不会调用真实短信平台。
const phoneN = (n: number) => `139${String(10000000 + n)}`;

function setup(over: Partial<SmsRuntime> = {}) {
  let t = Date.parse('2026-01-10T04:00:00Z');
  const outbox: { phone: string; content: string }[] = [];
  let failNext = false;
  const sms: SmsRuntime = {
    ...smsFromEnv({ SMS_MOCK: '1' }),
    send: async (phone, content) => {
      if (failNext) return { ok: false, detail: 'error:APIKEY or password error SECRET-DETAIL' };
      outbox.push({ phone, content });
      return { ok: true, detail: 'fake' };
    },
    ...over,
  };
  const db = memoryDb();
  const app = createApp({ db, now: () => t, sms });
  let cookie = '';
  let ip = '10.0.0.1';
  const call = async (method: string, url: string, payload?: unknown) => {
    const res = await app.request(url, {
      method,
      headers: { 'content-type': 'application/json', cookie, 'x-forwarded-for': ip },
      body: payload ? JSON.stringify(payload) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, json: (await res.json()) as any };
  };
  const lastCode = () => /(\d{6})/.exec(outbox[outbox.length - 1].content)![1];
  return {
    call,
    db,
    outbox,
    lastCode,
    advance: (ms: number) => (t += ms),
    clearCookie: () => (cookie = ''),
    setIp: (v: string) => (ip = v),
    failNext: (v: boolean) => (failNext = v),
  };
}

test('config: disabled without credentials, enabled with mock or full credentials', () => {
  assert.equal(smsFromEnv({}).enabled, false);
  assert.equal(smsFromEnv({ SMS_USERNAME: 'u', SMS_APIKEY: 'k' }).enabled, false);
  assert.equal(smsFromEnv({ SMS_USERNAME: 'u', SMS_APIKEY: 'k', SMS_PASSWORD_MD5: 'x'.repeat(32) }).enabled, false);
  assert.equal(smsFromEnv({ SMS_USERNAME: 'u', SMS_APIKEY: 'k', SMS_PASSWORD_MD5: 'AB'.repeat(16) }).enabled, true);
  assert.equal(smsFromEnv({ SMS_MOCK: '1' }).enabled, true);
  assert.equal(smsFromEnv({ SMS_MOCK: '1', SMS_ENABLED: '0' }).enabled, false);
  assert.equal(smsFromEnv({ SMS_MOCK: '0' }).mock, false);
});

test('content: signature first, 6-digit secure code', () => {
  const rt = smsFromEnv({ SMS_MOCK: '1' });
  assert.equal(renderSms(rt, '123456'), '【阳光互联】您的验证码是123456，5分钟内有效。');
  assert.equal(normalizeSign('阳光互联'), '【阳光互联】');
  assert.equal(renderSms({ sign: '【X】', template: '您的验证码{code}' }, '000001'), '【X】您的验证码000001');
  const seen = new Set<string>();
  for (let i = 0; i < 300; i++) {
    const c = newSmsCode();
    assert.match(c, /^\d{6}$/);
    seen.add(c);
  }
  assert.ok(seen.size > 250);
});

test('provider sender posts the documented fields and parses success/error (local fake server only)', async () => {
  const { createServer } = await import('node:http');
  let got = '';
  let reply = 'success:12345';
  const srv = createServer((req, res) => {
    let b = '';
    req.on('data', (d) => (b += d));
    req.on('end', () => {
      got = b;
      res.end(reply);
    });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const port = (srv.address() as { port: number }).port;
  const rt = smsFromEnv({
    SMS_USERNAME: 'tester',
    SMS_PASSWORD_MD5: 'ABCDEF0123456789ABCDEF0123456789',
    SMS_APIKEY: 'apikey-x',
    SMS_API_URL: `http://127.0.0.1:${port}/api/send/index.php`,
  });
  try {
    const ok = await rt.send('13912345678', '【阳光互联】您的验证码是123456，5分钟内有效。');
    assert.equal(ok.ok, true);
    const p = new URLSearchParams(got);
    assert.equal(p.get('username'), 'tester');
    assert.equal(p.get('password_md5'), 'abcdef0123456789abcdef0123456789');
    assert.equal(p.get('apikey'), 'apikey-x');
    assert.equal(p.get('mobile'), '13912345678');
    assert.equal(p.get('encode'), 'UTF-8');
    assert.equal(p.get('content'), '【阳光互联】您的验证码是123456，5分钟内有效。');
    reply = 'error:Account balance is insufficient';
    const bad = await rt.send('13912345678', 'x');
    assert.equal(bad.ok, false);
    assert.match(bad.detail, /balance/);
  } finally {
    srv.close();
  }
  const down = await smsFromEnv({ SMS_USERNAME: 'u', SMS_PASSWORD_MD5: 'a'.repeat(32), SMS_APIKEY: 'k', SMS_API_URL: 'http://127.0.0.1:1/x' }).send('13912345678', 'x');
  assert.equal(down.ok, false);
});

test('info reflects configuration; routes are 503 when disabled', async () => {
  const off = setup({ enabled: false });
  assert.equal((await off.call('GET', '/api/sms/info')).json.enabled, false);
  assert.equal((await off.call('POST', '/api/sms/send', { phone: phoneN(1) })).status, 503);
  assert.equal((await off.call('POST', '/api/sms/login', { phone: phoneN(1), code: '123456' })).status, 503);
  const on = setup();
  const info = (await on.call('GET', '/api/sms/info')).json;
  assert.deepEqual(info, { enabled: true, mock: true, codeLength: 6, resendSeconds: 60, expiresMinutes: 5 });
});

test('phone format is validated (mainland 1[3-9]xxxxxxxxx)', async () => {
  const s = setup();
  for (const bad of ['', '12345678901', '1234567890', '23912345678', '1391234567a', '+8613912345678', '139123456789']) {
    const r = await s.call('POST', '/api/sms/send', { phone: bad });
    assert.equal(r.status, 400, bad);
  }
  assert.equal(s.outbox.length, 0);
  assert.equal((await s.call('POST', '/api/sms/login', { phone: phoneN(1), code: '12345' })).status, 400);
  assert.equal((await s.call('POST', '/api/sms/login', { phone: phoneN(1), code: 'abcdef' })).status, 400);
});

test('send -> login auto-registers; code is single use; second login reuses the account', async () => {
  const s = setup();
  const phone = phoneN(2);
  const sent = await s.call('POST', '/api/sms/send', { phone });
  assert.equal(sent.status, 200);
  assert.equal(sent.json.resendSeconds, 60);
  assert.equal(s.outbox.length, 1);
  assert.match(s.outbox[0].content, /^【阳光互联】您的验证码是\d{6}，5分钟内有效。$/);
  const code = s.lastCode();

  const login = await s.call('POST', '/api/sms/login', { phone, code });
  assert.equal(login.status, 200);
  assert.equal(login.json.registered, true);
  assert.equal(login.json.user.energy, 30);
  assert.match(login.json.user.username, /^139_\d{4}_[a-z0-9]{4}$/);
  assert.equal(typeof login.json.token, 'string');
  assert.equal((await s.call('GET', '/api/me')).json.user.id, login.json.user.id);

  // 验证成功后验证码作废
  s.clearCookie();
  const reuse = await s.call('POST', '/api/sms/login', { phone, code });
  assert.equal(reuse.status, 400);
  assert.equal(reuse.json.error, '验证码错误或已过期');
  assert.equal((await s.call('GET', '/api/me')).json.user, null);

  s.advance(61_000);
  await s.call('POST', '/api/sms/send', { phone });
  const again = await s.call('POST', '/api/sms/login', { phone, code: s.lastCode() });
  assert.equal(again.status, 200);
  assert.equal(again.json.registered, false);
  assert.equal(again.json.user.id, login.json.user.id);
});

test('wrong code / unknown phone / expired / exhausted all give the same message', async () => {
  const s = setup();
  const phone = phoneN(3);
  await s.call('POST', '/api/sms/send', { phone });
  const code = s.lastCode();
  const wrong = code === '000000' ? '111111' : '000000';

  const unknown = await s.call('POST', '/api/sms/login', { phone: phoneN(99), code: '123456' });
  const bad = await s.call('POST', '/api/sms/login', { phone, code: wrong });
  assert.equal(unknown.status, 400);
  assert.deepEqual(bad.json, unknown.json);

  // 过期
  s.advance(5 * 60_000 + 1);
  assert.deepEqual((await s.call('POST', '/api/sms/login', { phone, code })).json, unknown.json);

  // 最多 5 次尝试：用完后即使输对也不行
  s.advance(61_000);
  await s.call('POST', '/api/sms/send', { phone });
  const code2 = s.lastCode();
  const wrong2 = code2 === '000000' ? '111111' : '000000';
  s.setIp('10.0.0.50');
  for (let i = 0; i < 5; i++) {
    const r = await s.call('POST', '/api/sms/login', { phone, code: wrong2 });
    assert.equal(r.status, 400);
    s.setIp(`10.0.0.${60 + i}`); // 换 IP，避开 IP 级限流，专门验证验证码自身的 5 次上限
  }
  const late = await s.call('POST', '/api/sms/login', { phone, code: code2 });
  assert.equal(late.status, 400);
  assert.equal(late.json.error, '验证码错误或已过期');
});

test('only the newest code works; resend invalidates the old one', async () => {
  const s = setup();
  const phone = phoneN(4);
  await s.call('POST', '/api/sms/send', { phone });
  const first = s.lastCode();
  s.advance(61_000);
  await s.call('POST', '/api/sms/send', { phone });
  const second = s.lastCode();
  if (first !== second) assert.equal((await s.call('POST', '/api/sms/login', { phone, code: first })).status, 400);
  assert.equal((await s.call('POST', '/api/sms/login', { phone, code: second })).status, 200);
});

test('60s resend interval per phone, with retryAfter', async () => {
  const s = setup();
  const phone = phoneN(5);
  assert.equal((await s.call('POST', '/api/sms/send', { phone })).status, 200);
  s.advance(20_000);
  const r = await s.call('POST', '/api/sms/send', { phone });
  assert.equal(r.status, 429);
  assert.equal(r.json.retryAfter, 40);
  assert.equal(s.outbox.length, 1);
  // 别的手机号不受影响
  assert.equal((await s.call('POST', '/api/sms/send', { phone: phoneN(6) })).status, 200);
  s.advance(41_000);
  assert.equal((await s.call('POST', '/api/sms/send', { phone })).status, 200);
});

test('daily limits: per phone, per IP and global', async () => {
  const s = setup({ phoneDailyLimit: 3, ipDailyLimit: 5, totalDailyLimit: 8 });
  const phone = phoneN(7);
  for (let i = 0; i < 3; i++) {
    assert.equal((await s.call('POST', '/api/sms/send', { phone })).status, 200);
    s.advance(61_000);
  }
  const capped = await s.call('POST', '/api/sms/send', { phone });
  assert.equal(capped.status, 429);
  assert.match(capped.json.error, /今日/);
  // 同 IP：已发 3 条，再发 2 条后第 6 条被拒
  assert.equal((await s.call('POST', '/api/sms/send', { phone: phoneN(8) })).status, 200);
  assert.equal((await s.call('POST', '/api/sms/send', { phone: phoneN(9) })).status, 200);
  assert.equal((await s.call('POST', '/api/sms/send', { phone: phoneN(10) })).status, 429);
  // 换 IP 继续，直到全站上限
  s.setIp('10.0.1.1');
  for (let n = 11; n < 14; n++) assert.equal((await s.call('POST', '/api/sms/send', { phone: phoneN(n) })).status, 200);
  const total = await s.call('POST', '/api/sms/send', { phone: phoneN(20) });
  assert.equal(total.status, 503);
  // 24 小时后恢复
  s.advance(24 * 3600_000);
  assert.equal((await s.call('POST', '/api/sms/send', { phone })).status, 200);
});

test('send failure: friendly message, no platform details, does not burn the cooldown', async () => {
  const s = setup();
  const phone = phoneN(11);
  s.failNext(true);
  const r = await s.call('POST', '/api/sms/send', { phone });
  assert.equal(r.status, 502);
  assert.equal(r.json.error, '短信发送失败，请稍后再试');
  assert.ok(!JSON.stringify(r.json).includes('SECRET-DETAIL'));
  s.failNext(false);
  assert.equal((await s.call('POST', '/api/sms/send', { phone })).status, 200);
});

test('only a hash of the code is stored', async () => {
  const s = setup();
  const phone = phoneN(12);
  await s.call('POST', '/api/sms/send', { phone });
  const code = s.lastCode();
  const row = await (await s.db).get<Record<string, unknown>>('SELECT * FROM sms_codes WHERE phone = ?', [phone]);
  assert.ok(row);
  assert.match(String(row.code_hash), /^[0-9a-f]{64}$/);
  assert.ok(!Object.values(row).some((v) => String(v) === code));
  assert.equal(row.expires_at, Date.parse('2026-01-10T04:00:00Z') + 300_000);
  assert.equal(row.attempts, 0);
});

test('verify brute force is throttled per IP', async () => {
  const s = setup();
  const phone = phoneN(13);
  await s.call('POST', '/api/sms/send', { phone });
  const code = s.lastCode();
  const wrong = code === '000000' ? '111111' : '000000';
  let last = 0;
  for (let i = 0; i < 10; i++) last = (await s.call('POST', '/api/sms/login', { phone, code: wrong })).status;
  assert.equal(last, 429);
  assert.equal((await s.call('POST', '/api/sms/login', { phone, code })).status, 429);
});

test('password login still works alongside; sms accounts have no usable password', async () => {
  const s = setup();
  await s.call('POST', '/api/register', { username: '小明', password: '123456' });
  assert.equal((await s.call('POST', '/api/login', { username: '小明', password: '123456' })).status, 200);
  const phone = phoneN(14);
  await s.call('POST', '/api/sms/send', { phone });
  const u = (await s.call('POST', '/api/sms/login', { phone, code: s.lastCode() })).json.user;
  s.clearCookie();
  assert.equal((await s.call('POST', '/api/login', { username: u.username, password: '123456' })).status, 401);
  assert.equal((await s.call('POST', '/api/login', { username: u.username, password: '' })).status, 401);
});

test('bind: requires login, verifies code, conflicts are rejected, rebind replaces', async () => {
  const s = setup();
  assert.equal((await s.call('POST', '/api/sms/send', { phone: phoneN(15), purpose: 'bind' })).status, 401);
  assert.equal((await s.call('GET', '/api/sms/phone')).status, 401);

  await s.call('POST', '/api/register', { username: 'binder', password: '123456' });
  assert.equal((await s.call('GET', '/api/sms/phone')).json.phone, null);
  const p1 = phoneN(16);
  await s.call('POST', '/api/sms/send', { phone: p1, purpose: 'bind' });
  // 登录用途的验证码不能拿来绑定，反之亦然
  assert.equal((await s.call('POST', '/api/sms/login', { phone: p1, code: s.lastCode() })).status, 400);
  const bound = await s.call('POST', '/api/sms/bind', { phone: p1, code: s.lastCode() });
  assert.equal(bound.status, 200);
  assert.equal(bound.json.phone, `${p1.slice(0, 3)}****${p1.slice(-4)}`);
  assert.equal((await s.call('GET', '/api/sms/phone')).json.phone, bound.json.phone);

  // 绑定后用该手机号验证码登录，进入同一个账号
  const me = (await s.call('GET', '/api/me')).json.user;
  s.clearCookie();
  s.advance(61_000);
  await s.call('POST', '/api/sms/send', { phone: p1 });
  const viaSms = await s.call('POST', '/api/sms/login', { phone: p1, code: s.lastCode() });
  assert.equal(viaSms.json.user.id, me.id);
  assert.equal(viaSms.json.registered, false);

  // 另一个账号不能绑定已被占用的手机号
  s.clearCookie();
  await s.call('POST', '/api/register', { username: 'other', password: '123456' });
  const conflict = await s.call('POST', '/api/sms/send', { phone: p1, purpose: 'bind' });
  assert.equal(conflict.status, 409);

  // 换绑：新手机号验证后替换，旧手机号释放
  s.advance(61_000);
  const p2 = phoneN(17);
  await s.call('POST', '/api/sms/send', { phone: p2, purpose: 'bind' });
  assert.equal((await s.call('POST', '/api/sms/bind', { phone: p2, code: s.lastCode() })).status, 200);
  s.advance(61_000);
  assert.equal((await s.call('POST', '/api/sms/send', { phone: p1, purpose: 'bind' })).status, 409);
  assert.equal((await s.call('POST', '/api/sms/bind', { phone: p1, code: '123456' })).status, 400);
});

test('bind code cannot be used by a different logged-in user', async () => {
  const s = setup();
  const phone = phoneN(18);
  await s.call('POST', '/api/register', { username: 'owner1', password: '123456' });
  await s.call('POST', '/api/sms/send', { phone, purpose: 'bind' });
  const code = s.lastCode();
  s.clearCookie();
  await s.call('POST', '/api/register', { username: 'thief01', password: '123456' });
  assert.equal((await s.call('POST', '/api/sms/bind', { phone, code })).status, 400);
});

test('concurrent sends to one phone only deliver once', async () => {
  const s = setup();
  const phone = phoneN(19);
  const rs = await Promise.all([1, 2, 3, 4].map(() => s.call('POST', '/api/sms/send', { phone })));
  assert.equal(rs.filter((r) => r.status === 200).length, 1);
  assert.equal(s.outbox.length, 1);
});
