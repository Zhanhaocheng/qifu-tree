import qrcode from 'qrcode-generator';
import {
  AGE_MAX,
  AGE_MIN,
  AVATAR_MAX_BYTES,
  AVATAR_PRESETS,
  AVATAR_SIZE,
  ITEMS,
  NICKNAME_MAX,
  STAGES,
  validateProfile,
  type AvatarPresetId,
  type ItemDef,
  type ItemId,
  type PrayerTag,
  type ProfileUpdate,
  type PublicUser,
  type TerrainDef,
  type TerrainId,
  type TopupPack,
} from '../shared/game';
import type { StorageMode } from './api';
import { avatarEl, avatarInner, clampCrop, displayName, drawCrop, encodeAvatar, loadImage, presetSvg, type CropState } from './avatar';
import type { AudioState } from './audio';
import { markReady } from './motion';

const $ = <T extends HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;

const ICONS = {
  energy: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M13 2 4.5 13.5H11L10 22l8.5-11.5H12z"/></svg>',
  coin: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><rect x="9" y="9" width="6" height="6" rx="1" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
  flame: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2c1 4-3 5.5-3 9.5a3 3 0 0 0 6 0c0-1-.4-1.8-1-2.6 3 1 5 3.6 5 6.6a7 7 0 0 1-14 0C5 9 10 7 12 2z"/></svg>',
  soundOn: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 9v6h4l5 4V5L8 9z"/><path class="sw1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M16 9a4 4 0 0 1 0 6"/><path class="sw2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M18.5 6.5a8 8 0 0 1 0 11"/></svg>',
  soundOff: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 9v6h4l5 4V5L8 9z"/><path class="sx" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="m16 9 5 6m0-6-5 6"/></svg>',
  eye: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
  eyeOff: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM4 4l16 16"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
  ok: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
  warn: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" d="M12 6v7.5"/><circle cx="12" cy="18" r="1.8" fill="currentColor"/></svg>',
  info: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="6.5" r="1.8" fill="currentColor"/><path fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" d="M12 11v7"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M8 3v4m8-4v4M8 13l3 3 5-5"/></svg>',
  pray: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" d="M7 3h10l-1 5 3 3v10H5V11l3-3z"/><circle cx="12" cy="14" r="2" fill="currentColor"/></svg>',
  shop: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" d="M4 8h16l-1.2 11.2a1 1 0 0 1-1 .8H6.2a1 1 0 0 1-1-.8zM8 8a4 4 0 0 1 8 0"/></svg>',
  land: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" d="M2 19 9 7l4 6 3-4 6 10zM16 5.5a1.5 1.5 0 1 0 .01 0"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="m6 6 12 12M18 6 6 18"/></svg>',
  gear: '<svg class="gear" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round" d="M10.4 3h3.2l.5 2.4 1.7.7 2.1-1.3 2.3 2.3-1.3 2.1.7 1.7 2.4.5v3.2l-2.4.5-.7 1.7 1.3 2.1-2.3 2.3-2.1-1.3-1.7.7-.5 2.4h-3.2l-.5-2.4-1.7-.7-2.1 1.3-2.3-2.3 1.3-2.1-.7-1.7L3 13.6v-3.2l2.4-.5.7-1.7-1.3-2.1 2.3-2.3 2.1 1.3 1.7-.7z"/><circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="1.9"/></svg>',
  edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16zM13.5 6.5l4 4"/></svg>',
  logout: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4M15 8l4 4-4 4M19 12H9"/></svg>',
  upload: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" d="M12 16V5m0 0-4 4m4-4 4 4M5 19h14"/></svg>',
};

const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const tweens = new WeakMap<HTMLElement, number>();
const bumpTimers = new WeakMap<HTMLElement, number>();

/**
 * 数字滚动到新值（easeOutQuart）；delta 提示（+8 / -10）只在 floatDelta 为 true 时浮出。
 * quiet 用于首次显示：只做 0 → 当前值的滚动，不触发 bump/delta。
 */
