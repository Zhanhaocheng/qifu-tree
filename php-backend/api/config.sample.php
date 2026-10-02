<?php
// 复制本文件为 config.php 并填写真实值。config.php 不要提交到 Git，也不要公开。
if (!defined('QIFU')) { http_response_code(403); exit; }

return [
    // ---- MySQL（在景安控制面板「数据库」里创建后，按面板显示的信息填写）----
    // DB_HOST：
    //   - 景安虚拟主机实测：'localhost' 会走本机 socket，主机上没有 -> 连接失败；
    //     请直接填面板里的数据库地址（外网地址，形如 xxxx.dnstoo.com），主机内的 PHP 可以直接连它。
    //   - 其它主机：先试 'localhost'，不行再试面板里的「内网地址」。
    //   - 外网地址同样可供你本机的 Navicat/命令行远程连接（通常要先在面板里放行你的出口 IP）。
    'DB_HOST' => 'xxxx.dnstoo.com',
    'DB_PORT' => 3306,
    'DB_NAME' => '',
    'DB_USER' => '',
    'DB_PASS' => '',

    // 签到「今天」的时区
    'TIMEZONE' => 'Asia/Shanghai',

    // install.php / diag.php 的口令：至少 12 位的随机字符串。装完后请删除这两个文件。
    'INSTALL_SECRET' => '',

    // ---- 内置测试账号（能量、福币近似无限）----
    // 正式对外开放前，请改掉默认密码，或把 TEST_ACCOUNT_DISABLED 设为 true
    'TEST_ACCOUNT_DISABLED' => false,
    'TEST_ACCOUNT_USER' => 'qifu_test',
    'TEST_ACCOUNT_PASSWORD' => 'Qifu@Test2026',

    // 同域部署（前端和 /api 在同一个域名）时保持空数组 = 关闭 CORS。
    // 只有前端放在别的域名（例如 Vercel）时才需要，例如 ['https://qifu-tree.vercel.app']
    'ALLOWED_ORIGINS' => [],

    // 只有站点前面有可信的反向代理/CDN 时才设为 true（此时用 X-Forwarded-For 取客户端 IP 做限流）
    'TRUST_PROXY_HEADERS' => false,

    // /api/me 与 /api/config 返回的 mode（local 表示正式存储；demo 会让前端显示演示提示条）
    'MODE' => 'local',

    // ---- 支付宝充值 ----
    // 全部留空 = 沿用「模拟充值」（点击即到账，不收钱）。只要填了 APP_ID / 密钥中的任何一项，
    // 就切换为真实支付并关闭模拟充值（配置填一半时支付不可用，而不是退回模拟，避免白送福币）。
    // 私钥是机密：只写在服务器上的 config.php 里，不要提交到 Git、不要发给别人。
    'ALIPAY_APP_ID' => '',            // 开放平台应用 APPID（沙箱用沙箱应用的 APPID）
    // 应用私钥（RSA2）。可以填 PEM（含 -----BEGIN ...----- 头尾），也可以只填去掉头尾的那一长串 base64；PKCS1 / PKCS8 都行。
    'ALIPAY_PRIVATE_KEY' => '',
    // 或者把私钥放在网站目录「之外」的文件里，这里填绝对路径（景安不支持 .htaccess，放在 WEB 目录内的文件可能被直接下载！）
    'ALIPAY_PRIVATE_KEY_PATH' => '',
    // 支付宝公钥（在开放平台「查看支付宝公钥」，注意不是应用公钥）。格式同上。
    'ALIPAY_PUBLIC_KEY' => '',
    'ALIPAY_PUBLIC_KEY_PATH' => '',

    // 证书模式（可选）：设为 true 后改用下面三个证书文件，不再使用 ALIPAY_PUBLIC_KEY。
    // 三个都是公开证书（不含私钥），可以放在 api/cert/ 下；应用私钥仍然用 ALIPAY_PRIVATE_KEY。
    'ALIPAY_CERT_MODE' => false,
    'ALIPAY_APP_CERT_PATH' => '',     // 应用公钥证书，如 __DIR__ . '/cert/appCertPublicKey_2021xxxx.crt'
    'ALIPAY_PUBLIC_CERT_PATH' => '',  // 支付宝公钥证书，如 .../alipayCertPublicKey_RSA2.crt
    'ALIPAY_ROOT_CERT_PATH' => '',    // 支付宝根证书，如 .../alipayRootCert.crt

    // 沙箱开关：true 时使用沙箱网关（https://openapi-sandbox.dl.alipaydev.com/gateway.do），APPID/密钥也要换成沙箱应用的。
    'ALIPAY_SANDBOX' => false,
    // 网关地址，留空 = 按沙箱开关自动选择（正式 https://openapi.alipay.com/gateway.do）
    'ALIPAY_GATEWAY' => '',

    // 异步通知 / 同步返回地址。这两个地址要原样填进支付宝开放平台后台（应用 -> 开发设置）。
    // 主机不支持 URL 重写，所以必须是查询式路由，路径固定为 /pay/alipay/notify 与 /pay/alipay/return。
    // 升级 HTTPS 后把 http 改成 https 即可（两处都要改，后台也要同步）。
    'ALIPAY_NOTIFY_URL' => 'http://qifu.laixi.cn/api/index.php?path=/pay/alipay/notify',
    'ALIPAY_RETURN_URL' => 'http://qifu.laixi.cn/api/index.php?path=/pay/alipay/return',

    // 电脑端支付方式：'qr' = 当面付 precreate，页面里直接显示二维码（默认，需要开通「当面付」）；
    //                'page' = 电脑网站支付 page.pay，跳转到支付宝收银台（需要开通「电脑网站支付」）。手机端固定用手机网站支付 wap.pay。
    'ALIPAY_PC_MODE' => 'qr',
    // 真实支付联调用的测试价：true 时三个充值档位的实付金额临时改为 0.01 / 0.02 / 0.03 元（福币数量不变），
    // /config、商店显示、下单、通知金额核对全部随之变化。联调完把它删掉或改回 false = 正式价 1 / 5 / 10 元，不需要重新发版。
    // 已创建的订单金额不会变（按下单当时的价格核对）。
    'PAY_TEST_PRICES' => false,
    // 订单超时（如 30m、2h、1d）
    'ALIPAY_ORDER_TIMEOUT' => '30m',
    // 可选：收款账号 PID（2088 开头），填了会在通知里额外校验 seller_id
    'ALIPAY_SELLER_ID' => '',
    // 访问支付宝网关时校验 HTTPS 证书。只有主机 CA 证书过旧导致无法联网时才临时改 false（响应仍会用支付宝公钥验签）
    'ALIPAY_SSL_VERIFY' => true,

    // true 时 500 错误会在 JSON 的 detail 字段里带上原因，排障用，排完请改回 false
    'DEBUG' => false,
];
