/**
 * 界面动效层：全部通过事件委托 / MutationObserver 挂在现有 DOM 上，不侵入业务代码。
 * - 涟漪、指针光晕、选项卡与道具选择的滑动指示器
 * - 弹层入场 stagger、加载态按钮、手机端下滑关闭
 * - 订阅 `qifu:fx`，把奖励以「飞入」的方式送到 HUD 并触发联动（不影响 3D 特效）
 * 所有位移类动画只用 transform / opacity；prefers-reduced-motion 下直接跳过。
 */
import type { QifuFxEvent } from './fx';

const root = document.documentElement;
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const tier = () => root.dataset.gfx ?? 'medium';
const $ = <T extends HTMLElement>(sel: string, scope: ParentNode = document) => scope.querySelector<T>(sel);

const RIPPLE_SEL = '.btn, .act, .icon-btn, .login-btn, .pack, .item, .terrain, .tab, .menu-item, .av-opt, .linkish, .eye';
const GLOW_SEL = '.act, .pack, .item, .terrain';

export function initMotion() {
  root.classList.add('intro');
  setTimeout(markReady, 6000);
  installRipple();
  installPointerGlow();
  watchDialogs();
  watchBusyButtons();
  installIndicators();
  installSheetSwipe();
  installFxLinks();
}

/** 加载层开始淡出时调用：HUD 依次入场 */
export function markReady() {
  root.classList.add('ui-ready');
}

/* ------------------------------------------------------------------ 涟漪 */

function installRipple() {
  document.addEventListener(
    'pointerdown',
    (e) => {
      if (reduceMotion() || e.button > 0) return;
      const host = (e.target as Element | null)?.closest<HTMLElement>(RIPPLE_SEL);
      if (!host || (host as HTMLButtonElement).disabled) return;
      const r = host.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      const size = Math.hypot(Math.max(x, r.width - x), Math.max(y, r.height - y)) * 2;
      let layer = host.querySelector<HTMLElement>(':scope > .rp-layer');
      if (!layer) {
        layer = document.createElement('span');
        layer.className = 'rp-layer';
        layer.setAttribute('aria-hidden', 'true');
        if (getComputedStyle(host).position === 'static') host.classList.add('rp-host');
        host.prepend(layer);
      }
      const wave = document.createElement('span');
      wave.className = 'rp-wave';
      wave.style.cssText = `left:${x}px;top:${y}px;width:${size}px;height:${size}px`;
      layer.appendChild(wave);
      setTimeout(() => wave.remove(), 700);
    },
    { passive: true },
  );
}

/* ---------------------------------------------------------------- 指针光晕 */

function installPointerGlow() {
  if (!matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  let raf = 0;
  let last: PointerEvent | null = null;
  document.addEventListener(
    'pointermove',
    (e) => {
      if (e.pointerType !== 'mouse') return;
      last = e;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const host = (last?.target as Element | null)?.closest<HTMLElement>(GLOW_SEL);
        if (!host || !last || tier() === 'low') return;
        const r = host.getBoundingClientRect();
        host.classList.add('glow-host');
        host.style.setProperty('--mx', `${last.clientX - r.left}px`);
        host.style.setProperty('--my', `${last.clientY - r.top}px`);
      });
    },
    { passive: true },
  );
}

/* -------------------------------------------------------------- 弹层入场等 */

function watchDialogs() {
  const host = $('#dialog-root');
  if (!host) return;
  new MutationObserver((records) => {
    for (const rec of records) {
      rec.addedNodes.forEach((n) => {
        if (n instanceof HTMLElement && n.classList.contains('backdrop')) prepareDialog(n);
      });
    }
  }).observe(host, { childList: true });
}

/** 这些容器本身不做动画，改为让它们的子项错落入场 */
const CONTAINER_SEL = '.form, .items, .packs, .perks, .terrains';

