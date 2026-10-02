import type { SmsInfo } from './api';

// 手机号 + 验证码输入面板：登录弹窗与「绑定手机号」弹窗共用。
// 精细交互：获取验证码倒计时（按截止时间计算，不会因切标签页漂移）、6 格输入自动跳格/粘贴/短信自动填充、
// 错误抖动（prefers-reduced-motion 下由样式关闭）。

const PHONE_RE = /^1[3-9]\d{9}$/;
const CD_KEY = 'qifu_sms_cd';
const LEN = 6;

export const isPhone = (s: string) => PHONE_RE.test(s);
export const maskPhone = (p: string) => `${p.slice(0, 3)}****${p.slice(-4)}`;

/** 去掉空格/横线/+86 前缀，最多保留 11 位数字 */
export function cleanPhone(raw: string): string {
  let d = raw.replace(/\D/g, '');
  if (d.length > 11 && d.startsWith('86')) d = d.slice(2);
  return d.slice(0, 11);
}

export interface SmsSendOutcome {
  ok: boolean;
  message?: string;
  /** 距离可以再次发送还要几秒（来自服务器的 retryAfter 或 resendSeconds） */
  cooldown?: number;
}

export interface SmsPaneOptions {
  info: SmsInfo;
  send: (phone: string) => Promise<SmsSendOutcome>;
  /** 6 位填满且手机号有效时触发（用于自动提交） */
  onComplete: () => void;
  /** 面板内部的提示/错误 */
  onError: (message: string | null) => void;
}

export interface SmsPane {
  phone(): string;
  code(): string;
  /** 通过返回 null，否则返回要显示的错误 */
  validate(): string | null;
  /** 验证码被拒：抖动、清空并回到第一格 */
  reject(): void;
  setActive(active: boolean): void;
  focus(): void;
  dispose(): void;
}

export function smsPaneHTML(): string {
  const cells = Array.from(
    { length: LEN },
    (_, i) =>
      `<input class="otp-cell" inputmode="numeric" pattern="[0-9]*" enterkeyhint="done" autocomplete="${i === 0 ? 'one-time-code' : 'off'}" aria-label="验证码第 ${i + 1} 位" />`,
  ).join('');
  return `
    <label>手机号
      <span class="field phone-field">
        <span class="cc" aria-hidden="true">+86</span>
        <input name="phone" type="tel" inputmode="numeric" autocomplete="tel-national" placeholder="请输入 11 位手机号" />
        <button type="button" class="send-code" disabled>获取验证码</button>
      </span>
    </label>
    <div class="otp-wrap">
      <span class="otp-label" id="otp-label">短信验证码</span>
      <div class="otp" role="group" aria-labelledby="otp-label">${cells}</div>
    </div>
    <p class="sms-hint" aria-live="polite"></p>`;
}

function readCooldown(): { phone: string; until: number } | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(CD_KEY) ?? 'null');
    if (v && typeof v.phone === 'string' && typeof v.until === 'number' && v.until > Date.now()) return v;
  } catch {
    /* storage unavailable */
  }
  return null;
}

function writeCooldown(phone: string, until: number) {
  try {
    sessionStorage.setItem(CD_KEY, JSON.stringify({ phone, until }));
  } catch {
    /* private mode */
  }
}