export function tweenNumber(el: HTMLElement, to: number, floatDelta = false, quiet = false) {
  const from = el.dataset.v === undefined ? to : Number(el.dataset.v);
  el.dataset.v = String(to);
  const running = tweens.get(el);
  if (running) cancelAnimationFrame(running);
  if (from === to || reduceMotion()) {
    el.textContent = String(to);
    return;
  }
  if (!quiet) {
    const host = el.closest<HTMLElement>('.stat, .balance') ?? el.parentElement!;
    host.classList.remove('bump-up', 'bump-down');
    void host.offsetWidth;
    host.classList.add(to > from ? 'bump-up' : 'bump-down');
    clearTimeout(bumpTimers.get(host));
    bumpTimers.set(
      host,
      window.setTimeout(() => host.classList.remove('bump-up', 'bump-down'), 1100),
    );
    if (floatDelta) {
      const tag = document.createElement('i');
      tag.className = `delta ${to > from ? 'up' : 'down'}`;
      tag.textContent = `${to > from ? '+' : '-'}${Math.abs(to - from)}`;
      host.appendChild(tag);
      setTimeout(() => tag.remove(), 1500);
    }
  }
  const dur = Math.min(1400, 520 + Math.abs(to - from) * 4);
  const t0 = performance.now();
  const step = (now: number) => {
    const k = Math.min(1, (now - t0) / dur);
    const e = 1 - Math.pow(1 - k, 4);
    el.textContent = String(Math.round(from + (to - from) * e));
    if (k < 1) tweens.set(el, requestAnimationFrame(step));
    else tweens.delete(el);
  };
  tweens.set(el, requestAnimationFrame(step));
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export interface HudHandlers {
  onSound: () => void;
  onLogin: () => void;
  onLogout: () => void;
  onProfile: () => void;
  onCheckin: () => void;
  onPray: () => void;
  onShop: () => void;
  onTerrain: () => void;
}

export function mountHud(h: HudHandlers) {
  const hud = $('#hud');
  hud.innerHTML = `
    <header class="top">
      <div class="brand">
        <h1><i class="seal" aria-hidden="true">福</i><span class="title-text">祈福树</span></h1>
        <span class="chip" id="stage-chip"></span>
      </div>
      <div class="top-right">
        <div class="sound-wrap"><button class="icon-btn" id="btn-sound" data-sound-toggle aria-label="声音开关" title="声音开关"></button><span class="sound-tip" id="sound-tip" hidden>轻点开启声音</span></div>
        <div class="menu-wrap" id="settings-wrap" hidden>
          <button class="icon-btn" id="btn-settings" aria-label="设置" title="设置" aria-haspopup="menu" aria-expanded="false" aria-controls="settings-menu">${ICONS.gear}</button>
          <div class="menu" id="settings-menu" role="menu" aria-label="设置" hidden>
            <button class="menu-item" role="menuitem" tabindex="-1" data-act="profile">${ICONS.edit}<span>编辑个人信息</span></button>
            <button class="menu-item danger" role="menuitem" tabindex="-1" data-act="logout">${ICONS.logout}<span>退出登录</span></button>
          </div>
        </div>
        <div id="user-area"><i class="skeleton skeleton-pill" aria-hidden="true"></i></div>
      </div>
    </header>
    <div class="stats" id="stats" hidden>
      <div class="stat" title="能量：签到获得，用于基础祈福">${ICONS.energy}<b class="num" id="st-energy">0</b><span>能量</span></div>
      <div class="stat coin" title="福币：充值获得，用于高级道具">${ICONS.coin}<b class="num" id="st-coins">0</b><span>福币</span></div>
      <div class="stat flame" title="连续签到天数">${ICONS.flame}<b class="num" id="st-streak">0</b><span>天连签</span></div>
    </div>
    <div class="growth" id="growth" hidden><div class="growth-bar"><i id="growth-fill" style="transform:scaleX(0.04)"></i></div><span id="growth-text"></span></div>
    <div class="demo-banner" id="demo-banner" hidden></div>
    <div class="hint" id="hint">拖动旋转 · 滚轮或双指缩放 · 点击祈福牌查看心愿</div>
    <nav class="actions">
      <button class="act" id="btn-checkin">${ICONS.check}<span id="checkin-label">每日签到</span><i class="stamp" aria-hidden="true">签</i></button>
      <button class="act primary" id="btn-pray">${ICONS.pray}<span>祈福</span></button>
      <button class="act" id="btn-terrain">${ICONS.land}<span>地形</span></button>
      <button class="act" id="btn-shop">${ICONS.shop}<span>商店</span></button>
    </nav>
    <div class="tag-count" id="tag-count"><i class="skeleton skeleton-line" aria-hidden="true"></i></div>`;
  $('#btn-sound').addEventListener('click', h.onSound);
  $('#btn-checkin').addEventListener('click', h.onCheckin);
  $('#btn-pray').addEventListener('click', h.onPray);
  $('#btn-shop').addEventListener('click', h.onShop);
  $('#btn-terrain').addEventListener('click', h.onTerrain);

  const menuWrap = $('#settings-wrap');
  const menuBtn = $<HTMLButtonElement>('#btn-settings');
  const menu = $('#settings-menu');
  const items = () => [...menu.querySelectorAll<HTMLButtonElement>('.menu-item')];
  let menuOpen = false;
  let hideTimer = 0;
  const closeMenu = (refocus = false) => {
    if (!menuOpen) return;
    menuOpen = false;
    menu.classList.remove('open');
    menuBtn.setAttribute('aria-expanded', 'false');
    hideTimer = window.setTimeout(() => (menu.hidden = true), 180);
    document.removeEventListener('pointerdown', onOutside, true);
    document.removeEventListener('keydown', onMenuKey, true);
    removeEventListener('resize', onResize);
    if (refocus) menuBtn.focus();
  };
  const onOutside = (e: Event) => {
    if (!menuWrap.contains(e.target as Node)) closeMenu();
  };
  const onResize = () => closeMenu();
  const onMenuKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closeMenu(true);
    } else if (e.key === 'Tab') closeMenu();
    else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
      e.preventDefault();
      const list = items();
      const i = list.indexOf(document.activeElement as HTMLButtonElement);
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? list.length - 1 : (i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length;
      list[next].focus();
    }
  };
  const openMenu = (focusFirst: boolean) => {
    if (menuOpen) return;
    clearTimeout(hideTimer);
    menuOpen = true;
    menu.hidden = false;
    void menu.offsetWidth;
    menu.classList.add('open');
    menuBtn.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('keydown', onMenuKey, true);
    addEventListener('resize', onResize);
    if (focusFirst) items()[0].focus();
  };
  menuBtn.addEventListener('click', (e) => {
    if (menuOpen) closeMenu();
    else openMenu(e.detail === 0);
  });
  menuBtn.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' && !menuOpen) {
      e.preventDefault();
      openMenu(true);
    }
  });
  menu.addEventListener('click', (e) => {
    const item = (e.target as HTMLElement).closest<HTMLElement>('.menu-item');
    if (!item) return;
    closeMenu();
    if (item.dataset.act === 'profile') h.onProfile();
    else h.onLogout();
  });
  setTimeout(() => ($('#hint').style.opacity = '0'), 9000);

  let shownUserId: number | null = null;

  return {
    setAudioState(state: AudioState) {
      const btn = $('#btn-sound');
      btn.innerHTML = state === 'on' ? ICONS.soundOn : ICONS.soundOff;
      btn.setAttribute('aria-pressed', String(state === 'on'));
      btn.setAttribute('aria-label', state === 'on' ? '声音已开启，点击静音' : state === 'muted' ? '声音已关闭，点击开启' : '声音尚未开启，轻点开启');
      btn.classList.toggle('off', state !== 'on');
      btn.classList.toggle('blocked', state === 'blocked');
      $('#sound-tip').hidden = state !== 'blocked';
    },
    setUser(user: PublicUser | null) {
      const area = $('#user-area');
      closeMenu();
      $('#settings-wrap').hidden = !user;
      if (!user) {
        area.innerHTML = '<button class="login-btn" id="btn-login">登录 / 注册</button>';
        $('#btn-login').addEventListener('click', h.onLogin);
        shownUserId = null;
        $('#stats').hidden = true;
        $('#growth').hidden = true;
        $('#checkin-label').textContent = '每日签到';
        $('#btn-checkin').classList.remove('done', 'todo');
        return;
      }
      const name = displayName(user);
      area.innerHTML = `<div class="user-pill" title="${esc(name)}">${avatarEl(user)}<span class="uname">${esc(name)}</span></div>`;
      $('#stats').hidden = false;
      const same = shownUserId === user.id;
      shownUserId = user.id;
      for (const [id, v] of [['#st-energy', user.energy], ['#st-coins', user.coins], ['#st-streak', user.streak]] as const) {
        const el = $(id);
        if (same) tweenNumber(el, v, true);
        else {
          el.dataset.v = '0';
          tweenNumber(el, v, false, true);
        }
      }
      $('#checkin-label').textContent = user.checkedInToday ? '今日已签到' : '每日签到';
      $('#btn-checkin').classList.toggle('done', user.checkedInToday);
      $('#btn-checkin').classList.toggle('todo', !user.checkedInToday);
      const next = STAGES[user.stage + 1];
      $('#growth').hidden = false;
      const cur = STAGES[user.stage];
      if (next) {
        const pct = ((user.prayerCount - cur.min) / (next.min - cur.min)) * 100;
        $('#growth-fill').style.transform = `scaleX(${Math.max(0.04, Math.min(1, pct / 100))})`;
        $('#growth-text').textContent = `${cur.name} · 再祈福 ${next.min - user.prayerCount} 次长成${next.name}`;
      } else {
        $('#growth-fill').style.transform = 'scaleX(1)';
        $('#growth-text').textContent = `${cur.name} · 已祈福 ${user.prayerCount} 次`;
      }
    },
    setStage(stage: number, label: string) {
      $('#stage-chip').textContent = `${STAGES[stage].name}${label ? ' · ' + label : ''}`;
    },
    clearTagCount() {
      $('#tag-count').textContent = '';
    },
    setTagCount(shown: number, total: number) {
      $('#tag-count').textContent = total > 0 ? `树上挂着 ${shown} 块祈福牌${total > shown ? `（共 ${total} 个心愿）` : ''}` : '树上还没有祈福牌，来挂第一块吧';
    },
    setMode(mode: StorageMode) {
      const b = $('#demo-banner');
      b.hidden = mode !== 'demo';
      if (mode === 'demo') b.textContent = '演示模式：未连接数据库，数据会在服务重启后丢失';
    },
  };
}

