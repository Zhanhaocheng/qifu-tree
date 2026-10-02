import type { ItemDef, ItemId, PrayerTag, PublicUser, TerrainDef, TerrainId, TopupPack } from '../shared/game';

export type StorageMode = 'local' | 'turso' | 'demo';

export type ApiErrorKind = 'http' | 'timeout' | 'network';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public kind: ApiErrorKind = 'http',
  ) {
    super(message);
  }
}

const API_BASE = ((import.meta.env.VITE_API_BASE as string | undefined) ?? '').trim().replace(/\/+$/, '');
// "query" 风格：/api/index.php?path=/xxx，用于不支持 URL 重写的虚拟主机（默认 REST 风格 /api/xxx）
const API_STYLE = ((import.meta.env.VITE_API_STYLE as string | undefined) ?? '').trim().toLowerCase();
const TOKEN_KEY = 'qifu_token';

const REQUEST_TIMEOUT_MS = 12000;
const GET_RETRIES = 2;
const RETRY_DELAY_MS = 700;
const RETRYABLE_STATUS = new Set([502, 503, 504]);

const MSG_TIMEOUT = '请求超时，网络较慢，请稍后重试';
const MSG_NETWORK = '网络连接失败，请检查网络后重试';
const MSG_TIMEOUT_WRITE = '请求超时，操作可能未成功，请刷新确认后再试';
const MSG_SESSION = '登录已失效，请重新登录';
const MSG_SERVER = '服务器开小差了，请稍后再试';
const MSG_FAILED = '请求失败';

// Bearer tokens are only used when the API lives on another origin, where
// browsers (Safari, WeChat) may block the third-party session cookie.
const crossOrigin = API_BASE !== '';

function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function writeToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable (private mode) */
  }
}

function endpoint(url: string): string {
  // query 风格下路径本身占用了 ?path=，附带的查询参数要用 & 接在后面
  if (API_STYLE === 'query') return `${API_BASE}/api/index.php?path=${url.replace(/^\/api/, '').replace('?', '&')}`;
  return API_BASE + url;
}

interface RequestOptions {
  /** 超时提示（POST 请求可能已经到达服务器，需要提示“可能未成功”） */
  timeoutMessage?: string;
  networkMessage?: string;
}

interface Attempt {
  res: Response;
  data: unknown;
}

