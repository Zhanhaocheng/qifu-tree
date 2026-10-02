# 祈福树 PHP 版部署指南（景安虚拟主机 / FTP / MySQL 5.6）

目标：把前端和 PHP 接口都放到 `http://qifu.laixi.cn`，同域访问，国内不再依赖 Vercel。
Vercel/Node 版保持原样，随时可以回退（见第 9 节）。

> 全程不需要 SSH，不需要 Node。所有操作都是：改一个配置文件 → FTP 上传 → 浏览器打开一个安装页。

## 0. 你会用到的东西

| 东西 | 说明 |
| --- | --- |
| `qifu-php-site.zip` | 上传包：`index.html`、`assets/`、`api/`、`schema.sql` |
| `php-import.sql` | 从 Turso 导出的现有数据（用户、祈福、充值、会话）。**含密码哈希，属敏感数据** |
| `qifu-frontend-query-style.zip` | 备用前端：主机不支持 URL 重写时用（第 8.2 节） |
| FTP 账号 | 景安给你的 FTP 地址、账号、密码；网站目录通常叫 `WEB`（景安实测路径形如 `/www/users/<FTP账号>/WEB/`） |
| MySQL 信息 | 面板里的数据库地址、库名、用户名、密码 |

## 1. 准备数据库

在景安控制面板的「数据库」里确认已有一个 **空的** MySQL 库（库名、用户名、密码都记下来）。

数据库地址：

- **景安实测**：`DB_HOST` 填面板里的数据库地址（外网地址，形如 `2295.dnstoo.com`，端口 3306），主机里的 PHP 可以直接连。
  **不要填 `localhost`**：它走本机 socket，景安主机上没有，会报 `No such file or directory`。
- 同一个外网地址也可以给你电脑上的 Navicat / 命令行远程连接用，通常要先在面板里放行你的出口 IP。
- 其它主机：先试 `localhost`，再试面板里的「内网地址」。

本项目的表结构已在真实的 **MySQL 5.6.51**（`innodb_large_prefix=OFF`，即最严格的索引长度限制）上验证过：不使用 JSON 类型、窗口函数、CTE、生成列，所有唯一索引都在 767 字节以内。

## 2. 填配置

1. 解压 `qifu-php-site.zip`。
2. 把 `api/config.sample.php` 复制一份，改名 `api/config.php`，用记事本（UTF-8，无 BOM）填：

   ```php
   'DB_HOST' => '面板里的数据库地址，如 2295.dnstoo.com',   // 景安不要填 localhost，见第 1 节
   'DB_PORT' => 3306,
   'DB_NAME' => '你的库名',
   'DB_USER' => '你的数据库用户名',
   'DB_PASS' => '你的数据库密码',
   'INSTALL_SECRET' => '随便一串 16 位以上的随机字符',   // 安装页口令，用完即废
   'TEST_ACCOUNT_PASSWORD' => '改成只有你知道的密码',      // 或者 'TEST_ACCOUNT_DISABLED' => true
   ```

   `config.php` 里有真实密码：**只上传到服务器，不要发给别人，不要提交到 Git**（仓库 `.gitignore` 已忽略它）。
3. 把 `php-import.sql` 复制到 `api/import.sql`（要导入旧数据时才需要）。

## 3. 上传（FTP）

**先备份**：用 FTP 把线上现有的 `index.html` 和 `assets/` 整个下载到电脑，留作回退（第 9 节）。

**上传顺序很重要**：先传 `api/`（此时线上前端还是旧的，不受影响），验证接口 OK 之后，最后才传 `index.html` 和 `assets/`。

### 方式 A：FileZilla

1. 新建站点：协议 FTP，主机填景安给的 FTP 地址，填账号密码。
2. 传输类型选「二进制」（站点管理器 → 传输设置，或 菜单 传输 → 传输类型 → 二进制）。
3. 右侧进入 `WEB/`，把本地 `api/` 整个文件夹（含 `config.php`、`import.sql`、`lib/`、隐藏文件 `.htaccess`）拖上去。
   FileZilla 菜单 → 服务器 → 「强制显示隐藏文件」，否则 `.htaccess` 可能看不到。