const TOAST_ICON = { info: ICONS.info, success: ICONS.ok, error: ICONS.warn } as const;
const TOAST_LIFE = 3200;

export function toast(message: string, kind: 'info' | 'error' | 'success' = 'info') {
  const host = $('#toasts');
  while (host.children.length >= 3) host.firstElementChild?.remove();
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  el.style.setProperty('--life', `${TOAST_LIFE}ms`);
  el.innerHTML = `<i class="toast-ico">${TOAST_ICON[kind]}</i><span>${esc(message)}</span><i class="toast-bar"></i>`;
  host.appendChild(el);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('show')));
  const dismiss = () => {
    if (el.classList.contains('leaving')) return;
    el.classList.remove('show');
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 320);
  };
  el.addEventListener('click', dismiss);
  setTimeout(dismiss, TOAST_LIFE);
}

let closeCurrent: (() => void) | null = null;

function openDialog(title: string, content: string, opts: { wide?: boolean } = {}) {
  closeCurrent?.();
  const root = $('#dialog-root');
  const backdrop = document.createElement('div');
  backdrop.className = 'backdrop';
  backdrop.innerHTML = `
    <div class="dialog ${opts.wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="dialog-head"><h2>${esc(title)}</h2><button class="icon-btn small" data-close aria-label="关闭">${ICONS.close}</button></div>
      <div class="dialog-body">${content}</div>
    </div>`;
  root.appendChild(backdrop);
  requestAnimationFrame(() => backdrop.classList.add('show'));
  const close = () => {
    backdrop.classList.remove('show');
    setTimeout(() => backdrop.remove(), 220);
    document.removeEventListener('keydown', onKey);
    if (closeCurrent === close) closeCurrent = null;
  };
  const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
  document.addEventListener('keydown', onKey);
  backdrop.addEventListener('pointerdown', (e) => e.target === backdrop && close());
  backdrop.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
  closeCurrent = close;
  return { el: backdrop, close };
}