function prepareDialog(backdrop: HTMLElement) {
  const dialog = $('.dialog', backdrop);
  if (!dialog) return;
  if (!reduceMotion()) {
    let i = 0;
    const seen = new Set<Element>();
    const collect = (el: Element) => {
      if (seen.has(el) || !(el instanceof HTMLElement)) return;
      seen.add(el);
      if (el.matches(CONTAINER_SEL)) {
        Array.from(el.children).forEach(collect);
        return;
      }
      el.dataset.stg = '';
      el.style.setProperty('--i', String(Math.min(i++, 14)));
    };
    $('.dialog-body', dialog)?.childNodes.forEach((n) => n instanceof Element && collect(n));
    dialog.classList.add('enter');
    setTimeout(() => dialog.classList.remove('enter'), 1500);
  }
  requestAnimationFrame(() => {
    dialog.querySelectorAll<HTMLElement>('.tabs').forEach((t) => placeTabInk(t, true));
    dialog.querySelectorAll<HTMLElement>('.items').forEach((g) => placeSelInk(g, true));
  });
}

/* ----------------------------------------------------------- 滑动指示器 */

function placeTabInk(tabs: HTMLElement, instant = false) {
  const active = $('.tab.active', tabs);
  if (!active) return;
  let ink = $('.tab-ink', tabs);
  if (!ink) {
    ink = document.createElement('i');
    ink.className = 'tab-ink no-anim';
    tabs.prepend(ink);
    tabs.classList.add('has-ink');
  }
  ink.style.setProperty('--x', `${active.offsetLeft}px`);
  ink.style.setProperty('--w', `${active.offsetWidth}px`);
  if (instant) requestAnimationFrame(() => ink!.classList.remove('no-anim'));
}

function placeSelInk(grid: HTMLElement, instant = false) {
  const sel = $('.item.selected', grid);
  let ink = $('.sel-ink', grid);
  if (!sel) {
    ink?.classList.remove('on');
    return;
  }
  if (!ink) {
    ink = document.createElement('i');
    ink.className = 'sel-ink no-anim';
    grid.prepend(ink);
    instant = true;
  }
  ink.style.setProperty('--x', `${sel.offsetLeft}px`);
  ink.style.setProperty('--y', `${sel.offsetTop}px`);
  ink.style.setProperty('--w', `${sel.offsetWidth}px`);
  ink.style.setProperty('--h', `${sel.offsetHeight}px`);
  const wasOn = ink.classList.contains('on');
  if (!wasOn) ink.classList.add('no-anim');
  ink.classList.add('on');
  if (instant || !wasOn) requestAnimationFrame(() => requestAnimationFrame(() => ink!.classList.remove('no-anim')));
}

function installIndicators() {
  document.addEventListener('click', (e) => {
    const el = e.target as Element | null;
    const tab = el?.closest<HTMLElement>('.tab');
    if (tab) {
      const tabs = tab.closest<HTMLElement>('.tabs');
      if (tabs) requestAnimationFrame(() => placeTabInk(tabs));
      const form = tabs?.nextElementSibling;
      if (form instanceof HTMLElement && !reduceMotion()) {
        form.classList.remove('swap');
        void form.offsetWidth;
        form.classList.add('swap');
        setTimeout(() => form.classList.remove('swap'), 500);
      }
    }
    const item = el?.closest<HTMLElement>('.item');
    const grid = item?.parentElement;
    if (item && grid?.classList.contains('items')) requestAnimationFrame(() => placeSelInk(grid));
  });
  addEventListener('resize', () => {
    document.querySelectorAll<HTMLElement>('.tabs').forEach((t) => placeTabInk(t, true));
    document.querySelectorAll<HTMLElement>('.items').forEach((g) => placeSelInk(g, true));
  });
}

/* --------------------------------------------------------- 加载态按钮 */

