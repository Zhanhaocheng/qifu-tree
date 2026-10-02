// 短信验证码登录的黑盒场景测试：对 Node 服务器或 PHP 服务器各跑一遍，并输出规范化后的对话记录用于逐字对比（parity）。
// 用法：QIFU_TEST_NOW_FILE=/tmp/clock node scripts/sms/e2e.mjs <base> <mockOutboxFile> <transcriptOut>
// 服务器必须以 mock 模式运行（SMS_MOCK=1 + SMS_MOCK_OUTBOX=<文件>）：这里不会、也无法调用真实短信平台。
import assert from 'node:assert/strict';
import fs from 'node:fs';

const [base, outbox, out] = process.argv.slice(2);
const CLOCK = process.env.QIFU_TEST_NOW_FILE;
if (!base || !outbox || !CLOCK) {
  console.error('usage: QIFU_TEST_NOW_FILE=... node e2e.mjs <base> <outbox> [transcript]');
  process.exit(2);
}
const T0 = Date.parse('2026-01-10T04:00:00Z');
const setClock = (ms) => fs.writeFileSync(CLOCK, String(ms));
let now = T0;
const tick = (ms) => setClock((now += ms));
setClock(T0);
fs.writeFileSync(outbox, '');

// 号码在运行时拼出来，仅用于 mock 环境
const phone = (n) => `139${String(20000000 + n)}`;
const log = [];
const norm = (t) =>
  t
    .replace(/[A-Za-z0-9_-]{43}/g, '<TOKEN>')
    .replace(/(139_\d{4}_)[a-z0-9]{4}/g, '$1<SFX>')
    // 用户 id 取决于库里已有多少账号（Node 会预置测试账号），默认地形由 id 决定：两边各自合理，不参与对比
    .replace(/"id":\d+/g, '"id":<ID>')
    .replace(/"terrain":"\w+"/g, '"terrain":"<T>"')
    .replace(/"ownedTerrains":\[[^\]]*\]/g, '"ownedTerrains":[<T>]');

class Client {
  constructor(ip) {
    this.ip = ip;
    this.cookie = '';
  }
  async call(label, method, path, body) {
    const h = { 'x-forwarded-for': this.ip };
    if (this.cookie) h.cookie = `qifu_session=${this.cookie}`;
    if (body !== undefined) h['content-type'] = 'application/json';
    const res = await fetch(base + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    const sc = res.headers.getSetCookie();
    if (sc.length) {
      const m = /^qifu_session=([^;]*)/.exec(sc[0]);
      if (m) this.cookie = m[1];
    }
    log.push({ label, req: `${method} ${path}`, status: res.status, type: res.headers.get('content-type'), body: norm(text), setCookie: sc.map((c) => norm(c).replace(/; Max-Age=\d+/, '')) });
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: res.status, json };
  }
  post(label, path, body) {
    return this.call(label, 'POST', path, body);
  }
  get(label, path) {
    return this.call(label, 'GET', path);
  }
}