export function closeDialog() {
  closeCurrent?.();
}

export function openAuth(onSubmit: (mode: 'login' | 'register', username: string, password: string) => Promise<string | null>) {
  const d = openDialog(
    '登录祈福树',
    `
    <div class="tabs" role="tablist">
      <button class="tab active" data-mode="login" role="tab">登录</button>
      <button class="tab" data-mode="register" role="tab">注册</button>
    </div>
    <form class="form" autocomplete="on">
      <label>用户名<input name="username" autocomplete="username" maxlength="20" required placeholder="2-20 位，可用汉字" /></label>
      <label>密码<span class="field"><input name="password" type="password" autocomplete="current-password" minlength="6" maxlength="72" required placeholder="至少 6 位" /><button type="button" class="eye" aria-label="显示密码" aria-pressed="false">${ICONS.eye}</button></span></label>
      <p class="form-error" role="alert" hidden></p>
      <button class="btn primary block" type="submit">登录</button>
      <p class="fine">新用户注册即送 30 点能量，每天签到还能领取更多。</p>
    </form>`,
  );
  let mode: 'login' | 'register' = 'login';
  const form = $<HTMLFormElement>('form', d.el);
  const submit = $<HTMLButtonElement>('button[type=submit]', d.el);
  const err = $('.form-error', d.el);
  d.el.querySelectorAll<HTMLButtonElement>('.tab').forEach((tab) =>
    tab.addEventListener('click', () => {
      mode = tab.dataset.mode as typeof mode;
      d.el.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
      submit.textContent = mode === 'login' ? '登录' : '注册并进入';
      $<HTMLInputElement>('input[name=password]', d.el).autocomplete = mode === 'login' ? 'current-password' : 'new-password';
      err.hidden = true;
    }),
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = new FormData(form);
    submit.disabled = true;
    submit.textContent = mode === 'login' ? '登录中…' : '注册中…';
    let message: string | null;
    try {
      message = await onSubmit(mode, String(data.get('username')), String(data.get('password')));
    } catch {
      message = '操作失败，请稍后重试';
    } finally {
      submit.disabled = false;
      submit.textContent = mode === 'login' ? '登录' : '注册并进入';
    }
    if (message) {
      err.textContent = message;
      err.hidden = false;
    } else d.close();
  });
  const pwd = $<HTMLInputElement>('input[name=password]', d.el);
  const eye = $<HTMLButtonElement>('.eye', d.el);
  eye.addEventListener('click', () => {
    const show = pwd.type === 'password';
    pwd.type = show ? 'text' : 'password';
    eye.innerHTML = show ? ICONS.eyeOff : ICONS.eye;
    eye.setAttribute('aria-pressed', String(show));
    eye.setAttribute('aria-label', show ? '隐藏密码' : '显示密码');
    pwd.focus();
  });
  setTimeout(() => $<HTMLInputElement>('input[name=username]', d.el).focus(), 60);
}

