# 祈福树

一棵会随昼夜、风和四季般的地形变化的 3D 祈福古树。注册登录后每日签到积攒能量，写下心愿，把带书法的祈福牌挂上树梢；用福币（充值：未配置支付宝时为演示支付，配置后为真实支付宝支付）购买金牌、祈福灯、莲花灯，并切换五种地形：山巅云海、竹林溪谷、江南水乡、大漠孤烟、雪山寒林。

- 前端：Vite + TypeScript + Three.js（程序化树、PBR 贴图、Preetham 天空、高度雾、实例化草地、动物与昆虫、WebAudio 合成音频）
- 后端：Hono + libSQL（本地 SQLite 文件 / Turso / 内存演示模式），密码 bcrypt，会话为 httpOnly Cookie
- 部署：Vercel（静态前端 + Serverless API）或 Docker

## 本地运行

```bash
npm install
npm run dev        # 前端 http://localhost:47231 ，API :47232（自动代理 /api）
npm test           # 后端接口测试
npm run build && npm start   # 生产模式，单端口 47232，同时托管 dist
```

数据默认保存在 `./data/qifu.db`（可用 `DATA_DIR` 修改）。

调试参数：`?hour=22`（强制时间）、`?terrain=snow`、`?stage=3`（树的阶段）、`?q=low|medium|high`（锁定画质，否则按帧率自适应）。

## 部署到 Vercel（免费额度）

