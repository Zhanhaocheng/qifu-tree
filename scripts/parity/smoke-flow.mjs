// 受限主机冒烟测试：诊断页 -> 安装页 -> 主要接口流程。要求每个响应都是预期状态码，且 API 响应一定是合法 JSON（无 PHP 警告混入）。
const [base, secret] = process.argv.slice(2);
let failed = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + extra}`);
  if (!ok) failed++;
};
const ip = (() => { let n = 0; return () => `10.2.${n++ % 250}.1`; })();
const call = async (method, path, { body, cookie, bearer, form, headers = {} } = {}) => {
  const h = { 'x-forwarded-for': ip(), ...headers };
  if (cookie) h.cookie = `qifu_session=${cookie}`;
  if (bearer) h.authorization = `Bearer ${bearer}`;
  let payload;
  if (form) { payload = new URLSearchParams(form).toString(); h['content-type'] = 'application/x-www-form-urlencoded'; }
  else if (body !== undefined) { payload = typeof body === 'string' ? body : JSON.stringify(body); h['content-type'] = 'application/json'; }
  const res = await fetch(base + path, { method, headers: h, body: payload });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, text, json, cookie: /qifu_session=([^;]+)/.exec(res.headers.get('set-cookie') ?? '')?.[1], type: res.headers.get('content-type') };
};
const api = async (name, method, path, want, o) => {
  const r = await call(method, path, o);
  check(`${method} ${path} -> ${want} (${name})`, r.status === want && (want === 404 || want === 204 || r.json !== null), `got ${r.status} ${r.text.slice(0, 200)}`);
  return r;
};

const d1 = await call('GET', '/api/diag.php');
check('diag.php renders', d1.status === 200 && d1.text.includes('PHP 版本') && !/Fatal|Warning|Notice|Deprecated/.test(d1.text), d1.text.slice(0, 300));
const d2 = await call('GET', `/api/diag.php?key=${secret}`);
check('diag.php db section', d2.text.includes('MySQL 版本') && !/Fatal|Warning/.test(d2.text), d2.text.slice(-300));
const bad = await call('POST', '/api/install.php', { form: { key: 'wrong-wrong-wrong' } });
check('install.php rejects wrong key (403)', bad.status === 403, String(bad.status));
const inst = await call('POST', '/api/install.php', { form: { key: secret } });
check('install.php succeeds', inst.status === 200 && inst.text.includes('安装完成') && !/Fatal|Warning|Notice/.test(inst.text), inst.text.replace(/<[^>]*>/g, ' ').slice(-300));

await api('config', 'GET', '/api/config', 200);
const reg = await api('register', 'POST', '/api/register', 200, { body: { username: 'smoke_user', password: '123456' } });
check('register sets cookie + token', !!reg.cookie && /^[A-Za-z0-9_-]{43}$/.test(reg.json?.token ?? ''));
const me = await api('me cookie', 'GET', '/api/me', 200, { cookie: reg.cookie });
check('me returns user', me.json?.user?.username === 'smoke_user');
await api('me bearer', 'GET', '/api/me', 200, { bearer: reg.json?.token });
await api('checkin', 'POST', '/api/checkin', 200, { cookie: reg.cookie });
await api('checkin again', 'POST', '/api/checkin', 409, { cookie: reg.cookie });
await api('pray', 'POST', '/api/pray', 200, { cookie: reg.cookie, body: { item: 'wood', text: '愿平安' } });
await api('pray broke', 'POST', '/api/pray', 402, { cookie: reg.cookie, body: { item: 'lotus', text: 'x' } });
await api('topup', 'POST', '/api/topup', 200, { cookie: reg.cookie, body: { pack: 'p30' } });
await api('terrain', 'POST', '/api/terrain', 200, { cookie: reg.cookie, body: { terrain: 'snow' } });
const pl = await api('prayers', 'GET', '/api/prayers', 200, { cookie: reg.cookie });
check('prayers has my tag', pl.json?.tags?.some((t) => t.mine && t.text === '愿平安'));
await api('login wrong pw', 'POST', '/api/login', 401, { body: { username: 'smoke_user', password: 'nope' } });
const li = await api('login test account', 'POST', '/api/login', 200, { body: { username: 'qifu_test', password: 'Qifu@Test2026' } });
await api('bad json', 'POST', '/api/register', 400, { body: 'not json' });
await api('unknown route', 'GET', '/api/zzz', 404);
await api('query style', 'GET', '/api/index.php?path=/me', 200);
await api('preflight', 'OPTIONS', '/api/pray', 204, { headers: { origin: 'http://qifu.laixi.cn', 'access-control-request-method': 'POST' } });
await api('logout', 'POST', '/api/logout', 200, { cookie: reg.cookie });
const after = await api('me after logout', 'GET', '/api/me', 200, { cookie: reg.cookie });
check('session invalidated', after.json?.user === null);
process.exit(failed ? 1 : 0);