async function attempt(method: string, url: string, headers: Record<string, string>, body: unknown): Promise<Attempt> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(endpoint(url), {
      method,
      credentials: 'include',
      headers: Object.keys(headers).length ? headers : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const data = await res.json().catch(() => ({}));
    return { res, data };
  } catch (e) {
    if (ctrl.signal.aborted) throw new ApiError('', 0, 'timeout');
    throw new ApiError('', 0, 'network');
  } finally {
    clearTimeout(timer);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function request<T>(method: string, url: string, body?: unknown, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (body) headers['content-type'] = 'application/json';
  const token = crossOrigin ? readToken() : null;
  if (token) headers.authorization = `Bearer ${token}`;

  // 只有 GET（幂等）会自动重试；POST 可能已生效，绝不重发
  const maxAttempts = method === 'GET' ? 1 + GET_RETRIES : 1;
  let out: Attempt | undefined;
  for (let i = 1; ; i++) {
    try {
      out = await attempt(method, url, headers, body);
      if (!RETRYABLE_STATUS.has(out.res.status) || i >= maxAttempts) break;
    } catch (e) {
      if (i >= maxAttempts) {
        const err = e as ApiError;
        throw new ApiError(
          err.kind === 'timeout' ? (opts.timeoutMessage ?? (method === 'GET' ? MSG_TIMEOUT : MSG_TIMEOUT_WRITE)) : (opts.networkMessage ?? MSG_NETWORK),
          0,
          err.kind,
        );
      }
    }
    await sleep(RETRY_DELAY_MS * i);
  }

  const { res, data } = out!;
  if (crossOrigin) {
    const issued = (data as { token?: unknown }).token;
    if (res.ok && typeof issued === 'string') writeToken(issued);
    else if (res.status === 401 && token) writeToken(null);
  }
  if (!res.ok) {
    const serverMessage = (data as { error?: unknown }).error;
    const fallback = res.status === 401 ? MSG_SESSION : res.status >= 500 ? MSG_SERVER : MSG_FAILED;
    throw new ApiError(typeof serverMessage === 'string' && serverMessage ? serverMessage : fallback, res.status);
  }
  return data as T;
}

export interface Config {
  items: ItemDef[];
  packs: TopupPack[];
  terrains: TerrainDef[];
  maxWishLength: number;
  mode: StorageMode;
}

export interface PayInfo {
  /** demo = 未配置支付宝，使用模拟充值；alipay = 真实支付（ready=false 表示配置不完整） */
  mode: 'demo' | 'alipay';
  ready: boolean;
  sandbox: boolean;
  /** 电脑端：qr = 页面内扫码；page = 跳转支付宝收银台 */
  pcMode: 'qr' | 'page';
  /** 测试价开关（PAY_TEST_PRICES）：档位实付金额临时为 0.01 / 0.02 / 0.03 元 */
  testPrices?: boolean;
}

export interface PayCreateResponse {
  orderNo: string;
  channel: 'wap' | 'page' | 'qr';
  amount: string;
  /** wap / page：以 POST 表单提交到支付宝网关 */
  form?: { action: string; fields: Record<string, string> };
  /** qr：支付宝二维码内容 */
  qrCode?: string;
}

export interface PayOrder {
  orderNo: string;
  status: 'pending' | 'paid' | 'closed';
  channel: 'wap' | 'page' | 'qr';
  packId: string;
  coins: number;
  amount: string;
  user?: PublicUser;
}

export interface PrayersResponse {
  tags: PrayerTag[];
  total: number;
  recent24h: number;
}

export const api = {
  config: () => request<Config>('GET', '/api/config'),
  me: () => request<{ user: PublicUser | null; mode: StorageMode }>('GET', '/api/me'),
  register: (username: string, password: string) =>
    request<{ user: PublicUser; token?: string }>('POST', '/api/register', { username, password }, {
      timeoutMessage: '注册请求超时，可能未成功，请稍后重试或直接登录确认',
      networkMessage: '网络连接失败，注册可能未成功，请检查网络后重试或直接登录确认',
    }),
  login: (username: string, password: string) =>
    request<{ user: PublicUser; token?: string }>('POST', '/api/login', { username, password }, {
      timeoutMessage: '登录请求超时，网络较慢，请稍后重试',
    }),
  logout: () => request<{ ok: true }>('POST', '/api/logout').finally(() => writeToken(null)),
  checkin: () => request<{ gained: number; user: PublicUser }>('POST', '/api/checkin'),
  pray: (item: ItemId, text: string) => request<{ tag: PrayerTag; reward: number; user: PublicUser }>('POST', '/api/pray', { item, text }),
  setTerrain: (terrain: TerrainId) => request<{ spent: number; user: PublicUser }>('POST', '/api/terrain', { terrain }),
  topup: (pack: string) => request<{ added: number; user: PublicUser }>('POST', '/api/topup', { pack }),
  prayers: () => request<PrayersResponse>('GET', '/api/prayers'),
  /** Node/Vercel 版没有支付接口：任何失败都当作「模拟充值」 */
  payInfo: () =>
    request<PayInfo>('GET', '/api/pay/info')
      .then((r) => (r && (r.mode === 'alipay' || r.mode === 'demo') ? r : null))
      .catch(() => null),
  payCreate: (pack: string, device: 'mobile' | 'desktop') =>
    request<PayCreateResponse>('POST', '/api/pay/alipay/create', { pack, device }, {
      timeoutMessage: '下单请求超时，请稍后重试（如已扣款，福币会自动到账）',
    }),
  payQuery: (orderNo: string) => request<PayOrder>('GET', `/api/pay/alipay/query?orderNo=${encodeURIComponent(orderNo)}`),
  payRecheck: () => request<{ paid: PayOrder[]; user: PublicUser }>('POST', '/api/pay/alipay/recheck'),
};
