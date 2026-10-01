import { Hono, type Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { cors } from 'hono/cors';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import type { Db, Exec } from './db.js';
import { UNLIMITED_BALANCE, ensureTestAccount, isTestAccount, testAccountFromEnv, type TestAccountConfig } from './testAccount.js';
import {
  ITEMS,
  MAX_WISH_LENGTH,
  START_ENERGY,
  TERRAINS,
  defaultTerrainFor,
  type TerrainId,
  TOPUP_PACKS,
  checkinReward,
  stageOf,
  type PrayerTag,
  type PublicUser,
} from '../shared/game.js';

const SESSION_COOKIE = 'qifu_session';
const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;
const TAG_LIMIT = 300;

export const DEFAULT_ALLOWED_ORIGINS = [
  'http://qifu.laixi.cn',
  'https://qifu.laixi.cn',
  'https://qifu-tree.vercel.app',
  'http://localhost:47231',
  'http://127.0.0.1:47231',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];

export function allowedOriginsFromEnv(env: Record<string, string | undefined> = process.env): string[] {
  const raw = env.ALLOWED_ORIGINS;
  if (raw === undefined) return DEFAULT_ALLOWED_ORIGINS;
  return raw
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  energy: number;
  coins: number;
  streak: number;
  last_checkin: string | null;
  terrain: string | null;
  created_at: number;
}

export interface AppOptions {
  db: Db | Promise<Db>;
  timeZone?: string;
  now?: () => number;
  testAccount?: TestAccountConfig | null;
  allowedOrigins?: string[];
}

export function createApp({ db: dbInput, timeZone = 'Asia/Shanghai', now = Date.now, testAccount = testAccountFromEnv(), allowedOrigins = allowedOriginsFromEnv() }: AppOptions) {
  const app = new Hono();
  const origins = new Set(allowedOrigins);

  app.use(
    '*',
    cors({
      origin: (origin) => (origins.has(origin) ? origin : null),
      allowHeaders: ['Content-Type', 'Authorization'],
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      credentials: true,
      maxAge: 86400,
    }),
  );

  let db!: Db;
  app.use('*', async (_c, next) => {
    if (!db) {
      db = await dbInput;
      await ensureTestAccount(db, testAccount, now);
    }
    await next();
  });

  const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const dayOf = (ms: number) => dayFormat.format(new Date(ms));
  const today = () => dayOf(now());
  const yesterday = () => dayOf(now() - 24 * 3600 * 1000);

  const hashToken = (t: string) => crypto.createHash('sha256').update(t).digest('hex');

  const failures = new Map<string, { count: number; until: number }>();
  const throttled = (key: string) => {
    const f = failures.get(key);
    return !!f && f.count >= 8 && f.until > now();
  };
  const noteFailure = (key: string) => {
    const f = failures.get(key);
    if (f && f.until > now()) f.count++;
    else failures.set(key, { count: 1, until: now() + 10 * 60 * 1000 });
  };

  const getUser = (id: number, ex: Exec = db) => ex.get<UserRow>('SELECT * FROM users WHERE id = ?', [id]);

  const ensureTerrain = async (u: UserRow): Promise<{ terrain: TerrainId; owned: TerrainId[] }> => {
    if (!u.terrain) {
      u.terrain = defaultTerrainFor(u.id);
      await db.run('UPDATE users SET terrain = ? WHERE id = ?', [u.terrain, u.id]);
      await db.run('INSERT OR IGNORE INTO user_terrains (user_id, terrain) VALUES (?, ?)', [u.id, u.terrain]);
    }
    const owned = (await db.all<{ terrain: TerrainId }>('SELECT terrain FROM user_terrains WHERE user_id = ?', [u.id])).map((r) => r.terrain);
    if (!owned.includes(u.terrain as TerrainId)) {
      await db.run('INSERT OR IGNORE INTO user_terrains (user_id, terrain) VALUES (?, ?)', [u.id, u.terrain]);
      owned.push(u.terrain as TerrainId);
    }
    return { terrain: u.terrain as TerrainId, owned };
  };

  const toPublic = async (u: UserRow): Promise<PublicUser> => {
    const { terrain, owned } = await ensureTerrain(u);
    const row = await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM prayers WHERE user_id = ?', [u.id]);
    const n = row?.n ?? 0;
    return {
      id: u.id,
      username: u.username,
      energy: u.energy,
      coins: u.coins,
      streak: u.last_checkin === today() || u.last_checkin === yesterday() ? u.streak : 0,
      checkedInToday: u.last_checkin === today(),
      prayerCount: n,
      stage: stageOf(n),
      terrain,
      ownedTerrains: owned,
    };
  };

  const bearerToken = (c: Context): string | undefined => {
    const m = /^Bearer\s+(\S+)$/i.exec(c.req.header('authorization') ?? '');
    return m?.[1];
  };

  const sessionTokens = (c: Context): string[] => {
    const tokens = [bearerToken(c), getCookie(c, SESSION_COOKIE)].filter((t): t is string => !!t);
    return [...new Set(tokens)];
  };

  const startSession = async (c: Context, userId: number): Promise<string> => {
    const token = crypto.randomBytes(32).toString('base64url');
    await db.run('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)', [
      hashToken(token),
      userId,
      now() + SESSION_TTL_MS,
    ]);
    setCookie(c, SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'Lax',
      path: '/',
      maxAge: SESSION_TTL_MS / 1000,
      secure: c.req.header('x-forwarded-proto') === 'https',
    });
    return token;
  };

  const currentUser = async (c: Context): Promise<UserRow | undefined> => {
    for (const token of sessionTokens(c)) {
      const row = await db.get<{ user_id: number; expires_at: number }>(
        'SELECT user_id, expires_at FROM sessions WHERE token_hash = ?',
        [hashToken(token)],
      );
      if (!row) continue;
      if (row.expires_at < now()) {
        await db.run('DELETE FROM sessions WHERE token_hash = ?', [hashToken(token)]);
        continue;
      }
      const user = await getUser(row.user_id);
      if (user) return user;
    }
    return undefined;
  };

  const body = async (c: Context): Promise<Record<string, unknown>> => {
    try {
      const b = await c.req.json();
      return b && typeof b === 'object' ? (b as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  };

  const fail = (c: Context, message: string, status: 400 | 401 | 402 | 409 | 429 = 400) => c.json({ error: message }, status);

  const clientIp = (c: Context) => c.req.header('x-forwarded-for')?.split(',')[0].trim() ?? 'local';

  app.post('/api/register', async (c) => {
    const b = await body(c);
    const username = typeof b.username === 'string' ? b.username.trim() : '';
    const password = typeof b.password === 'string' ? b.password : '';
    if (!/^[\p{L}\p{N}_-]{2,20}$/u.test(username)) return fail(c, '用户名需为 2-20 位的字母、数字、汉字、下划线或短横线');
    if (password.length < 6 || password.length > 72) return fail(c, '密码长度需在 6-72 位之间');
    const key = `reg:${clientIp(c)}`;
    if (throttled(key)) return fail(c, '操作过于频繁，请稍后再试', 429);
    if (await db.get('SELECT 1 FROM users WHERE username = ?', [username])) return fail(c, '用户名已被使用', 409);
    const hash = await bcrypt.hash(password, 10);
    try {
      const info = await db.run(
        'INSERT INTO users (username, password_hash, energy, coins, created_at) VALUES (?, ?, ?, 0, ?)',
        [username, hash, START_ENERGY, now()],
      );
      noteFailure(key);
      const token = await startSession(c, info.lastId);
      await ensureTerrain((await getUser(info.lastId))!);
      return c.json({ user: await toPublic((await getUser(info.lastId))!), token });
    } catch {
      return fail(c, '用户名已被使用', 409);
    }
  });

  app.post('/api/login', async (c) => {
    const b = await body(c);
    const username = typeof b.username === 'string' ? b.username.trim() : '';
    const password = typeof b.password === 'string' ? b.password : '';
    const key = `login:${clientIp(c)}:${username.toLowerCase()}`;
    if (throttled(key)) return fail(c, '尝试次数过多，请 10 分钟后再试', 429);
    if (isTestAccount(testAccount, username)) await ensureTestAccount(db, testAccount, now);
    const u = await db.get<UserRow>('SELECT * FROM users WHERE username = ?', [username]);
    const ok = u ? await bcrypt.compare(password, u.password_hash) : false;
    if (!u || !ok) {
      noteFailure(key);
      return fail(c, '用户名或密码错误', 401);
    }
    failures.delete(key);
    const token = await startSession(c, u.id);
    return c.json({ user: await toPublic(u), token });
  });

  app.post('/api/logout', async (c) => {
    for (const token of sessionTokens(c)) await db.run('DELETE FROM sessions WHERE token_hash = ?', [hashToken(token)]);
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.json({ ok: true });
  });

  app.get('/api/me', async (c) => {
    const u = await currentUser(c);
    return c.json({ user: u ? await toPublic(u) : null, mode: db.mode });
  });

  app.get('/api/config', (c) =>
    c.json({ items: ITEMS, packs: TOPUP_PACKS, terrains: TERRAINS, maxWishLength: MAX_WISH_LENGTH, mode: db.mode }),
  );

  app.post('/api/checkin', async (c) => {
    const u = await currentUser(c);
    if (!u) return fail(c, '请先登录', 401);
    const gained = await db.tx(async (t) => {
      const fresh = (await getUser(u.id, t))!;
      if (fresh.last_checkin === today()) return null;
      const streak = fresh.last_checkin === yesterday() ? fresh.streak + 1 : 1;
      const reward = checkinReward(streak);
      await t.run('UPDATE users SET energy = energy + ?, streak = ?, last_checkin = ? WHERE id = ?', [
        reward,
        streak,
        today(),
        u.id,
      ]);
      return reward;
    });
    if (gained === null) return fail(c, '今天已经签到过了', 409);
    return c.json({ gained, user: await toPublic((await getUser(u.id))!) });
  });

  app.post('/api/pray', async (c) => {
    const u = await currentUser(c);
    if (!u) return fail(c, '请先登录', 401);
    const b = await body(c);
    const item = ITEMS.find((i) => i.id === b.item);
    if (!item) return fail(c, '请选择祈福道具');
    const text = typeof b.text === 'string' ? b.text.trim() : '';
    if (!text) return fail(c, '请写下你的心愿');
    if ([...text].length > MAX_WISH_LENGTH) return fail(c, `心愿最多 ${MAX_WISH_LENGTH} 字`);

    const res = await db.tx(async (t) => {
      const fresh = (await getUser(u.id, t))!;
      const balance = item.currency === 'energy' ? fresh.energy : fresh.coins;
      const unlimited = isTestAccount(testAccount, fresh.username);
      if (!unlimited && balance < item.cost) {
        return { error: item.currency === 'energy' ? '能量不足，去签到或使用福币道具吧' : '福币不足，请先充值' };
      }
      if (unlimited) {
        await t.run('UPDATE users SET energy = MAX(energy, ?), coins = MAX(coins, ?) WHERE id = ?', [UNLIMITED_BALANCE, UNLIMITED_BALANCE, u.id]);
      } else if (item.currency === 'energy') {
        await t.run('UPDATE users SET energy = energy - ? + ? WHERE id = ?', [item.cost, item.reward, u.id]);
      } else {
        await t.run('UPDATE users SET coins = coins - ?, energy = energy + ? WHERE id = ?', [item.cost, item.reward, u.id]);
      }
      const row = await t.get<{ n: number }>('SELECT COUNT(*) AS n FROM prayers');
      const position = row?.n ?? 0;
      const info = await t.run(
        'INSERT INTO prayers (user_id, item_type, text, position, created_at) VALUES (?, ?, ?, ?, ?)',
        [u.id, item.id, text, position, now()],
      );
      return { id: info.lastId, position };
    });
    if ('error' in res) return fail(c, res.error as string, 402);
    const tag: PrayerTag = {
      id: res.id,
      itemType: item.id,
      text,
      position: res.position,
      username: u.username,
      createdAt: now(),
      mine: true,
    };
    return c.json({ tag, reward: item.reward, user: await toPublic((await getUser(u.id))!) });
  });

  app.post('/api/terrain', async (c) => {
    const u = await currentUser(c);
    if (!u) return fail(c, '请先登录', 401);
    const b = await body(c);
    const def = TERRAINS.find((t) => t.id === b.terrain);
    if (!def) return fail(c, '未知的地形');
    await ensureTerrain(u);
    const res = await db.tx(async (t) => {
      const fresh = (await getUser(u.id, t))!;
      const owned = await t.get('SELECT 1 FROM user_terrains WHERE user_id = ? AND terrain = ?', [u.id, def.id]);
      let spent = 0;
      if (!owned) {
        const unlimited = isTestAccount(testAccount, fresh.username);
        if (!unlimited && fresh.coins < def.price) return { error: '福币不足，请先充值' };
        if (!unlimited) await t.run('UPDATE users SET coins = coins - ? WHERE id = ?', [def.price, u.id]);
        await t.run('INSERT INTO user_terrains (user_id, terrain) VALUES (?, ?)', [u.id, def.id]);
        spent = unlimited ? 0 : def.price;
      }
      await t.run('UPDATE users SET terrain = ? WHERE id = ?', [def.id, u.id]);
      return { spent };
    });
    if ('error' in res) return fail(c, res.error as string, 402);
    return c.json({ spent: res.spent, user: await toPublic((await getUser(u.id))!) });
  });

  app.post('/api/topup', async (c) => {
    const u = await currentUser(c);
    if (!u) return fail(c, '请先登录', 401);
    const b = await body(c);
    const pack = TOPUP_PACKS.find((p) => p.id === b.pack);
    if (!pack) return fail(c, '请选择充值档位');
    await db.tx(async (t) => {
      await t.run('UPDATE users SET coins = coins + ? WHERE id = ?', [pack.coins, u.id]);
      await t.run('INSERT INTO topups (user_id, pack_id, coins, created_at) VALUES (?, ?, ?, ?)', [u.id, pack.id, pack.coins, now()]);
    });
    return c.json({ added: pack.coins, demo: true, user: await toPublic((await getUser(u.id))!) });
  });

  app.get('/api/prayers', async (c) => {
    const me = await currentUser(c);
    const rows = await db.all<{
      id: number;
      item_type: PrayerTag['itemType'];
      text: string;
      position: number;
      created_at: number;
      user_id: number;
      username: string;
    }>(
      `SELECT p.id, p.item_type, p.text, p.position, p.created_at, p.user_id, u.username
       FROM prayers p JOIN users u ON u.id = p.user_id
       ORDER BY p.id DESC LIMIT ?`,
      [TAG_LIMIT],
    );
    const total = (await db.get<{ total: number }>('SELECT COUNT(*) AS total FROM prayers'))?.total ?? 0;
    const recent =
      (await db.get<{ recent: number }>('SELECT COUNT(*) AS recent FROM prayers WHERE created_at > ?', [now() - 24 * 3600 * 1000]))
        ?.recent ?? 0;
    const tags: PrayerTag[] = rows.reverse().map((r) => ({
      id: r.id,
      itemType: r.item_type,
      text: r.text,
      position: r.position,
      username: r.username,
      createdAt: r.created_at,
      mine: me?.id === r.user_id,
    }));
    return c.json({ tags, total, recent24h: recent });
  });

  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: '服务器开小差了，请稍后再试' }, 500);
  });

  return app;
}
