import './style.css';
import { STAGES, TERRAINS, stageOf, type PublicUser, type PrayerTag, type TerrainId } from '../shared/game';
import { api, ApiError, type Config } from './api';
import { AudioEngine } from './audio';
import { QifuScene, type Quality } from './scene/scene';
import { STAGE_PARAMS } from './scene/tree';
import { closeDialog, hideLoading, mountHud, openAuth, openPray, openShop, showPopup, toast } from './ui';

const params = new URLSearchParams(location.search);
const hourParam = params.get('hour');
const qualityParam = params.get('q') as Quality | null;
const stageParam = params.get('stage');
const terrainParam = params.get('terrain') as TerrainId | null;

const audio = new AudioEngine();
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
      audio.checkin();
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
  onShop: () => {
    audio.click();
    if (!user) return showAuth();
    if (!config) return;
    const shop = openShop(user, config.packs, async (pack) => {
      try {
        const res = await api.topup(pack.id);
        user = res.user;
        audio.coin();
        toast(`演示充值成功：+${res.added} 福币`, 'success');
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
audio.onMuteChange((m) => hud.setMuted(m));

const scene = new QifuScene(
  document.querySelector<HTMLCanvasElement>('#scene')!,
  {
    onPick: (tag, x, y) => {
      if (tag) audio.click();
      showPopup(tag, x, y);
    },
    onFrame: (s) => audio.setEnvironment(s.wind, s.night),
  },
  { quality: ['low', 'medium', 'high'].includes(qualityParam ?? '') ? (qualityParam as Quality) : undefined, hour: hourParam !== null ? Number(hourParam) : null, terrain: TERRAINS.some((t) => t.id === terrainParam) ? (terrainParam as TerrainId) : undefined },
);
(window as unknown as { __qifu: unknown }).__qifu = { scene, audio };

function handleError(e: unknown) {
  audio.error();
  if (e instanceof ApiError && e.status === 401) {
    user = null;
    refresh();
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
      await loadTags();
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
    audio.pray();
    const before = scene.getStage();
    const known = await loadTags();
    void known;
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
