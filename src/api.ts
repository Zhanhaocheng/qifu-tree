import type { ItemDef, ItemId, PrayerTag, PublicUser, TerrainDef, TerrainId, TopupPack } from '../shared/game';

export type StorageMode = 'local' | 'turso' | 'demo';

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('网络连接失败，请检查网络后重试', 0);
  }
  const data = await res.json().catch(() => ({}));
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
  register: (username: string, password: string) => request<{ user: PublicUser }>('POST', '/api/register', { username, password }),
  login: (username: string, password: string) => request<{ user: PublicUser }>('POST', '/api/login', { username, password }),
  logout: () => request<{ ok: true }>('POST', '/api/logout'),
  checkin: () => request<{ gained: number; user: PublicUser }>('POST', '/api/checkin'),
  pray: (item: ItemId, text: string) => request<{ tag: PrayerTag; reward: number; user: PublicUser }>('POST', '/api/pray', { item, text }),
  setTerrain: (terrain: TerrainId) => request<{ spent: number; user: PublicUser }>('POST', '/api/terrain', { terrain }),
  topup: (pack: string) => request<{ added: number; user: PublicUser }>('POST', '/api/topup', { pack }),
  prayers: () => request<PrayersResponse>('GET', '/api/prayers'),
};
