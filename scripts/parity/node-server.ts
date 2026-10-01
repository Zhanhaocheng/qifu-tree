// 测试用 Node 服务器：与线上相同的 createApp，但时钟由文件控制，存储为全新的 SQLite 文件。
import { serve } from '@hono/node-server';
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from '../../server/app.js';
import { createDb } from '../../server/db.js';
import { ensureTestAccount, testAccountFromEnv } from '../../server/testAccount.js';

const port = Number(process.env.PORT ?? 47341);
const clockFile = process.env.QIFU_TEST_NOW_FILE ?? '';
const now = () => {
  if (clockFile) {
    try {
      const v = fs.readFileSync(clockFile, 'utf8').trim();
      if (/^\d+$/.test(v)) return Number(v);
    } catch {
      /* real time */
    }
  }
  return Date.now();
};

const dir = process.env.DATA_DIR ?? '/tmp/qifu-parity-node';
fs.rmSync(dir, { recursive: true, force: true });
const db = await createDb(`file:${path.join(dir, 'qifu.db')}`, 'local');
const testAccount = testAccountFromEnv(process.env);
await ensureTestAccount(db, testAccount, now);
const app = createApp({ db, now, testAccount });
serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }, () => console.log(`node parity server on ${port}`));
