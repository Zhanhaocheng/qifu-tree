// 支付宝充值集成测试：真实 PHP + MySQL，伪造的「支付宝」用临时 RSA 密钥签名（不使用任何真实密钥）。
//   - 验签：通知签名错误 / 金额被改 / app_id 不符 / sign_type 非 RSA2 一律拒绝
//   - 幂等：重复通知、10 路并发通知、通知 + 查单 + return 同时到达，福币只加一次
//   - 补单：网关回 TRADE_SUCCESS 时查单接口入账；网关响应被篡改 / 金额不符不入账
// 用法：QIFU_DB_NAME=... QIFU_DB_USER=... QIFU_DB_PASS=... node scripts/pay/alipay.test.mjs
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { generateKeyPairSync, createSign, createVerify, randomBytes } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const env = process.env;
for (const k of ['QIFU_DB_NAME', 'QIFU_DB_USER', 'QIFU_DB_PASS']) if (!env[k]) throw new Error(`${k} 未设置（必须指向可清空的测试库）`);

const APP_ID = '2021000000000001';
const PORT_SITE = 47381;
const PORT_DEMO = 47382;
const PORT_GW = 47383;
const PORT_TEST = 47385;
const TESTP = `http://127.0.0.1:${PORT_TEST}`;
const SITE = `http://127.0.0.1:${PORT_SITE}`;
const DEMO = `http://127.0.0.1:${PORT_DEMO}`;
const NOTIFY_URL = 'http://qifu.laixi.cn/api/index.php?path=/pay/alipay/notify';
const RETURN_URL = 'http://qifu.laixi.cn/api/index.php?path=/pay/alipay/return';

const rsa = () => generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
const appKeys = rsa(); // 商户应用密钥（私钥给 PHP，公钥由「支付宝」保存用来验我们的请求）
const aliKeys = rsa(); // 支付宝密钥（私钥签通知/响应，公钥给 PHP）
const rawB64 = (pem) => pem.replace(/-----[A-Z ]+-----|\s+/g, '');

const sign = (content, privPem) => createSign('RSA-SHA256').update(content, 'utf8').sign(privPem, 'base64');
const signContent = (p, skip = ['sign']) =>
  Object.keys(p).filter((k) => !skip.includes(k) && p[k] !== '' && p[k] != null).sort().map((k) => `${k}=${p[k]}`).join('&');

function notifyParams(over = {}) {
  const p = {
    gmt_create: '2026-10-02 10:00:00', charset: 'utf-8', seller_id: '2088000000000001', subject: 'test',
    sign_type: 'RSA2', notify_id: randomBytes(8).toString('hex'), notify_type: 'trade_status_sync', app_id: APP_ID,
    version: '1.0', auth_app_id: APP_ID, buyer_id: '2088000000000009', invoice_amount: '1.00', fund_bill_list: '[{"amount":"1.00","fundChannel":"ALIPAYACCOUNT"}]',
    trade_status: 'TRADE_SUCCESS', gmt_payment: '2026-10-02 10:00:05', ...over,
  };
  p.sign = sign(signContent(p, ['sign', 'sign_type']), aliKeys.privateKey);
  return p;
}

/* ------------------------------------------------------------ fake gateway */
const gwOrders = new Map(); // out_trade_no -> { status, amount, tradeNo, tamper }
const gwRequests = [];
const gw = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const p = Object.fromEntries(new URLSearchParams(body));
    gwRequests.push(p);
    const valid = createVerify('RSA-SHA256').update(signContent(p), 'utf8').verify(appKeys.publicKey, p.sign ?? '', 'base64');
    const biz = JSON.parse(p.biz_content ?? '{}');
    const key = `${(p.method ?? '').replace(/\./g, '_')}_response`;
    let inner;
    let tamper = false;
    if (!valid || p.app_id !== APP_ID || p.sign_type !== 'RSA2' || p.charset !== 'utf-8') {
      inner = { code: '40002', msg: 'Invalid Arguments', sub_code: 'isv.invalid-signature', sub_msg: '签名无效' };
    } else if (p.method === 'alipay.trade.precreate') {
      inner = { code: '10000', msg: 'Success', out_trade_no: biz.out_trade_no, qr_code: `https://qr.alipay.com/fake_${biz.out_trade_no}` };
    } else if (p.method === 'alipay.trade.query') {
      const o = gwOrders.get(biz.out_trade_no);
      if (!o) inner = { code: '40004', msg: 'Business Failed', sub_code: 'ACQ.TRADE_NOT_EXIST', sub_msg: '交易不存在' };
      else {
        tamper = !!o.tamper;
        inner = { code: '10000', msg: 'Success', out_trade_no: biz.out_trade_no, trade_no: o.tradeNo, trade_status: o.status, total_amount: o.amount };
      }
    } else inner = { code: '40004', msg: 'Business Failed', sub_msg: 'unsupported' };
    const text = JSON.stringify(inner);
    const sig = tamper ? sign(text + 'x', aliKeys.privateKey) : sign(text, aliKeys.privateKey);
    res.setHeader('content-type', 'application/json;charset=utf-8');
    res.end(`{"${key}":${text},"sign":"${sig}"}`);
  });
});

