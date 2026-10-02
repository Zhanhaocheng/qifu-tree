// 黑盒对比测试：对 Node 服务器和 PHP 服务器执行完全相同的场景，逐步比较状态码/响应原文/关键响应头。
// 用法：node scripts/parity/run.mjs <nodeBase> <phpBase>   （时钟文件由 QIFU_TEST_NOW_FILE 指定，两个服务器都读取）
import fs from 'node:fs';

const [nodeBase, phpBase] = process.argv.slice(2);
const CLOCK = process.env.QIFU_TEST_NOW_FILE;
if (!nodeBase || !phpBase || !CLOCK) {
  console.error('usage: QIFU_TEST_NOW_FILE=/tmp/clock node run.mjs <nodeBase> <phpBase>');
  process.exit(2);
}
const T0 = Date.parse('2026-01-10T04:00:00Z');
const DAY = 24 * 3600 * 1000;
const ALLOWED = 'http://qifu.laixi.cn';
const setClock = (ms) => fs.writeFileSync(CLOCK, String(ms));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let ipCounter = 0;
const nextIp = () => `10.1.${Math.floor(++ipCounter / 250)}.${(ipCounter % 250) + 1}`;

function norm(text) {
  return text.replace(/[A-Za-z0-9_-]{43}/g, '<TOKEN>');
}

class Client {
  constructor(base, log, ip = nextIp()) {
    this.base = base;
    this.log = log;
    this.ip = ip;
    this.cookie = '';
    this.token = '';
  }
  async call(label, method, path, { body, raw, headers = {}, cookie = this.cookie, bearer, ip = this.ip } = {}) {
    const h = { 'x-forwarded-for': ip, ...headers };
    if (cookie) h.cookie = `qifu_session=${cookie}`;
    if (bearer !== undefined) h.authorization = `Bearer ${bearer}`;
    let payload;
    if (raw !== undefined) payload = raw;
    else if (body !== undefined) payload = JSON.stringify(body);
    if (payload !== undefined) h['content-type'] = 'application/json';
    const res = await fetch(this.base + path, { method, headers: h, body: payload });
    const text = await res.text();
    const sc = res.headers.getSetCookie();
    const rec = {
      label,
      req: `${method} ${path}`,
      status: res.status,
      type: res.headers.get('content-type'),
      body: norm(text),
      setCookie: sc.map(norm),
      acao: res.headers.get('access-control-allow-origin'),
      acac: res.headers.get('access-control-allow-credentials'),
      acah: res.headers.get('access-control-allow-headers'),
      acam: res.headers.get('access-control-allow-methods'),
      acma: res.headers.get('access-control-max-age'),
    };
    this.log.push(rec);
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}
    if (sc.length) {
      const m = /^qifu_session=([^;]*)/.exec(sc[0]);
      if (m) this.cookie = m[1];
    }
    if (json && typeof json.token === 'string') this.token = json.token;
    return { status: res.status, json, rec };
  }
  post(label, path, body, o = {}) {
    return this.call(label, 'POST', path, { body, ...o });
  }
  get(label, path, o = {}) {
    return this.call(label, 'GET', path, o);
  }
  fresh() {
    return new Client(this.base, this.log);
  }
}

