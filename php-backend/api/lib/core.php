<?php
if (!defined('QIFU')) { http_response_code(403); exit; }

const Q_SESSION_COOKIE = 'qifu_session';
const Q_SESSION_TTL_MS = 30 * 24 * 3600 * 1000;
const Q_TAG_LIMIT = 300;
const Q_UNLIMITED_BALANCE = 999999999;
const Q_ERR_SERVER = '服务器开小差了，请稍后再试';

/* ---------------------------------------------------------------- config */

function q_config_array(): array
{
    static $cfg = null;
    if ($cfg !== null) {
        return $cfg;
    }
    $cfg = [];
    $candidates = [__DIR__ . '/../config.php', dirname(__DIR__, 2) . '/qifu-config.php'];
    foreach ($candidates as $file) {
        if (is_file($file)) {
            $loaded = require $file;
            if (is_array($loaded)) {
                $cfg = $loaded;
            }
            break;
        }
    }
    return $cfg;
}

/** config.php 的值优先，其次同名环境变量（便于测试），最后默认值 */
function q_cfg(string $key, $default = null)
{
    $cfg = q_config_array();
    if (array_key_exists($key, $cfg)) {
        return $cfg[$key];
    }
    $env = getenv('QIFU_' . $key);
    if ($env !== false && $env !== '') {
        return $env;
    }
    return $default;
}

function q_cfg_bool(string $key, bool $default = false): bool
{
    $v = q_cfg($key, $default);
    if (is_string($v)) {
        return in_array(strtolower($v), ['1', 'true', 'yes', 'on'], true);
    }
    return (bool) $v;
}

function q_cfg_list(string $key): array
{
    $v = q_cfg($key, []);
    if (is_string($v)) {
        $v = explode(',', $v);
    }
    $out = [];
    foreach ((array) $v as $item) {
        $item = rtrim(trim((string) $item), '/');
        if ($item !== '') {
            $out[] = $item;
        }
    }
    return $out;
}

/* ----------------------------------------------------------------- clock */

function q_now(): int
{
    $f = getenv('QIFU_TEST_NOW_FILE');
    if ($f !== false && $f !== '' && is_file($f)) {
        $v = trim((string) file_get_contents($f));
        if ($v !== '' && ctype_digit($v)) {
            return (int) $v;
        }
    }
    return (int) floor(microtime(true) * 1000);
}

function q_day(int $ms): string
{
    $tz = new DateTimeZone((string) q_cfg('TIMEZONE', 'Asia/Shanghai'));
    return (new DateTimeImmutable('@' . intdiv($ms, 1000)))->setTimezone($tz)->format('Y-m-d');
}

function q_today(): string
{
    return q_day(q_now());
}

function q_yesterday(): string
{
    return q_day(q_now() - 24 * 3600 * 1000);
}

/* ------------------------------------------------------------------ http */

function q_header(string $name): string
{
    $key = 'HTTP_' . strtoupper(str_replace('-', '_', $name));
    if (!empty($_SERVER[$key])) {
        return (string) $_SERVER[$key];
    }
    if ($name === 'authorization') {
        if (!empty($_SERVER['REDIRECT_HTTP_AUTHORIZATION'])) {
            return (string) $_SERVER['REDIRECT_HTTP_AUTHORIZATION'];
        }
        if (function_exists('getallheaders')) {
            foreach (getallheaders() as $k => $v) {
                if (strtolower($k) === 'authorization') {
                    return (string) $v;
                }
            }
        }
    }
    return '';
}

function q_json($data, int $status = 200): void
{
    $flags = JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE;
    http_response_code($status);
    header('Content-Type: application/json');
    header('Cache-Control: no-store');
    echo json_encode($data, $flags);
}

function q_fail(string $message, int $status = 400): void
{
    q_json(['error' => $message], $status);
}

function q_request_body(): array
{
    $raw = file_get_contents('php://input');
    if ($raw === false || $raw === '') {
        return [];
    }
    $d = json_decode($raw, true);
    return is_array($d) ? $d : [];
}

