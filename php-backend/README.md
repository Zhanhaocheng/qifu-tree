# php-backend

与 `server/app.ts`（Hono）接口兼容的 PHP 实现。详见 [php-deploy-guide.md](php-deploy-guide.md)。

- `api/index.php`：入口与路由（`/api/*` 经 `.htaccess` / `web.config` 重写到此；也支持 `/api/index.php?path=/xxx` 与 `/api/index.php/xxx`）
- `api/lib/`：`core.php`（配置/时钟/HTTP 工具）、`db.php`（PDO）、`game.php`（道具、地形、充值档位，对应 `shared/game.ts`）、`app.php`（各接口）、`alipay.php`（支付宝充值：RSA2 签名/验签、下单、查单补单、通知、幂等入账）
- `api/config.sample.php`：复制为 `config.php` 填写；`api/install.php`：一次性安装；`api/diag.php`：环境诊断（用完删除）
- `schema.sql`：MySQL 5.6 兼容表结构（`api/lib/schema.sql` 是同一份拷贝，修改时请同步两处）

与 Node 版的有意差异：限流计数放在 `rate_limits` 表（PHP 无常驻内存）；`username_key` 列实现 SQLite `NOCASE`（只折叠 ASCII 字母）；`TRUST_PROXY_HEADERS` 默认关闭，限流用 `REMOTE_ADDR`。

支付宝充值（可选，未配置时仍是模拟充值）：接口 `GET /pay/info`、`POST /pay/alipay/create`、`GET /pay/alipay/query`、`POST /pay/alipay/recheck`、`POST|GET /pay/alipay/notify`（免登录，成功只输出 `success`）、`GET /pay/alipay/return`。配置项见 `api/config.sample.php` 的 `ALIPAY_*`，部署与沙箱测试见 [php-deploy-guide.md](php-deploy-guide.md) 第 11 节，自动化测试 `npm run test:pay`。