export function mountSmsPane(root: HTMLElement, o: SmsPaneOptions): SmsPane {
  const q = <T extends HTMLElement>(sel: string) => root.querySelector(sel) as T;
  const phoneInput = q<HTMLInputElement>('input[name=phone]');
  const sendBtn = q<HTMLButtonElement>('.send-code');
  const otp = q<HTMLElement>('.otp');
  const cells = Array.from(root.querySelectorAll<HTMLInputElement>('.otp-cell'));
  const hint = q<HTMLElement>('.sms-hint');

  let cooling: { phone: string; until: number } | null = readCooldown();
  let sending = false;
  let timer = 0;
  let active = true;

  const syncHint = (text: string) => {
    hint.textContent = text;
    hint.classList.toggle('mock', o.info.mock && text.startsWith('测试模式'));
  };
  const idleHint = () => (o.info.mock ? '测试模式：不会真实发送短信，验证码见服务端日志' : '');
  syncHint(idleHint());

  const remaining = () => (cooling ? Math.max(0, Math.ceil((cooling.until - Date.now()) / 1000)) : 0);
  const renderSend = () => {
    const phone = phoneInput.value;
    const left = cooling && cooling.phone === phone ? remaining() : 0;
    if (cooling && remaining() === 0) cooling = null;
    sendBtn.disabled = sending || left > 0 || !isPhone(phone);
    sendBtn.classList.toggle('cooling', left > 0);
    sendBtn.textContent = sending ? '发送中…' : left > 0 ? `${left} 秒后重发` : cells.some((c) => c.value) || hint.dataset.sent ? '重新获取' : '获取验证码';
  };
  const tick = () => {
    renderSend();
    if (!cooling) {
      clearInterval(timer);
      timer = 0;
    }
  };
  const startCooldown = (phone: string, seconds: number) => {
    cooling = { phone, until: Date.now() + seconds * 1000 };
    writeCooldown(phone, cooling.until);
    clearInterval(timer);
    timer = window.setInterval(tick, 250);
    tick();
  };

  if (cooling) {
    phoneInput.value = cooling.phone;
    hint.dataset.sent = '1';
    timer = window.setInterval(tick, 250);
  }
  renderSend();

  phoneInput.addEventListener('input', () => {
    const c = cleanPhone(phoneInput.value);
    if (c !== phoneInput.value) phoneInput.value = c;
    o.onError(null);
    renderSend();
  });

  sendBtn.addEventListener('click', async () => {
    const phone = phoneInput.value;
    if (!isPhone(phone) || sending) return;
    sending = true;
    o.onError(null);
    renderSend();
    const res = await o.send(phone).catch(() => ({ ok: false, message: '发送失败，请稍后重试' }) as SmsSendOutcome);
    sending = false;
    if (res.ok) {
      hint.dataset.sent = '1';
      syncHint(`验证码已发送至 ${maskPhone(phone)}，${o.info.expiresMinutes} 分钟内有效`);
      clearOtp();
      startCooldown(phone, res.cooldown ?? o.info.resendSeconds);
      cells[0].focus();
    } else {
      if (res.message) o.onError(res.message);
      if (res.cooldown) startCooldown(phone, res.cooldown);
      else renderSend();
    }
  });

  /* ---------- 6 格验证码 ---------- */
  const value = () => cells.map((c) => c.value).join('');
  const paint = () => cells.forEach((c) => c.classList.toggle('filled', c.value !== ''));
  function clearOtp() {
    cells.forEach((c) => (c.value = ''));
    paint();
  }
  const complete = () => {
    paint();
    if (value().length === LEN && isPhone(phoneInput.value)) o.onComplete();
  };
  const fillFrom = (start: number, digits: string) => {
    let i = start;
    for (const d of digits.slice(0, LEN - start)) cells[i++].value = d;
    cells[Math.min(i, LEN - 1)].focus();
    complete();
  };

  cells.forEach((cell, i) => {
    cell.addEventListener('focus', () => cell.select());
    cell.addEventListener('input', () => {
      o.onError(null);
      const digits = cell.value.replace(/\D/g, '');
      if (!digits) {
        cell.value = '';
        paint();
        return;
      }
      cell.value = '';
      fillFrom(i, digits);
    });
    cell.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !cell.value && i > 0) {
        e.preventDefault();
        cells[i - 1].value = '';
        cells[i - 1].focus();
        paint();
      } else if (e.key === 'ArrowLeft' && i > 0) {
        e.preventDefault();
        cells[i - 1].focus();
      } else if (e.key === 'ArrowRight' && i < LEN - 1) {
        e.preventDefault();
        cells[i + 1].focus();
      }
    });
    cell.addEventListener('paste', (e) => {
      const digits = (e.clipboardData?.getData('text') ?? '').replace(/\D/g, '');
      if (!digits) return;
      e.preventDefault();
      o.onError(null);
      if (digits.length >= LEN) {
        clearOtp();
        fillFrom(0, digits);
      } else fillFrom(i, digits);
    });
  });

  const dispose = () => clearInterval(timer);

  return {
    phone: () => phoneInput.value,
    code: value,
    validate() {
      if (!isPhone(phoneInput.value)) return '请输入正确的 11 位手机号';
      if (value().length !== LEN) return '请输入 6 位短信验证码';
      return null;
    },
    reject() {
      otp.classList.remove('shake');
      void otp.offsetWidth;
      otp.classList.add('shake');
      setTimeout(() => otp.classList.remove('shake'), 600);
      clearOtp();
      cells[0].focus();
    },
    setActive(on) {
      active = on;
      root.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input, button').forEach((el) => (el.disabled = !on || (el === sendBtn && sendBtn.disabled)));
      if (on) renderSend();
    },
    focus() {
      if (!active) return;
      (isPhone(phoneInput.value) ? cells[0] : phoneInput).focus();
    },
    dispose,
  };
}
