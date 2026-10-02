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
  createdAt: number;
  mine: boolean;
}
