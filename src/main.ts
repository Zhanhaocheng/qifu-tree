import './styles/fonts.css';
import './style.css';
import './styles/motion.css';
import './styles/sms.css';
import { STAGES, TERRAINS, stageOf, type PublicUser, type PrayerTag, type TerrainId } from '../shared/game';
import { api, ApiError, type Config, type PayCreateResponse, type PayInfo, type PayOrder, type SmsInfo } from './api';
import { AudioEngine } from './audio';
import { createFx } from './fx';
import { initMotion } from './motion';
import { QifuScene, type Quality } from './scene/scene';
import { STAGE_PARAMS } from './scene/tree';
import { closeDialog, hideLoading, mountHud, openAuth, openBindPhone, openPray, openShop, openTerrain, showPopup, toast } from './ui';

const params = new URLSearchParams(location.search);
const hourParam = params.get('hour');
const qualityParam = params.get('q') as Quality | null;
const stageParam = params.get('stage');
const terrainParam = params.get('terrain') as TerrainId | null;

initMotion();
const audio = new AudioEngine();
const fx = createFx(audio);
for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault());
let user: PublicUser | null = null;
let config: Config | null = null;
let payInfo: PayInfo | null = null;
let smsInfo: Promise<SmsInfo | null> = Promise.resolve(null);
let total = 0;

const hud = mountHud({
  onSound: () => audio.toggleMute(),
  onLogin: () => {
    audio.click();
    showAuth();
  },
  onLogout: async () => {
    audio.click();
    await api.logout().catch(() => undefined);
    user = null;
    refresh();
    await loadTags();
    toast('已退出登录');
  },
  onCheckin: async () => {
    audio.click();
    if (!user) return showAuth();
    if (user.checkedInToday) return toast('今天已经签到过了，明天再来吧');
    try {
      const res = await api.checkin();
      user = res.user;
      fx.checkin(res.gained, user.streak);
      toast(`签到成功，获得 ${res.gained} 点能量（已连续 ${user.streak} 天）`, 'success');
      refresh();
    } catch (e) {
      handleError(e);
    }
  },
  onPray: () => {
    audio.click();
    if (!user) return showAuth();
    if (!config) return;
    openPray(user, config.maxWishLength, submitPrayer, () => audio.click());
  },
  onTerrain: () => {
    audio.click();
    if (!user) return showAuth();
    if (!config) return;
    openTerrain(user, config.terrains, async (t) => {
      try {
        const res = await api.setTerrain(t.id);
        user = res.user;
        audio.click();
        closeDialog();
        toast(res.spent ? `已解锁并切换到「${t.name}」（-${res.spent} 福币）` : `已切换到「${t.name}」`, 'success');
        showBusy(true);
        await new Promise((r) => setTimeout(r, 60));
        refresh();
        showBusy(false);
        if (res.spent) fx.terrainUnlock(t, res.spent, user.coins);
        else fx.terrainSwitch(t);
        return null;
      } catch (e) {
        audio.error();
        return e instanceof ApiError ? e.message : '切换失败';
      }
    });
  },
  onShop: () => {
    audio.click();
    if (!user) return showAuth();
    if (!config) return;
    const shop: ReturnType<typeof openShop> = openShop(user, config.packs, payInfo, async (pack) => {
      if (payInfo?.mode === 'alipay') return buyWithAlipay(pack, shop);
      try {
        const res = await api.topup(pack.id);
        user = res.user;
        fx.payment(res.added, user.coins, pack.label);
        toast(`支付成功：+${res.added} 福币`, 'success');
        shop.setCoins(user.coins);
        refresh();
        return null;
      } catch (e) {
        audio.error();
        return e instanceof ApiError ? e.message : '充值失败';
      }
    });
  },
});
audio.onStateChange((s) => hud.setAudioState(s));