/* ------------------------------------------------------------- php servers */
const procs = [];
const tmp = mkdtempSync(join(tmpdir(), 'qifu-pay-'));
const phpStr = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const INSTALL_SECRET = 'pay-test-install-secret-1234';

function makeSite(name, extra) {
  const dir = join(tmp, name);
  mkdirSync(dir, { recursive: true });
  cpSync(join(root, 'php-backend/api'), join(dir, 'api'), { recursive: true });
  const cfg = {
    DB_HOST: env.QIFU_DB_HOST ?? '127.0.0.1', DB_PORT: Number(env.QIFU_DB_PORT ?? 3306), DB_NAME: env.QIFU_DB_NAME, DB_USER: env.QIFU_DB_USER, DB_PASS: env.QIFU_DB_PASS,
    INSTALL_SECRET, TRUST_PROXY_HEADERS: true, TEST_ACCOUNT_DISABLED: true, DEBUG: true, ...extra,
  };
  const lines = Object.entries(cfg).map(([k, v]) => `  ${phpStr(k)} => ${typeof v === 'boolean' ? v : typeof v === 'number' ? v : phpStr(v)},`);
  writeFileSync(join(dir, 'api/config.php'), `<?php\nif (!defined('QIFU')) { http_response_code(403); exit; }\nreturn [\n${lines.join('\n')}\n];\n`);
  return dir;
}

function startPhp(dir, port) {
  const args = [];
  if (env.PHP_DISABLE_FUNCTIONS) args.push('-d', `disable_functions=${env.PHP_DISABLE_FUNCTIONS}`);
  args.push('-d', 'display_errors=1', '-d', 'error_reporting=-1', '-S', `127.0.0.1:${port}`, '-t', dir);
  const p = spawn('php', args, { env: { ...env, PHP_CLI_SERVER_WORKERS: '8' }, stdio: ['ignore', 'ignore', 'pipe'] });
  let log = '';
  p.stderr.on('data', (d) => (log += d));
  procs.push({ p, get log() { return log; } });
}

