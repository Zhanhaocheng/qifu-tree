<?php
// 祈福树 PHP API 入口（与 Node/Hono 版接口兼容）
define('QIFU', 1);
require __DIR__ . '/lib/core.php';
q_harden_runtime();
if (q_fn('ob_start')) {
    ob_start();
}

function q_internal_error(Throwable $e): void
{
    q_log(get_class($e) . ': ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
    q_ob_end_all(false);
    if (!headers_sent()) {
        q_call('header_remove', 'Set-Cookie');
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

if (q_fn('set_error_handler')) {
    set_error_handler(static function ($no, $str, $file, $line) {
        q_log("PHP[$no] $str @ $file:$line");
        return true;
    });
}
if (q_fn('register_shutdown_function')) {
    register_shutdown_function(static function () {
        $e = q_fn('error_get_last') ? error_get_last() : null;
        if ($e && in_array($e['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR], true)) {
            q_internal_error(new ErrorException($e['message'], 0, $e['type'], $e['file'], $e['line']));
        }
    });
}

try {
    require __DIR__ . '/lib/db.php';
    require __DIR__ . '/lib/game.php';
    require __DIR__ . '/lib/app.php';
    q_dispatch();
    q_ob_end_all(true);
} catch (Throwable $e) {
    q_internal_error($e);
}
