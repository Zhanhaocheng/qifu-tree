import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allowedOriginsFromEnv, createApp } from './app.js';
import { memoryDb } from './db.js';
import { testAccountFromEnv } from './testAccount.js';

function setup() {
  let t = Date.parse('2026-01-10T04:00:00Z');
  const app = createApp({ db: memoryDb(), now: () => t });
  let cookie = '';
  const call = async (method: string, url: string, payload?: unknown) => {
    const res = await app.request(url, {
      method,
      headers: { 'content-type': 'application/json', cookie },
      body: payload ? JSON.stringify(payload) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, json: (await res.json()) as any };
  };
  return { call, advanceDay: () => (t += 24 * 3600 * 1000), advance: (ms: number) => (t += ms), clear: () => (cookie = '') };
}

test('register, me, logout, login', async () => {
  const s = setup();
  assert.equal((await s.call('POST', '/api/register', { username: 'a', password: '123456' })).status, 400);
  const r = await s.call('POST', '/api/register', { username: '小明', password: '123456' });
  assert.equal(r.status, 200);
  assert.equal(r.json.user.energy, 30);
  assert.equal((await s.call('GET', '/api/me')).json.user.username, '小明');
  assert.equal((await s.call('POST', '/api/register', { username: '小明', password: '123456' })).status, 409);
  await s.call('POST', '/api/logout');
  assert.equal((await s.call('GET', '/api/me')).json.user, null);
  assert.equal((await s.call('POST', '/api/login', { username: '小明', password: 'bad-pass' })).status, 401);
  assert.equal((await s.call('POST', '/api/login', { username: '小明', password: '123456' })).status, 200);
});

test('checkin streak and once per day', async () => {
  const s = setup();
  await s.call('POST', '/api/register', { username: 'tester', password: '123456' });
  const a = await s.call('POST', '/api/checkin');
  assert.equal(a.json.gained, 20);
  assert.equal((await s.call('POST', '/api/checkin')).status, 409);
  s.advanceDay();
  const b = await s.call('POST', '/api/checkin');
  assert.equal(b.json.gained, 25);
  assert.equal(b.json.user.streak, 2);
  s.advanceDay();
  s.advanceDay();
  const c = await s.call('POST', '/api/checkin');
  assert.equal(c.json.user.streak, 1);
});

test('pray costs energy, premium needs coins, topup', async () => {
  const s = setup();
  assert.equal((await s.call('POST', '/api/pray', { item: 'wood', text: 'x' })).status, 401);
  await s.call('POST', '/api/register', { username: 'tester', password: '123456' });
  const p = await s.call('POST', '/api/pray', { item: 'wood', text: '愿家人平安' });
  assert.equal(p.status, 200);
  assert.equal(p.json.user.energy, 0);
  assert.equal(p.json.user.prayerCount, 1);
  assert.equal((await s.call('POST', '/api/pray', { item: 'lotus', text: '愿' })).status, 402);
  assert.equal((await s.call('POST', '/api/pray', { item: 'wood', text: '  ' })).status, 400);
  const t = await s.call('POST', '/api/topup', { pack: 'p10' });
  assert.equal(t.json.user.coins, 1180);
  assert.equal((await s.call('POST', '/api/topup', { pack: 'p6' })).status, 400);
  const l = await s.call('POST', '/api/pray', { item: 'lotus', text: '愿' });
  assert.equal(l.json.user.coins, 1180 - 88);
  assert.equal(l.json.user.energy, 0);
  assert.equal(l.json.reward, 0);
  const list = await s.call('GET', '/api/prayers');
  assert.equal(list.json.tags.length, 2);
  assert.equal(list.json.tags[1].position, 1);
  assert.equal(list.json.tags[0].mine, true);
  s.clear();
  assert.equal((await s.call('GET', '/api/prayers')).json.tags[0].mine, false);
});

test('terrain is assigned at signup; switching costs coins once', async () => {
  const s = setup();
  const r = await s.call('POST', '/api/register', { username: 'terra', password: '123456' });
  const first = r.json.user.terrain as string;
  assert.ok(['mountain', 'bamboo', 'jiangnan', 'desert', 'snow'].includes(first));
  assert.deepEqual(r.json.user.ownedTerrains, [first]);
  const other = first === 'snow' ? 'desert' : 'snow';
  assert.equal((await s.call('POST', '/api/terrain', { terrain: other })).status, 402);
  await s.call('POST', '/api/topup', { pack: 'p10' });
  const sw = await s.call('POST', '/api/terrain', { terrain: other });
  assert.equal(sw.json.user.terrain, other);
  assert.equal(sw.json.user.coins, 1180 - 888);
  const back = await s.call('POST', '/api/terrain', { terrain: first });
  assert.equal(back.json.spent, 0);
  assert.equal(back.json.user.coins, 1180 - 888);
});

const TEST_CFG = { username: 'qifu_test', password: 'Qifu@Test2026' };

function appWith(testAccount: typeof TEST_CFG | null, db: ReturnType<typeof memoryDb> | Awaited<ReturnType<typeof memoryDb>> = memoryDb()) {
  const app = createApp({ db, testAccount });
  let cookie = '';
  const call = async (method: string, url: string, payload?: unknown) => {
    const res = await app.request(url, {
      method,
      headers: { 'content-type': 'application/json', cookie },
      body: payload ? JSON.stringify(payload) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, json: (await res.json()) as any };
  };
  return { call, db };
}

test('built-in test account has unlimited energy and coins', async () => {
  const s = appWith(TEST_CFG);
  const login = await s.call('POST', '/api/login', TEST_CFG);
  assert.equal(login.status, 200);
  const e0 = login.json.user.energy as number;
  const c0 = login.json.user.coins as number;
  assert.ok(e0 >= 999_999_999 && c0 >= 999_999_999);

  for (const item of ['lotus', 'lantern', 'wood']) {
    const p = await s.call('POST', '/api/pray', { item, text: '愿' });
    assert.equal(p.status, 200);
    assert.ok(p.json.user.energy >= e0 && p.json.user.coins >= c0);
  }

  const first = login.json.user.terrain as string;
  const other = first === 'snow' ? 'desert' : 'snow';
  const sw = await s.call('POST', '/api/terrain', { terrain: other });
  assert.equal(sw.status, 200);
  assert.equal(sw.json.user.terrain, other);
  assert.equal(sw.json.spent, 0);
  assert.ok(sw.json.user.coins >= c0);
});

test('test account is ensured on cold start, restored when drained, and works across instances', async () => {
  const db = await memoryDb();
  const a = appWith(TEST_CFG, db);
  assert.equal((await a.call('GET', '/api/me')).status, 200);
  assert.ok(await db.get('SELECT 1 FROM users WHERE username = ?', [TEST_CFG.username]));

  await db.run('UPDATE users SET energy = 1, coins = 0, password_hash = ? WHERE username = ?', ['bogus', TEST_CFG.username]);
  const b = appWith(TEST_CFG, db);
  const login = await b.call('POST', '/api/login', TEST_CFG);
  assert.equal(login.status, 200);
  assert.ok(login.json.user.energy >= 999_999_999 && login.json.user.coins >= 999_999_999);
  assert.equal((await b.call('POST', '/api/login', { ...TEST_CFG, password: 'wrong-pass' })).status, 401);
  const rows = await db.all('SELECT id FROM users WHERE username = ?', [TEST_CFG.username]);
  assert.equal(rows.length, 1);
});

test('test account can be disabled or customised', async () => {
  const off = appWith(null);
  assert.equal((await off.call('POST', '/api/login', TEST_CFG)).status, 401);

  const custom = appWith({ username: 'demo_user', password: 'Another#Pass1' });
  assert.equal((await custom.call('POST', '/api/login', TEST_CFG)).status, 401);
  assert.equal((await custom.call('POST', '/api/login', { username: 'demo_user', password: 'Another#Pass1' })).status, 200);

  assert.equal(testAccountFromEnv({})?.username, 'qifu_test');
  assert.equal(testAccountFromEnv({ TEST_ACCOUNT_DISABLED: '1' }), null);
  assert.deepEqual(testAccountFromEnv({ TEST_ACCOUNT_USER: 'u1', TEST_ACCOUNT_PASSWORD: 'p1' }), { username: 'u1', password: 'p1' });
});

test('regular users are still charged', async () => {
  const s = appWith(TEST_CFG);
  await s.call('POST', '/api/register', { username: 'normal', password: '123456' });
  assert.equal((await s.call('POST', '/api/pray', { item: 'lotus', text: '愿' })).status, 402);
});

const SITE = 'http://qifu.laixi.cn';

test('CORS: allowed origin gets credentials headers; preflight succeeds; others get none', async () => {
  const app = createApp({ db: memoryDb(), testAccount: null });
  const pre = await app.request('/api/login', {
    method: 'OPTIONS',
    headers: { origin: SITE, 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization,content-type' },
  });
  assert.ok(pre.status === 204 || pre.status === 200);
  assert.equal(pre.headers.get('access-control-allow-origin'), SITE);
  assert.equal(pre.headers.get('access-control-allow-credentials'), 'true');
  const allowHeaders = (pre.headers.get('access-control-allow-headers') ?? '').toLowerCase();
  assert.ok(allowHeaders.includes('authorization') && allowHeaders.includes('content-type'));

  const res = await app.request('/api/config', { headers: { origin: 'https://qifu.laixi.cn' } });
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://qifu.laixi.cn');
  assert.equal(res.headers.get('access-control-allow-credentials'), 'true');

  const evil = await app.request('/api/config', { headers: { origin: 'https://evil.example' } });
  assert.equal(evil.status, 200);
  assert.equal(evil.headers.get('access-control-allow-origin'), null);

  const same = await app.request('/api/config');
  assert.equal(same.headers.get('access-control-allow-origin'), null);
});

test('CORS origins come from ALLOWED_ORIGINS', async () => {
  assert.ok(allowedOriginsFromEnv({}).includes('http://qifu.laixi.cn'));
  assert.deepEqual(allowedOriginsFromEnv({ ALLOWED_ORIGINS: ' https://a.example/ , https://b.example ' }), ['https://a.example', 'https://b.example']);
  const app = createApp({ db: memoryDb(), testAccount: null, allowedOrigins: allowedOriginsFromEnv({ ALLOWED_ORIGINS: 'https://a.example' }) });
  const ok = await app.request('/api/config', { headers: { origin: 'https://a.example' } });
  assert.equal(ok.headers.get('access-control-allow-origin'), 'https://a.example');
  const no = await app.request('/api/config', { headers: { origin: SITE } });
  assert.equal(no.headers.get('access-control-allow-origin'), null);
});

test('bearer token auth: login returns token, works without cookie, logout invalidates it', async () => {
  const app = createApp({ db: memoryDb(), testAccount: null });
  const send = (method: string, url: string, token?: string, payload?: unknown) =>
    app.request(url, {
      method,
      headers: { origin: SITE, 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: payload ? JSON.stringify(payload) : undefined,
    });

  const reg = await send('POST', '/api/register', undefined, { username: 'cross', password: '123456' });
  assert.equal(reg.status, 200);
  assert.ok(reg.headers.get('set-cookie')?.includes('qifu_session='));
  const regToken = ((await reg.json()) as any).token as string;
  assert.ok(typeof regToken === 'string' && regToken.length > 20);

  const login = await send('POST', '/api/login', undefined, { username: 'cross', password: '123456' });
  const token = ((await login.json()) as any).token as string;
  assert.notEqual(token, regToken);

  assert.equal(((await (await send('GET', '/api/me', token)).json()) as any).user.username, 'cross');
  assert.equal(((await (await send('GET', '/api/me')).json()) as any).user, null);
  assert.equal(((await (await send('GET', '/api/me', 'bogus')).json()) as any).user, null);
  assert.equal((await send('POST', '/api/checkin', token)).status, 200);
  assert.equal((await send('POST', '/api/checkin')).status, 401);

  assert.equal((await send('POST', '/api/logout', token)).status, 200);
  assert.equal(((await (await send('GET', '/api/me', token)).json()) as any).user, null);
  assert.equal(((await (await send('GET', '/api/me', regToken)).json()) as any).user.username, 'cross');
});

test('a valid bearer token wins over a stale cookie', async () => {
  const app = createApp({ db: memoryDb(), testAccount: null });
  const reg = await app.request('/api/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'mixed', password: '123456' }),
  });
  const token = ((await reg.json()) as any).token as string;
  const me = await app.request('/api/me', { headers: { cookie: 'qifu_session=stale', authorization: `Bearer ${token}` } });
  assert.equal(((await me.json()) as any).user.username, 'mixed');
});

test('profile: nickname defaults to username, edit nickname/avatar/age, validation', async () => {
  const s = setup();
  assert.equal((await s.call('GET', '/api/profile')).status, 401);
  assert.equal((await s.call('PUT', '/api/profile', { nickname: 'x' })).status, 401);
  const r = await s.call('POST', '/api/register', { username: 'Alice', password: '123456' });
  assert.deepEqual(
    { n: r.json.user.nickname, a: r.json.user.avatar, g: r.json.user.age },
    { n: 'Alice', a: null, g: null },
  );
  const put = (b: unknown) => s.call('PUT', '/api/profile', b);
  const ok = await put({ nickname: '  小  福 ', age: 28, avatar: 'preset:koi' });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.json.profile, { username: 'Alice', nickname: '小 福', avatar: 'preset:koi', age: 28 });
  assert.equal(ok.json.user.nickname, '小 福');
  assert.equal((await s.call('GET', '/api/me')).json.user.nickname, '小 福');
  assert.equal((await s.call('GET', '/api/profile')).json.profile.age, 28);

  for (const nickname of ['<script>', 'a"b', '福'.repeat(21), '😀', 5, ['x']]) assert.equal((await put({ nickname })).status, 400);
  for (const age of [0, 121, 1.5, 'abc', true, ' 3']) assert.equal((await put({ age })).status, 400);
  for (const avatar of ['preset:nope', 'http://x/a.png', 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', 'data:image/png;base64,AAAA', 7]) {
    assert.equal((await put({ avatar })).status, 400);
  }
  assert.equal((await put({})).status, 400);
  assert.equal((await put({ username: 'hacker', coins: 9999 })).status, 400);
  assert.equal((await s.call('GET', '/api/profile')).json.profile.nickname, '小 福');

  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(300, 1)]).toString('base64');
  assert.equal((await put({ avatar: `data:image/png;base64,${png}` })).status, 200);
  const big = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(24 * 1024, 1)]).toString('base64');
  assert.equal((await put({ avatar: `data:image/jpeg;base64,${big}` })).json.error, '头像图片过大，请换一张或重新裁剪');
  assert.equal((await put({ avatar: `data:image/jpeg;base64,${png}` })).status, 400);

  const cleared = await put({ nickname: '', age: null, avatar: null });
  assert.deepEqual(cleared.json.profile, { username: 'Alice', nickname: 'Alice', avatar: null, age: null });
  assert.equal((await s.call('POST', '/api/profile', { age: '41' })).json.profile.age, 41);
});