const scene = new QifuScene(
  document.querySelector<HTMLCanvasElement>('#scene')!,
  {
    onPick: (tag, x, y) => {
      if (tag) audio.click();
      showPopup(tag, x, y);
    },
    onFrame: (s) => {
      audio.setEnvironment(s.wind, s.night);
      if (audio.terrain !== s.terrain) audio.setTerrain(s.terrain);
    },
    onAnimal: (kind, pos, cam) => audio.animal(kind, pos.distanceTo(cam), pos.x - cam.x),
    onQuality: (q) => (document.documentElement.dataset.gfx = q),
  },
  { quality: ['low', 'medium', 'high'].includes(qualityParam ?? '') ? (qualityParam as Quality) : undefined, hour: hourParam !== null ? Number(hourParam) : null, terrain: TERRAINS.some((t) => t.id === terrainParam) ? (terrainParam as TerrainId) : undefined },
);
document.documentElement.dataset.gfx = qualityParam && ['low', 'medium', 'high'].includes(qualityParam) ? qualityParam : matchMedia('(pointer: coarse)').matches || innerWidth < 720 ? 'medium' : 'high';
(window as unknown as { __qifu: unknown }).__qifu = { scene, audio };

function showBusy(on: boolean) {
  document.querySelector('#app')!.classList.toggle('busy', on);
}

function handleError(e: unknown) {
  audio.error();
  if (e instanceof ApiError && e.status === 401) {
    user = null;
    refresh();
    toast(e.message, 'error');
    showAuth();
    return;
  }
  toast(e instanceof ApiError ? e.message : '出错了，请稍后重试', 'error');
}

function afterAuth(res: { user: PublicUser }, registered: boolean) {
  user = res.user;
  audio.click();
  refresh();
  loadTags().catch(() => undefined);
  toast(registered ? `欢迎，${user.username}！已赠送 30 点能量` : `欢迎回来，${user.username}`, 'success');
}

async function showAuth() {
  const info = await Promise.race([smsInfo, new Promise<null>((r) => setTimeout(() => r(null), 800))]);
  openAuth(
    async (mode, username, password) => {
      try {
        const res = mode === 'login' ? await api.login(username, password) : await api.register(username, password);
        afterAuth(res, mode === 'register');
        return null;
      } catch (e) {
        audio.error();
        return e instanceof ApiError ? e.message : '操作失败';
      }
    },
    info
      ? {
          info,
          send: smsSend('login'),
          login: async (phone, code) => {
            try {
              const res = await api.smsLogin(phone, code);
              afterAuth(res, res.registered);
              return null;
            } catch (e) {
              audio.error();
              return e instanceof ApiError ? e.message : '操作失败';
            }
          },
        }
      : undefined,
  );
}

function smsSend(purpose: 'login' | 'bind') {
  return async (phone: string) => {
    try {
      const res = await api.smsSend(phone, purpose);
      return { ok: true, cooldown: res.resendSeconds };
    } catch (e) {
      audio.error();
      if (e instanceof ApiError && e.status === 401 && purpose === 'bind') {
        handleError(e);
        return { ok: false };
      }
      return { ok: false, message: e instanceof ApiError ? e.message : '发送失败，请稍后重试', cooldown: e instanceof ApiError ? e.retryAfter : undefined };
    }
  };
}

/** 设置菜单里的「绑定手机号」只需派发 window.dispatchEvent(new Event('qifu:bind-phone')) */
window.addEventListener('qifu:bind-phone', async () => {
  if (!user) return showAuth();
  const info = await smsInfo;
  if (!info) return toast('手机号绑定暂未开放', 'info');
  const current = await api.smsPhone().then((r) => r.phone).catch(() => null);
  openBindPhone({
    info,
    current,
    send: smsSend('bind'),
    bind: async (phone, code) => {
      try {
        const res = await api.smsBind(phone, code);
        toast(`已绑定手机号 ${res.phone}`, 'success');
        return null;
      } catch (e) {
        audio.error();
        return e instanceof ApiError ? e.message : '操作失败';
      }
    },
  });
});

async function submitPrayer(item: Parameters<typeof api.pray>[0], text: string): Promise<string | null> {
  try {
    const res = await api.pray(item, text);
    user = res.user;
    refresh();
    closeDialog();
    fx.pray(item, res.reward, res.tag.id);
    const before = scene.getStage();
    await loadTags().catch(() => undefined);
    if (scene.getStage() === before) scene.focusTag(res.tag.id);
    scene.spawnBurst(res.tag.id);
    toast(res.reward ? `祈福牌已挂上树梢，返还 ${res.reward} 能量` : '祈福牌已挂上树梢，愿心想事成', 'success');
    return null;
  } catch (e) {
    audio.error();
    if (e instanceof ApiError && e.status === 401) {
      handleError(e);
      return null;
    }
    return e instanceof ApiError ? e.message : '祈福失败';
  }
}