function watchBusyButtons() {
  const host = $('#dialog-root');
  if (!host) return;
  const since = new WeakMap<Element, number>();
  new MutationObserver((records) => {
    for (const rec of records) {
      const btn = rec.target as HTMLButtonElement;
      if (!(btn instanceof HTMLButtonElement)) continue;
      if (btn.disabled && rec.oldValue === null) {
        since.set(btn, performance.now());
        btn.classList.add('is-loading');
        btn.setAttribute('aria-busy', 'true');
      } else if (!btn.disabled) {
        const wait = Math.max(0, 380 - (performance.now() - (since.get(btn) ?? 0)));
        setTimeout(() => {
          if (btn.disabled) return;
          btn.classList.remove('is-loading');
          btn.removeAttribute('aria-busy');
        }, wait);
      }
    }
  }).observe(host, { attributes: true, attributeFilter: ['disabled'], attributeOldValue: true, subtree: true });
}

/* ------------------------------------------- 手机：下滑 / 右滑关闭弹层 */

function installSheetSwipe() {
  const landscape = () => matchMedia('(orientation: landscape) and (max-height: 520px)').matches;
  const sheet = () => matchMedia('(max-width: 720px)').matches || landscape();
  document.addEventListener(
    'pointerdown',
    (e) => {
      const head = (e.target as Element | null)?.closest<HTMLElement>('.dialog-head');
      if (!head || !sheet() || (e.target as Element).closest('button') || e.pointerType === 'mouse') return;
      const dialog = head.closest<HTMLElement>('.dialog');
      const backdrop = head.closest<HTMLElement>('.backdrop');
      if (!dialog || !backdrop) return;
      const horizontal = landscape();
      const start = horizontal ? e.clientX : e.clientY;
      const size = horizontal ? dialog.offsetWidth : dialog.offsetHeight;
      const t0 = performance.now();
      let d = 0;
      dialog.classList.add('dragging');
      const move = (m: PointerEvent) => {
        d = Math.max(0, (horizontal ? m.clientX : m.clientY) - start);
        dialog.style.transform = horizontal ? `translateX(${d}px)` : `translateY(${d}px)`;
        backdrop.style.opacity = String(1 - Math.min(1, d / size) * 0.85);
      };
      const end = () => {
        removeEventListener('pointermove', move);
        removeEventListener('pointerup', end);
        removeEventListener('pointercancel', end);
        dialog.classList.remove('dragging');
        const velocity = d / Math.max(1, performance.now() - t0);
        if (d > size * 0.28 || (d > 24 && velocity > 0.6)) {
          dialog.style.transform = horizontal ? 'translateX(100%)' : 'translateY(100%)';
          backdrop.style.opacity = '0';
          $<HTMLButtonElement>('[data-close]', dialog)?.click();
        } else {
          dialog.style.transform = '';
          backdrop.style.opacity = '';
        }
      };
      addEventListener('pointermove', move);
      addEventListener('pointerup', end);
      addEventListener('pointercancel', end);
    },
    { passive: true },
  );
}

/* ----------------------------------------- 奖励飞入 + qifu:fx 的 UI 联动 */

const FLY_ICON = {
  coin: '<svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="26" fill="#f2c14e" stroke="#fff3c4" stroke-width="4"/><rect x="25" y="25" width="14" height="14" rx="2.5" fill="none" stroke="#b9852a" stroke-width="4"/></svg>',
  energy: '<svg viewBox="0 0 64 64"><path d="M36 4 12 36h14l-4 24 28-34H36z" fill="#ffd76a" stroke="#fff3c4" stroke-width="4" stroke-linejoin="round"/></svg>',
  spark: '<svg viewBox="0 0 64 64"><path d="M32 4l7 21 21 7-21 7-7 21-7-21-21-7 21-7z" fill="#fff3c4" stroke="#f2c14e" stroke-width="3" stroke-linejoin="round"/></svg>',
} as const;