export function openPray(
  user: PublicUser,
  maxLen: number,
  onSubmit: (item: ItemId, text: string) => Promise<string | null>,
  onSelect: () => void,
) {
  const canAfford = (i: ItemDef) => (i.currency === 'energy' ? user.energy : user.coins) >= i.cost;
  const cards = ITEMS.map(
    (i) => `
    <button type="button" class="item ${canAfford(i) ? '' : 'short'}" data-item="${i.id}" aria-pressed="false">
      <i class="swatch ${i.glow ? 'glow' : ''}" style="--c:${i.color}"></i>
      <b>${i.name}</b>
      <small>${i.desc}</small>
      <span class="price ${i.currency}">${i.cost} ${i.currency === 'energy' ? '能量' : '福币'}</span>
      ${i.reward ? `<em>返还 ${i.reward} 能量</em>` : '<em>&nbsp;</em>'}
    </button>`,
  ).join('');
  const d = openDialog(
    '挂一块祈福牌',
    `<form class="form">
      <div class="items">${cards}</div>
      <label>写下心愿<textarea name="text" rows="3" maxlength="${maxLen}" placeholder="愿家人平安健康，愿所爱之人皆得所愿……" required></textarea></label>
      <div class="counter"><span id="wish-count">0</span>/${maxLen}　心愿会展示给所有来到树下的人</div>
      <p class="form-error" role="alert" hidden></p>
      <button class="btn primary block" type="submit" disabled>请先选择道具</button>
    </form>`,
    { wide: true },
  );
  let selected: ItemDef | null = null;
  const submit = $<HTMLButtonElement>('button[type=submit]', d.el);
  const err = $('.form-error', d.el);
  const text = $<HTMLTextAreaElement>('textarea', d.el);
  d.el.querySelectorAll<HTMLButtonElement>('.item').forEach((btn) =>
    btn.addEventListener('click', () => {
      selected = ITEMS.find((i) => i.id === btn.dataset.item)!;
      d.el.querySelectorAll('.item').forEach((b) => {
        b.classList.toggle('selected', b === btn);
        b.setAttribute('aria-pressed', String(b === btn));
      });
      submit.disabled = false;
      submit.textContent = `挂上${selected.name}`;
      onSelect();
    }),
  );
  const counter = $('.counter', d.el);
  text.addEventListener('input', () => {
    const len = [...text.value].length;
    $('#wish-count', d.el).textContent = String(len);
    counter.classList.toggle('near', len >= maxLen * 0.8 && len < maxLen);
    counter.classList.toggle('full', len >= maxLen);
  });
  $('form', d.el).addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!selected) return;
    const label = submit.textContent;
    submit.disabled = true;
    submit.textContent = '提交中…';
    let message: string | null;
    try {
      message = await onSubmit(selected.id, text.value);
    } catch {
      message = '操作失败，请稍后重试';
    } finally {
      submit.disabled = false;
      submit.textContent = label;
    }
    if (message) {
      err.textContent = message;
      err.hidden = false;
    } else d.close();
  });
  setTimeout(() => $<HTMLButtonElement>('.item', d.el).focus(), 60);
}

export interface ShopPay {
  mode: 'demo' | 'alipay';
  ready: boolean;
  sandbox: boolean;
  testPrices?: boolean;
}

export interface QrPanel {
  text: string;
  amount: string;
  label: string;
  coins: number;
}

function qrSvg(text: string): string {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
}

/**
 * onBuy 返回：null = 成功（播放到账动画）；string = 错误提示；undefined = 已发起支付、等待结果（不播放动画）
 */
