import bcrypt from 'bcryptjs';
import type { Db } from './db.js';

export const UNLIMITED_BALANCE = 999_999_999;

export interface TestAccountConfig {
  username: string;
  password: string;
}

export function testAccountFromEnv(env: NodeJS.ProcessEnv = process.env): TestAccountConfig | null {
  if (env.TEST_ACCOUNT_DISABLED === '1' || env.TEST_ACCOUNT_DISABLED === 'true') return null;
  const username = env.TEST_ACCOUNT_USER?.trim() || 'qifu_test';
  const password = env.TEST_ACCOUNT_PASSWORD || 'Qifu@Test2026';
  return { username, password };
}

export const isTestAccount = (cfg: TestAccountConfig | null | undefined, username: string) =>
  !!cfg && cfg.username.toLowerCase() === username.toLowerCase();

/**
 * 幂等地保证测试账号存在：账号不存在则创建，密码被改动则恢复，
 * 能量/福币低于上限值则补满。可在每次冷启动和每次登录时安全地并发调用。
 */
export async function ensureTestAccount(db: Db, cfg: TestAccountConfig | null, now: () => number = Date.now) {
  if (!cfg) return;
  const existing = await db.get<{ password_hash: string }>('SELECT password_hash FROM users WHERE username = ?', [cfg.username]);
  const stale = !existing || !(await bcrypt.compare(cfg.password, existing.password_hash));
  const hash = stale ? await bcrypt.hash(cfg.password, 10) : existing!.password_hash;
  await db.run(
    `INSERT INTO users (username, password_hash, energy, coins, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(username) DO UPDATE SET
       password_hash = excluded.password_hash,
       energy = MAX(users.energy, excluded.energy),
       coins = MAX(users.coins, excluded.coins)`,
    [cfg.username, hash, UNLIMITED_BALANCE, UNLIMITED_BALANCE, now()],
  );
}
