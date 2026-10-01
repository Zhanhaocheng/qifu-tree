/**
 * 成功反馈中枢：音效 + 弹层 + 震动 + 派发 `qifu:fx` 窗口事件（供 3D 场景订阅粒子）。
 *
 * 事件契约（window.dispatchEvent(new CustomEvent('qifu:fx', { detail }))）：
 *   detail.type: 'payment' | 'terrain-unlock' | 'terrain-switch' | 'pray' | 'checkin'
 *   公共字段：intensity(1-3)、particles（推荐粒子种类，按主次排序）、palette（推荐颜色）、
 *             count（建议粒子数）、origin（建议发射位置）、ts（毫秒时间戳）
 *   各类型专有字段见下方 QifuFxEvent。
 */
import { ITEMS, type ItemId, type TerrainDef, type TerrainId } from '../shared/game';
import type { AudioEngine } from './audio';

export type FxParticleKind = 'coins' | 'petals' | 'lantern' | 'sparkle';
export type FxOrigin = 'tree' | 'tag' | 'terrain' | 'screen';

interface FxBase {
  intensity: 1 | 2 | 3;
  particles: FxParticleKind[];
  palette: string[];
  count: number;
  origin: FxOrigin;
  ts: number;
}

export type QifuFxEvent =
  | (FxBase & { type: 'payment'; added: number; balance: number; pack: string })
  | (FxBase & { type: 'terrain-unlock'; terrain: TerrainId; name: string; spent: number; balance: number })
  | (FxBase & { type: 'terrain-switch'; terrain: TerrainId; name: string })
  | (FxBase & { type: 'pray'; item: ItemId; itemName: string; color: string; glow: boolean; reward: number; tagId: number | null })
  | (FxBase & { type: 'checkin'; gained: number; streak: number });

type FxInput = QifuFxEvent extends infer T ? (T extends unknown ? Omit<T, keyof FxBase> & Partial<FxBase> : never) : never;

declare global {
  interface WindowEventMap {
    'qifu:fx': CustomEvent<QifuFxEvent>;
  }
}

const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function vibrate(pattern: number | number[]) {
  if (reduceMotion()) return;
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* 部分浏览器禁止 */
  }
}

const HAPTICS: Record<string, number[]> = {
  payment: [18, 40, 18, 40, 70],
  'terrain-unlock': [30, 50, 30, 50, 140],
  'terrain-switch': [14],
  checkin: [14, 30, 14],
  wood: [30],
  ribbon: [14, 30, 14],
  gold: [18, 36, 50],
  lantern: [26, 60, 80],
  lotus: [18, 36, 18, 36, 18, 36, 110],
};

const SVG = {
  coin: '<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="26" fill="#f2c14e" stroke="#fff3c4" stroke-width="3"/><circle cx="32" cy="32" r="19" fill="none" stroke="#b9852a" stroke-width="2.5"/><rect x="25" y="25" width="14" height="14" rx="2.5" fill="none" stroke="#b9852a" stroke-width="3"/></svg>',
  terrain: '<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="45" cy="19" r="7" fill="#fff3c4"/><path d="M4 54 24 20l12 18 8-11 16 27z" fill="#8fb4d9" stroke="#fff" stroke-width="2.5" stroke-linejoin="round"/><path d="m24 20 6 9-6-2-5 4z" fill="#fff"/></svg>',
  energy: '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M36 4 12 36h14l-4 24 28-34H36z" fill="#ffd76a" stroke="#fff3c4" stroke-width="3" stroke-linejoin="round"/></svg>',
};