export function openShop(
  user: PublicUser,
  packs: TopupPack[],
  pay: ShopPay | null,
  onBuy: (pack: TopupPack) => Promise<string | null | undefined>,
) {
  const real = pay?.mode === 'alipay';
  const notice = !real
    ? '演示支付：点击即到账，不会产生任何真实扣款。'
    : !pay!.ready
      ? '支付暂未开放，请稍后再来。'
      : pay!.sandbox
        ? '支付宝沙箱测试环境：使用沙箱买家账号付款，不会产生真实扣款。'
        : '使用支付宝安全支付，付款成功后福币自动到账。手机会直接拉起支付宝，电脑请扫码。';
  const testNotice = real && pay!.ready && pay!.testPrices ? '<div class="notice">测试价：当前为联调阶段，实付金额仅 ¥0.01 / ¥0.02 / ¥0.03，福币数量不变。</div>' : '';
  const d = openDialog(
    '福币商店',
    `<div class="notice">${notice}</div>${testNotice}
     <p class="balance">当前福币 <b id="shop-coins" data-v="${user.coins}">${user.coins}</b></p>
     <div class="packs">${packs
       .map(
         (p) => `<button class="pack" data-pack="${p.id}">
           <span class="pack-name">${p.label}</span>
           <b>${p.coins}<small> 福币</small></b>
           <span class="pack-price">¥${p.price}${real ? '' : '（演示）'}</span>
         </button>`,
       )
       .join('')}</div>
     <div class="pay-qr" hidden>
       <p class="pay-qr-title">请使用支付宝扫码支付 <b class="pay-qr-amount"></b></p>
       <div class="pay-qr-code" aria-label="支付宝付款二维码"></div>
       <p class="pay-qr-hint">打开手机支付宝 → 扫一扫。支付完成后本页面会自动更新。</p>
       <p class="pay-qr-status" role="status" aria-live="polite"></p>
       <div class="pay-qr-actions">
         <button type="button" class="btn" data-pay-cancel>返回</button>
         <button type="button" class="btn primary" data-pay-check>我已支付，刷新</button>
       </div>
     </div>
     <h3 class="shop-perks-title">福币可以换什么</h3>
     <ul class="perks">${ITEMS.filter((i) => i.currency === 'coins')
       .map((i) => `<li><i class="swatch ${i.glow ? 'glow' : ''}" style="--c:${i.color}"></i><b>${i.name}</b><span>${i.cost} 福币${i.reward ? ` · 返还 ${i.reward} 能量` : ''}${i.glow ? ' · 夜间发光' : ''}</span></li>`)
       .join('')}</ul>
     <p class="error-line form-error" role="alert" hidden></p>`,
  );
  const err = $('.form-error', d.el);
  const packsEl = $('.packs', d.el);
  const qrEl = $('.pay-qr', d.el);
  const perks = [$('.shop-perks-title', d.el), $('.perks', d.el)];
  let qrHandlers: { onCancel: () => void; onCheck: () => void } | null = null;

  const setHidden = (el: HTMLElement, hidden: boolean) => {
    el.hidden = hidden;
  };

  d.el.querySelectorAll<HTMLButtonElement>('.pack').forEach((btn) =>
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      const pack = packs.find((p) => p.id === btn.dataset.pack)!;
      let message: string | null | undefined;
      try {
        message = await onBuy(pack);
      } catch {
        message = '充值失败，请稍后重试';
      } finally {
        btn.disabled = false;
      }
      if (message === undefined) return;
      if (message) {
        err.textContent = message;
        err.hidden = false;
      } else {
        err.hidden = true;
        btn.classList.remove('paid');
        void btn.offsetWidth;
        btn.classList.add('paid');
        setTimeout(() => btn.classList.remove('paid'), 1200);
      }
    }),
  );
  $('[data-pay-cancel]', d.el).addEventListener('click', () => qrHandlers?.onCancel());
  $('[data-pay-check]', d.el).addEventListener('click', () => qrHandlers?.onCheck());

  const hideQr = () => {
    qrHandlers = null;
    setHidden(qrEl, true);
    setHidden(packsEl, false);
    perks.forEach((el) => setHidden(el, false));
  };

  return {
    setCoins: (n: number) => tweenNumber($('#shop-coins', d.el), n),
    /** 弹窗是否仍然打开（用于停止轮询） */
    isOpen: () => d.el.isConnected,
    showQr(panel: QrPanel, handlers: { onCancel: () => void; onCheck: () => void }) {
      qrHandlers = {
        onCancel: () => {
          handlers.onCancel();
          hideQr();
        },
        onCheck: handlers.onCheck,
      };
      err.hidden = true;
      $('.pay-qr-code', d.el).innerHTML = qrSvg(panel.text);
      $('.pay-qr-amount', d.el).textContent = `¥${panel.amount}（${panel.label}，${panel.coins} 福币）`;
      $('.pay-qr-status', d.el).textContent = '等待付款…';
      setHidden(packsEl, true);
      perks.forEach((el) => setHidden(el, true));
      setHidden(qrEl, false);
    },
    setPayStatus: (text: string) => {
      $('.pay-qr-status', d.el).textContent = text;
    },
    hideQr,
  };
}

export function openTerrain(
  user: PublicUser,
  terrains: TerrainDef[],
  onPick: (t: TerrainDef) => Promise<string | null>,
) {
  const cards = (u: PublicUser) =>
    terrains
      .map((t) => {
        const owned = u.ownedTerrains.includes(t.id);
        const current = u.terrain === t.id;
        const status = current ? '<span class="tstate now">当前使用</span>' : owned ? '<span class="tstate own">已拥有</span>' : `<span class="tstate buy">${t.price} 福币解锁</span>`;
        return `<button type="button" class="terrain ${current ? 'current' : ''}" data-terrain="${t.id}">
          <i class="tswatch" style="--a:${t.swatch[0]};--b:${t.swatch[1]}"></i>
          <span class="tinfo"><b>${t.name}<small>${t.subtitle}</small></b><em>${t.desc}</em></span>
          ${status}
        </button>`;
      })
      .join('');
  const d = openDialog(
    '选择地形',
    `<p class="balance">首次进入时会按你的编号生成专属地形。解锁后永久拥有。当前福币 <b id="terrain-coins">${user.coins}</b></p>
     <div class="terrains" id="terrain-list">${cards(user)}</div>
     <p class="error-line form-error" role="alert" hidden></p>`,
    { wide: true },
  );
  const err = $('.form-error', d.el);
  const list = $('#terrain-list', d.el);
  list.addEventListener('click', async (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.terrain');
    if (!btn) return;
    const t = terrains.find((x) => x.id === btn.dataset.terrain)!;
    btn.disabled = true;
    let message: string | null;
    try {
      message = await onPick(t);
    } catch {
      message = '切换失败，请稍后重试';
    } finally {
      btn.disabled = false;
    }
    if (message) {
      err.textContent = message;
      err.hidden = false;
    } else d.close();
  });
  return {
    refresh(u: PublicUser) {
      list.innerHTML = cards(u);
      $('#terrain-coins', d.el).textContent = String(u.coins);
    },
  };
}

export type { TerrainId };

