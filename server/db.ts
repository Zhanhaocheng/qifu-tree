import { createClient, type Client, type InArgs, type Transaction } from '@libsql/client';
import fs from 'node:fs';
import path from 'node:path';

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
    created_at INTEGER NOT NULL
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

export async function createDb(url: string, mode: DbMode, authToken?: string): Promise<Db> {
  if (url.startsWith('file:')) fs.mkdirSync(path.dirname(url.slice('file:'.length)), { recursive: true });
  const client = createClient({ url, authToken });
  for (const stmt of SCHEMA) await client.execute(stmt);
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
export function openDbFromEnv(env: NodeJS.ProcessEnv = process.env): Promise<Db> {
  if (env.TURSO_DATABASE_URL) return createDb(env.TURSO_DATABASE_URL, 'turso', env.TURSO_AUTH_TOKEN);
  if (env.VERCEL || env.DEMO_MODE === '1') return memoryDb();
  const dir = env.DATA_DIR ?? path.resolve('data');
  return createDb(`file:${path.join(dir, 'qifu.db')}`, 'local');
}
