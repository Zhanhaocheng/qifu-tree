import { createClient, type Client, type InArgs, type Transaction } from '@libsql/client';
import fs from 'node:fs';
import path from 'node:path';
import { ensureTestAccount, testAccountFromEnv } from './testAccount.js';

export type DbMode = 'local' | 'turso' | 'demo';

export interface Exec {
  get<T = Record<string, any>>(sql: string, args?: InArgs): Promise<T | undefined>;
  all<T = Record<string, any>>(sql: string, args?: InArgs): Promise<T[]>;
  run(sql: string, args?: InArgs): Promise<{ lastId: number; changes: number }>;
}

export interface Db extends Exec {
  mode: DbMode;
  tx<T>(fn: (t: Exec) => Promise<T>): Promise<T>;
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    energy INTEGER NOT NULL DEFAULT 0,
    coins INTEGER NOT NULL DEFAULT 0,
    streak INTEGER NOT NULL DEFAULT 0,
    last_checkin TEXT,
    terrain TEXT,
    nickname TEXT,
    avatar TEXT,
    age INTEGER,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS user_terrains (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    terrain TEXT NOT NULL,
    PRIMARY KEY (user_id, terrain)
  )`,
  `CREATE TABLE IF NOT EXISTS prayers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_type TEXT NOT NULL,
    text TEXT NOT NULL,
    position INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_prayers_user ON prayers(user_id)`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS topups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    pack_id TEXT NOT NULL,
    coins INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  )`,
];

function wrap(target: Client | Transaction): Exec {
  const rows = async (sql: string, args?: InArgs) => (await target.execute({ sql, args: args ?? [] })).rows;
  return {
    async get(sql, args) {
      const r = await rows(sql, args);
      return r[0] ? ({ ...r[0] } as any) : undefined;
    },
    async all(sql, args) {
      return (await rows(sql, args)).map((r) => ({ ...r }) as any);
    },
    async run(sql, args) {
      const r = await target.execute({ sql, args: args ?? [] });
      return { lastId: Number(r.lastInsertRowid ?? 0), changes: r.rowsAffected };
    },
  };
}

/**
 * 个人资料字段（昵称/头像/年龄）。线上已有的表没有这些列：
 * 缺哪列补哪列（ADD COLUMN 只改表结构，不动已有数据），新补上昵称列时把已有用户的昵称回填为用户名。
 * 可重复执行；并发冷启动时后到的 ALTER 会报 duplicate column，忽略即可。
 */
async function migrateProfileColumns(client: Client) {
  const info = await client.execute('PRAGMA table_info(users)');
  const have = new Set(info.rows.map((r) => String(r.name)));
  let addedNickname = false;
  for (const [col, ddl] of [
    ['nickname', 'TEXT'],
    ['avatar', 'TEXT'],
    ['age', 'INTEGER'],
  ] as const) {
    if (have.has(col)) continue;
    try {
      await client.execute(`ALTER TABLE users ADD COLUMN ${col} ${ddl}`);
      if (col === 'nickname') addedNickname = true;
    } catch (e) {
      if (!/duplicate column/i.test(String((e as Error).message))) throw e;
    }
  }
  if (addedNickname) await client.execute('UPDATE users SET nickname = username WHERE nickname IS NULL');
}

export async function createDb(url: string, mode: DbMode, authToken?: string): Promise<Db> {
  if (url.startsWith('file:')) fs.mkdirSync(path.dirname(url.slice('file:'.length)), { recursive: true });
  const client = createClient({ url, authToken });
  for (const stmt of SCHEMA) await client.execute(stmt);
  await client.execute('ALTER TABLE users ADD COLUMN terrain TEXT').catch(() => undefined);
  await migrateProfileColumns(client);
  await client.execute('PRAGMA foreign_keys = ON').catch(() => undefined);
  return {
    mode,
    ...wrap(client),
    async tx(fn) {
      const t = await client.transaction('write');
      try {
        const out = await fn(wrap(t));
        await t.commit();
        return out;
      } catch (e) {
        await t.rollback();
        throw e;
      } finally {
        t.close();
      }
    },
  };
}

export function memoryDb() {
  return createDb(':memory:', 'demo');
}

/**
 * 选择存储：
 * - 设置了 TURSO_DATABASE_URL：使用 Turso/libSQL（生产推荐）
 * - 运行在 Vercel 且没有数据库：内存演示模式（数据会丢失）
 * - 否则：本地 SQLite 文件（DATA_DIR，默认 ./data）
 */
export async function openDbFromEnv(env: NodeJS.ProcessEnv = process.env): Promise<Db> {
  let db: Db;
  if (env.TURSO_DATABASE_URL) db = await createDb(env.TURSO_DATABASE_URL, 'turso', env.TURSO_AUTH_TOKEN);
  else if (env.VERCEL || env.DEMO_MODE === '1') db = await memoryDb();
  else db = await createDb(`file:${path.join(env.DATA_DIR ?? path.resolve('data'), 'qifu.db')}`, 'local');
  await ensureTestAccount(db, testAccountFromEnv(env));
  return db;
}