### 方式 B：curl 命令行

在解压目录里执行（把 HOST、WEB 目录名换成你的；账号密码放环境变量，不要写进命令历史/脚本）：

```bash
export FTP_HOST=你的FTP地址   FTP_USER=你的FTP账号
read -s -p "FTP 密码: " FTP_PASS; export FTP_PASS; echo

cd qifu-php-site           # 解压出来的目录；注意先把 config.php、import.sql 放进 api/
upload() { curl -sS --ftp-create-dirs -u "$FTP_USER:$FTP_PASS" -T "$1" "ftp://$FTP_HOST/WEB/${1#./}" && echo "ok $1"; }

# 第一步：只传 api/
find ./api -type f | while read -r f; do upload "$f"; done
```

## 4. 先看环境（诊断页）

浏览器打开 `http://qifu.laixi.cn/api/diag.php`，应看到类似：

```
PHP 版本      8.1.x  (OK)
pdo_mysql     OK
bcrypt        OK
config.php 存在  OK
```

再打开 `http://qifu.laixi.cn/api/diag.php?key=你的INSTALL_SECRET`，会多出「数据库连接 OK / MySQL 版本 5.6.x」。

- 页面还会列出 `disable_functions` 和「不可用的可选函数」。共享主机常禁用 `set_time_limit`、`ini_set`、`putenv` 等，程序对这些都做了兼容，**不会因此报错**。
- PHP 版本需要 7.4 以上（推荐 8.1）。在景安面板「PHP 版本」里选 8.x。
- `pdo_mysql` 缺失：在面板里开启 PDO MySQL / 联系客服。
- 数据库连接失败：看第 1 节换 `DB_HOST`，或看第 10 节。

## 5. 安装（建表 + 导入数据）

1. 打开 `http://qifu.laixi.cn/api/install.php`，输入 `INSTALL_SECRET`，点「开始安装」。
2. 成功页面应显示：连接成功 → 表结构已就绪 → `import.sql 导入完成（单事务）` → 各表行数。
   本次导出的预期行数：users 10、user_terrains 15、prayers 14、sessions 25、topups 6（以你上传的文件为准）。
3. 安装是可重复运行的：表已存在不会被改动；`users` 表非空时会**跳过**导入，不会覆盖数据；导入出错会整体回滚。

> 不想用 install.php？也可以在 Navicat / phpMyAdmin 里先运行 `schema.sql`，再运行 `import.sql`（需要先放行你的 IP 并用外网地址连接）。`import.sql` 里每条 INSERT 占一行，字符串中的换行已转义。

## 6. 验证接口（此时用户还看不到变化）

```bash
curl -s http://qifu.laixi.cn/api/config | head -c 200
curl -s http://qifu.laixi.cn/api/me                    # {"user":null,"mode":"local"}
curl -s -X POST http://qifu.laixi.cn/api/login -H 'content-type: application/json' \
     -d '{"username":"qifu_test","password":"你在 config.php 里设置的测试账号密码"}'
```

如果 `/api/config` 返回的是 404 页面或 HTML，说明 URL 重写没生效 → 第 8.2 节。

## 7. 切换前端

接口验证通过后，上传 `index.html` 和 `assets/`（覆盖旧的）。最后上传 `index.html`。
然后用浏览器**强制刷新**（Ctrl+F5）打开 `http://qifu.laixi.cn`，用旧账号登录、签到、祈福各试一次。
已有用户的密码哈希（bcrypt）已导入，旧账号和旧密码可直接登录。注意：旧前端是用浏览器里保存的令牌登录的，新的同域前端改用 Cookie，所以每个用户切换后需要**重新登录一次**。

数据切换提醒：从这一刻起，新注册/充值/祈福都写进 **景安 MySQL**，Turso 不再更新。要避免丢数据，请在导出 `import.sql` 之后、切换之前，尽量不要让别人在 Vercel 版上注册；或者切换前重新导出一次。

## 8. 清理与安全

### 8.1 安装完成后立刻做

通过 FTP **删除**：`api/install.php`、`api/diag.php`、`api/import.sql`。
然后确认下面几个地址都返回 403 / 404（不是内容）：