const timeFmt = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export function showPopup(tag: PrayerTag | null, x: number, y: number) {
  const el = $('#popup');
  if (!tag) {
    el.hidden = true;
    return;
  }
  const item = ITEMS.find((i) => i.id === tag.itemType)!;
  el.innerHTML = `<div class="popup-head"><i class="swatch ${item.glow ? 'glow' : ''}" style="--c:${item.color}"></i><b>${esc(tag.nickname || tag.username)}${tag.mine ? '（我）' : ''}</b><small>${item.name} · ${timeFmt.format(tag.createdAt)}</small></div><p>${esc(tag.text)}</p>`;
  el.hidden = false;
  el.style.animation = 'none';
  void el.offsetWidth;
  el.style.animation = '';
  const w = Math.min(300, innerWidth - 24);
  el.style.width = `${w}px`;
  const left = Math.max(12, Math.min(innerWidth - w - 12, x - w / 2));
  const top = Math.max(70, Math.min(innerHeight - 180, y + 18));
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}

export async function hideLoading() {
  const l = $('#loading');
  await Promise.race([document.fonts?.ready, new Promise((r) => setTimeout(r, 1500))]).catch(() => undefined);
  l.classList.add('hide');
  markReady();
  setTimeout(() => l.remove(), 800);
}

/* ------------------------------------------------------------------ 个人资料 */

const CROP_BOX = 224;
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

