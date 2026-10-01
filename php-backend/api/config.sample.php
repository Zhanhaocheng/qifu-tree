<?php
// 复制本文件为 config.php 并填写真实值。config.php 不要提交到 Git，也不要公开。
if (!defined('QIFU')) { http_response_code(403); exit; }

return [
    // ---- MySQL（在景安控制面板「数据库」里创建后，按面板显示的信息填写）----
    // DB_HOST 有两种写法，按顺序试：
    //   1) PHP 和 MySQL 在同一台主机（网站上线后的正常情况）：先试 'localhost'；
    //      不行就填面板里写的「内网地址/数据库服务器地址」。
    //   2) 面板给的外网地址（形如 xxxx.dnstoo.com）：用于你本机的 Navicat/命令行等远程连接，
    //      通常要先在面板里放行你的出口 IP；网站里的 PHP 也可以填它，但可能更慢。
    'DB_HOST' => 'localhost',
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

    // true 时 500 错误会在 JSON 的 detail 字段里带上原因，排障用，排完请改回 false
    'DEBUG' => false,
];
