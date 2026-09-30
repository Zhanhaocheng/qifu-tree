import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from './app.js';
import { openDbFromEnv } from './db.js';

const PORT = Number(process.env.PORT ?? 47232);
const db = await openDbFromEnv();

const root = new Hono();
root.route('/', createApp({ db, timeZone: process.env.APP_TZ ?? 'Asia/Shanghai' }));

const distDir = path.resolve('dist');
if (fs.existsSync(path.join(distDir, 'index.html'))) {
  root.use('/*', serveStatic({ root: './dist' }));
  root.get('*', serveStatic({ path: './dist/index.html' }));
}

serve({ fetch: root.fetch, port: PORT, hostname: '0.0.0.0' }, (info) => {
  console.log(`祈福树服务已启动: http://0.0.0.0:${info.port} (存储: ${db.mode})`);
});