function syncTerrain() {
  if (terrainParam && TERRAINS.some((t) => t.id === terrainParam)) return;
  const want: TerrainId = user ? user.terrain : 'mountain';
  const seed = user ? user.id : 1;
  if (scene.getTerrain() !== want) scene.setTerrain(want, seed);
}

function currentStage() {
  if (stageParam !== null) return Math.min(3, Math.max(0, Number(stageParam)));
  return user ? user.stage : stageOf(Math.floor(total / 4));
}

function refresh() {
  hud.setUser(user);
  syncTerrain();
  scene.setStage(currentStage(), true);
  hud.setStage(scene.getStage(), user ? '' : '来访');
  hud.setTagCount(scene.getTagCount(), total);
}

async function loadTags(): Promise<PrayerTag[]> {
  const res = await api.prayers();
  total = res.total;
  scene.setActivity(res.recent24h);
  syncTerrain();
  scene.setStage(currentStage(), true);
  scene.setTags(res.tags);
  hud.setStage(scene.getStage(), user ? `已祈福 ${user.prayerCount} 次` : '来访');
  hud.setTagCount(scene.getTagCount(), total);
  return res.tags;
}

/* ------------------------------------------------------------ 支付宝充值 */

const PAY_SEEN_KEY = 'qifu_pay_seen';
const PAY_PENDING_KEY = 'qifu_pay_pending';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function readList(key: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function writeStore(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* 隐私模式 */
  }
}

const isMobileDevice = () =>
  /Android|iPhone|iPad|iPod|Mobile|HarmonyOS|OpenHarmony/i.test(navigator.userAgent) ||
  (matchMedia('(pointer: coarse)').matches && Math.min(innerWidth, innerHeight) < 820);

/** 已到账的订单只播放一次特效（QR 轮询、return 回跳、补单可能先后发现同一笔） */
function announcePaid(order: PayOrder, shop?: ReturnType<typeof openShop>): boolean {
  if (order.user) user = order.user;
  refresh();
  shop?.setCoins(user?.coins ?? 0);
  if (localStorage.getItem(PAY_PENDING_KEY) === order.orderNo) writeStore(PAY_PENDING_KEY, null);
  if (readList(PAY_SEEN_KEY).includes(order.orderNo)) return false;
  writeStore(PAY_SEEN_KEY, JSON.stringify([...readList(PAY_SEEN_KEY), order.orderNo].slice(-30)));
  const label = config?.packs.find((p) => p.id === order.packId)?.label ?? '福币';
  fx.payment(order.coins, user?.coins ?? 0, label);
  toast(`支付成功：+${order.coins} 福币`, 'success');
  return true;
}

async function pollOrder(orderNo: string, shouldStop: () => boolean, maxMs: number): Promise<PayOrder | null> {
  const t0 = Date.now();
  let last: PayOrder | null = null;
  while (!shouldStop() && Date.now() - t0 < maxMs) {
    try {
      last = await api.payQuery(orderNo);
      if (last.status !== 'pending') return last;
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 404)) return last;
    }
    await sleep(2500);
  }
  return last;
}

function submitPayForm(form: NonNullable<PayCreateResponse['form']>) {
  const f = document.createElement('form');
  f.method = 'POST';
  f.action = form.action;
  f.acceptCharset = 'utf-8';
  f.style.display = 'none';
  for (const [name, value] of Object.entries(form.fields)) {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = name;
    input.value = value;
    f.appendChild(input);
  }
  document.body.appendChild(f);
  f.submit();
}