async function scenarios(base) {
  const log = [];
  const A = new Client(base, log);
  const reg = (c, u, p = '123456', label = `register ${u}`) => c.post(label, '/api/register', { username: u, password: p });

  // 预热：Node 首个请求会再 upsert 一次测试账号（SQLite 自增 id 被消耗），PHP 用一次测试账号登录对齐
  setClock(T0);
  if (base === phpBase) await fetch(base + '/api/login', { method: 'POST', headers: { 'x-forwarded-for': '10.0.0.1' }, body: JSON.stringify({ username: 'qifu_test', password: 'Qifu@Test2026' }) });
  else await fetch(base + '/api/config');

  // ---- S1 匿名与路由
  await A.get('config', '/api/config');
  await A.get('me anon', '/api/me');
  await A.get('prayers empty', '/api/prayers');
  for (const [p, b] of [['checkin'], ['pray', { item: 'wood', text: 'x' }], ['terrain', { terrain: 'snow' }], ['topup', { pack: 'p1' }]]) await A.post(`anon ${p}`, `/api/${p}`, b);
  await A.post('anon logout', '/api/logout');
  await A.get('unknown route', '/api/nope');
  await A.get('wrong method login', '/api/login');
  await A.post('wrong method config', '/api/config', {});
  await A.get('trailing slash', '/api/me/');
  await A.get('query string', '/api/me?x=1');
  await A.call('preflight allowed', 'OPTIONS', '/api/pray', { headers: { origin: ALLOWED, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' } });
  await A.get('cors allowed', '/api/me', { headers: { origin: ALLOWED } });
  await A.get('cors denied', '/api/me', { headers: { origin: 'http://evil.example' } });
  await A.get('bad bearer', '/api/me', { bearer: 'nope' });
  await A.get('basic auth', '/api/me', { headers: { authorization: 'Basic abc' } });

  // ---- S2 校验
  const V = A.fresh();
  const names = ['a', '字'.repeat(21), 'a b', 'a!b', 'ab@c', '😀😀', '', '   ', 'e\u0301x', 'a.b', 'a/b'];
  for (const n of names) await reg(V, n, '123456', `bad username ${JSON.stringify(n)}`);
  await V.post('username number', '/api/register', { username: 123, password: '123456' });
  await V.post('username missing', '/api/register', { password: '123456' });
  await V.call('invalid json', 'POST', '/api/register', { raw: 'not json' });
  await V.call('array body', 'POST', '/api/register', { raw: '[]' });
  await V.call('string body', 'POST', '/api/register', { raw: '"str"' });
  await V.call('number body', 'POST', '/api/register', { raw: '123' });
  await V.call('empty body', 'POST', '/api/register', { raw: '' });
  for (const [label, pw] of [['short', '12345'], ['73', 'a'.repeat(73)], ['emoji 74 units', '😀'.repeat(37)], ['number', 123456], ['missing', undefined]]) {
    await V.post(`bad password ${label}`, '/api/register', { username: 'pwtest', password: pw });
  }
  for (const [u, p] of [
    ['  小明_x-1  ', 'a'.repeat(72)],
    ['\u00a0nbsp1\u00a0', '😀'.repeat(36)],
    ['\ufeffbom1', '密'.repeat(37)],
    ['ａｂｃ１', '123456'],
    ['字'.repeat(20), '123456'],
    ['ab', '123456'],
    ['x-_y', 'p@ss word'],
  ]) {
    const c = A.fresh();
    await reg(c, u, p);
    await c.get('me', '/api/me');
    await c.post('login same', '/api/login', { username: u, password: p });
  }

  // ---- S3 登录会话
  const C = A.fresh();
  await reg(C, 'Tester_A');
  const tokA = C.token;
  await C.get('me cookie', '/api/me');
  await C.get('me bearer only', '/api/me', { cookie: '', bearer: tokA });
  await C.get('me bad bearer + good cookie', '/api/me', { bearer: 'bogus' });
  await C.get('me good bearer + bad cookie', '/api/me', { cookie: 'bogus', bearer: tokA });
  await C.get('me lowercase bearer scheme', '/api/me', { cookie: '', headers: { authorization: `bearer   ${tokA}` } });
  await C.get('me bearer no token', '/api/me', { cookie: '', headers: { authorization: 'Bearer' } });
  for (const n of ['tester_a', 'TESTER_A']) await reg(A.fresh(), n, '123456', `dup ${n}`);
  const L = A.fresh();
  await L.post('login lower', '/api/login', { username: 'tester_a', password: '123456' });
  const tokB = L.token;
  await L.post('login wrong pw', '/api/login', { username: 'Tester_A', password: 'wrongpw' });
  await L.post('login unknown', '/api/login', { username: 'nobody_here', password: '123456' });
  await L.post('login leading space pw', '/api/login', { username: 'Tester_A', password: ' 123456' });
  await L.post('login empty', '/api/login', {});
  await L.post('login username padded', '/api/login', { username: '  Tester_A ', password: '123456' });
  await L.post('login https cookie', '/api/login', { username: 'Tester_A', password: '123456' }, { headers: { 'x-forwarded-proto': 'https' } });
  await L.call('logout bearer only', 'POST', '/api/logout', { cookie: '', bearer: tokB });
  await L.get('bearer B dead', '/api/me', { cookie: '', bearer: tokB });
  await C.get('cookie A alive', '/api/me', { cookie: tokA });
  await C.post('logout cookie', '/api/logout');
  await C.get('cookie A dead', '/api/me', { cookie: tokA });
  const E = A.fresh();
  await E.post('login for expiry', '/api/login', { username: 'Tester_A', password: '123456' });
  await E.post('login for both-logout', '/api/login', { username: 'Tester_A', password: '123456' });
  const e2 = E.token;
  await E.call('logout both', 'POST', '/api/logout', { bearer: e2 });
  await E.get('after logout both', '/api/me');
  const X = A.fresh();
  await X.post('login for expiry2', '/api/login', { username: 'Tester_A', password: '123456' });
  setClock(T0 + 31 * DAY);
  await X.get('expired session', '/api/me');
  await X.get('expired again', '/api/me');
  setClock(T0);
  await reg(A.fresh(), 'Éclair');
  await reg(A.fresh(), 'éclair', '123456', 'non-ascii case differs');
  await reg(A.fresh(), 'cafe');
  await reg(A.fresh(), 'café', '123456', 'accent differs');

  // ---- S4 签到
  const K = A.fresh();
  await reg(K, 'checker');
  await K.post('checkin 1', '/api/checkin');
  await K.post('checkin again', '/api/checkin');
  await K.get('me after', '/api/me');
  for (let d = 1; d <= 8; d++) {
    setClock(T0 + d * DAY);
    if (d === 3) await K.get(`me day ${d} before`, '/api/me');
    await K.post(`checkin day ${d}`, '/api/checkin');
  }
  setClock(T0 + 10 * DAY);
  await K.get('me gap', '/api/me');
  await K.post('checkin after gap', '/api/checkin');
  setClock(Date.parse('2026-02-10T15:59:59Z'));
  await K.post('checkin 23:59:59 CST', '/api/checkin');
  await K.post('checkin same CST day', '/api/checkin');
  setClock(Date.parse('2026-02-10T16:00:00Z'));
  await K.get('me after midnight CST', '/api/me');
  await K.post('checkin 00:00:00 CST', '/api/checkin');
  setClock(T0);

  // ---- S5 祈福
  const P = A.fresh();
  await reg(P, 'prayer1');
  await P.post('pray wood', '/api/pray', { item: 'wood', text: '愿家人平安' });
  await P.post('pray ribbon insufficient', '/api/pray', { item: 'ribbon', text: 'x' });
  await P.post('pray wood 2', '/api/pray', { item: 'wood', text: 'two' });
  await P.post('pray wood 3', '/api/pray', { item: 'wood', text: 'three' });
  await P.post('pray wood broke', '/api/pray', { item: 'wood', text: 'four' });
  await P.post('pray gold no coins', '/api/pray', { item: 'gold', text: 'x' });
  await P.post('topup p6', '/api/topup', { pack: 'p1' });
  await P.post('pray gold', '/api/pray', { item: 'gold', text: ' 金牌 ' });
  await P.post('pray ribbon', '/api/pray', { item: 'ribbon', text: 'ribbon' });
  await P.post('pray lotus insufficient', '/api/pray', { item: 'lotus', text: 'x' });
  await P.post('topup p30', '/api/topup', { pack: 'p5' });
  await P.post('pray lantern', '/api/pray', { item: 'lantern', text: 'lantern' });
  await P.post('pray lotus', '/api/pray', { item: 'lotus', text: 'lotus' });
  for (const [label, b] of [
    ['no item', { text: 'x' }],
    ['bad item', { item: 'foo', text: 'x' }],
    ['item number', { item: 5, text: 'x' }],
    ['item null', { item: null, text: 'x' }],
    ['no text', { item: 'gold' }],
    ['blank text', { item: 'gold', text: '   ' }],
    ['text number', { item: 'gold', text: 5 }],
    ['61 chars', { item: 'gold', text: 'x'.repeat(61) }],
    ['60 chars', { item: 'gold', text: 'y'.repeat(60) }],
    ['60 emoji', { item: 'gold', text: '😀'.repeat(60) }],
    ['61 emoji', { item: 'gold', text: '😀'.repeat(61) }],
    ['newline text', { item: 'gold', text: 'line1\nline2 "quoted" \\ back/slash <b>' }],
    ['unicode ws trim', { item: 'gold', text: '\u3000全角空格\u3000' }],
  ]) await P.post(`pray ${label}`, '/api/pray', b);
  await P.post('topup 98', '/api/topup', { pack: 'p10' });
  const S = A.fresh();
  await reg(S, 'stager');
  await S.post('topup', '/api/topup', { pack: 'p10' });
  for (let i = 1; i <= 41; i++) {
    if (i % 10 === 0) await S.post(`topup ${i}`, '/api/topup', { pack: 'p10' });
    await S.post(`stage pray ${i}`, '/api/pray', { item: 'gold', text: `n${i}` });
  }

  // ---- S6 地形
  const ids = [];
  for (let i = 0; i < 8; i++) {
    const c = A.fresh();
    const r = await reg(c, `terr${i}`);
    if (r.status !== 200) console.log('S6 register failed', i, r.status, JSON.stringify(r.json));
    ids.push(c);
  }
  const T = ids[0];
  await T.post('terrain unknown', '/api/terrain', { terrain: 'nope' });
  await T.post('terrain missing', '/api/terrain', {});
  await T.post('terrain number', '/api/terrain', { terrain: 3 });
  const cur = (await T.get('me terr', '/api/me')).json.user;
  await T.post('terrain switch current', '/api/terrain', { terrain: cur.terrain });
  const other = ['snow', 'bamboo', 'desert', 'jiangnan', 'mountain'].find((t) => t !== cur.terrain);
  await T.post('terrain unlock broke', '/api/terrain', { terrain: other });
  for (let i = 0; i < 4; i++) await T.post(`topup ${i}`, '/api/topup', { pack: 'p10' });
  for (const t of ['snow', 'bamboo', 'desert', 'jiangnan', 'mountain', 'snow', 'bamboo']) await T.post(`terrain ${t}`, '/api/terrain', { terrain: t });
  await T.get('me end', '/api/me');

  // ---- S7 充值
  const U = A.fresh();
  await reg(U, 'topper');
  for (const p of ['p1', 'p5', 'p10', 'p999', undefined, 6]) await U.post(`topup ${p}`, '/api/topup', { pack: p });

  // ---- S8 列表
  const B1 = A.fresh();
  const B2 = A.fresh();
  await reg(B1, 'lister1');
  await reg(B2, 'lister2');
  setClock(T0);
  await B1.post('l1 pray', '/api/pray', { item: 'wood', text: 'from 1' });
  setClock(T0 + 1000);
  await B2.post('l2 pray', '/api/pray', { item: 'wood', text: 'from 2' });
  await A.get('list anon', '/api/prayers');
  await B1.get('list as 1', '/api/prayers');
  await B2.get('list as 2', '/api/prayers');
  await B1.get('list bearer', '/api/prayers', { cookie: '', bearer: B1.token });
  setClock(T0 + 25 * 3600 * 1000);
  await B1.get('list recent24h shrinks', '/api/prayers');
  setClock(T0);

  // ---- S9 测试账号
  const Q = A.fresh();
  await Q.post('test login wrong pw', '/api/login', { username: 'qifu_test', password: 'wrong' });
  await Q.post('test login', '/api/login', { username: 'qifu_test', password: 'Qifu@Test2026' });
  await Q.post('test login upper', '/api/login', { username: 'QIFU_TEST', password: 'Qifu@Test2026' });
  await reg(A.fresh(), 'qifu_test', '123456', 'register qifu_test');
  await reg(A.fresh(), 'Qifu_Test', '123456', 'register Qifu_Test');
  await Q.post('test pray lotus', '/api/pray', { item: 'lotus', text: 'unlimited' });
  await Q.post('test pray wood', '/api/pray', { item: 'wood', text: 'unlimited' });
  await Q.post('test pray gold', '/api/pray', { item: 'gold', text: 'unlimited' });
  for (const t of ['snow', 'bamboo', 'desert']) await Q.post(`test terrain ${t}`, '/api/terrain', { terrain: t });
  await Q.post('test topup', '/api/topup', { pack: 'p10' });
  await Q.post('test checkin', '/api/checkin');
  await Q.get('test me', '/api/me');
  for (let i = 1; i <= 305; i++) await Q.post(i % 50 === 0 ? `bulk ${i}` : 'bulk', '/api/pray', { item: i % 2 ? 'wood' : 'lotus', text: `b${i}` });
  await Q.get('list capped at 300', '/api/prayers');

  // ---- S10 限流（每个子场景使用独立 IP，时钟固定）
  const R = A.fresh();
  R.ip = '10.9.9.9';
  setClock(T0);
  for (let i = 1; i <= 9; i++) await R.post(`bad login ${i}`, '/api/login', { username: 'Tester_A', password: 'bad' + i });
  await R.post('good login while throttled', '/api/login', { username: 'Tester_A', password: '123456' });
  await R.post('other user same ip', '/api/login', { username: 'checker', password: '123456' });
  setClock(T0 + 11 * 60 * 1000);
  await R.post('good login after window', '/api/login', { username: 'Tester_A', password: '123456' });
  for (let i = 1; i <= 3; i++) await R.post(`bad after reset ${i}`, '/api/login', { username: 'Tester_A', password: 'bad' });
  await R.post('good resets counter', '/api/login', { username: 'Tester_A', password: '123456' });
  const G = A.fresh();
  G.ip = '10.9.9.10';
  setClock(T0);
  for (let i = 1; i <= 9; i++) await reg(G, `ratelim${i}`, '123456', `rate register ${i}`);
  await G.post('rate register invalid first', '/api/register', { username: 'x', password: '123456' });
  await reg(G, 'checker', '123456', 'rate register dup while throttled');
  setClock(T0 + 11 * 60 * 1000);
  await reg(G, 'ratelim10', '123456', 'rate register after window');
  setClock(T0);
  return log;
}

function compare(a, b) {
  let diffs = 0;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = JSON.stringify(a[i]);
    const y = JSON.stringify(b[i]);
    if (x !== y) {
      diffs++;
      if (diffs <= 15) {
        console.log(`\nDIFF #${i} [${a[i]?.label}]`);
        for (const k of Object.keys({ ...a[i], ...b[i] })) {
          const p = JSON.stringify(a[i]?.[k]);
          const q = JSON.stringify(b[i]?.[k]);
          if (p !== q) {
            let at = 0;
            while (p && q && p[at] === q[at]) at++;
            console.log(` ${k}: node=${p?.slice(Math.max(0, at - 60), at + 120)}\n ${' '.repeat(k.length)}  php =${q?.slice(Math.max(0, at - 60), at + 120)}`);
          }
        }
      }
    }
  }
  return diffs;
}

const tNode = await scenarios(nodeBase);
const tPhp = await scenarios(phpBase);
const diffs = compare(tNode, tPhp);
const statuses = {};
for (const r of tNode) statuses[r.status] = (statuses[r.status] ?? 0) + 1;
console.log(`steps: node=${tNode.length} php=${tPhp.length}; status histogram (node): ${JSON.stringify(statuses)}`);
if (process.env.TRANSCRIPT) fs.writeFileSync(process.env.TRANSCRIPT, JSON.stringify({ node: tNode, php: tPhp }, null, 1));
console.log(diffs === 0 ? 'PARITY OK: all steps identical' : `PARITY FAIL: ${diffs} differing steps`);
process.exit(diffs === 0 ? 0 : 1);
