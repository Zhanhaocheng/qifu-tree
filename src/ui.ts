import { ITEMS, STAGES, type ItemDef, type ItemId, type PrayerTag, type PublicUser, type TerrainDef, type TerrainId, type TopupPack } from '../shared/game';
import type { StorageMode } from './api';
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
};

const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const tweens = new WeakMap<HTMLElement, number>();

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
        <div id="user-area"><i class="skeleton skeleton-pill" aria-hidden="true"></i></div>
      </div>
    </header>
    <div class="stats" id="stats" hidden>
      <div class="stat" title="能量：签到获得，用于基础祈福">${ICONS.energy}<b class="num" id="st-energy">0</b><span>能量</span></div>
      <div class="stat coin" title="福币：充值获得，用于高级道具">${ICONS.coin}<b class="num" id="st-coins">0</b><span>福币</span><button class="mini" id="btn-add-coin" aria-label="充值福币">+</button></div>
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
  $('#btn-add-coin').addEventListener('click', h.onShop);
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
      area.innerHTML = `<div class="user-pill"><span class="avatar">${esc(user.username.slice(0, 1).toUpperCase())}</span><span class="uname">${esc(user.username)}</span><button class="linkish" id="btn-logout">退出</button></div>`;
      $('#btn-logout').addEventListener('click', h.onLogout);
      $('#stats').hidden = false;
      const same = shownUserId === user.id;
      shownUserId = user.id;
      for (const [id, v] of [['#st-energy', user.energy], ['#st-coins', user.coins], ['#st-streak', user.streak]] as const) {
        const el = $(id);
        if (same) tweenNumber(el, v, id !== '#st-streak');
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

export function openShop(
  user: PublicUser,
  packs: TopupPack[],
  onBuy: (pack: TopupPack) => Promise<string | null>,
) {
  const d = openDialog(
    '福币商店',
    `<div class="notice">演示支付：点击即到账，不会产生任何真实扣款。真实支付（微信 / 支付宝）需要商户资质，将在后续阶段接入。</div>
     <p class="balance">当前福币 <b id="shop-coins" data-v="${user.coins}">${user.coins}</b></p>
     <div class="packs">${packs
       .map(
         (p) => `<button class="pack" data-pack="${p.id}">
           <span class="pack-name">${p.label}</span>
           <b>${p.coins}<small> 福币</small></b>
           <span class="pack-price">¥${p.price}（演示）</span>
         </button>`,
       )
       .join('')}</div>
     <h3>福币可以换什么</h3>
     <ul class="perks">${ITEMS.filter((i) => i.currency === 'coins')
       .map((i) => `<li><i class="swatch ${i.glow ? 'glow' : ''}" style="--c:${i.color}"></i><b>${i.name}</b><span>${i.cost} 福币 · 返还 ${i.reward} 能量${i.glow ? ' · 夜间发光' : ''}</span></li>`)
       .join('')}</ul>
     <p class="error-line form-error" role="alert" hidden></p>`,
  );
  const err = $('.form-error', d.el);
  d.el.querySelectorAll<HTMLButtonElement>('.pack').forEach((btn) =>
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      const pack = packs.find((p) => p.id === btn.dataset.pack)!;
      let message: string | null;
      try {
        message = await onBuy(pack);
      } catch {
        message = '充值失败，请稍后重试';
      } finally {
        btn.disabled = false;
      }
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
  return { setCoins: (n: number) => tweenNumber($('#shop-coins', d.el), n) };
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
  el.innerHTML = `<div class="popup-head"><i class="swatch ${item.glow ? 'glow' : ''}" style="--c:${item.color}"></i><b>${esc(tag.username)}${tag.mine ? '（我）' : ''}</b><small>${item.name} · ${timeFmt.format(tag.createdAt)}</small></div><p>${esc(tag.text)}</p>`;
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