```
http://qifu.laixi.cn/api/config.php
http://qifu.laixi.cn/api/lib/core.php
http://qifu.laixi.cn/api/schema.sql
http://qifu.laixi.cn/api/install.php
```

### 8.2 如果 `/api/xxx` 不工作（重写失败）

先测：`http://qifu.laixi.cn/api/index.php?path=/config` 能返回 JSON，说明 PHP 没问题，只是主机不支持 `.htaccess`/`web.config` 重写。
这时改用 **查询风格**：上传 `qifu-frontend-query-style.zip` 里的 `index.html` 和 `assets/`（前端请求会变成 `/api/index.php?path=/xxx`），其余不变。
自己构建：`VITE_API_STYLE=query npm run build`（同域，不要设置 `VITE_API_BASE`）。

### 8.3 安全清单

- `INSTALL_SECRET` 至少 16 位随机；装完删除 `install.php`/`diag.php`。
- `config.php` 被 `.htaccess`（Apache）和 `web.config`（IIS）禁止直接访问；即使被访问，它没有任何输出。
- 测试账号 `qifu_test`（能量、福币近似无限）：对外开放前请改 `TEST_ACCOUNT_PASSWORD` 或设 `TEST_ACCOUNT_DISABLED => true`。
- `import.sql` 含用户的 bcrypt 哈希；用完删除，本地的副本也妥善保管。
- 同域部署默认关闭 CORS（`ALLOWED_ORIGINS` 为空数组）。只有让 Vercel 前端调用这个 PHP 接口时才需要配置。
- 限流（同一 IP 登录失败 8 次 / 注册 8 次，10 分钟）存在数据库表 `rate_limits`。如果前面有 CDN/反向代理，才把 `TRUST_PROXY_HEADERS` 设为 `true`（否则用户可伪造 `X-Forwarded-For` 绕过限流）。
- 现在站点是 `http://`：Cookie 不带 `Secure`。将来升级 HTTPS 时无需改代码（会自动加 `Secure`）。
- 定期在景安面板备份数据库。

## 9. 回滚到 Vercel 版

PHP 版不会动 Vercel/Turso 的任何数据。回滚只需要：

1. 用 FTP 把第 3 节备份的旧 `index.html` 和 `assets/` 传回 `WEB/`（旧前端内置了 `https://qifu-tree.vercel.app` 作为 API 地址）。
2. 浏览器强制刷新。
3. `api/` 目录可以保留（无人访问）也可以删除。

注意：切换到 PHP 版之后产生的新用户/数据在 MySQL 里，不会自动回到 Turso。

## 10. 排错

| 现象 | 原因与处理 |
| --- | --- |
| 接口 500，`{"error":"服务器开小差了，请稍后再试"}` | 打开 `config.php` 临时设 `'DEBUG' => true`，再访问 `/api/prayers`，响应里的 `detail` 会写原因（用完改回 `false`）。常见原因：`DB_HOST`/账号错误、没运行 install.php（表不存在）、PHP 缺 `pdo_mysql`。服务器的 PHP 错误日志可在景安面板里查看。 |
| `/api/xxx` 返回 404 页面/HTML | 重写没生效 → 第 8.2 节。Apache 主机确认允许 `.htaccess`；IIS 主机确认有 `web.config` 且启用了 URL Rewrite。 |
| IIS 上出现 500.19 / 500.50 | `web.config` 里的 `<security>` 段被主机锁定：删掉整个 `<security>...</security>` 再试（`config.php` 本身无输出，仍然安全）；或直接用查询风格。 |
| `DB 连接失败 / No such file or directory / Connection refused / Access denied` | `DB_HOST` 不要用 `localhost`（景安没有本机 socket），改成面板的外网地址；确认库名、用户名带全；密码里有特殊字符时不要多加引号。 |
| 数据库报 `Specified key was too long` | 本项目已避免（所有唯一索引 ≤ 767 字节）。若你自己改过表，请保持 `username_key` 等为 `VARCHAR(64)` 以内。 |
| 中文乱码 | `config.php`、`schema.sql` 必须是 UTF-8；表都是 `utf8mb4`。FTP 请用二进制模式。 |
| 登录后刷新又掉线 | 浏览器禁用 Cookie，或前端和接口不同域（此时前端需用 `VITE_API_BASE` 构建，走 Bearer 令牌，并在 `ALLOWED_ORIGINS` 里加入前端域名）。 |
| 一直提示「操作过于频繁 / 尝试次数过多」 | 命中限流（同 IP 10 分钟内）。等待 10 分钟，或在数据库里 `DELETE FROM rate_limits`。 |
| 前端提示「请求超时」 | 前端 12 秒超时；GET 请求会自动重试 2 次，POST（登录/注册/祈福）不会重试。注册超时后请先用同账号「登录」确认是否已成功。 |
| `Call to undefined function xxx()` | 该函数被主机的 `disable_functions` 禁用。最新版已对所有可选函数做了兼容；请确认上传的是最新版文件，并用 `diag.php` 查看被禁用的函数列表，把结果反馈给我们。 |
| `install.php` 报 403 | 口令不对，或 `config.php` 里 `INSTALL_SECRET` 少于 12 位。 |
| 看不到 `.htaccess` | FTP 客户端要开启「显示隐藏文件」。 |
| `Authorization` 头收不到 | `.htaccess` 已包含修复规则；诊断页会显示。同域 Cookie 登录不依赖它，只有跨域 Bearer 才需要。 |

