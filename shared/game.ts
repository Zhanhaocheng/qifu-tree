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
  { id: 'wood', name: '平安木牌', desc: '朴素木牌，寄托一份平安', currency: 'energy', cost: 10, reward: 0, growth: 1, glow: false, color: '#c9955a' },
  { id: 'ribbon', name: '红绸福带', desc: '一条红绸，系上心愿', currency: 'energy', cost: 25, reward: 5, growth: 1, glow: false, color: '#d8343a' },
  { id: 'gold', name: '金色福牌', desc: '金牌高悬，福气加倍', currency: 'coins', cost: 8, reward: 40, growth: 2, glow: false, color: '#f2c14e' },
  { id: 'lantern', name: '祈福灯', desc: '夜里会发出温暖的光', currency: 'coins', cost: 18, reward: 100, growth: 3, glow: true, color: '#ff8a3d' },
  { id: 'lotus', name: '莲花灯', desc: '莲开一盏，福泽绵长', currency: 'coins', cost: 38, reward: 260, growth: 5, glow: true, color: '#ff8fc0' },
];

export interface TopupPack {
  id: string;
  coins: number;
  price: number;
  label: string;
}

export const TOPUP_PACKS: TopupPack[] = [
  { id: 'p6', coins: 60, price: 6, label: '小福包' },
  { id: 'p30', coins: 330, price: 30, label: '中福包' },
  { id: 'p98', coins: 1180, price: 98, label: '大福包' },
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
