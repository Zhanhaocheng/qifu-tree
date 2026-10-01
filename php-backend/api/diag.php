<?php
// 只读诊断页（不使用 phpinfo）。排障完成后请删除本文件。
define('QIFU', 1);
error_reporting(E_ALL);
ini_set('display_errors', '0');
header('Content-Type: text/plain; charset=UTF-8');
header('Cache-Control: no-store');
header('X-Robots-Tag: noindex');

require __DIR__ . '/lib/core.php';

$line = static function ($k, $v) { echo str_pad($k, 28) . $v . "\n"; };
$yn = static function ($b) { return $b ? 'OK' : '缺失'; };

echo "== 祈福树 PHP 诊断 ==\n";
$line('PHP 版本', PHP_VERSION . (version_compare(PHP_VERSION, '7.4.0', '>=') ? '  (OK, 需要 >= 7.4，推荐 8.1)' : '  (过低，需要 >= 7.4)'));
$line('SAPI', PHP_SAPI);
$line('pdo_mysql', $yn(extension_loaded('pdo_mysql')));
$line('mbstring (可选)', extension_loaded('mbstring') ? 'OK' : '缺失（可用，不影响）');
$line('json', $yn(extension_loaded('json')));
$line('pcre /u 支持', $yn(@preg_match('/\p{L}/u', 'a') === 1));
$line('bcrypt', $yn(defined('PASSWORD_BCRYPT') && function_exists('password_hash')));
$line('random_bytes', $yn(function_exists('random_bytes')));
$line('时区数据 Asia/Shanghai', $yn(in_array('Asia/Shanghai', DateTimeZone::listIdentifiers(), true)));
$line('config.php 存在', $yn(is_file(__DIR__ . '/config.php') || is_file(dirname(__DIR__, 2) . '/qifu-config.php')));
$line('lib/ 存在', $yn(is_dir(__DIR__ . '/lib')));
$line('服务器软件', (string) ($_SERVER['SERVER_SOFTWARE'] ?? '?'));
$line('REQUEST_URI', (string) ($_SERVER['REQUEST_URI'] ?? '?'));
$line('SCRIPT_NAME', (string) ($_SERVER['SCRIPT_NAME'] ?? '?'));
$line('PATH_INFO', (string) ($_SERVER['PATH_INFO'] ?? '(无)'));
$line('X-Original-URL (IIS)', (string) ($_SERVER['HTTP_X_ORIGINAL_URL'] ?? '(无)'));
$line('解析出的 API 路径', q_route_path());
$line('收到 Authorization 头', q_header('authorization') !== '' ? '是（令牌可用）' : '否（用 curl -H "Authorization: Bearer x" 测试；同域 Cookie 登录不受影响）');
$line('HTTPS', q_is_https() ? '是' : '否');

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
        foreach (['users', 'user_terrains', 'prayers', 'sessions', 'topups', 'rate_limits', 'meta'] as $t) {
            try {
                $line("表 $t", (int) $pdo->query("SELECT COUNT(*) FROM `$t`")->fetchColumn() . ' 行');
            } catch (Throwable $e) {
                $line("表 $t", '不存在（请运行 install.php）');
            }
        }
    } catch (Throwable $e) {
        $line('数据库连接', '失败：' . $e->getMessage());
    }
} else {
    echo "\n（数据库检查：在地址后加 ?key=你的INSTALL_SECRET）\n";
}
