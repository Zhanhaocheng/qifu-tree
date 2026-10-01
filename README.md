# 祈福树

一棵会随昼夜、风和四季般的地形变化的 3D 祈福古树。注册登录后每日签到积攒能量，写下心愿，把带书法的祈福牌挂上树梢；用福币（演示支付）购买金牌、祈福灯、莲花灯，并切换五种地形：山巅云海、竹林溪谷、江南水乡、大漠孤烟、雪山寒林。

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

- 充值是**演示支付**，点击即到账，不产生真实扣款；接入微信/支付宝需要商户资质。
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
