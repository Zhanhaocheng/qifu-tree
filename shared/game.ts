export type ItemId = 'wood' | 'ribbon' | 'gold' | 'lantern' | 'lotus';

export interface ItemDef {
  id: ItemId;
  name: string;
  desc: string;
  currency: 'energy' | 'coins';
  cost: number;
  /** 祈福后返还的能量 */
  reward: number;
  /** 对树成长的贡献权重 */
  growth: number;
  glow: boolean;
  color: string;
}

export const ITEMS: ItemDef[] = [
  { id: 'wood', name: '平安木牌', desc: '朴素木牌，寄托一份平安', currency: 'energy', cost: 30, reward: 0, growth: 1, glow: false, color: '#c9955a' },
  { id: 'ribbon', name: '红绸福带', desc: '一条红绸，系上心愿', currency: 'energy', cost: 58, reward: 0, growth: 1, glow: false, color: '#d8343a' },
  { id: 'gold', name: '金色福牌', desc: '金牌高悬，福气加倍', currency: 'coins', cost: 28, reward: 0, growth: 2, glow: false, color: '#f2c14e' },
  { id: 'lantern', name: '祈福灯', desc: '夜里会发出温暖的光', currency: 'coins', cost: 68, reward: 0, growth: 3, glow: true, color: '#ff8a3d' },
  { id: 'lotus', name: '莲花灯', desc: '莲开一盏，福泽绵长', currency: 'coins', cost: 88, reward: 0, growth: 5, glow: true, color: '#ff8fc0' },
];

export interface TopupPack {
  id: string;
  coins: number;
  price: number;
  label: string;
}

export const TOPUP_PACKS: TopupPack[] = [
  { id: 'p1', coins: 60, price: 1, label: '小福包' },
  { id: 'p5', coins: 330, price: 5, label: '中福包' },
  { id: 'p10', coins: 1180, price: 10, label: '大福包' },
];

export const STAGES = [
  { name: '树苗', min: 0 },
  { name: '小树', min: 3 },
  { name: '大树', min: 12 },
  { name: '繁茂古树', min: 40 },
] as const;

export function stageOf(prayerCount: number): number {
  let s = 0;
  for (let i = 0; i < STAGES.length; i++) if (prayerCount >= STAGES[i].min) s = i;
  return s;
}

export function checkinReward(streak: number): number {
  return 20 + Math.min(streak - 1, 6) * 5;
}

export type TerrainId = 'mountain' | 'bamboo' | 'jiangnan' | 'desert' | 'snow';

export interface TerrainDef {
  id: TerrainId;
  name: string;
  subtitle: string;
  desc: string;
  price: number;
  swatch: [string, string];
}

export const TERRAINS: TerrainDef[] = [
  { id: 'mountain', name: '山巅云海', subtitle: '孤峰之上', desc: '绝壁孤峰，脚下云海翻涌，远山如黛', price: 888, swatch: ['#8fb4d9', '#f4efe4'] },
  { id: 'bamboo', name: '竹林溪谷', subtitle: '幽篁听泉', desc: '竹影婆娑，溪水潺潺，薄雾里有鹿与蜻蜓', price: 888, swatch: ['#3f7a4a', '#b8d9a0'] },
  { id: 'jiangnan', name: '江南水乡', subtitle: '烟雨小桥', desc: '粉墙黛瓦，拱桥乌篷，一池莲叶伴垂柳', price: 888, swatch: ['#5f8f9c', '#e8e2d2'] },
  { id: 'desert', name: '大漠孤烟', subtitle: '长河落日', desc: '沙丘如浪，孤烟直上，驼铃隐隐', price: 888, swatch: ['#d9a25b', '#f3d9a0'] },
  { id: 'snow', name: '雪山寒林', subtitle: '千山鸟飞绝', desc: '雪峰环绕，寒松覆雪，红绸格外醒目', price: 888, swatch: ['#a9c4dc', '#ffffff'] },
];

export function defaultTerrainFor(userId: number): TerrainId {
  const h = Math.imul(userId + 7, 2654435761) >>> 0;
  return TERRAINS[(h >>> 8) % TERRAINS.length].id;
}

export const MAX_WISH_LENGTH = 60;
export const START_ENERGY = 30;

export interface PublicUser {
  id: number;
  username: string;
  /** 展示名；未设置时等于用户名 */
  nickname: string;
  /** `preset:<id>`（内置头像）或 `data:image/(png|jpeg|webp);base64,...`（128x128 上传头像）；null = 默认首字母头像 */
  avatar: string | null;
  age: number | null;
  energy: number;
  coins: number;
  streak: number;
  checkedInToday: boolean;
  prayerCount: number;
  stage: number;
  terrain: TerrainId;
  ownedTerrains: TerrainId[];
}

export interface PrayerTag {
  id: number;
  itemType: ItemId;
  text: string;
  position: number;
  username: string;
  nickname: string;
  createdAt: number;
  mine: boolean;
}

/* ------------------------------------------------------------------ 个人资料 */

export const NICKNAME_MAX = 20;
export const AGE_MIN = 1;
export const AGE_MAX = 120;
/** 上传头像（解码后的图片字节）上限；前端会裁成 128x128 并压缩，后端再校验 */
export const AVATAR_MAX_BYTES = 24 * 1024;
export const AVATAR_SIZE = 128;