Vercel 的 Serverless 函数没有持久磁盘，所以线上使用 [Turso](https://turso.tech)（libSQL，免费额度）：

```bash
# 1. 创建数据库（一次性）
curl -sSfL https://get.tur.so/install.sh | bash
turso auth login
turso db create qifu-tree
turso db show qifu-tree --url            # -> TURSO_DATABASE_URL
turso db tokens create qifu-tree         # -> TURSO_AUTH_TOKEN

# 2. 部署
npm i -g vercel
vercel login
vercel link
vercel env add TURSO_DATABASE_URL production
vercel env add TURSO_AUTH_TOKEN production
vercel --prod
```

也可以在 Vercel 网页导入 GitHub 仓库，Framework 选 Vite，并在 Settings → Environment Variables 添加上面两个变量。表结构会在首次请求时自动创建。

**没有配置数据库变量时**，Vercel 上会进入「演示模式」：数据只存在函数实例内存里，冷启动或重新部署即丢失，页面顶部会显示提示条。适合先看效果。

可选环境变量：`APP_TZ`（签到日期的时区，默认 `Asia/Shanghai`）。

## PHP + MySQL 后端（国内虚拟主机，备选）

`php-backend/` 是与 Hono 接口完全兼容的 PHP 版（PHP 7.4+/8.x，MySQL 5.6+，无需 SSH/Node，FTP 上传即可），用于把前端和接口都放在国内主机的同一个域名下。Vercel/Node 版不受影响。

- 部署步骤（中文）：[php-backend/php-deploy-guide.md](php-backend/php-deploy-guide.md)
- 打包：`npm run build:php` → `dist-php/qifu-php-site.zip`（前端 + `api/` + `schema.sql`），以及主机不支持 URL 重写时用的 `qifu-frontend-query-style.zip`（`VITE_API_STYLE=query`）
- 导出 Turso 数据（只读）：`TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... npm run export:turso`，生成给 `install.php` 导入的 `import.sql`
- 对比测试：`npm run test:parity`（对 Node 与 PHP 执行同一批场景并逐字节比较响应；需 `QIFU_DB_*` 指向可清空的测试库）；`node scripts/parity/frontend-api.test.mjs` 测前端超时/重试逻辑

前端构建变量：`VITE_API_BASE`（跨域接口地址，默认同域）、`VITE_API_STYLE=query`（使用 `/api/index.php?path=/xxx`）。前端请求有 12 秒超时，GET 自动重试 2 次，POST 不重试。

## 内置测试账号

每次启动（含 Vercel 冷启动、演示模式内存重置、本地 SQLite、Turso）都会幂等地确保下面的账号存在，登录时也会再次校验：

| 项 | 默认值 | 环境变量 |
| --- | --- | --- |
| 用户名 | `qifu_test` | `TEST_ACCOUNT_USER` |
| 密码 | `Qifu@Test2026` | `TEST_ACCOUNT_PASSWORD` |
| 关闭 | 默认开启 | `TEST_ACCOUNT_DISABLED=1` |

该账号能量与福币约为 999,999,999：祈福、解锁/切换地形都不会扣除（也不会低于该值），密码或余额被改动后会在下次启动/登录时恢复。其他用户不受影响。正式上线对外开放时，请设置 `TEST_ACCOUNT_PASSWORD` 为私密值，或设置 `TEST_ACCOUNT_DISABLED=1`。

## 部署为容器（备选）

```bash
docker build -t qifu-tree .
docker run -p 8080:8080 -v qifu-data:/data qifu-tree
```

`fly.toml`（Fly.io，需 `fly volumes create qifu_data`）与 `render.yaml`（Render，需要付费磁盘）已附带。

## 关于支付与音频

- Node/Vercel 版的充值是**演示支付**，点击即到账，不产生真实扣款。PHP 版（国内主机）支持真实支付宝充值，未配置密钥时同样回退为演示支付，见 [php-backend/php-deploy-guide.md](php-backend/php-deploy-guide.md) 第 11 章。
- 价格与奖励集中定义在 `shared/game.ts`（PHP 版对应 `php-backend/api/lib/game.php`，两处必须一致，`npm run test:parity` 会比对）：

| 项目 | 价格 |
| --- | --- |
| 充值 `p1` / `p5` / `p10` | ¥1 / ¥5 / ¥10 → 60 / 330 / 1180 福币 |
| 地貌解锁（5 种，每种） | 888 福币（初始地貌已拥有，切换已拥有的地貌免费） |
| 平安木牌 / 红绸福带 | 30 / 58 能量 |
| 金色福牌 / 祈福灯 / 莲花灯 | 28 / 68 / 88 福币 |
| 祈福牌返还能量 | 全部为 0 |

- 所有音乐与音效均由 WebAudio 实时合成，没有第三方音频素材，不涉及授权问题。

<!-- vercel git integration preview check -->

## 反馈事件 `qifu:fx`

支付成功、解锁地形、挂祈福牌、签到时，前端会在 `window` 上派发 `CustomEvent('qifu:fx')`，3D 场景可订阅它来播放粒子。类型定义见 `src/fx.ts` 的 `QifuFxEvent`。

```ts
window.addEventListener('qifu:fx', (e) => {
  const d = e.detail; // d.type: 'payment' | 'terrain-unlock' | 'terrain-switch' | 'pray' | 'checkin'
});
```

公共字段：`intensity`（1-3）、`particles`（`coins | petals | lantern | sparkle`，按主次排序）、`palette`（颜色数组）、`count`（建议粒子数）、`origin`（`tree | tag | terrain | screen`）、`ts`。专有字段：`payment` 带 `added/balance/pack`；`terrain-unlock` 带 `terrain/name/spent/balance`；`terrain-switch` 带 `terrain/name`；`pray` 带 `item/itemName/color/glow/reward/tagId`；`checkin` 带 `gained/streak`。


## 界面、字体与动效

2D 界面（HUD、弹窗、商店、登录、toast）的样式与动效与 3D 场景完全分离，不改变大树和背景的观感。

- **字体（自托管，商用免费）**：正文用「霞鹜文楷」（LXGW WenKai Medium），题字（标题、弹窗标题、成功提示）用「马善政楷书」，两者均为 SIL OFL 1.1，许可证见 `src/fonts/OFL-*.txt`。字体按界面实际用字子集化为 woff2，随静态资源一起构建，**不依赖 Google Fonts**：`kai-core`（界面静态文案，约 90 KB，首屏）、`kai-more`（约 650 个高频字，约 135 KB，仅当心愿牌/用户名里出现这些字时才下载，`unicode-range` 控制）、`brush`（约 24 KB）。范围之外的字符回退到系统宋体/楷体。
- **重新生成字体**（界面文案有改动时）：`pip install fonttools brotli jieba`，下载 LXGW WenKai Medium / Ma Shan Zheng 的 TTF 后运行 `python3 scripts/fonts/build-fonts.py <TTF 目录>`，会更新 `src/fonts/*.woff2` 与 `src/styles/fonts.css`。
- **令牌与字阶**：`src/style.css` 顶部集中定义颜色、圆角/阴影层级、缓动与时长、字阶（11–34 px）、字距、安全区变量；福币/能量等数字统一用 `tabular-nums`。
- **动效层**：`src/styles/motion.css`（纯 CSS）+ `src/motion.ts`（事件委托，无新增依赖）。包含：按钮悬停/按下/聚焦/禁用/加载态、涟漪与指针光晕、弹层入场/退出与错落 stagger、选项卡与道具选择的滑动指示器、数字滚动（count-up）、奖励飞入 HUD（订阅 `qifu:fx`，不影响 3D 特效）、toast 弹性入场与倒计时线、骨架屏、手机底部弹层下滑关闭。
- **性能**：动画只使用 `transform` / `opacity`；毛玻璃（`backdrop-filter`）只在 3D 画质为「高」时启用（`html[data-gfx]` 由场景画质回调同步），「低」档位会关闭流光、图标循环等装饰动画。
- **减少动态效果**：`prefers-reduced-motion: reduce` 下所有过渡/动画瞬时完成，涟漪与飞入奖励被跳过。
- **主机 MIME**：部分旧版 IIS 主机没有 `.woff2` 的 MIME 类型，字体会 404（页面会自动回退到系统字体，功能不受影响）。上传后访问 `/assets/kai-core-*.woff2` 应返回 200；若 404，请在主机后台添加 MIME `.woff2 → font/woff2`。

## 分离部署（静态前端 + 跨域 API）

- 构建前端时设置 `VITE_API_BASE=https://qifu-tree.vercel.app npm run build`，把 `dist/` 上传到任意静态主机（资源使用相对路径，无需服务端重写）。不设置时默认同源 `/api`。
- 跨域时登录/注册响应会额外返回 `token`，前端存入 localStorage 并以 `Authorization: Bearer` 发送；服务端同时接受 Cookie 或 Bearer。
- 服务端通过环境变量 `ALLOWED_ORIGINS`（逗号分隔）配置 CORS 白名单，默认包含 `qifu.laixi.cn`、`qifu-tree.vercel.app` 与本地开发地址。
