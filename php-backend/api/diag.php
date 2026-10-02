<?php
// 只读诊断页（不使用 phpinfo）。排障完成后请删除本文件。
define('QIFU', 1);
require __DIR__ . '/lib/core.php';
require __DIR__ . '/lib/alipay.php';
q_harden_runtime();
header('Content-Type: text/plain; charset=UTF-8');
header('Cache-Control: no-store');
header('X-Robots-Tag: noindex');

$line = static function ($k, $v) { echo str_pad($k, 28) . $v . "\n"; };
$yn = static function ($b) { return $b ? 'OK' : '缺失'; };

echo "== 祈福树 PHP 诊断 ==\n";
$line('PHP 版本', PHP_VERSION . (version_compare(PHP_VERSION, '7.4.0', '>=') ? '  (OK, 需要 >= 7.4，推荐 8.1)' : '  (过低，需要 >= 7.4)'));
$line('SAPI', PHP_SAPI);
$disabled = (string) q_call('ini_get', 'disable_functions');
$line('disable_functions', $disabled === '' ? '(空或无法读取)' : $disabled);
$line('open_basedir', (string) q_call('ini_get', 'open_basedir') ?: '(无)');
$needed = ['set_time_limit', 'ini_set', 'ini_get', 'error_reporting', 'getenv', 'header_remove', 'getallheaders', 'usleep', 'sleep', 'random_bytes', 'ob_start', 'error_log', 'ctype_digit', 'mb_strtolower'];
$missing = array_values(array_filter($needed, static function ($f) { return !q_fn($f); }));
$line('不可用的可选函数', $missing ? implode(', ', $missing) . '  （程序已自动兼容，不影响使用）' : '无');
$line('pdo_mysql', $yn(extension_loaded('pdo_mysql')));
$line('mbstring (可选)', extension_loaded('mbstring') ? 'OK' : '缺失（可用，不影响）');
$line('json', $yn(extension_loaded('json')));
$line('pcre /u 支持', $yn(@preg_match('/\p{L}/u', 'a') === 1));
$line('bcrypt', $yn(defined('PASSWORD_BCRYPT') && function_exists('password_hash')));
$line('random_bytes', $yn(function_exists('random_bytes')));
$line('时区数据 Asia/Shanghai', $yn(in_array('Asia/Shanghai', DateTimeZone::listIdentifiers(), true)));
$line('config.php 存在', $yn(@is_file(__DIR__ . "/config.php") || @is_file(dirname(__DIR__, 2) . "/qifu-config.php")));
$line('lib/ 存在', $yn(@is_dir(__DIR__ . "/lib")));
$line('服务器软件', (string) ($_SERVER['SERVER_SOFTWARE'] ?? '?'));
$line('REQUEST_URI', (string) ($_SERVER['REQUEST_URI'] ?? '?'));
$line('SCRIPT_NAME', (string) ($_SERVER['SCRIPT_NAME'] ?? '?'));
$line('PATH_INFO', (string) ($_SERVER['PATH_INFO'] ?? '(无)'));
$line('X-Original-URL (IIS)', (string) ($_SERVER['HTTP_X_ORIGINAL_URL'] ?? '(无)'));
$line('解析出的 API 路径', q_route_path());
$line('收到 Authorization 头', q_header('authorization') !== '' ? '是（令牌可用）' : '否（用 curl -H "Authorization: Bearer x" 测试；同域 Cookie 登录不受影响）');
$line('HTTPS', q_is_https() ? '是' : '否');

echo "\n== 支付宝 ==\n";
$line('openssl 扩展', $yn(extension_loaded('openssl') && q_fn('openssl_sign')));
$line('curl 扩展', extension_loaded('curl') && q_fn('curl_init') ? 'OK' : '缺失（改用 stream；需要 allow_url_fopen）');
$line('allow_url_fopen', q_call('ini_get', 'allow_url_fopen') ? 'On' : 'Off');
$line('支付模式', q_pay_mode() === 'demo' ? '模拟充值（未配置支付宝）' : '支付宝' . (q_cfg_bool('ALIPAY_SANDBOX') ? '（沙箱）' : '（正式）') . (q_ali_cert_mode() ? ' / 证书模式' : ' / 密钥模式'));
if (q_pay_mode() === 'alipay') {
    $problems = q_ali_problems();
    $line('支付配置', $problems ? '有问题' : 'OK');
    foreach ($problems as $pr) {
        echo "  - $pr\n";
    }
    $line('网关', q_ali_gateway());
    $line('notify 地址', q_ali_notify_url());
    $line('return 地址', q_ali_return_url());
}

echo "\n路由测试：访问 /api/config 应返回 JSON；若返回 404 页面或 HTML，说明重写未生效，\n";
echo "请改用查询风格：/api/index.php?path=/config （并用 VITE_API_STYLE=query 重新构建前端）。\n";

$secret = (string) q_cfg('INSTALL_SECRET', '');
if (strlen($secret) >= 12 && isset($_GET['key']) && hash_equals($secret, (string) $_GET['key'])) {
    echo "\n== 数据库（已验证口令）==\n";
    require __DIR__ . '/lib/db.php';
    try {
        $pdo = q_pdo();
        $line('数据库连接', 'OK');
        $line('MySQL 版本', (string) $pdo->getAttribute(PDO::ATTR_SERVER_VERSION));
        foreach (['users', 'user_terrains', 'prayers', 'sessions', 'topups', 'pay_orders', 'rate_limits', 'meta'] as $t) {
            try {
                $line("表 $t", (int) $pdo->query("SELECT COUNT(*) FROM `$t`")->fetchColumn() . ' 行');
            } catch (Throwable $e) {
                $line("表 $t", '不存在（请运行 install.php）');
            }
        }
    } catch (Throwable $e) {
        $line('数据库连接', '失败：' . $e->getMessage());
        if (strpos($e->getMessage(), 'No such file') !== false || strpos($e->getMessage(), '[2002]') !== false) {
            echo "提示：DB_HOST 为 localhost 时 PHP 会走本机 socket，很多虚拟主机没有；请改成面板里的数据库地址（例如 xxxx.dnstoo.com）。\n";
        }
    }
} else {
    echo "\n（数据库检查：在地址后加 ?key=你的INSTALL_SECRET）\n";
}