function q_client_ip(): string
{
    if (q_cfg_bool('TRUST_PROXY_HEADERS')) {
        $xff = q_header('x-forwarded-for');
        if ($xff !== '') {
            return trim(explode(',', $xff)[0]);
        }
        return 'local';
    }
    return (string) ($_SERVER['REMOTE_ADDR'] ?? 'local');
}

function q_is_https(): bool
{
    $https = $_SERVER['HTTPS'] ?? '';
    return ($https !== '' && strtolower((string) $https) !== 'off') || strtolower(q_header('x-forwarded-proto')) === 'https';
}

function q_set_session_cookie(string $token): void
{
    $c = Q_SESSION_COOKIE . '=' . $token . '; Max-Age=' . (Q_SESSION_TTL_MS / 1000) . '; Path=/; HttpOnly';
    if (q_is_https()) {
        $c .= '; Secure';
    }
    header('Set-Cookie: ' . $c . '; SameSite=Lax', false);
}

function q_clear_session_cookie(): void
{
    header('Set-Cookie: ' . Q_SESSION_COOKIE . '=; Max-Age=0; Path=/', false);
}

function q_apply_cors(): bool
{
    $origin = rtrim(q_header('origin'), '/');
    $allowed = q_cfg_list('ALLOWED_ORIGINS');
    $ok = $origin !== '' && in_array($origin, $allowed, true);
    if ($ok) {
        header('Access-Control-Allow-Origin: ' . q_header('origin'));
    }
    header('Access-Control-Allow-Credentials: true');
    header('Vary: Origin', false);
    if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
        if ($ok) {
            header('Access-Control-Allow-Headers: Content-Type,Authorization');
            header('Access-Control-Allow-Methods: GET,POST,OPTIONS');
            header('Access-Control-Max-Age: 86400');
        }
        ini_set('default_mimetype', '');
        http_response_code(204);
        return true;
    }
    return false;
}

function q_route_path(): string
{
    if (isset($_GET['path']) && is_string($_GET['path'])) {
        return '/' . ltrim($_GET['path'], '/');
    }
    $uri = $_SERVER['HTTP_X_ORIGINAL_URL'] ?? $_SERVER['HTTP_X_REWRITE_URL'] ?? $_SERVER['REQUEST_URI'] ?? '/';
    $path = (string) parse_url((string) $uri, PHP_URL_PATH);
    if (preg_match('#/api(?:/index\.php)?(/.*)?$#', $path, $m)) {
        return $m[1] ?? '/';
    }
    return '/' . ltrim($path, '/');
}

/* ------------------------------------------------------------------ text */

/** 与 JS String.prototype.trim 相同的空白集合 */
function q_trim(string $s): string
{
    $r = preg_replace('/^[\p{Zs}\t\n\x0B\f\r\x{2028}\x{2029}\x{FEFF}]+|[\p{Zs}\t\n\x0B\f\r\x{2028}\x{2029}\x{FEFF}]+$/u', '', $s);
    return $r === null ? $s : $r;
}

/** Unicode 码点数（等价于 JS 的 [...s].length） */
function q_codepoints(string $s): int
{
    return (int) preg_match_all('/./su', $s);
}

/** UTF-16 长度（等价于 JS 的 s.length） */
function q_utf16_length(string $s): int
{
    return q_codepoints($s) + (int) preg_match_all('/[\x{10000}-\x{10FFFF}]/u', $s);
}

function q_lower(string $s): string
{
    return function_exists('mb_strtolower') ? mb_strtolower($s, 'UTF-8') : strtolower($s);
}

/** SQLite COLLATE NOCASE：只折叠 ASCII 字母 */
function q_username_key(string $username): string
{
    return strtr($username, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz');
}

function q_hash_token(string $token): string
{
    return hash('sha256', $token);
}

function q_new_token(): string
{
    return rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
}
