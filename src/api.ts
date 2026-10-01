import type { ItemDef, ItemId, PrayerTag, PublicUser, TerrainDef, TerrainId, TopupPack } from '../shared/game';

export type StorageMode = 'local' | 'turso' | 'demo';

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

const API_BASE = ((import.meta.env.VITE_API_BASE as string | undefined) ?? '').trim().replace(/\/+$/, '');
const TOKEN_KEY = 'qifu_token';

// Bearer tokens are only used when the API lives on another origin, where
// browsers (Safari, WeChat) may block the third-party session cookie.
const crossOrigin = API_BASE !== '';

function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function writeToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable (private mode) */
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  const headers: Record<string, string> = {};
  if (body) headers['content-type'] = 'application/json';
  const token = crossOrigin ? readToken() : null;
  if (token) headers.authorization = `Bearer ${token}`;
  try {
    res = await fetch(API_BASE + url, {
      method,
      credentials: 'include',
      headers: Object.keys(headers).length ? headers : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('网络连接失败，请检查网络后重试', 0);
  }
  const data = await res.json().catch(() => ({}));
  if (crossOrigin) {
    const issued = (data as { token?: unknown }).token;
    if (res.ok && typeof issued === 'string') writeToken(issued);
    else if (res.status === 401 && token) writeToken(null);
  }
  if (!res.ok) throw new ApiError((data as { error?: string }).error ?? '请求失败', res.status);
  return data as T;
}

export interface Config {
  items: ItemDef[];
  packs: TopupPack[];
  terrains: TerrainDef[];
  maxWishLength: number;
  mode: StorageMode;
}

export interface PrayersResponse {
  tags: PrayerTag[];
  total: number;
  recent24h: number;
}

export const api = {
  config: () => request<Config>('GET', '/api/config'),
  me: () => request<{ user: PublicUser | null; mode: StorageMode }>('GET', '/api/me'),
  register: (username: string, password: string) => request<{ user: PublicUser; token?: string }>('POST', '/api/register', { username, password }),
  login: (username: string, password: string) => request<{ user: PublicUser; token?: string }>('POST', '/api/login', { username, password }),
  logout: () => request<{ ok: true }>('POST', '/api/logout').finally(() => writeToken(null)),
  checkin: () => request<{ gained: number; user: PublicUser }>('POST', '/api/checkin'),
  pray: (item: ItemId, text: string) => request<{ tag: PrayerTag; reward: number; user: PublicUser }>('POST', '/api/pray', { item, text }),
  setTerrain: (terrain: TerrainId) => request<{ spent: number; user: PublicUser }>('POST', '/api/terrain', { terrain }),
  topup: (pack: string) => request<{ added: number; user: PublicUser }>('POST', '/api/topup', { pack }),
  prayers: () => request<PrayersResponse>('GET', '/api/prayers'),
};
