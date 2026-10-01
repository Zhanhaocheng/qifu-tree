<?php
// 祈福树 PHP API 入口（与 Node/Hono 版接口兼容）
define('QIFU', 1);
error_reporting(E_ALL);
ini_set('display_errors', '0');
ini_set('log_errors', '1');
ob_start();

require __DIR__ . '/lib/core.php';

function q_internal_error(Throwable $e): void
{
    error_log('[qifu] ' . get_class($e) . ': ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
    while (ob_get_level() > 0) {
        ob_end_clean();
    }
    if (!headers_sent()) {
        header_remove('Set-Cookie');
        http_response_code(500);
        header('Content-Type: application/json');
        header('Cache-Control: no-store');
    }
    $out = ['error' => Q_ERR_SERVER];
    if (q_cfg_bool('DEBUG')) {
        $out['detail'] = get_class($e) . ': ' . $e->getMessage();
    }
    echo json_encode($out, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
}

set_error_handler(static function ($no, $str, $file, $line) {
    error_log("[qifu] PHP[$no] $str @ $file:$line");
    return true;
});
register_shutdown_function(static function () {
    $e = error_get_last();
    if ($e && in_array($e['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR], true)) {
        q_internal_error(new ErrorException($e['message'], 0, $e['type'], $e['file'], $e['line']));
    }
});

try {
    require __DIR__ . '/lib/db.php';
    require __DIR__ . '/lib/game.php';
    require __DIR__ . '/lib/app.php';
    q_dispatch();
    while (ob_get_level() > 1) {
        ob_end_flush();
    }
    ob_end_flush();
} catch (Throwable $e) {
    q_internal_error($e);
}
