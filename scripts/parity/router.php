<?php
// php -S 的路由脚本：/api/* 交给 api/index.php，其余按文件原样提供
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$root = realpath(__DIR__ . '/../../php-backend');
$file = $root . $path;
if ($path !== '/' && is_file($file) && substr($file, -4) === '.php' && strpos($path, '/api/lib/') !== 0 && basename($file) !== 'config.php') {
    return false;
}
if (strpos($path, '/api') === 0) {
    require $root . '/api/index.php';
    return true;
}
http_response_code(404);
echo 'not found';
