import { handle } from 'hono/vercel';
import { createApp } from '../server/app.js';
import { openDbFromEnv } from '../server/db.js';

const app = createApp({ db: openDbFromEnv(), timeZone: process.env.APP_TZ ?? 'Asia/Shanghai' });
const handler = handle(app);

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const DELETE = handler;
export const PATCH = handler;
export const OPTIONS = handler;
export const HEAD = handler;
