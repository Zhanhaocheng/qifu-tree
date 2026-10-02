// 前端 src/api.ts 行为测试：超时、GET 重试、POST 不重试、提示文案、Bearer 令牌、三种构建模式（默认/跨域/query 风格）
import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const API_TS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/api.ts');
const bundle = async (define) => {
  const r = await build({ entryPoints: [API_TS], bundle: true, write: false, format: 'esm', define });
  return 'data:text/javascript;base64,' + Buffer.from(r.outputFiles[0].text).toString('base64');
};
// 时间缩放 1/100：12s 超时 -> 120ms
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms, ...a) => realSetTimeout(fn, ms / 100, ...a);
const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
let calls = [];
const respond = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const hang = (init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))));
let behavior;
globalThis.fetch = async (url, init) => { calls.push({ url, method: init.method, auth: init.headers?.authorization }); return behavior(url, init, calls.length); };
const t = async (name, fn) => { calls = []; try { await fn(); console.log('PASS', name); } catch (e) { console.log('FAIL', name, e.message); process.exitCode = 1; } };
const eq = (a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${JSON.stringify(a)} !== ${JSON.stringify(b)}`); };
const rej = async (p) => p.then(() => { throw new Error('should reject'); }, (e) => e);

for (const mode of ['vercel(default)', 'cross-origin', 'query-style']) {
  const define = {
    'import.meta.env.VITE_API_BASE': mode === 'cross-origin' ? '"https://api.example.com"' : '""',
    'import.meta.env.VITE_API_STYLE': mode === 'query-style' ? '"query"' : '""',
  };
  const { api, ApiError } = await import(await bundle(define));
  console.log('--', mode);
  await t('GET retries on network error then succeeds', async () => {
    behavior = (u, i, n) => (n < 3 ? Promise.reject(new TypeError('fail')) : Promise.resolve(respond(200, { items: [] })));
    await api.config(); eq(calls.length, 3);
    if (mode === 'query-style') eq(calls[0].url, '/api/index.php?path=/config');
    if (mode === 'cross-origin') eq(calls[0].url, 'https://api.example.com/api/config');
    if (mode === 'vercel(default)') eq(calls[0].url, '/api/config');
  });
  await t('payQuery builds the right URL (query-style keeps ?path= and appends &orderNo=)', async () => {
    behavior = () => Promise.resolve(respond(200, { status: 'pending' }));
    await api.payQuery('QF1');
    if (mode === 'query-style') eq(calls[0].url, '/api/index.php?path=/pay/alipay/query&orderNo=QF1');
    if (mode === 'vercel(default)') eq(calls[0].url, '/api/pay/alipay/query?orderNo=QF1');
  });
  await t('payInfo is null when the backend has no payment API (Node/Vercel => demo top-up)', async () => {
    behavior = () => Promise.resolve(respond(404, {}));
    eq(await api.payInfo(), null);
    behavior = () => Promise.resolve(respond(200, {}));
    eq(await api.payInfo(), null);
  });
  await t('GET retries on 503 and gives up with server msg', async () => {
    behavior = () => Promise.resolve(respond(503, {}));
    const e = await rej(api.prayers()); eq(calls.length, 3); eq([e.status, e.message], [503, '服务器开小差了，请稍后再试']);
  });
  await t('GET timeout -> 3 attempts, kind=timeout, message', async () => {
    behavior = (u, init) => hang(init);
    const e = await rej(api.me()); eq(calls.length, 3); eq([e.kind, e.message], ['timeout', '请求超时，网络较慢，请稍后重试']);
  });
  await t('GET network failure message', async () => {
    behavior = () => Promise.reject(new TypeError('x'));
    const e = await rej(api.me()); eq([e.kind, e.message], ['network', '网络连接失败，请检查网络后重试']);
  });
  await t('POST register timeout: no retry + hint', async () => {
    behavior = (u, init) => hang(init);
    const e = await rej(api.register('abc', '123456')); eq(calls.length, 1); eq(e.message, '注册请求超时，可能未成功，请稍后重试或直接登录确认');
  });
  await t('POST register network failure: no retry + hint', async () => {
    behavior = () => Promise.reject(new TypeError('x'));
    const e = await rej(api.register('abc', '123456')); eq(calls.length, 1); eq(e.kind, 'network'); if (!e.message.includes('注册可能未成功')) throw new Error(e.message);
  });
  await t('POST login timeout message, pray timeout generic write message', async () => {
    behavior = (u, init) => hang(init);
    eq((await rej(api.login('a', 'b'))).message, '登录请求超时，网络较慢，请稍后重试');
    eq((await rej(api.pray('wood', 'x'))).message, '请求超时，操作可能未成功，请刷新确认后再试'); eq(calls.length, 2);
  });
  await t('POST 5xx never retried', async () => {
    behavior = () => Promise.resolve(respond(502, {}));
    await rej(api.checkin()); eq(calls.length, 1);
  });
  await t('401 login keeps server message; 401 without body -> session message', async () => {
    behavior = () => Promise.resolve(respond(401, { error: '用户名或密码错误' }));
    eq((await rej(api.login('a', 'b'))).message, '用户名或密码错误');
    behavior = () => Promise.resolve(new Response('<html>', { status: 401 }));
    const e = await rej(api.checkin()); eq([e.status, e.message], [401, '登录已失效，请重新登录']);
  });
  await t('server error messages pass through (402/409)', async () => {
    behavior = () => Promise.resolve(respond(402, { error: '福币不足，请先充值' }));
    eq((await rej(api.topup('p6'))).message, '福币不足，请先充值');
  });
  await t('token handling', async () => {
    store.clear();
    behavior = () => Promise.resolve(respond(200, { user: {}, token: 'TOK' }));
    await api.login('a', 'b');
    eq(store.get('qifu_token'), mode === 'cross-origin' ? 'TOK' : undefined);
    behavior = () => Promise.resolve(respond(200, { user: null, mode: 'local' }));
    await api.me(); eq(calls.at(-1).auth, mode === 'cross-origin' ? 'Bearer TOK' : undefined);
  });
}
