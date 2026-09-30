import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from './app.js';
import { openDb } from './db.js';

function setup() {
  let t = Date.parse('2026-01-10T04:00:00Z');
  const app = createApp({ db: openDb(':memory:'), now: () => t });
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
  assert.equal(p.json.user.energy, 20);
  assert.equal(p.json.user.prayerCount, 1);
  assert.equal((await s.call('POST', '/api/pray', { item: 'lotus', text: '愿' })).status, 402);
  assert.equal((await s.call('POST', '/api/pray', { item: 'wood', text: '  ' })).status, 400);
  const t = await s.call('POST', '/api/topup', { pack: 'p6' });
  assert.equal(t.json.user.coins, 60);
  const l = await s.call('POST', '/api/pray', { item: 'lotus', text: '愿' });
  assert.equal(l.json.user.coins, 22);
  assert.equal(l.json.user.energy, 20 + 260);
  const list = await s.call('GET', '/api/prayers');
  assert.equal(list.json.tags.length, 2);
  assert.equal(list.json.tags[1].position, 1);
  assert.equal(list.json.tags[0].mine, true);
  s.clear();
  assert.equal((await s.call('GET', '/api/prayers')).json.tags[0].mine, false);
});