export function openProfile(user: PublicUser, onSubmit: (update: Required<ProfileUpdate>) => Promise<string | null>) {
  let avatar: string | null = user.avatar;
  let custom: string | null = user.avatar && !user.avatar.startsWith('preset:') ? user.avatar : null;
  const d = openDialog(
    '个人资料',
    `<form class="form profile-form" autocomplete="off" novalidate>
      <div class="profile-head">
        <span class="avatar xl" id="pf-preview" aria-hidden="true"></span>
        <div class="profile-id"><b id="pf-name"></b><small>登录名 <em>${esc(user.username)}</em>，用于登录，不可修改</small></div>
      </div>
      <label>昵称<input name="nickname" maxlength="${NICKNAME_MAX}" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="1-${NICKNAME_MAX} 位，留空则使用登录名" value="${esc(user.nickname === user.username ? '' : user.nickname)}" /></label>
      <label>年龄<span class="opt">（选填）</span><input name="age" type="number" inputmode="numeric" min="${AGE_MIN}" max="${AGE_MAX}" step="1" placeholder="${AGE_MIN}-${AGE_MAX}，可留空" value="${user.age ?? ''}" /></label>
      <div class="avatar-pick">
        <span class="pick-title">头像</span>
        <div class="avatar-grid" role="group" aria-label="选择头像"></div>
        <input type="file" name="file" accept="image/*" hidden />
        <p class="fine">上传的图片会先裁成 ${AVATAR_SIZE}×${AVATAR_SIZE} 并压缩（不超过 ${AVATAR_MAX_BYTES / 1024} KB）。</p>
      </div>
      <p class="form-error" role="alert" hidden></p>
      <button class="btn primary block" type="submit">保存</button>
    </form>
    <div class="crop" hidden>
      <p class="crop-tip">拖动图片调整位置，滑块或滚轮缩放</p>
      <div class="crop-stage"><canvas class="crop-canvas" width="${CROP_BOX}" height="${CROP_BOX}" aria-label="头像裁剪区域"></canvas><i class="crop-ring" aria-hidden="true"></i></div>
      <label class="crop-zoom">缩放<input type="range" min="1" max="4" step="0.01" value="1" aria-label="缩放" /></label>
      <div class="crop-actions"><button type="button" class="btn" data-crop-cancel>取消</button><button type="button" class="btn primary" data-crop-ok>使用这张</button></div>
    </div>`,
  );
  const form = $<HTMLFormElement>('.profile-form', d.el);
  const nick = $<HTMLInputElement>('input[name=nickname]', d.el);
  const age = $<HTMLInputElement>('input[name=age]', d.el);
  const fileInput = $<HTMLInputElement>('input[name=file]', d.el);
  const grid = $('.avatar-grid', d.el);
  const err = $('.form-error', d.el);
  const submit = $<HTMLButtonElement>('button[type=submit]', d.el);
  const cropEl = $('.crop', d.el);
  const showErr = (m: string | null) => {
    err.textContent = m ?? '';
    err.hidden = !m;
  };

  const effectiveName = () => nick.value.trim().replace(/ {2,}/g, ' ') || user.username;
  const paintPreview = () => {
    $('#pf-preview', d.el).innerHTML = avatarInner(avatar, effectiveName());
    $('#pf-name', d.el).textContent = effectiveName();
  };
  const paintGrid = () => {
    const opt = (key: string, inner: string, label: string, selected: boolean) =>
      `<button type="button" class="av-opt${selected ? ' selected' : ''}" data-av="${key}" aria-pressed="${selected}" aria-label="${esc(label)}" title="${esc(label)}"><span class="avatar">${inner}</span></button>`;
    grid.innerHTML =
      opt('', `<b class="initial">${esc([...effectiveName()][0]?.toUpperCase() ?? '?')}</b>`, '默认（首字母）', avatar === null) +
      AVATAR_PRESETS.map((p) => opt(`preset:${p.id}`, presetSvg(p.id as AvatarPresetId), p.name, avatar === `preset:${p.id}`)).join('') +
      (custom ? opt('custom', avatarInner(custom, ''), '我上传的头像', avatar === custom) : '') +
      `<button type="button" class="av-opt upload" data-upload aria-label="${custom ? '重新上传图片' : '上传图片'}" title="${custom ? '重新上传图片' : '上传图片'}"><span class="avatar">${ICONS.upload}</span><small>上传</small></button>`;
  };
  const paint = () => {
    paintGrid();
    paintPreview();
  };
  paint();
  nick.addEventListener('input', () => {
    paintPreview();
    if (avatar === null) grid.querySelector('.initial')!.textContent = [...effectiveName()][0]?.toUpperCase() ?? '?';
  });
  grid.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.av-opt');
    if (!btn) return;
    if (btn.hasAttribute('data-upload')) {
      fileInput.value = '';
      fileInput.click();
      return;
    }
    const key = btn.dataset.av!;
    avatar = key === '' ? null : key === 'custom' ? custom : key;
    showErr(null);
    paint();
  });

  /* 裁剪 */
  const canvas = $<HTMLCanvasElement>('.crop-canvas', d.el);
  const zoomInput = $<HTMLInputElement>('.crop-zoom input', d.el);
  const ctx = canvas.getContext('2d')!;
  let img: HTMLImageElement | null = null;
  let view = { w: 1, h: 1 };
  let crop: CropState = { zoom: 1, x: 0, y: 0 };
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = canvas.height = Math.round(CROP_BOX * dpr);
  const redraw = () => {
    if (!img) return;
    crop = clampCrop(view, CROP_BOX, crop);
    drawCrop(ctx, img, view, CROP_BOX, crop, canvas.width);
  };
  const setZoom = (z: number) => {
    // 以视窗中心为锚点缩放：偏移按比例缩放
    const nz = Math.min(4, Math.max(1, z));
    const r = nz / crop.zoom;
    crop = clampCrop(view, CROP_BOX, { zoom: nz, x: crop.x * r, y: crop.y * r });
    zoomInput.value = String(nz);
    redraw();
  };
  const leaveCrop = () => {
    img = null;
    cropEl.hidden = true;
    form.hidden = false;
  };
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    if (!f.type.startsWith('image/')) return showErr('请选择图片文件');
    if (f.size > MAX_UPLOAD_BYTES) return showErr('图片太大了，请选择 12 MB 以内的图片');
    try {
      img = await loadImage(f);
    } catch {
      img = null;
      return showErr('这张图片无法读取，请换一张（支持 JPG、PNG、WebP 等常见格式）');
    }
    showErr(null);
    view = { w: img.naturalWidth, h: img.naturalHeight };
    crop = { zoom: 1, x: 0, y: 0 };
    zoomInput.value = '1';
    form.hidden = true;
    cropEl.hidden = false;
    redraw();
    $<HTMLButtonElement>('[data-crop-ok]', d.el).focus();
  });
  zoomInput.addEventListener('input', () => setZoom(Number(zoomInput.value)));
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    setZoom(crop.zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08));
  }, { passive: false });
  let drag: { id: number; x: number; y: number } | null = null;
  const scale = () => CROP_BOX / canvas.getBoundingClientRect().width;
  canvas.addEventListener('pointerdown', (e) => {
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    const k = scale();
    crop = { ...crop, x: crop.x + (e.clientX - drag.x) * k, y: crop.y + (e.clientY - drag.y) * k };
    drag.x = e.clientX;
    drag.y = e.clientY;
    redraw();
  });
  const endDrag = () => (drag = null);
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  $('[data-crop-cancel]', d.el).addEventListener('click', leaveCrop);
  $('[data-crop-ok]', d.el).addEventListener('click', () => {
    if (!img) return;
    const out = document.createElement('canvas');
    out.width = out.height = AVATAR_SIZE;
    drawCrop(out.getContext('2d')!, img, view, CROP_BOX, crop, AVATAR_SIZE);
    const url = encodeAvatar(out);
    leaveCrop();
    if (!url) return showErr('图片压缩后仍然太大，请换一张更简单的图片');
    custom = url;
    avatar = url;
    showErr(null);
    paint();
  });
  // 裁剪过程中按 Esc 先退出裁剪，而不是直接关掉整个弹窗
  d.el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !cropEl.hidden) {
      e.stopPropagation();
      leaveCrop();
    }
  }, true);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const patch = { nickname: nick.value, avatar, age: age.value.trim() === '' ? null : Number(age.value) };
    const check = validateProfile(patch);
    if (!check.ok) return showErr(check.error);
    showErr(null);
    submit.disabled = true;
    submit.textContent = '保存中…';
    let message: string | null;
    try {
      message = await onSubmit({ nickname: patch.nickname, avatar, age: patch.age });
    } catch {
      message = '保存失败，请稍后重试';
    } finally {
      submit.disabled = false;
      submit.textContent = '保存';
    }
    if (message) showErr(message);
    else d.close();
  });
  setTimeout(() => nick.focus({ preventScroll: true }), 60);
}