诊断页 `diag.php` 不使用 `phpinfo()`，不泄漏配置内容，数据库部分需要口令；排障完请删除。

## 11. 支付宝充值（可选；不配置就继续用模拟充值）

### 11.1 它是怎么工作的

| 场景 | 支付产品 | 流程 |
| --- | --- | --- |
| 手机浏览器 | 手机网站支付 `alipay.trade.wap.pay` | 点档位 → 自动跳到支付宝 App / 收银台 → 付款 → 回到站点 → 站点查单入账并播放到账特效 |
| 电脑浏览器（默认 `ALIPAY_PC_MODE = 'qr'`） | 当面付 `alipay.trade.precreate` | 点档位 → 弹窗里显示支付宝二维码 → 手机扫码付款 → 弹窗每 2.5 秒轮询订单，付款成功自动到账 |
| 电脑浏览器（`ALIPAY_PC_MODE = 'page'`） | 电脑网站支付 `alipay.trade.page.pay` | 点档位 → 当前页跳到支付宝收银台 → 付款 → 回到站点查单 |

- 福币**只在服务器收到并验证过支付宝的付款结果后**才增加：异步通知（notify）验签 + 校验金额与 `app_id`，或服务器主动 `alipay.trade.query` 查单（响应同样验签）。浏览器回跳（return）本身不会直接加币。
- 通知、查单、回跳可能同时到达，入账在数据库事务里对订单行加锁，**同一笔订单只会加一次福币**。
- 订单表 `pay_orders`（待支付 `pending` / 已支付 `paid` / 已关闭 `closed`，记录用户、档位、金额、支付宝交易号）。首次下单时程序会自动 `CREATE TABLE IF NOT EXISTS`，也包含在 `schema.sql` 里；不需要为此重新运行 `install.php`。
- **没有填任何支付宝配置** = 继续模拟充值（点击即到账）。**只要填了 `ALIPAY_APP_ID` 或任一密钥项**，模拟充值接口就会被关闭；配置填了一半时支付显示「暂未开放」，不会退回成免费到账。
- 不依赖 Composer / 第三方 SDK：只用 PHP 的 `openssl`，以及 `curl`（没有 curl 时自动改用 `allow_url_fopen` 的 stream）。

### 11.2 在支付宝开放平台准备