function itemSvg(id: ItemId, color: string) {
  const shapes: Record<ItemId, string> = {
    wood: `<rect x="18" y="8" width="28" height="44" rx="5" fill="${color}" stroke="#fff3c4" stroke-width="2.5"/><path d="M32 2v8" stroke="#a8742f" stroke-width="3"/><path d="M24 22h16M24 30h16M24 38h10" stroke="#7a4f1c" stroke-width="2.5" stroke-linecap="round"/>`,
    ribbon: `<path d="M20 6h24v50l-12-10-12 10z" fill="${color}" stroke="#ffd0d0" stroke-width="2.5" stroke-linejoin="round"/><path d="M26 16h12M26 24h12" stroke="#ffe3a0" stroke-width="3" stroke-linecap="round"/>`,
    gold: `<rect x="16" y="8" width="32" height="46" rx="6" fill="${color}" stroke="#fff3c4" stroke-width="3"/><path d="M32 2v8" stroke="#b9852a" stroke-width="3"/><circle cx="32" cy="31" r="10" fill="none" stroke="#b9852a" stroke-width="3"/><rect x="28" y="27" width="8" height="8" fill="none" stroke="#b9852a" stroke-width="2.5"/>`,
    lantern: `<path d="M32 3v7M20 12h24" stroke="#a8742f" stroke-width="3.5" stroke-linecap="round"/><ellipse cx="32" cy="32" rx="17" ry="20" fill="${color}" stroke="#ffe3a0" stroke-width="3"/><path d="M32 12v40M21 17q-4 15 0 30M43 17q4 15 0 30" fill="none" stroke="#ffe3a0" stroke-width="2" opacity=".7"/><path d="M26 54h12M32 54v8" stroke="#a8742f" stroke-width="3" stroke-linecap="round"/>`,
    lotus: `<path d="M32 12c-8 8-8 22 0 34 8-12 8-26 0-34zM18 22c-6 10-2 22 14 26-2-14-8-22-14-26zM46 22c6 10 2 22-14 26 2-14 8-22 14-26z" fill="${color}" stroke="#ffe0ee" stroke-width="2.5" stroke-linejoin="round"/><path d="M12 52q20 8 40 0" fill="none" stroke="#7fc88a" stroke-width="4" stroke-linecap="round"/>`,
  };
  return `<svg viewBox="0 0 64 64" aria-hidden="true">${shapes[id]}</svg>`;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

interface CardOpts {
  icon: string;
  title: string;
  sub: string;
  tone: 'gold' | 'jade' | 'lantern' | 'lotus' | 'red';
  particles: FxParticleKind;
  palette: string[];
  count: number;
  flash?: boolean;
}

function layer() {
  let el = document.querySelector<HTMLElement>('#fx-layer');
  if (!el) {
    el = document.createElement('div');
    el.id = 'fx-layer';
    el.setAttribute('aria-live', 'polite');
    document.querySelector('#app')!.appendChild(el);
  }
  return el;
}

function showCard(o: CardOpts) {
  const root = layer();
  while (root.querySelectorAll('.fx-card').length >= 2) root.querySelector('.fx-card')!.remove();
  const card = document.createElement('div');
  card.className = `fx-card tone-${o.tone}`;
  const sparks = reduceMotion()
    ? ''
    : Array.from({ length: o.count }, (_, i) => {
        const ang = (i / o.count) * Math.PI * 2 + Math.random() * 0.5;
        const dist = 90 + Math.random() * 120;
        const size = 6 + Math.random() * 9;
        const color = o.palette[i % o.palette.length];
        const delay = Math.random() * 0.12;
        return `<i class="fx-p ${o.particles}" style="--dx:${(Math.cos(ang) * dist).toFixed(0)}px;--dy:${(Math.sin(ang) * dist - 30).toFixed(0)}px;--s:${size.toFixed(1)}px;--c:${color};--r:${Math.floor(Math.random() * 360)}deg;animation-delay:${delay.toFixed(2)}s"></i>`;
      }).join('');
  card.innerHTML = `<div class="fx-glow"></div><div class="fx-sparks">${sparks}</div><div class="fx-icon">${o.icon}</div><b class="fx-title">${esc(o.title)}</b><span class="fx-sub">${esc(o.sub)}</span>`;
  root.appendChild(card);
  if (o.flash && !reduceMotion()) {
    const flash = document.createElement('div');
    flash.className = 'fx-flash';
    root.appendChild(flash);
    setTimeout(() => flash.remove(), 1200);
  }
  setTimeout(() => card.classList.add('out'), 2300);
  setTimeout(() => card.remove(), 2800);
}

export function createFx(audio: AudioEngine) {
  const dispatch = (e: FxInput) => {
    const base: Record<QifuFxEvent['type'], Pick<FxBase, 'intensity' | 'particles' | 'palette' | 'count' | 'origin'>> = {
      payment: { intensity: 2, particles: ['coins', 'sparkle'], palette: ['#f2c14e', '#ffd76a', '#fff3c4'], count: 36, origin: 'tree' },
      'terrain-unlock': { intensity: 3, particles: ['sparkle', 'petals'], palette: ['#f2c14e', '#fff3c4', '#ffb7c5'], count: 60, origin: 'terrain' },
      'terrain-switch': { intensity: 1, particles: ['sparkle'], palette: ['#fff3c4', '#cfe3ff'], count: 18, origin: 'terrain' },
      pray: { intensity: 2, particles: ['sparkle'], palette: ['#f2c14e', '#fff3c4'], count: 40, origin: 'tag' },
      checkin: { intensity: 1, particles: ['sparkle'], palette: ['#ffd76a', '#8bd45a'], count: 20, origin: 'tree' },
    };
    const detail = { ...base[e.type], ...e, ts: Date.now() } as QifuFxEvent;
    window.dispatchEvent(new CustomEvent('qifu:fx', { detail }));
    return detail;
  };

  return {
    payment(added: number, balance: number, packLabel: string) {
      const intensity = added >= 1000 ? 3 : added >= 300 ? 2 : 1;
      const d = dispatch({ type: 'payment', added, balance, pack: packLabel, intensity, count: 24 + intensity * 14 });
      audio.payment(added);
      vibrate(HAPTICS.payment);
      showCard({ icon: SVG.coin, title: `+${added} 福币`, sub: `支付成功 · ${packLabel}`, tone: 'gold', particles: 'coins', palette: d.palette, count: d.count });
    },
    terrainUnlock(t: TerrainDef, spent: number, balance: number) {
      const d = dispatch({ type: 'terrain-unlock', terrain: t.id, name: t.name, spent, balance, palette: [t.swatch[0], t.swatch[1], '#f2c14e', '#fff3c4', '#ffb7c5'] });
      audio.terrainUnlock();
      vibrate(HAPTICS['terrain-unlock']);
      showCard({
        icon: SVG.terrain.replace('#8fb4d9', t.swatch[0]),
        title: '已解锁',
        sub: `${t.name} · ${t.subtitle}${spent ? ` · -${spent} 福币` : ''}`,
        tone: 'jade',
        particles: 'sparkle',
        palette: d.palette,
        count: d.count,
        flash: true,
      });
    },
    terrainSwitch(t: TerrainDef) {
      dispatch({ type: 'terrain-switch', terrain: t.id, name: t.name, palette: [t.swatch[0], t.swatch[1], '#fff3c4'] });
      vibrate(HAPTICS['terrain-switch']);
    },
    pray(item: ItemId, reward: number, tagId: number | null) {
      const def = ITEMS.find((i) => i.id === item)!;
      const particles: Record<ItemId, FxParticleKind[]> = {
        wood: ['sparkle'],
        ribbon: ['petals', 'sparkle'],
        gold: ['coins', 'sparkle'],
        lantern: ['lantern', 'sparkle'],
        lotus: ['petals', 'lantern'],
      };
      const tone: Record<ItemId, CardOpts['tone']> = { wood: 'gold', ribbon: 'red', gold: 'gold', lantern: 'lantern', lotus: 'lotus' };
      const palette = item === 'lotus' ? ['#ff8fc0', '#ffd0e4', '#fff3c4'] : item === 'ribbon' ? ['#d8343a', '#ff7b7b', '#ffe3a0'] : item === 'lantern' ? ['#ff8a3d', '#ffc36b', '#fff3c4'] : ['#f2c14e', '#ffd76a', '#fff3c4'];
      const d = dispatch({
        type: 'pray',
        item,
        itemName: def.name,
        color: def.color,
        glow: def.glow,
        reward,
        tagId,
        particles: particles[item],
        palette,
        intensity: (def.growth >= 5 ? 3 : def.growth >= 2 ? 2 : 1) as 1 | 2 | 3,
        count: 24 + def.growth * 10,
      });
      audio.pray(item);
      vibrate(HAPTICS[item]);
      showCard({
        icon: itemSvg(item, def.color),
        title: reward ? `+${reward} 能量` : '心愿已挂上',
        sub: `${def.name}${reward ? ' · 返还能量' : ' · 愿心想事成'}`,
        tone: tone[item],
        particles: d.particles[0],
        palette,
        count: d.count,
      });
    },
    checkin(gained: number, streak: number) {
      dispatch({ type: 'checkin', gained, streak });
      audio.checkin();
      vibrate(HAPTICS.checkin);
      showCard({ icon: SVG.energy, title: `+${gained} 能量`, sub: `签到成功 · 已连续 ${streak} 天`, tone: 'gold', particles: 'sparkle', palette: ['#ffd76a', '#8bd45a', '#fff3c4'], count: 18 });
    },
  };
}