async function waitUp(url) {
  for (let i = 0; i < 80; i++) {
    try {
      await fetch(url);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error(`server not up: ${url}`);
}

/* ------------------------------------------------------------------ client */
const call = async (base, method, path, { body, form, jar, headers = {}, redirect } = {}) => {
  const h = { ...headers };
  if (jar?.cookie) h.cookie = jar.cookie;
  let payload;
  if (body) { h['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  if (form) { h['content-type'] = 'application/x-www-form-urlencoded'; payload = new URLSearchParams(form).toString(); }
  const url = `${base}/api/index.php?path=${path.replace('?', '&')}`;
  const res = await fetch(url, { method, headers: h, body: payload, redirect: redirect ?? 'follow' });
  const sc = res.headers.getSetCookie?.() ?? [];
  if (jar && sc.length) jar.cookie = sc.map((c) => c.split(';')[0]).join('; ');
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* plain text */ }
  return { status: res.status, text, json, res };
};

let ipSeq = 10;
async function newUser(base = SITE) {
  const jar = {};
  const name = `u${randomBytes(4).toString('hex')}`;
  const r = await call(base, 'POST', '/register', { body: { username: name, password: 'pw123456' }, jar, headers: { 'x-forwarded-for': `10.9.0.${ipSeq++}` } });
  assert.equal(r.status, 200, r.text);
  return { jar, name, id: r.json.user.id };
}
const coinsOf = async (u) => (await call(SITE, 'GET', '/me', { jar: u.jar })).json.user.coins;
const create = (u, pack = 'p1', device = 'desktop') => call(SITE, 'POST', '/pay/alipay/create', { body: { pack, device }, jar: u.jar });
const postNotify = (params) => call(SITE, 'POST', '/pay/alipay/notify', { form: params });
const payNotify = (orderNo, over = {}) => notifyParams({ out_trade_no: orderNo, trade_no: `2026100222001${orderNo.slice(-8)}`, total_amount: '1.00', ...over });

before(async () => {
  await new Promise((r) => gw.listen(PORT_GW, '127.0.0.1', r));
  const common = { ALIPAY_APP_ID: APP_ID, ALIPAY_GATEWAY: `http://127.0.0.1:${PORT_GW}/gateway.do`, ALIPAY_SELLER_ID: '2088000000000001' };
  // 主站点：密钥用「去掉头尾的裸 base64」格式，顺带验证格式兼容；notify/return 不写，验证默认值
  const siteDir = makeSite('site', { ...common, ALIPAY_PRIVATE_KEY: rawB64(appKeys.privateKey), ALIPAY_PUBLIC_KEY: rawB64(aliKeys.publicKey) });
  const demoDir = makeSite('demo', {});
  const testDir = makeSite('testprice', { ...common, ALIPAY_PRIVATE_KEY: appKeys.privateKey, ALIPAY_PUBLIC_KEY: aliKeys.publicKey, PAY_TEST_PRICES: true });
  // 先清库再安装
  execFileSync('php', ['-r', `$p=new PDO("mysql:host=".getenv("QIFU_DB_HOST").";port=".(getenv("QIFU_DB_PORT")?:3306).";dbname=".getenv("QIFU_DB_NAME").";charset=utf8mb4",getenv("QIFU_DB_USER"),getenv("QIFU_DB_PASS"));$p->exec("SET FOREIGN_KEY_CHECKS=0");foreach($p->query("SHOW TABLES")->fetchAll(PDO::FETCH_COLUMN) as $t){$p->exec("DROP TABLE \`$t\`");}`], { env: { ...env, QIFU_DB_HOST: env.QIFU_DB_HOST ?? '127.0.0.1' } });
  startPhp(siteDir, PORT_SITE);
  startPhp(demoDir, PORT_DEMO);
  startPhp(testDir, PORT_TEST);
  await waitUp(`${SITE}/api/index.php?path=/config`);
  await waitUp(`${DEMO}/api/index.php?path=/config`);
  await waitUp(`${TESTP}/api/index.php?path=/config`);
  const inst = await fetch(`${SITE}/api/install.php`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `key=${INSTALL_SECRET}` });
  assert.ok((await inst.text()).includes('安装完成'));
});

after(async () => {
  for (const { p } of procs) p.kill();
  gw.close();
  rmSync(tmp, { recursive: true, force: true });
});

/* ------------------------------------------------------------------- tests */
test('install.php 建好 pay_orders，且 /pay/info 报告支付宝模式', async () => {
  const r = await call(SITE, 'GET', '/pay/info');
  assert.deepEqual(r.json, { mode: 'alipay', ready: true, sandbox: false, pcMode: 'qr', testPrices: false });
});

test('未配置支付宝：保留模拟充值，真实支付接口不可用', async () => {
  const info = await call(DEMO, 'GET', '/pay/info');
  assert.equal(info.json.mode, 'demo');
  const u = await newUser(DEMO);
  const top = await call(DEMO, 'POST', '/topup', { body: { pack: 'p1' }, jar: u.jar });
  assert.equal(top.status, 200);
  assert.equal(top.json.added, 60);
  assert.equal(top.json.demo, true);
  const c = await call(DEMO, 'POST', '/pay/alipay/create', { body: { pack: 'p1' }, jar: u.jar });
  assert.equal(c.status, 400);
});

test('已配置支付宝：模拟充值接口被关闭（不能白拿福币）', async () => {
  const u = await newUser();
  const top = await call(SITE, 'POST', '/topup', { body: { pack: 'p10' }, jar: u.jar });
  assert.equal(top.status, 403);
  assert.equal(await coinsOf(u), 0);
});

test('配置填了一半（只有 APPID）：不退回模拟充值，也不能下单', async () => {
  const dir = makeSite('half', { ALIPAY_APP_ID: APP_ID });
  startPhp(dir, 47384);
  await waitUp('http://127.0.0.1:47384/api/index.php?path=/config');
  const u = await newUser('http://127.0.0.1:47384');
  const info = await call('http://127.0.0.1:47384', 'GET', '/pay/info');
  assert.deepEqual([info.json.mode, info.json.ready], ['alipay', false]);
  assert.equal((await call('http://127.0.0.1:47384', 'POST', '/topup', { body: { pack: 'p1' }, jar: u.jar })).status, 403);
  assert.equal((await call('http://127.0.0.1:47384', 'POST', '/pay/alipay/create', { body: { pack: 'p1' }, jar: u.jar })).status, 503);
});

test('下单需要登录；档位必须存在', async () => {
  assert.equal((await call(SITE, 'POST', '/pay/alipay/create', { body: { pack: 'p1' } })).status, 401);
  const u = await newUser();
  assert.equal((await create(u, 'nope')).status, 400);
});

test('手机端 wap.pay：表单参数完整且签名可被支付宝公钥侧验证', async () => {
  const u = await newUser();
  const r = await create(u, 'p5', 'mobile');
  assert.equal(r.status, 200, r.text);
  const { form, orderNo, channel } = r.json;
  assert.equal(channel, 'wap');
  assert.match(orderNo, /^QF\d{12}[0-9a-f]{12}$/);
  const f = form.fields;
  assert.equal(form.action, `http://127.0.0.1:${PORT_GW}/gateway.do?charset=utf-8`);
  assert.equal(f.method, 'alipay.trade.wap.pay');
  assert.equal(f.app_id, APP_ID);
  assert.equal(f.sign_type, 'RSA2');
  assert.equal(f.notify_url, NOTIFY_URL);
  assert.equal(f.return_url, RETURN_URL);
  assert.match(f.timestamp, /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
  const biz = JSON.parse(f.biz_content);
  assert.equal(biz.out_trade_no, orderNo);
  assert.equal(biz.total_amount, '5.00');
  assert.equal(biz.product_code, 'QUICK_WAP_WAY');
  assert.equal(biz.subject, '祈福树福币·中福包');
  assert.ok(createVerify('RSA-SHA256').update(signContent(f), 'utf8').verify(appKeys.publicKey, f.sign, 'base64'));
  assert.equal(await coinsOf(u), 0); // 下单本身不加币
});

test('电脑端 precreate：二维码来自（验签通过的）网关响应', async () => {
  const u = await newUser();
  const r = await create(u, 'p1', 'desktop');
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.channel, 'qr');
  assert.equal(r.json.qrCode, `https://qr.alipay.com/fake_${r.json.orderNo}`);
  const req = gwRequests.findLast((x) => x.method === 'alipay.trade.precreate');
  assert.equal(req.notify_url, NOTIFY_URL);
  assert.equal(JSON.parse(req.biz_content).total_amount, '1.00');
});

test('notify：无需登录/Cookie，成功只输出纯文本 success，并且幂等入账', async () => {
  const u = await newUser();
  const { json: o } = await create(u, 'p1');
  const before_ = await coinsOf(u);

  const r1 = await postNotify(payNotify(o.orderNo));
  assert.equal(r1.status, 200);
  assert.equal(r1.text, 'success'); // 逐字节：没有换行、BOM、PHP 警告
  assert.match(r1.res.headers.get('content-type'), /^text\/plain/);
  assert.equal(r1.res.headers.getSetCookie().length, 0);
  assert.equal(await coinsOf(u), before_ + 60);

  const r2 = await postNotify(payNotify(o.orderNo));
  assert.equal(r2.text, 'success');
  const r3 = await postNotify(payNotify(o.orderNo, { trade_status: 'TRADE_FINISHED' }));
  assert.equal(r3.text, 'success');
  assert.equal(await coinsOf(u), before_ + 60, '重复通知不能重复加福币');

  const q = await call(SITE, 'GET', `/pay/alipay/query?orderNo=${o.orderNo}`, { jar: u.jar });
  assert.equal(q.json.status, 'paid');
  assert.equal(q.json.user.coins, before_ + 60);
});

test('notify：10 路并发重复通知只入账一次', async () => {
  const u = await newUser();
  const { json: o } = await create(u, 'p5');
  const params = payNotify(o.orderNo, { total_amount: '5.00' });
  const rs = await Promise.all(Array.from({ length: 10 }, () => postNotify(params)));
  for (const r of rs) assert.equal(r.text, 'success');
  assert.equal(await coinsOf(u), 330);
  const q = await call(SITE, 'GET', `/pay/alipay/query?orderNo=${o.orderNo}`, { jar: u.jar });
  assert.equal(q.json.status, 'paid');
});

test('notify：验签 / 金额 / app_id / sign_type 校验，失败都返回 fail 且不入账', async () => {
  const u = await newUser();
  const { json: o } = await create(u, 'p1');
  const good = payNotify(o.orderNo);

  assert.equal((await postNotify({ ...good, sign: 'AAAA' })).text, 'fail');
  assert.equal((await postNotify({ ...good, total_amount: '0.01' })).text, 'fail', '改金额后签名失效');
  const forged = notifyParams({ out_trade_no: o.orderNo, trade_no: 'x1', total_amount: '1.00' });
  const wrongKey = { ...forged, sign: sign(signContent(forged, ['sign', 'sign_type']), appKeys.privateKey) };
  assert.equal((await postNotify(wrongKey)).text, 'fail', '用别的密钥签名');
  assert.equal((await postNotify(payNotify(o.orderNo, { total_amount: '0.01' }))).text, 'fail', '签名有效但金额与订单不符');
  assert.equal((await postNotify(payNotify(o.orderNo, { app_id: '2021999999999999' }))).text, 'fail', 'app_id 不符');
  assert.equal((await postNotify(payNotify(o.orderNo, { seller_id: '2088111111111111' }))).text, 'fail', 'seller_id 不符');
  const rsa1 = notifyParams({ out_trade_no: o.orderNo, trade_no: 'x2', total_amount: '1.00', sign_type: 'RSA' });
  assert.equal((await postNotify(rsa1)).text, 'fail', '拒绝 RSA(SHA1) 降级');
  const noSign = { ...good };
  delete noSign.sign;
  assert.equal((await postNotify(noSign)).text, 'fail');
  assert.equal((await call(SITE, 'POST', '/pay/alipay/notify', { form: {} })).text, 'fail');
  assert.equal((await call(SITE, 'GET', '/pay/alipay/notify')).text, 'fail');
  assert.equal(await coinsOf(u), 0);

  // 同样的订单、正确的通知仍可入账（上面的失败没有污染订单状态）
  assert.equal((await postNotify(good)).text, 'success');
  assert.equal(await coinsOf(u), 60);
});

test('notify：签名参数从 POST body 读取，URL 查询串里的同名参数无效', async () => {
  const u = await newUser();
  const { json: o } = await create(u, 'p1');
  const good = payNotify(o.orderNo);
  // 把合法参数塞进 query、body 为空 -> 必须失败
  const qs = new URLSearchParams(good).toString();
  const res = await fetch(`${SITE}/api/index.php?path=/pay/alipay/notify&${qs}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: '' });
  assert.equal(await res.text(), 'fail');
  assert.equal(await coinsOf(u), 0);
});

test('notify：未知订单（验签通过）确认收到；TRADE_CLOSED 关闭订单，但之后真有付款仍会入账', async () => {
  assert.equal((await postNotify(payNotify('QF000000UNKNOWN'))).text, 'success');
  const u = await newUser();
  const { json: o } = await create(u, 'p1');
  assert.equal((await postNotify(payNotify(o.orderNo, { trade_status: 'WAIT_BUYER_PAY' }))).text, 'success');
  assert.equal(await coinsOf(u), 0);
  assert.equal((await postNotify(payNotify(o.orderNo, { trade_status: 'TRADE_CLOSED' }))).text, 'success');
  let q = await call(SITE, 'GET', `/pay/alipay/query?orderNo=${o.orderNo}`, { jar: u.jar });
  assert.equal(q.json.status, 'closed');
  assert.equal((await postNotify(payNotify(o.orderNo))).text, 'success');
  q = await call(SITE, 'GET', `/pay/alipay/query?orderNo=${o.orderNo}`, { jar: u.jar });
  assert.equal(q.json.status, 'paid');
  assert.equal(await coinsOf(u), 60);
});

test('查单补单：网关回 TRADE_SUCCESS 时入账一次；轮询、再通知都不会重复', async () => {
  const u = await newUser();
  const { json: o } = await create(u, 'p10');
  let q = await call(SITE, 'GET', `/pay/alipay/query?orderNo=${o.orderNo}`, { jar: u.jar });
  assert.equal(q.json.status, 'pending'); // 网关：交易不存在
  gwOrders.set(o.orderNo, { status: 'TRADE_SUCCESS', amount: '10.00', tradeNo: `2026100222001${o.orderNo.slice(-8)}` });
  await new Promise((r) => setTimeout(r, 4200)); // 越过 4 秒查单节流
  q = await call(SITE, 'GET', `/pay/alipay/query?orderNo=${o.orderNo}`, { jar: u.jar });
  assert.equal(q.json.status, 'paid');
  assert.equal(q.json.coins, 1180);
  assert.equal(q.json.user.coins, 1180);
  await call(SITE, 'GET', `/pay/alipay/query?orderNo=${o.orderNo}`, { jar: u.jar });
  assert.equal((await postNotify(payNotify(o.orderNo, { total_amount: '10.00' }))).text, 'success');
  assert.equal(await coinsOf(u), 1180);
});

test('查单：同一订单 4 秒内只向支付宝查一次（防止轮询打爆网关）', async () => {
  const u = await newUser();
  const { json: o } = await create(u, 'p1');
  const n0 = gwRequests.filter((x) => x.method === 'alipay.trade.query').length;
  for (let i = 0; i < 5; i++) await call(SITE, 'GET', `/pay/alipay/query?orderNo=${o.orderNo}`, { jar: u.jar });
  assert.equal(gwRequests.filter((x) => x.method === 'alipay.trade.query').length - n0, 1);
});

test('查单：网关响应被篡改（验签失败）或金额不符时不入账', async () => {
  const u = await newUser();
  const a = (await create(u, 'p1')).json;
  const b = (await create(u, 'p1')).json;
  gwOrders.set(a.orderNo, { status: 'TRADE_SUCCESS', amount: '1.00', tradeNo: 'T_A', tamper: true });
  gwOrders.set(b.orderNo, { status: 'TRADE_SUCCESS', amount: '0.01', tradeNo: 'T_B' });
  assert.equal((await call(SITE, 'GET', `/pay/alipay/query?orderNo=${a.orderNo}`, { jar: u.jar })).json.status, 'pending');
  assert.equal((await call(SITE, 'GET', `/pay/alipay/query?orderNo=${b.orderNo}`, { jar: u.jar })).json.status, 'pending');
  assert.equal(await coinsOf(u), 0);
});

test('查单：只能查自己的订单；订单号格式校验', async () => {
  const u1 = await newUser();
  const u2 = await newUser();
  const { json: o } = await create(u1, 'p1');
  assert.equal((await call(SITE, 'GET', `/pay/alipay/query?orderNo=${o.orderNo}`, { jar: u2.jar })).status, 404);
  assert.equal((await call(SITE, 'GET', `/pay/alipay/query?orderNo=${o.orderNo}`)).status, 401);
  assert.equal((await call(SITE, 'GET', `/pay/alipay/query?orderNo=${encodeURIComponent("x' or 1=1 --")}`, { jar: u1.jar })).status, 400);
});

test('补单接口 recheck：一次补上该用户所有已付款未入账的订单', async () => {
  const u = await newUser();
  const a = (await create(u, 'p1')).json;
  const b = (await create(u, 'p5')).json;
  const c = (await create(u, 'p1')).json; // 未支付
  gwOrders.set(a.orderNo, { status: 'TRADE_SUCCESS', amount: '1.00', tradeNo: 'T_RA' });
  gwOrders.set(b.orderNo, { status: 'TRADE_FINISHED', amount: '5.00', tradeNo: 'T_RB' });
  const r = await call(SITE, 'POST', '/pay/alipay/recheck', { jar: u.jar });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.json.paid.map((x) => x.orderNo).sort(), [a.orderNo, b.orderNo].sort());
  assert.equal(r.json.user.coins, 60 + 330);
  const r2 = await call(SITE, 'POST', '/pay/alipay/recheck', { jar: u.jar });
  assert.equal(r2.json.paid.length, 0);
  assert.equal(await coinsOf(u), 390);
  assert.equal((await call(SITE, 'GET', `/pay/alipay/query?orderNo=${c.orderNo}`, { jar: u.jar })).json.status, 'pending');
  assert.equal((await call(SITE, 'POST', '/pay/alipay/recheck')).status, 401);
});

test('return：验签后查单入账并 302 回站点（?payOrder=订单号）；伪造签名只跳转不入账', async () => {
  const u = await newUser();
  const { json: o } = await create(u, 'p1', 'mobile');
  gwOrders.set(o.orderNo, { status: 'TRADE_SUCCESS', amount: '1.00', tradeNo: 'T_RET' });
  const ret = {
    charset: 'utf-8', out_trade_no: o.orderNo, method: 'alipay.trade.wap.pay.return', total_amount: '1.00', sign: '', trade_no: 'T_RET',
    auth_app_id: APP_ID, version: '1.0', app_id: APP_ID, sign_type: 'RSA2', seller_id: '2088000000000001', timestamp: '2026-10-02 10:00:00',
  };
  ret.sign = sign(signContent(ret, ['sign', 'sign_type']), aliKeys.privateKey);

  const forged = await call(SITE, 'GET', `/pay/alipay/return&${new URLSearchParams({ ...ret, sign: 'AAAA' })}`, { redirect: 'manual' });
  assert.equal(forged.status, 302);
  assert.equal(forged.res.headers.get('location'), `http://qifu.laixi.cn/?payOrder=${o.orderNo}`);
  assert.equal(await coinsOf(u), 0);

  const ok = await call(SITE, 'GET', `/pay/alipay/return&${new URLSearchParams(ret)}`, { redirect: 'manual' });
  assert.equal(ok.status, 302);
  assert.equal(ok.res.headers.get('location'), `http://qifu.laixi.cn/?payOrder=${o.orderNo}`);
  assert.equal(await coinsOf(u), 60);
  await call(SITE, 'GET', `/pay/alipay/return&${new URLSearchParams(ret)}`, { redirect: 'manual' });
  assert.equal(await coinsOf(u), 60);

  const bare = await call(SITE, 'GET', '/pay/alipay/return', { redirect: 'manual' });
  assert.equal(bare.res.headers.get('location'), 'http://qifu.laixi.cn/');
});

test('通知 + 查单 + return 同时到达：福币只加一次', async () => {
  const u = await newUser();
  const { json: o } = await create(u, 'p5');
  gwOrders.set(o.orderNo, { status: 'TRADE_SUCCESS', amount: '5.00', tradeNo: 'T_RACE' });
  const notify = payNotify(o.orderNo, { total_amount: '5.00', trade_no: 'T_RACE' });
  const rs = await Promise.all([
    postNotify(notify), postNotify(notify),
    call(SITE, 'POST', '/pay/alipay/recheck', { jar: u.jar }),
    call(SITE, 'GET', `/pay/alipay/query?orderNo=${o.orderNo}`, { jar: u.jar }),
    postNotify(notify),
  ]);
  assert.equal(rs[0].text, 'success');
  assert.equal(await coinsOf(u), 330);
});

test('topups 流水：每笔真实支付恰好一条', async () => {
  const out = execFileSync('php', ['-r', `$p=new PDO("mysql:host=".getenv("QIFU_DB_HOST").";port=".(getenv("QIFU_DB_PORT")?:3306).";dbname=".getenv("QIFU_DB_NAME").";charset=utf8mb4",getenv("QIFU_DB_USER"),getenv("QIFU_DB_PASS"));
    echo json_encode([(int)$p->query("SELECT COUNT(*) FROM pay_orders WHERE status='paid'")->fetchColumn(), (int)$p->query("SELECT COUNT(*) FROM topups")->fetchColumn(),
    (int)$p->query("SELECT COUNT(*) FROM (SELECT trade_no FROM pay_orders WHERE trade_no IS NOT NULL GROUP BY trade_no HAVING COUNT(*)>1) t")->fetchColumn()]);`], { env: { ...env, QIFU_DB_HOST: env.QIFU_DB_HOST ?? '127.0.0.1' } }).toString();
  const [paid, topups, dupTrade] = JSON.parse(out);
  assert.ok(paid > 0);
  assert.equal(topups, paid + 1); // 多出的 1 条来自 demo 站点的模拟充值
  assert.equal(dupTrade, 0);
});


/* ------------------------------------------------------ 测试价开关 PAY_TEST_PRICES */
const pricesOf = (r) => r.json.packs.map((p) => [p.id, p.price, p.coins]);

test('PAY_TEST_PRICES 默认关闭：/config 与 /pay/info 是正式价 1/5/10', async () => {
  assert.deepEqual(pricesOf(await call(SITE, 'GET', '/config')), [['p1', 1, 60], ['p5', 5, 330], ['p10', 10, 1180]]);
  assert.equal((await call(SITE, 'GET', '/pay/info')).json.testPrices, false);
});

test('PAY_TEST_PRICES 开启：/config 价格变为 0.01/0.02/0.03，福币数量不变', async () => {
  assert.deepEqual(pricesOf(await call(TESTP, 'GET', '/config')), [['p1', 0.01, 60], ['p5', 0.02, 330], ['p10', 0.03, 1180]]);
  assert.equal((await call(TESTP, 'GET', '/pay/info')).json.testPrices, true);
});

test('测试价：下单金额（wap 表单 / precreate）用测试价，订单金额以分记', async () => {
  const u = await newUser(TESTP);
  const mk = (pack, device) => call(TESTP, 'POST', '/pay/alipay/create', { body: { pack, device }, jar: u.jar });
  const expect = { p1: '0.01', p5: '0.02', p10: '0.03' };
  for (const pack of Object.keys(expect)) {
    const w = await mk(pack, 'mobile');
    assert.equal(w.status, 200, w.text);
    assert.equal(JSON.parse(w.json.form.fields.biz_content).total_amount, expect[pack]);
    assert.equal(w.json.amount, expect[pack]);
  }
  const before = gwRequests.length;
  const q = await mk('p5', 'desktop');
  assert.equal(q.status, 200, q.text);
  const req = gwRequests.slice(before).find((x) => x.method === 'alipay.trade.precreate');
  assert.equal(JSON.parse(req.biz_content).total_amount, '0.02');
});

test('测试价：notify 金额按测试价核对 —— 正式价金额 10.00 被拒，0.03 才入账（福币仍是 1180）', async () => {
  const u = await newUser(TESTP);
  const { json: o } = await call(TESTP, 'POST', '/pay/alipay/create', { body: { pack: 'p10', device: 'desktop' }, jar: u.jar });
  const post = (p) => call(TESTP, 'POST', '/pay/alipay/notify', { form: p });
  const coins = async () => (await call(TESTP, 'GET', '/me', { jar: u.jar })).json.user.coins;
  assert.equal((await post(payNotify(o.orderNo, { total_amount: '10.00' }))).text, 'fail');
  assert.equal((await post(payNotify(o.orderNo, { total_amount: '0.02' }))).text, 'fail');
  assert.equal(await coins(), 0);
  assert.equal((await post(payNotify(o.orderNo, { total_amount: '0.03' }))).text, 'success');
  assert.equal(await coins(), 1180);
  assert.equal((await post(payNotify(o.orderNo, { total_amount: '0.03' }))).text, 'success');
  assert.equal(await coins(), 1180);
});

test('测试价：查单补单同样按测试价核对金额', async () => {
  const u = await newUser(TESTP);
  const a = (await call(TESTP, 'POST', '/pay/alipay/create', { body: { pack: 'p1', device: 'desktop' }, jar: u.jar })).json;
  const b = (await call(TESTP, 'POST', '/pay/alipay/create', { body: { pack: 'p5', device: 'desktop' }, jar: u.jar })).json;
  gwOrders.set(a.orderNo, { status: 'TRADE_SUCCESS', amount: '1.00', tradeNo: 'T_TP_A' }); // 金额是正式价 -> 拒绝
  gwOrders.set(b.orderNo, { status: 'TRADE_SUCCESS', amount: '0.02', tradeNo: 'T_TP_B' });
  const r = await call(TESTP, 'POST', '/pay/alipay/recheck', { jar: u.jar });
  assert.deepEqual(r.json.paid.map((x) => x.orderNo), [b.orderNo]);
  assert.equal(r.json.user.coins, 330);
});