1. 在 [open.alipay.com](https://open.alipay.com) 创建「网页&移动应用」，拿到 **APPID**。
2. 在应用里添加并签约产品：手机端需要「手机网站支付」；电脑端按 `ALIPAY_PC_MODE` 选「当面付」或「电脑网站支付」。
3. 设置签名：用开放平台的「密钥工具」生成 RSA2(SHA256) 密钥对，把**应用公钥**上传到应用，平台会给出**支付宝公钥**。
   - 应用**私钥**只放在服务器的 `config.php` 里，不要发给任何人、不要提交 Git。
   - 如果用证书模式：下载 *应用公钥证书*、*支付宝公钥证书*、*支付宝根证书* 三个文件，见下面 `ALIPAY_CERT_MODE`。
4. 在应用的「开发设置」里把下面两个地址原样填进去（站点目前不支持 URL 重写，所以是查询式路由，**两个地址已固定，不要改路径**）：

   ```
   异步通知（notify）  http://qifu.laixi.cn/api/index.php?path=/pay/alipay/notify
   同步返回（return）  http://qifu.laixi.cn/api/index.php?path=/pay/alipay/return
   ```

   - 以后站点升级 HTTPS，就把两处都改成 `https://`，`config.php` 里的 `ALIPAY_NOTIFY_URL` / `ALIPAY_RETURN_URL` 同步修改。
   - notify 必须能被支付宝服务器从公网访问：不能要求登录，不要被主机的防火墙 / CC 防护 / 访问口令拦住。成功时本接口只输出纯文本 `success`。

### 11.3 `config.php` 要填的项

在服务器上的 `api/config.php` 里追加（模板见 `api/config.sample.php`）：

| 配置项 | 说明 |
| --- | --- |
| `ALIPAY_APP_ID` | 应用 APPID（沙箱就用沙箱应用的 APPID） |
| `ALIPAY_PRIVATE_KEY` | 应用私钥。PEM 全文，或只填去掉头尾的那一长串 base64（PKCS1 / PKCS8 都支持） |
| `ALIPAY_PUBLIC_KEY` | **支付宝公钥**（不是应用公钥）。格式同上 |
| `ALIPAY_PRIVATE_KEY_PATH` / `ALIPAY_PUBLIC_KEY_PATH` | 可选：改为从文件读取，填绝对路径。**文件必须放在网站目录（WEB）之外**，景安不支持 `.htaccess`，网站目录里的 `.pem` 可能被直接下载 |
| `ALIPAY_CERT_MODE` | `true` 启用证书模式：用下面三个证书文件代替 `ALIPAY_PUBLIC_KEY`；应用私钥仍用 `ALIPAY_PRIVATE_KEY` |
| `ALIPAY_APP_CERT_PATH` / `ALIPAY_PUBLIC_CERT_PATH` / `ALIPAY_ROOT_CERT_PATH` | 应用公钥证书 / 支付宝公钥证书 / 支付宝根证书的路径，如 `__DIR__ . '/cert/alipayRootCert.crt'`（三者都是公开证书，不含私钥） |
| `ALIPAY_SANDBOX` | `true` = 沙箱网关 `openapi-sandbox.dl.alipaydev.com`；`false` = 正式网关 `openapi.alipay.com` |
| `ALIPAY_GATEWAY` | 可选：手动指定网关，留空按沙箱开关自动选 |
| `ALIPAY_NOTIFY_URL` / `ALIPAY_RETURN_URL` | 默认就是 11.2 里的两个地址（可改为 https） |
| `ALIPAY_PC_MODE` | `'qr'`（默认，当面付扫码）或 `'page'`（电脑网站支付跳转） |
| `PAY_TEST_PRICES` | 测试价开关，默认 `false`（正式价 1 / 5 / 10 元）。`true` = 三个档位实付改为 0.01 / 0.02 / 0.03 元，福币数量不变，见 11.9 |
| `ALIPAY_ORDER_TIMEOUT` | 订单有效期，默认 `30m` |
| `ALIPAY_SELLER_ID` | 可选：收款账号 PID（2088 开头），填了会在通知里多校验一项 |
| `ALIPAY_SSL_VERIFY` | 默认 `true`；仅当主机 CA 过旧连不上网关时才临时改 `false`（响应依然会用支付宝公钥验签） |

示例（密钥为占位，不是真的）：

```php
'ALIPAY_APP_ID' => '2021000000000000',
'ALIPAY_PRIVATE_KEY' => 'MIIEvQIBADANBgkqhkiG9w0BAQEFAASC...（应用私钥，一整串）',
'ALIPAY_PUBLIC_KEY' => 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A...（支付宝公钥，一整串）',
'ALIPAY_SANDBOX' => true,
```

### 11.4 需要上传的文件清单

在 `qifu-php-site.zip` 里，相对第 3 节的旧版本，**新增或有变化**的文件：

| 文件 | 说明 |
| --- | --- |
| `api/lib/game.php` | 变更：充值档位价格随 `PAY_TEST_PRICES` 开关切换（测试价版本新增的改动） |
| `api/lib/alipay.php` | **新增**：签名 / 验签 / 下单 / 查单 / 通知 / 入账 |
| `api/lib/app.php` | 变更：新增 `/pay/*` 路由；已启用支付宝时关闭模拟充值 |
| `api/index.php` | 变更：加载 `lib/alipay.php` |
| `api/lib/schema.sql`、`schema.sql` | 变更：新增 `pay_orders` 表（运行时也会自动建表） |
| `api/diag.php` | 变更：多一段「支付宝」诊断（用完请删除） |
| `api/install.php` | 变更：安装时加载支付宝库（已经装好、已删除的话可以不传） |
| `api/.htaccess`、`api/web.config` | 变更：额外禁止下载 `.key` / `.pem` |
| `api/config.sample.php` | 变更：新增 `ALIPAY_*` 配置项模板（仅供参考，**不要覆盖线上的 `api/config.php`**） |
| `index.html`、`assets/*` | 变更：前端商店支持手机跳转 / 电脑扫码。**景安不支持 URL 重写，请上传 `qifu-frontend-query-style.zip` 里的 `index.html` 和 `assets/`（查询风格，请求形如 `/api/index.php?path=/xxx`）**，不要用 `qifu-php-site.zip` 里那份 REST 风格前端；上传后可删除旧的 `assets/index-*.js` / `*.css` |

**不要上传 / 覆盖**：线上的 `api/config.php`（里面有数据库密码和支付宝私钥）。把 `ALIPAY_*` 追加进去即可。

推荐顺序：

1. 先用 FTP 备份线上的 `index.html`、`assets/`、`api/`。
2. 上传 `api/`（不含 `config.php`），再上传查询风格前端的 `index.html` 和 `assets/`。此时没有 `ALIPAY_*` 配置，充值仍是模拟模式，用户感知不到变化。
3. 编辑线上 `api/config.php`，追加 `ALIPAY_*`（先用沙箱配置，见 11.5）。
4. 打开 `http://qifu.laixi.cn/api/diag.php`，「支付宝」一段应显示：openssl OK、支付模式「支付宝（沙箱）」、支付配置 OK、notify/return 地址与 11.2 一致。
5. 浏览器访问 `http://qifu.laixi.cn/api/index.php?path=/pay/info` 应返回 `{"mode":"alipay","ready":true,...}`；访问 `http://qifu.laixi.cn/api/index.php?path=/pay/alipay/notify`（GET，无参数）应只显示纯文本 `fail`——说明路由和纯文本输出都正常（真正的通知是 POST）。

### 11.5 在沙箱里测试

1. 开放平台 → 开发者中心 → 沙箱：拿到沙箱 **APPID**、沙箱应用私钥/公钥配置，以及**支付宝公钥**，另有「沙箱买家账号」（账号和支付密码，余额是虚拟的）。
2. `config.php`：`ALIPAY_SANDBOX => true`，填沙箱 APPID、你的应用私钥、沙箱的支付宝公钥。沙箱建议用密钥模式（`ALIPAY_CERT_MODE => false`）。
3. 在沙箱应用里把 notify / return 地址填成 11.2 里的两个地址（沙箱通知同样会请求你的真实域名）。
4. 最容易的测法：`'ALIPAY_PC_MODE' => 'page'`，在电脑浏览器点档位，跳到沙箱收银台后用「沙箱买家账号」登录付款，付完点回商户，站点会自动到账并播放特效。
   手机浏览器测手机网站支付：同样会打开沙箱收银台页面，用买家账号付款即可（沙箱 App 仅在安卓上可用，不装也能走网页收银台）。
   二维码模式（`'qr'`）需要安装「沙箱版支付宝 App」扫码。
5. 检查到账：`pay_orders` 里该订单 `status = 'paid'`、`trade_no` 有值，`topups` 多一条，用户福币 +档位数。
6. 验证幂等：在沙箱后台重发同一笔通知，或刷新 return 页面，福币不会再增加。
7. 沙箱通过后：`ALIPAY_SANDBOX => false`，换成正式 APPID / 私钥 / 支付宝公钥，在正式应用里填同样的两个地址，用最低档（¥1）真实付一笔小额测试。

### 11.6 补单与排错

- **用户付了款但福币没增加**：用户刷新页面或再次打开商店，前端会自动调用补单接口（`POST /pay/alipay/recheck`），服务器会重新向支付宝查询该用户最近 48 小时内所有未支付订单并入账。也可以让用户重新登录一次。
- 运营侧手动核对：`SELECT out_trade_no, user_id, amount_cents, status, trade_no, FROM_UNIXTIME(created_at/1000) FROM pay_orders ORDER BY id DESC LIMIT 20;`。
- 日志：`[qifu] alipay ...` 开头的行在 PHP 错误日志里（景安面板可查看）。把 `DEBUG` 临时设为 `true`，下单失败时响应的 `detail` 会带原因。

| 现象 | 原因与处理 |
| --- | --- |
| 点档位提示「支付暂未开放」 | `diag.php` 的「支付配置」会列出缺什么：常见是漏填 `ALIPAY_PUBLIC_KEY`、把应用公钥当成了支付宝公钥、私钥格式被复制坏（多了引号 / 少了一段） |
| 下单失败，日志里有 `isv.invalid-signature` / 验签失败 | 应用私钥与上传到开放平台的应用公钥不是一对；或沙箱 / 正式环境的 APPID、网关、密钥混用了 |
| 日志 `联系支付宝网关失败` | 主机访问不了外网（防火墙）、curl / allow_url_fopen 都被禁用，或 CA 证书过旧（可临时 `ALIPAY_SSL_VERIFY => false`） |
| 支付宝后台显示通知失败 | 打开 notify 地址（GET）看是不是纯文本 `fail`；若是 404 / HTML 说明路径写错。POST 通知失败请看 PHP 日志：`验签失败`（支付宝公钥不对）、`app_id 不匹配`、`金额与订单不符` |
| 付款后回到站点但没到账 | 稍等几秒（页面会自动确认）；仍未到账看 `pay_orders.status` 与日志；notify 不通时由查单补上 |
| 想退款 | 在支付宝商户后台退款；程序**不会**自动扣回已发放的福币，需要人工处理 |
| 提示「微信内无法唤起支付宝」 | 微信内置浏览器会拦截支付宝；请在系统浏览器里打开站点 |

### 11.7 安全要点

- 私钥只在服务器的 `config.php`（PHP 文件，被直接访问时没有任何输出）里；不要把它写进前端、Git、聊天记录。
- 签名只接受 RSA2（拒绝 RSA/SHA1 降级）；通知必须同时通过：验签、`app_id`、（可选）`seller_id`、订单存在、金额与订单一致。
- 网关响应（预下单、查单）同样先验签再信任；响应被篡改或金额不符一律不入账。
- 订单查询接口要求登录且只能查自己的订单；同一订单对支付宝的查询有 4 秒节流。

### 11.8 自动化测试（开发者）

```bash
# 需要一个可被清空的 MySQL/MariaDB 测试库，不使用任何真实密钥
export QIFU_DB_HOST=127.0.0.1 QIFU_DB_NAME=qifu_test QIFU_DB_USER=... QIFU_DB_PASS=...
npm run test:pay
# 在函数被禁用的环境下再跑一遍：
PHP_DISABLE_FUNCTIONS="set_time_limit,ini_set,getenv,curl_init,curl_exec" npm run test:pay
```

测试用临时生成的 RSA 密钥伪造「支付宝」的通知与网关响应，覆盖：验签通过 / 签名错误 / 金额被改 / `app_id` 不符 / `sign_type` 降级、重复与 10 路并发通知只入账一次、通知 + 查单 + return 同时到达、补单接口、网关响应被篡改、订单归属、模拟充值回退与关闭。

### 11.9 测试价 / 改回正式价（`PAY_TEST_PRICES`）

真实支付联调时，可以把三个充值档位的实付金额临时降到几分钱，**福币奖励数量不变**：

| 档位 | 正式价（默认） | 测试价 | 福币 |
| --- | --- | --- | --- |
| 小福包（`p1`） | ¥1 | ¥0.01 | 60 |
| 中福包（`p5`） | ¥5 | ¥0.02 | 330 |
| 大福包（`p10`） | ¥10 | ¥0.03 | 1180 |

- **开启**：在线上 `api/config.php` 里加一行 `'PAY_TEST_PRICES' => true,`（放在数组最后一项之后、结尾的 `];` 之前）。保存后立刻生效，不需要重新上传其它文件。
- **改回正式价**：把这一行改成 `'PAY_TEST_PRICES' => false,` 或直接删掉这一行（默认就是 `false`），**只改 `config.php`，不需要重新发版 / 重传任何文件**。联调完务必改回，否则用户只付几分钱就能拿到全部福币。
- 这个开关是全站统一的：`/config` 接口、商店里显示的价格（开启时商店顶部会多一条「测试价」提示）、下单金额、`wap.pay` / `precreate` 的 `total_amount`、notify 与查单的金额核对，用的都是同一套价格。
- 订单创建时金额就记在 `pay_orders.amount_cents` 里，通知和查单都按**订单自己的金额**核对。所以切换开关不会影响已经创建的订单：开启测试价前下的 ¥1 订单，仍然要付 ¥1 才会入账；改回正式价前下的 0.01 元订单，付 0.01 元也能正常入账。切换后建议让用户重新点档位下新单，别继续付旧订单。
- 支付宝单笔最小金额是 0.01 元，所以最低档就是 0.01；沙箱和正式环境都适用。
- 验证：打开 `http://qifu.laixi.cn/api/index.php?path=/config`，`packs` 里的 `price` 应为 `0.01 / 0.02 / 0.03`（改回后是 `1 / 5 / 10`），`coins` 始终是 `60 / 330 / 1180`；`/pay/info` 里的 `testPrices` 也会显示 `true` / `false`。
- 开着测试价期间，**不要向普通用户开放**。

### 11.10 正式价格表与已有数据

当前正式价格（`api/lib/game.php` 里是 PHP 版的唯一来源，Node 版对应 `shared/game.ts`，两处必须一致，`npm run test:parity` 会比对）：

| 项目 | 价格 / 效果 |
| --- | --- |
| 充值 小福包（`p1`） | ¥1 → 60 福币 |
| 充值 中福包（`p5`） | ¥5 → 330 福币 |
| 充值 大福包（`p10`） | ¥10 → 1180 福币 |
| 5 种地貌解锁（山巅云海、竹林溪谷、江南水乡、大漠孤烟、雪山寒林） | 每个 888 福币；首次随机分配的初始地貌视为已拥有，已拥有的地貌切换免费 |
| 平安木牌 | 30 能量 |
| 红绸福带 | 58 能量 |
| 金色福牌 | 28 福币 |
| 祈福灯（夜间发光） | 68 福币 |
| 莲花灯（夜间发光） | 88 福币 |
| 所有祈福牌的返还能量 | 0（成长权重、发光等其它字段不变） |

对已有数据的影响：

- **用户的能量、福币余额、已祈福的牌、已拥有的地貌**都不变，只是之后按新价格消费。已经解锁的地貌继续免费切换。
- **充值档位 id 换成了 `p1` / `p5` / `p10`**，旧的 `p6` / `p30` / `p98` 不再可用（模拟充值接口会返回「请选择充值档位」）。旧版前端缓存的页面请强制刷新（Ctrl+F5）。
- **历史订单与流水**（`topups`、`pay_orders`）原样保留，里面仍是旧 id、旧金额和当时发放的福币。上线时刻还没付款的旧订单（`pending`）仍按**订单自己记录的金额和福币**核对入账：付款成功就按当时的订单给福币，不会按新价格重算。
- 祈福牌的返还能量改为 0 后，历史上已发放的能量不回收。
