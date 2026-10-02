#!/usr/bin/env node
// 只读导出 Turso/libSQL 数据 -> MySQL 的 import.sql（只执行 SELECT，不修改线上数据）
//
// 用法：
//   TURSO_DATABASE_URL=libsql://xxx.turso.io TURSO_AUTH_TOKEN=... node scripts/export-turso.mjs [输出文件，默认 import.sql]
//
// - 自动识别 URL 与 Token 填反的情况（URL 应以 libsql:// 开头，Token 以 eyJ 开头）。
// - 输出文件包含 bcrypt 密码哈希与会话令牌的 sha256 哈希，属于敏感数据，请妥善保管，导入后从服务器删除。
// - 每条 INSERT 占一行（字符串内的换行均已转义），install.php 依赖这一点逐行导入。
import { createClient } from '@libsql/client';
import fs from 'node:fs';

let url = (process.env.TURSO_DATABASE_URL ?? '').trim();
let token = (process.env.TURSO_AUTH_TOKEN ?? '').trim();
const looksLikeUrl = (v) => /^(libsql|https?|wss?):\/\//.test(v);
if (!looksLikeUrl(url) && looksLikeUrl(token)) {
  [url, token] = [token, url];
  console.error('注意：检测到 TURSO_DATABASE_URL 与 TURSO_AUTH_TOKEN 填反，已自动对调（仅本次运行）。');
}
if (!looksLikeUrl(url)) {
  console.error('缺少有效的 TURSO_DATABASE_URL（应形如 libsql://xxx.turso.io）');
  process.exit(2);
}

const out = process.argv[2] ?? 'import.sql';
const client = createClient({ url, authToken: token || undefined });
const rows = async (sql) => (await client.execute(sql)).rows.map((r) => ({ ...r }));

const q = (v) => {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number' || typeof v === 'bigint') return String(v);
  return (
    "'" +
    String(v)
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/\0/g, '\\0')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\x1a/g, '\\Z') +
    "'"
  );
};
const asciiLower = (s) => s.replace(/[A-Z]/g, (c) => c.toLowerCase());

const users = await rows('SELECT * FROM users ORDER BY id');
const userIds = new Set(users.map((u) => Number(u.id)));
const terrains = (await rows('SELECT user_id, terrain FROM user_terrains ORDER BY user_id, terrain')).filter((r) => userIds.has(Number(r.user_id)));
const prayers = (await rows('SELECT id, user_id, item_type, text, position, created_at FROM prayers ORDER BY id')).filter((r) => userIds.has(Number(r.user_id)));
const nowMs = Date.now();
const sessions = (await rows(`SELECT token_hash, user_id, expires_at FROM sessions WHERE expires_at > ${nowMs} ORDER BY expires_at`)).filter((r) => userIds.has(Number(r.user_id)));
const topups = (await rows('SELECT id, user_id, pack_id, coins, created_at FROM topups ORDER BY id')).filter((r) => userIds.has(Number(r.user_id)));

const badHash = users.filter((u) => !/^\$2[aby]\$\d\d\$[./A-Za-z0-9]{53}$/.test(String(u.password_hash)));
if (badHash.length) {
  console.error(`中止：${badHash.length} 个用户的 password_hash 不是 bcrypt 格式，不会导出（避免泄漏明文）。`);
  process.exit(3);
}
const badName = users.filter((u) => [...String(u.username)].length > 20 || Buffer.byteLength(String(u.username)) > 64);
if (badName.length) console.error(`警告：${badName.length} 个用户名超过 20 字符/64 字节，MySQL 列可能放不下。`);

const lines = [
  '-- 祈福树数据导出（来自 Turso，只读导出）。含 bcrypt 哈希，属敏感数据。',
  `-- 导出时间 ${new Date().toISOString()}`,
  'SET NAMES utf8mb4;',
];
const batch = (table, cols, data, map) => {
  for (let i = 0; i < data.length; i += 50) {
    const values = data.slice(i, i + 50).map((r) => '(' + map(r).map(q).join(',') + ')');
    lines.push(`INSERT INTO ${table} (${cols}) VALUES ${values.join(',')};`);
  }
};
batch('users', 'id,username,username_key,password_hash,energy,coins,streak,last_checkin,terrain,nickname,avatar,age,created_at', users, (u) => [
  Number(u.id), u.username, asciiLower(String(u.username)), u.password_hash, Number(u.energy), Number(u.coins), Number(u.streak), u.last_checkin, u.terrain, u.nickname || u.username, u.avatar ?? null, u.age == null ? null : Number(u.age), Number(u.created_at),
]);
batch('user_terrains', 'user_id,terrain', terrains, (r) => [Number(r.user_id), r.terrain]);
batch('prayers', 'id,user_id,item_type,text,position,created_at', prayers, (r) => [Number(r.id), Number(r.user_id), r.item_type, r.text, Number(r.position), Number(r.created_at)]);
batch('sessions', 'token_hash,user_id,expires_at', sessions, (r) => [r.token_hash, Number(r.user_id), Number(r.expires_at)]);
batch('topups', 'id,user_id,pack_id,coins,created_at', topups, (r) => [Number(r.id), Number(r.user_id), r.pack_id, Number(r.coins), Number(r.created_at)]);

fs.writeFileSync(out, lines.join('\n') + '\n', { mode: 0o600 });
console.error(`已写入 ${out}：users=${users.length} user_terrains=${terrains.length} prayers=${prayers.length} sessions(未过期)=${sessions.length} topups=${topups.length}`);
client.close();
