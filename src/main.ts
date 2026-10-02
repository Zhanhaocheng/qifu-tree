import './styles/fonts.css';
import './style.css';
import './styles/motion.css';
import { STAGES, TERRAINS, stageOf, type PublicUser, type PrayerTag, type TerrainId } from '../shared/game';
import { api, ApiError, type Config } from './api';
import { AudioEngine } from './audio';
import { createFx } from './fx';
import { initMotion } from './motion';
import { QifuScene, type Quality } from './scene/scene';
import { STAGE_PARAMS } from './scene/tree';
import { closeDialog, hideLoading, mountHud, openAuth, openPray, openShop, openTerrain, showPopup, toast } from './ui';

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
    const shop = openShop(user, config.packs, async (pack) => {
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

function showAuth() {
  openAuth(async (mode, username, password) => {
    try {
      const res = mode === 'login' ? await api.login(username, password) : await api.register(username, password);
      user = res.user;
      audio.click();
      refresh();
      loadTags().catch(() => undefined);
      toast(mode === 'register' ? `欢迎，${user.username}！已赠送 30 点能量` : `欢迎回来，${user.username}`, 'success');
      return null;
    } catch (e) {
      audio.error();
      return e instanceof ApiError ? e.message : '操作失败';
    }
  });
}

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

async function boot() {
  try {
    const [cfg, me] = await Promise.all([api.config(), api.me()]);
    config = cfg;
    user = me.user;
    hud.setMode(cfg.mode);
    hud.setUser(user);
    syncTerrain();
    scene.setStage(currentStage(), false);
    await loadTags();
    hud.setStage(scene.getStage(), user ? `已祈福 ${user.prayerCount} 次` : '来访');
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