async function buyWithAlipay(pack: { id: string; label: string; coins: number }, shop: ReturnType<typeof openShop>): Promise<string | undefined> {
  if (!payInfo?.ready) return '支付暂未开放，请稍后再试';
  const mobile = isMobileDevice();
  if (mobile && /MicroMessenger/i.test(navigator.userAgent)) {
    return '微信内无法唤起支付宝，请点右上角「…」用浏览器打开本页后再充值';
  }
  let order: PayCreateResponse;
  try {
    order = await api.payCreate(pack.id, mobile ? 'mobile' : 'desktop');
  } catch (e) {
    audio.error();
    return e instanceof ApiError ? e.message : '下单失败，请稍后重试';
  }
  writeStore(PAY_PENDING_KEY, order.orderNo);
  if (order.form) {
    toast('正在前往支付宝…');
    await sleep(150);
    submitPayForm(order.form);
    return undefined;
  }
  if (!order.qrCode) return '下单失败，请稍后重试';

  let stopped = false;
  const finish = (res: PayOrder | null) => {
    if (res?.status === 'paid') {
      announcePaid(res, shop);
      shop.hideQr();
    } else if (res?.status === 'closed') shop.setPayStatus('订单已关闭，请返回重新下单');
  };
  shop.showQr(
    { text: order.qrCode, amount: order.amount, label: pack.label, coins: pack.coins },
    {
      onCancel: () => {
        stopped = true;
        writeStore(PAY_PENDING_KEY, null);
      },
      onCheck: async () => {
        shop.setPayStatus('正在查询支付结果…');
        try {
          const res = await api.payQuery(order.orderNo);
          if (res.status === 'pending') shop.setPayStatus('还没有收到付款，请完成扫码支付');
          else finish(res);
        } catch (e) {
          shop.setPayStatus(e instanceof ApiError ? e.message : '查询失败，请稍后重试');
        }
      },
    },
  );
  void pollOrder(order.orderNo, () => stopped || !shop.isOpen(), 10 * 60 * 1000).then((res) => {
    if (stopped) return;
    if (res && res.status !== 'pending') finish(res);
    else if (shop.isOpen()) shop.setPayStatus('尚未收到付款。如已付款请点「我已支付，刷新」，福币稍后也会自动到账');
  });
  return undefined;
}

/** 回到站点后确认支付结果：支付宝 return 页带回 ?payOrder=，或上次留下未确认的订单 */
async function resumePayments() {
  const params = new URLSearchParams(location.search);
  const fromReturn = params.get('payOrder');
  if (fromReturn) {
    params.delete('payOrder');
    const rest = params.toString();
    history.replaceState(null, '', location.pathname + (rest ? `?${rest}` : '') + location.hash);
  }
  if (payInfo?.mode !== 'alipay' || !user) return;
  const orderNo = fromReturn ?? localStorage.getItem(PAY_PENDING_KEY);
  if (orderNo && /^[A-Za-z0-9_]{6,40}$/.test(orderNo)) {
    if (fromReturn) toast('正在确认支付结果…');
    const res = await pollOrder(orderNo, () => false, fromReturn ? 20000 : 100);
    if (res?.status === 'paid') return void announcePaid(res);
    if (fromReturn) toast(res?.status === 'closed' ? '订单已关闭，未扣款' : '尚未收到付款结果，到账后福币会自动增加', res?.status === 'closed' ? 'error' : undefined);
    else if (res?.status === 'closed') writeStore(PAY_PENDING_KEY, null);
  }
  try {
    const r = await api.payRecheck();
    r.paid.forEach((o) => announcePaid({ ...o, user: r.user }));
    user = r.user;
    refresh();
  } catch {
    /* 补单是尽力而为 */
  }
}

async function boot() {
  try {
    smsInfo = api.smsInfo();
    const [cfg, me, pay] = await Promise.all([api.config(), api.me(), api.payInfo()]);
    config = cfg;
    payInfo = pay;
    user = me.user;
    hud.setMode(cfg.mode);
    hud.setUser(user);
    syncTerrain();
    scene.setStage(currentStage(), false);
    await loadTags();
    hud.setStage(scene.getStage(), user ? `已祈福 ${user.prayerCount} 次` : '来访');
    void resumePayments();
  } catch {
    toast('无法连接服务器，正在显示离线的树', 'error');
    hud.setUser(null);
    hud.clearTagCount();
    hud.setStage(0, '离线');
  }
  hideLoading();
  setInterval(() => {
    if (!document.hidden) loadTags().catch(() => undefined);
  }, 30000);
}

void STAGES;
void STAGE_PARAMS;
void boot();