export const AVATAR_PRESETS = [
  { id: 'crane', name: '仙鹤' },
  { id: 'lotus', name: '莲花' },
  { id: 'koi', name: '锦鲤' },
  { id: 'bamboo', name: '青竹' },
  { id: 'plum', name: '寒梅' },
  { id: 'lantern', name: '灯笼' },
  { id: 'fu', name: '福印' },
  { id: 'cloud', name: '祥云' },
  { id: 'panda', name: '熊猫' },
  { id: 'rabbit', name: '玉兔' },
  { id: 'mountain', name: '远山' },
  { id: 'coin', name: '铜钱' },
] as const;

export type AvatarPresetId = (typeof AVATAR_PRESETS)[number]['id'];

export interface ProfileInput {
  nickname?: unknown;
  avatar?: unknown;
  age?: unknown;
}

/** 校验后的更新；缺席的字段表示不修改。nickname === null 表示恢复为用户名 */
export interface ProfileUpdate {
  nickname?: string | null;
  avatar?: string | null;
  age?: number | null;
}

export const PROFILE_ERRORS = {
  nickname: `昵称需为 1-${NICKNAME_MAX} 位的字母、数字、汉字、空格、下划线、短横线、点或间隔号`,
  age: `年龄需为 ${AGE_MIN}-${AGE_MAX} 之间的整数，也可以留空`,
  avatar: '头像无效，请重新选择',
  avatarType: '头像图片格式需为 PNG、JPEG 或 WebP',
  avatarSize: '头像图片过大，请换一张或重新裁剪',
  empty: '没有需要修改的内容',
} as const;

const NICKNAME_RE = /^[\p{L}\p{M}\p{N}_\-·. ]{1,20}$/u;
const AVATAR_DATA_RE = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/;
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** 解码 base64 的前 24 个字符（18 字节），用来核对文件头，不依赖 Buffer / atob */
function b64Head(b64: string): number[] {
  const out: number[] = [];
  const head = b64.slice(0, 24);
  for (let i = 0; i + 3 < head.length; i += 4) {
    const n = [0, 1, 2, 3].map((k) => B64.indexOf(head[i + k]));
    out.push((n[0] << 2) | (n[1] >> 4), ((n[1] & 15) << 4) | (n[2] >> 2), ((n[2] & 3) << 6) | n[3]);
  }
  return out;
}

export function avatarDataBytes(b64: string): number {
  return Math.floor((b64.length * 3) / 4) - (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0);
}

/** 返回 null 表示有效，否则是错误提示 */
export function avatarError(v: string): string | null {
  if (v.startsWith('preset:')) return AVATAR_PRESETS.some((p) => `preset:${p.id}` === v) ? null : PROFILE_ERRORS.avatar;
  const m = AVATAR_DATA_RE.exec(v);
  if (!m || m[2].length % 4 !== 0) return v.startsWith('data:image/') ? PROFILE_ERRORS.avatarType : PROFILE_ERRORS.avatar;
  if (avatarDataBytes(m[2]) > AVATAR_MAX_BYTES) return PROFILE_ERRORS.avatarSize;
  const h = b64Head(m[2]);
  const isPng = h[0] === 0x89 && h[1] === 0x50 && h[2] === 0x4e && h[3] === 0x47 && h[4] === 0x0d && h[5] === 0x0a && h[6] === 0x1a && h[7] === 0x0a;
  const isJpeg = h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff;
  const isWebp = h[0] === 0x52 && h[1] === 0x49 && h[2] === 0x46 && h[3] === 0x46 && h[8] === 0x57 && h[9] === 0x45 && h[10] === 0x42 && h[11] === 0x50;
  const ok = m[1] === 'png' ? isPng : m[1] === 'jpeg' ? isJpeg : isWebp;
  return ok ? null : PROFILE_ERRORS.avatarType;
}

/**
 * 校验并规范化个人资料更新。只处理出现的字段（`in` 判断），用于 GET/PUT /api/profile。
 * PHP 版（php-backend/api/lib/profile.php 中的 q_validate_profile）必须保持完全一致，parity 测试会比对。
 */
export function validateProfile(b: Record<string, unknown>): { ok: true; value: ProfileUpdate } | { ok: false; error: string } {
  const value: ProfileUpdate = {};
  if ('nickname' in b) {
    const raw = b.nickname;
    if (raw === null) value.nickname = null;
    else if (typeof raw !== 'string') return { ok: false, error: PROFILE_ERRORS.nickname };
    else {
      const t = raw.trim().replace(/ {2,}/g, ' ');
      if (t === '') value.nickname = null;
      else if (!NICKNAME_RE.test(t)) return { ok: false, error: PROFILE_ERRORS.nickname };
      else value.nickname = t;
    }
  }
  if ('avatar' in b) {
    const raw = b.avatar;
    if (raw === null || raw === '') value.avatar = null;
    else if (typeof raw !== 'string') return { ok: false, error: PROFILE_ERRORS.avatar };
    else {
      const err = avatarError(raw);
      if (err) return { ok: false, error: err };
      value.avatar = raw;
    }
  }
  if ('age' in b) {
    const raw = b.age;
    let n: number | null | undefined;
    if (raw === null || raw === '') n = null;
    else if (typeof raw === 'number' && Number.isInteger(raw)) n = raw;
    else if (typeof raw === 'string' && /^\d{1,3}$/.test(raw)) n = Number(raw);
    if (n === undefined || (n !== null && (n < AGE_MIN || n > AGE_MAX))) return { ok: false, error: PROFILE_ERRORS.age };
    value.age = n;
  }
  if (!('nickname' in value) && !('avatar' in value) && !('age' in value)) return { ok: false, error: PROFILE_ERRORS.empty };
  return { ok: true, value };
}
