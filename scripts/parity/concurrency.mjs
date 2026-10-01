// 并发与故障测试（只针对 PHP）：同一用户并发签到只成功一次；并发祈福 position 不重复且余额不被超扣；数据库不可用时返回 JSON 500 且不泄漏细节
const base = process.argv[2];
const down = process.argv[3];
let failed = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${extra}`);
  if (!ok) failed++;
};
const post = (path, body, cookie, ip = '10.7.7.7') =>
  fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, ...(cookie ? { cookie: `qifu_session=${cookie}` } : {}) }, body: JSON.stringify(body ?? {}) }).then(async (r) => ({ status: r.status, json: await r.json(), cookie: /qifu_session=([^;]+)/.exec(r.headers.get('set-cookie') ?? '')?.[1] }));

const reg = await post('/api/register', { username: 'conc' + Date.now().toString(36).slice(-6), password: '123456' }, null, '10.7.7.8');
const ck = reg.cookie;
const res = await Promise.all(Array.from({ length: 12 }, () => post('/api/checkin', {}, ck)));
const okc = res.filter((r) => r.status === 200).length;
check('12 concurrent checkins -> exactly one 200', okc === 1 && res.filter((r) => r.status === 409).length === 11, `(200s=${okc})`);

// 30 能量 + 3 次木牌(10) 的并发：最多 3 次成功
const pr = await Promise.all(Array.from({ length: 10 }, (_, i) => post('/api/pray', { item: 'wood', text: 'c' + i }, ck)));
const okp = pr.filter((r) => r.status === 200);
check('10 concurrent prayers with 50 energy -> at most 5 succeed, no overspend', okp.length === 5 && pr.filter((r) => r.status === 402).length === 5, `(ok=${okp.length})`);

const t = await post('/api/login', { username: 'qifu_test', password: 'Qifu@Test2026' }, null, '10.7.7.9');
const many = await Promise.all(Array.from({ length: 40 }, (_, i) => post('/api/pray', { item: 'wood', text: 'p' + i }, t.cookie)));
const positions = many.map((r) => r.json.tag?.position);
check('40 concurrent test-account prayers -> unique positions', many.every((r) => r.status === 200) && new Set(positions).size === 40, `(unique=${new Set(positions).size})`);

if (down) {
  const r = await fetch(down + '/api/prayers');
  const text = await r.text();
  check('DB down -> JSON 500, no detail leak', r.status === 500 && text === '{"error":"服务器开小差了，请稍后再试"}' && r.headers.get('content-type') === 'application/json', text.slice(0, 80));
}
process.exit(failed ? 1 : 0);
