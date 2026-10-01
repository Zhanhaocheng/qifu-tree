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
| FTP 账号 | 景安给你的 FTP 地址、账号、密码；网站目录通常叫 `WEB`（或 `wwwroot`） |
| MySQL 信息 | 面板里的数据库地址、库名、用户名、密码 |

## 1. 准备数据库

在景安控制面板的「数据库」里确认已有一个 **空的** MySQL 库（库名、用户名、密码都记下来）。

数据库地址有两种：

- **外网地址**（形如 `2295.dnstoo.com`）：给你电脑上的 Navicat / 命令行远程连接用，通常要先在面板里放行你的出口 IP。
- **主机内部连接**：网站上线后，PHP 和 MySQL 在景安机房内部。`config.php` 里的 `DB_HOST` 依次试：
  1. `localhost`
  2. 面板写的「内网地址 / 数据库服务器」
  3. 外网地址（也能用，只是更慢）

本项目的表结构已在真实的 **MySQL 5.6.51**（`innodb_large_prefix=OFF`，即最严格的索引长度限制）上验证过：不使用 JSON 类型、窗口函数、CTE、生成列，所有唯一索引都在 767 字节以内。

## 2. 填配置

1. 解压 `qifu-php-site.zip`。
2. 把 `api/config.sample.php` 复制一份，改名 `api/config.php`，用记事本（UTF-8，无 BOM）填：

   ```php
   'DB_HOST' => 'localhost',        // 见第 1 节
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
| `DB 连接失败 / Connection refused / Access denied` | 换 `DB_HOST`（`localhost` / 内网地址 / 外网地址）；确认库名、用户名带全；密码里有特殊字符时不要多加引号。 |
| 数据库报 `Specified key was too long` | 本项目已避免（所有唯一索引 ≤ 767 字节）。若你自己改过表，请保持 `username_key` 等为 `VARCHAR(64)` 以内。 |
| 中文乱码 | `config.php`、`schema.sql` 必须是 UTF-8；表都是 `utf8mb4`。FTP 请用二进制模式。 |
| 登录后刷新又掉线 | 浏览器禁用 Cookie，或前端和接口不同域（此时前端需用 `VITE_API_BASE` 构建，走 Bearer 令牌，并在 `ALLOWED_ORIGINS` 里加入前端域名）。 |
| 一直提示「操作过于频繁 / 尝试次数过多」 | 命中限流（同 IP 10 分钟内）。等待 10 分钟，或在数据库里 `DELETE FROM rate_limits`。 |
| 前端提示「请求超时」 | 前端 12 秒超时；GET 请求会自动重试 2 次，POST（登录/注册/祈福）不会重试。注册超时后请先用同账号「登录」确认是否已成功。 |
| `install.php` 报 403 | 口令不对，或 `config.php` 里 `INSTALL_SECRET` 少于 12 位。 |
| 看不到 `.htaccess` | FTP 客户端要开启「显示隐藏文件」。 |
| `Authorization` 头收不到 | `.htaccess` 已包含修复规则；诊断页会显示。同域 Cookie 登录不依赖它，只有跨域 Bearer 才需要。 |

诊断页 `diag.php` 不使用 `phpinfo()`，不泄漏配置内容，数据库部分需要口令；排障完请删除。