const lastCodeFor = (p) => {
  const lines = fs.readFileSync(outbox, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const hit = lines.filter((l) => l.phone === p).pop();
  assert.ok(hit, `no sms for ${p}`);
  assert.match(hit.content, /^【阳光互联】您的验证码是\d{6}，5分钟内有效。$/);
  return /(\d{6})/.exec(hit.content)[1];
};
const wrongOf = (code) => (code === '000000' ? '111111' : '000000');
const count = () => fs.readFileSync(outbox, 'utf8').trim().split('\n').filter(Boolean).length;
const ok = (r, status, label) => assert.equal(r.status, status, `${label}: got ${r.status} ${JSON.stringify(r.json)}`);

let ipN = 0;
const client = () => new Client(`10.20.${Math.floor(++ipN / 200)}.${(ipN % 200) + 1}`);

// ---- 基本信息与格式校验
const A = client();
const info = await A.get('info', '/api/sms/info');
ok(info, 200, 'info');
assert.equal(info.json.enabled, true);
assert.equal(info.json.mock, true);
for (const [i, bad] of ['', '12345678901', '23912345678', '1391234567a', '+8613912345678'].entries())
  ok(await A.post(`invalid phone ${i}`, '/api/sms/send', { phone: bad }), 400, 'invalid phone');
assert.equal(count(), 0);

// ---- 注册 + 登录闭环
const P1 = phone(1);
ok(await A.post('send p1', '/api/sms/send', { phone: P1 }), 200, 'send');
ok(await A.post('send p1 again (interval)', '/api/sms/send', { phone: P1 }), 429, 'interval');
assert.equal(count(), 1);
const code1 = lastCodeFor(P1);
ok(await A.post('login wrong code', '/api/sms/login', { phone: P1, code: wrongOf(code1) }), 400, 'wrong');
ok(await A.post('login short code', '/api/sms/login', { phone: P1, code: '123' }), 400, 'short');
const reg = await A.post('login ok (register)', '/api/sms/login', { phone: P1, code: code1 });
ok(reg, 200, 'login');
assert.equal(reg.json.registered, true);
assert.equal(reg.json.user.energy, 30);
assert.match(reg.json.user.username, /^139_\d{4}_[a-z0-9]{4}$/);
const me = await A.get('me after sms login', '/api/me');
assert.equal(me.json.user.id, reg.json.user.id);
const B = client();
ok(await B.post('login reuse code', '/api/sms/login', { phone: P1, code: code1 }), 400, 'reuse');
ok(await B.get('me anonymous', '/api/me'), 200, 'me');

// ---- 二次登录同一个账号
tick(61_000);
ok(await B.post('send p1 second', '/api/sms/send', { phone: P1 }), 200, 'send2');
const again = await B.post('login existing', '/api/sms/login', { phone: P1, code: lastCodeFor(P1) });
ok(again, 200, 'login2');
assert.equal(again.json.registered, false);
assert.equal(again.json.user.id, reg.json.user.id);

// ---- 未发送过 / 过期 / 次数用尽：统一提示
const C = client();
const unknown = await C.post('login never sent', '/api/sms/login', { phone: phone(2), code: '123456' });
ok(unknown, 400, 'never sent');
ok(await C.post('send p3', '/api/sms/send', { phone: phone(3) }), 200, 'send p3');
const code3 = lastCodeFor(phone(3));
tick(300_001);
const expired = await C.post('login expired', '/api/sms/login', { phone: phone(3), code: code3 });
assert.deepEqual(expired.json, unknown.json);

tick(61_000);
const P4 = phone(4);
ok(await C.post('send p4', '/api/sms/send', { phone: P4 }), 200, 'send p4');
const code4 = lastCodeFor(P4);
for (let i = 1; i <= 5; i++) ok(await client().post(`p4 wrong ${i}`, '/api/sms/login', { phone: P4, code: wrongOf(code4) }), 400, 'wrong');
const exhausted = await client().post('p4 correct after 5 wrong', '/api/sms/login', { phone: P4, code: code4 });
assert.deepEqual(exhausted.json, unknown.json);
ok(exhausted, 400, 'exhausted');

// ---- 重发使旧验证码失效
tick(61_000);
const P5 = phone(5);
const D = client();
await D.post('send p5 a', '/api/sms/send', { phone: P5 });
const c5a = lastCodeFor(P5);
tick(61_000);
await D.post('send p5 b', '/api/sms/send', { phone: P5 });
const c5b = lastCodeFor(P5);
if (c5a !== c5b) ok(await D.post('p5 old code', '/api/sms/login', { phone: P5, code: c5a }), 400, 'old');
ok(await D.post('p5 new code', '/api/sms/login', { phone: P5, code: c5b }), 200, 'new');

// ---- 验证次数限流（同 IP）
const E = client();
for (let i = 1; i <= 9; i++) await E.post(`ip verify throttle ${i}`, '/api/sms/login', { phone: phone(6), code: '000000' });
ok(await E.post('ip verify throttled', '/api/sms/login', { phone: phone(6), code: '000000' }), 429, 'throttle');

// ---- 每日上限（服务器以 SMS_PHONE_DAILY_LIMIT=3、SMS_IP_DAILY_LIMIT=8 启动）
tick(25 * 3600_000);
const F = client();
const P7 = phone(7);
for (let i = 1; i <= 3; i++) {
  ok(await F.post(`daily phone ${i}`, '/api/sms/send', { phone: P7 }), 200, 'daily');
  tick(61_000);
}
ok(await F.post('daily phone cap', '/api/sms/send', { phone: P7 }), 429, 'phone cap');
for (let n = 8; n <= 12; n++) ok(await F.post(`daily ip ${n}`, '/api/sms/send', { phone: phone(n) }), 200, 'ip');
ok(await F.post('daily ip cap', '/api/sms/send', { phone: phone(13) }), 429, 'ip cap');
tick(25 * 3600_000);
ok(await F.post('daily reset after 25h', '/api/sms/send', { phone: P7 }), 200, 'reset');

// ---- 绑定手机号
const G = client();
ok(await G.post('bind send anonymous', '/api/sms/send', { phone: phone(20), purpose: 'bind' }), 401, 'anon bind');
ok(await G.get('phone anonymous', '/api/sms/phone'), 401, 'phone anon');
ok(await G.post('register pw user', '/api/register', { username: 'binder', password: '123456' }), 200, 'register');
assert.equal((await G.get('phone none', '/api/sms/phone')).json.phone, null);
ok(await G.post('bind send', '/api/sms/send', { phone: phone(20), purpose: 'bind' }), 200, 'bind send');
const bc = lastCodeFor(phone(20));
ok(await G.post('login with bind code (wrong purpose)', '/api/sms/login', { phone: phone(20), code: bc }), 400, 'wrong purpose');
const bound = await G.post('bind', '/api/sms/bind', { phone: phone(20), code: bc });
ok(bound, 200, 'bind');
assert.equal(bound.json.phone, `139****${phone(20).slice(-4)}`);
assert.equal((await G.get('phone bound', '/api/sms/phone')).json.phone, bound.json.phone);
tick(61_000);
const H = client();
await H.post('send for bound phone', '/api/sms/send', { phone: phone(20) });
const viaBound = await H.post('login via bound phone', '/api/sms/login', { phone: phone(20), code: lastCodeFor(phone(20)) });
ok(viaBound, 200, 'via bound');
assert.equal(viaBound.json.registered, false);
assert.equal(viaBound.json.user.username, 'binder');
const I = client();
ok(await I.post('register other', '/api/register', { username: 'other01', password: '123456' }), 200, 'reg other');
ok(await I.post('bind taken phone', '/api/sms/send', { phone: phone(20), purpose: 'bind' }), 409, 'taken');

// 密码登录与短信账号并存：短信注册的账号没有可用密码
ok(await client().post('password login still works', '/api/login', { username: 'binder', password: '123456' }), 200, 'pw login');
ok(await client().post('sms user cannot password login', '/api/login', { username: reg.json.user.username, password: '123456' }), 401, 'no pw');

if (out) fs.writeFileSync(out, JSON.stringify(log, null, 1));
console.log(`sms e2e OK against ${base}: ${log.length} steps`);