test('profile: username stays the login name; prayers show the nickname', async () => {
  const s = setup();
  await s.call('POST', '/api/register', { username: 'bob', password: '123456' });
  await s.call('PUT', '/api/profile', { nickname: '福宝' });
  await s.call('POST', '/api/checkin');
  const p = await s.call('POST', '/api/pray', { item: 'wood', text: '平安' });
  assert.equal(p.json.tag.nickname, '福宝');
  assert.equal(p.json.tag.username, 'bob');
  s.clear();
  const list = await s.call('GET', '/api/prayers');
  assert.equal(list.json.tags[0].nickname, '福宝');
  assert.equal((await s.call('POST', '/api/login', { username: 'bob', password: '123456' })).json.user.nickname, '福宝');
  assert.equal((await s.call('POST', '/api/register', { username: 'BOB', password: '123456' })).status, 409);
});

test('profile: CORS preflight allows PUT', async () => {
  const app = createApp({ db: memoryDb() });
  const res = await app.request('/api/profile', {
    method: 'OPTIONS',
    headers: { origin: 'http://qifu.laixi.cn', 'access-control-request-method': 'PUT' },
  });
  assert.match(res.headers.get('access-control-allow-methods') ?? '', /PUT/);
});

test('profile migration: an old users table gains the columns and nicknames default to usernames', async () => {
  const { createDb } = await import('./db.js');
  const { default: fs } = await import('node:fs');
  const { default: os } = await import('node:os');
  const { default: path } = await import('node:path');
  const { createClient } = await import('@libsql/client');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qifu-mig-'));
  const url = `file:${path.join(dir, 'old.db')}`;
  const old = createClient({ url });
  await old.execute(`CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE COLLATE NOCASE, password_hash TEXT NOT NULL,
    energy INTEGER NOT NULL DEFAULT 0, coins INTEGER NOT NULL DEFAULT 0, streak INTEGER NOT NULL DEFAULT 0,
    last_checkin TEXT, terrain TEXT, created_at INTEGER NOT NULL)`);
  await old.execute({ sql: 'INSERT INTO users (username, password_hash, energy, coins, created_at) VALUES (?, ?, 5, 7, 1)', args: ['老用户', 'x'] });
  old.close();
  for (let i = 0; i < 2; i++) {
    const db = await createDb(url, 'local');
    const u = await db.get<any>('SELECT * FROM users WHERE username = ?', ['老用户']);
    assert.equal(u.nickname, '老用户');
    assert.equal(u.avatar, null);
    assert.equal(u.age, null);
    assert.equal(u.energy, 5);
    assert.equal(u.coins, 7);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});
