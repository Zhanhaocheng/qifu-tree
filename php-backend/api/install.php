<?php
// 一次性安装脚本：建表 -> （可选）导入 import.sql -> 保证测试账号存在。
// 需要 config.php 中的 INSTALL_SECRET。用完后请务必从服务器删除 install.php、diag.php 和 import.sql。
define('QIFU', 1);
error_reporting(E_ALL);
ini_set('display_errors', '0');
@set_time_limit(300);
header('Content-Type: text/html; charset=UTF-8');
header('Cache-Control: no-store');
header('X-Robots-Tag: noindex');

require __DIR__ . '/lib/core.php';
require __DIR__ . '/lib/db.php';
require __DIR__ . '/lib/game.php';
require __DIR__ . '/lib/app.php';

function h($s) { return htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8'); }

function page($title, $body)
{
    echo '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
        . '<title>' . h($title) . '</title><style>body{font:15px/1.6 system-ui,sans-serif;max-width:720px;margin:2rem auto;padding:0 1rem}'
        . 'pre{background:#f4f4f4;padding:.8rem;overflow:auto}.ok{color:#0a7d2c}.bad{color:#b00020}input{padding:.4rem;width:20rem;max-width:100%}button{padding:.4rem 1rem}</style>'
        . '<h2>' . h($title) . '</h2>' . $body;
    exit;
}

$secret = (string) q_cfg('INSTALL_SECRET', '');
if (strlen($secret) < 12) {
    http_response_code(403);
    page('祈福树安装', '<p class="bad">请先在 api/config.php 里把 INSTALL_SECRET 设置为至少 12 位的随机字符串，然后刷新本页。</p>');
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    page('祈福树安装', '<form method="post"><p>输入 config.php 中的 INSTALL_SECRET：</p><p><input type="password" name="key" autocomplete="off" autofocus> <button>开始安装</button></p></form>');
}

if (!hash_equals($secret, (string) ($_POST['key'] ?? ''))) {
    sleep(2);
    http_response_code(403);
    page('祈福树安装', '<p class="bad">口令不正确。</p>');
}

$log = [];
$failed = false;
try {
    $pdo = q_pdo();
    $log[] = '数据库连接成功，服务器版本 ' . $pdo->getAttribute(PDO::ATTR_SERVER_VERSION);

    $schema = str_replace("\r\n", "\n", (string) file_get_contents(__DIR__ . '/lib/schema.sql'));
    $schema = preg_replace('/^--.*$/m', '', $schema);
    $n = 0;
    foreach (explode(";\n", $schema . "\n") as $stmt) {
        $stmt = trim($stmt);
        if ($stmt === '') {
            continue;
        }
        $pdo->exec($stmt);
        $n++;
    }
    $log[] = "表结构已就绪（执行 $n 条语句，已存在的表不会被改动）";

    $importFile = __DIR__ . '/import.sql';
    $users = (int) q_val('SELECT COUNT(*) FROM users');
    if (!is_file($importFile)) {
        $log[] = '未找到 api/import.sql，跳过数据导入';
    } elseif ($users > 0) {
        $log[] = "users 表已有 $users 行，为避免覆盖，跳过数据导入";
    } else {
        $count = 0;
        $pdo->beginTransaction();
        try {
            $fh = fopen($importFile, 'rb');
            while (($line = fgets($fh)) !== false) {
                $line = trim($line);
                if ($line === '' || strpos($line, '--') === 0) {
                    continue;
                }
                if (!preg_match('/^(INSERT INTO `?(users|user_terrains|prayers|sessions|topups)`? |SET NAMES )/', $line)) {
                    throw new RuntimeException('import.sql 含有不允许的语句：' . substr($line, 0, 40));
                }
                $pdo->exec($line);
                $count++;
            }
            fclose($fh);
            $pdo->commit();
            $log[] = "import.sql 导入完成（$count 条语句，单事务）";
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $e;
        }
    }

    q_ensure_test_account();
    $log[] = q_test_account() ? '测试账号已就绪（用户名见 config.php）' : '测试账号已关闭（TEST_ACCOUNT_DISABLED）';

    foreach (['users', 'user_terrains', 'prayers', 'sessions', 'topups'] as $t) {
        $log[] = "表 {$t}：" . (int) q_val("SELECT COUNT(*) FROM `$t`") . ' 行';
    }
} catch (Throwable $e) {
    $failed = true;
    error_log('[qifu-install] ' . $e->getMessage());
    $log[] = '出错：' . $e->getMessage();
}

$body = '<ul>' . implode('', array_map(static function ($l) { return '<li>' . h($l) . '</li>'; }, $log)) . '</ul>';
$body .= $failed
    ? '<p class="bad">安装未完成，请根据上面的错误排查（导入失败时已整体回滚，可修正后重新运行）。</p>'
    : '<p class="ok"><b>安装完成。</b>现在请通过 FTP 删除 api/install.php、api/diag.php 和 api/import.sql。</p>';
page('祈福树安装结果', $body);