function flyLayer() {
  let el = $('#fly-layer');
  if (!el) {
    el = document.createElement('div');
    el.id = 'fly-layer';
    el.setAttribute('aria-hidden', 'true');
    $('#app')!.appendChild(el);
  }
  return el;
}

function center(el: Element) {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

function cardOrigin() {
  const landscape = matchMedia('(orientation: landscape) and (max-height: 520px)').matches;
  const narrow = matchMedia('(max-width: 720px)').matches;
  return { x: innerWidth / 2, y: innerHeight * (landscape ? 0.45 : narrow ? 0.38 : 0.34) };
}

const lastLand = new WeakMap<Element, number>();
function land(target: Element, cls = 'land') {
  const now = performance.now();
  if (now - (lastLand.get(target) ?? 0) < 140) return;
  lastLand.set(target, now);
  target.classList.remove(cls);
  void (target as HTMLElement).offsetWidth;
  target.classList.add(cls);
  setTimeout(() => target.classList.remove(cls), 800);
}

/** 从 from 飞向 target 元素的若干粒子，落点触发 land */
function flyTo(kind: keyof typeof FLY_ICON, from: { x: number; y: number }, target: Element | null, n: number, delay = 420) {
  if (!target || reduceMotion() || target.getBoundingClientRect().width === 0) return;
  const count = tier() === 'low' ? Math.ceil(n / 2) : n;
  const to = center(target);
  const layer = flyLayer();
  const host = target.closest('.stat') ?? target;
  for (let i = 0; i < count; i++) {
    const el = document.createElement('i');
    el.className = 'fly';
    el.innerHTML = FLY_ICON[kind];
    layer.appendChild(el);
    const burst = 50 + Math.random() * 70;
    const ang = Math.random() * Math.PI * 2;
    const mx = from.x + Math.cos(ang) * burst;
    const my = from.y + Math.sin(ang) * burst - 30;
    const pos = (x: number, y: number, s: number) => `translate(${x}px, ${y}px) scale(${s})`;
    const anim = el.animate(
      [
        { transform: pos(from.x, from.y, 0.3), opacity: 0 },
        { transform: pos(mx, my, 1.15), opacity: 1, offset: 0.32, easing: 'cubic-bezier(0.5, 0, 0.75, 0.2)' },
        { transform: pos(to.x, to.y, 0.55), opacity: 0.95 },
      ],
      { duration: 780 + Math.random() * 260, delay: delay + i * 55, easing: 'cubic-bezier(0.22, 0.7, 0.3, 1)', fill: 'both' },
    );
    anim.onfinish = () => {
      el.remove();
      land(host);
    };
    anim.oncancel = () => el.remove();
  }
}

function installFxLinks() {
  window.addEventListener('qifu:fx', (ev) => {
    const d = (ev as CustomEvent<QifuFxEvent>).detail;
    const origin = cardOrigin();
    switch (d.type) {
      case 'payment':
        flyTo('coin', origin, $('.stat.coin svg'), Math.min(14, 5 + Math.round(d.added / 80)));
        break;
      case 'pray':
        if (d.reward > 0) flyTo('energy', origin, $('.stat:not(.coin):not(.flame) svg'), Math.min(10, 3 + Math.round(d.reward / 30)));
        flyTo('spark', origin, $('#growth'), 4, 560);
        setTimeout(() => {
          const g = $('#growth');
          if (g && !reduceMotion()) land(g, 'glow');
          const c = $('#tag-count');
          if (c && !reduceMotion()) land(c, 'bump');
        }, 1100);
        break;
      case 'checkin': {
        const btn = $('#btn-checkin');
        flyTo('energy', btn ? center(btn) : origin, $('.stat:not(.coin):not(.flame) svg'), Math.min(8, 3 + Math.round(d.gained / 10)), 200);
        setTimeout(() => {
          const flame = $('.stat.flame');
          if (flame && !reduceMotion()) land(flame, 'flare');
        }, 900);
        break;
      }
      default:
        break;
    }
  });
}
