<?php
if (!defined('QIFU')) { http_response_code(403); exit; }

// 短信发送层：美联软通 5C 平台（http://www.5c.com.cn/ ，管理后台 http://m.5c.com.cn ）。
// 接口依据官方文档《美联软通5C平台接口文档20170222版》第 3.1 节 HTTP 发送接口：
//   POST/GET https://m.5c.com.cn/api/send/index.php（也有 http:// 版本）
//   参数：username、password_md5（32 位 MD5，文档要求小写）、apikey、mobile、content（短信全文，须带签名）、encode=UTF-8
//   返回：success:msgid 表示提交成功；error:xxx 表示失败（Missing username / APIKEY or password error /
//         Unauthorized IP address / Account balance is insufficient / Throughput Rate Exceeded / Black keywords is:xxx ...）
// 本文件只负责「把一条短信送出去」，验证码业务逻辑在 sms.php。要换短信平台，只需改这里的 q_sms_provider_send()。
// 机密（用户名、MD5 密码、apikey）只从服务器上的 config.php 读取，绝不写进代码或 Git。

const Q_SMS_DEFAULT_URL = 'https://m.5c.com.cn/api/send/index.php';
const Q_SMS_DEFAULT_SIGN = '【阳光互联】';
const Q_SMS_DEFAULT_TEMPLATE = '{sign}您的验证码是{code}，{minutes}分钟内有效。';

function q_sms_cred(string $key): string
{
    return trim((string) q_cfg($key, ''));
}

function q_sms_mock(): bool
{
    return q_cfg_bool('SMS_MOCK');
}

/** 真实发送所需的凭据是否齐全（MD5 必须是 32 位十六进制） */
function q_sms_credentials_ready(): bool
{
    return q_sms_cred('SMS_USERNAME') !== ''
        && q_sms_cred('SMS_APIKEY') !== ''
        && (bool) preg_match('/^[0-9a-fA-F]{32}$/D', q_sms_cred('SMS_PASSWORD_MD5'));
}

/** 短信功能是否对外开放：未关闭，且（mock 或凭据齐全） */
function q_sms_enabled(): bool
{
    return q_cfg_bool('SMS_ENABLED', true) && (q_sms_mock() || q_sms_credentials_ready());
}

function q_sms_sign(): string
{
    $sign = trim((string) q_cfg('SMS_SIGN', Q_SMS_DEFAULT_SIGN));
    if ($sign === '') {
        $sign = Q_SMS_DEFAULT_SIGN;
    }
    if (strpos($sign, '【') !== 0) {
        $sign = '【' . $sign . '】';
    }
    return $sign;
}

/** 渲染验证码短信全文。模板里的 {sign} {code} {minutes} 会被替换；模板没写签名时自动补在开头 */
function q_sms_render(string $code, int $minutes): string
{
    $tpl = (string) q_cfg('SMS_TEMPLATE', Q_SMS_DEFAULT_TEMPLATE);
    if (strpos($tpl, '{code}') === false) {
        $tpl = Q_SMS_DEFAULT_TEMPLATE;
    }
    $text = strtr($tpl, ['{sign}' => q_sms_sign(), '{code}' => $code, '{minutes}' => (string) $minutes]);
    if (strpos($text, '【') === false) {
        $text = q_sms_sign() . $text;
    }
    return $text;
}

/** mock：不联网，把短信写进 SMS_MOCK_OUTBOX（每行一个 JSON）；没配路径就写 error_log。仅供开发/测试。 */
function q_sms_mock_deliver(string $phone, string $content): array
{
    $line = json_encode(['phone' => $phone, 'content' => $content, 'at' => q_now()], JSON_UNESCAPED_UNICODE) . "\n";
    $path = trim((string) q_cfg('SMS_MOCK_OUTBOX', ''));
    if ($path !== '' && q_fn('file_put_contents') && @file_put_contents($path, $line, FILE_APPEND | LOCK_EX) !== false) {
        return ['ok' => true, 'detail' => 'mock outbox'];
    }
    q_log('SMS mock: ' . $line);
    return ['ok' => true, 'detail' => 'mock log'];
}

/** @return array{0:int,1:string} [HTTP 状态码, 响应体] */
function q_sms_http_post(string $url, array $fields): array
{
    $body = http_build_query($fields, '', '&', PHP_QUERY_RFC1738);
    $verify = q_cfg_bool('SMS_SSL_VERIFY', true);
    if (q_fn('curl_init') && q_fn('curl_exec')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $body,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 6,
            CURLOPT_TIMEOUT => 12,
            CURLOPT_SSL_VERIFYPEER => $verify,
            CURLOPT_SSL_VERIFYHOST => $verify ? 2 : 0,
            CURLOPT_HTTPHEADER => ['Content-Type: application/x-www-form-urlencoded;charset=utf-8'],
        ]);
        $out = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err = curl_error($ch);
        curl_close($ch);
        if (!is_string($out)) {
            throw new RuntimeException('curl: ' . $err);
        }
        return [$status, $out];
    }
    if (q_fn('file_get_contents') && q_fn('stream_context_create')) {
        $ctx = stream_context_create([
            'http' => [
                'method' => 'POST',
                'header' => "Content-Type: application/x-www-form-urlencoded;charset=utf-8\r\n",
                'content' => $body,
                'timeout' => 12,
                'ignore_errors' => true,
            ],
            'ssl' => ['verify_peer' => $verify, 'verify_peer_name' => $verify],
        ]);
        $out = @file_get_contents($url, false, $ctx);
        if (!is_string($out)) {
            throw new RuntimeException('stream request failed');
        }
        $status = 0;
        $hdrs = function_exists('http_get_last_response_headers') ? http_get_last_response_headers() : ($http_response_header ?? []);
        if (!empty($hdrs[0]) && preg_match('#\s(\d{3})\s#', (string) $hdrs[0], $m)) {
            $status = (int) $m[1];
        }
        return [$status, $out];
    }
    throw new RuntimeException('服务器既没有 curl 也不能用 stream 访问外网');
}

/**
 * 发送一条短信（内容须已带签名）。永不抛异常。
 * detail 只用于写服务器日志（不含凭据），绝不能返回给用户。
 *
 * @return array{ok:bool, detail:string}
 */
function q_sms_provider_send(string $phone, string $content): array
{
    if (q_sms_mock()) {
        return q_sms_mock_deliver($phone, $content);
    }
    if (!q_sms_credentials_ready()) {
        return ['ok' => false, 'detail' => 'credentials missing'];
    }
    $url = trim((string) q_cfg('SMS_API_URL', Q_SMS_DEFAULT_URL));
    $fields = [
        'username' => q_sms_cred('SMS_USERNAME'),
        'password_md5' => strtolower(q_sms_cred('SMS_PASSWORD_MD5')),
        'apikey' => q_sms_cred('SMS_APIKEY'),
        'mobile' => $phone,
        'content' => $content,
        'encode' => 'UTF-8',
    ];
    try {
        [$status, $resp] = q_sms_http_post($url, $fields);
    } catch (Throwable $e) {
        return ['ok' => false, 'detail' => 'transport: ' . $e->getMessage()];
    }
    $resp = trim(preg_replace('/^\xEF\xBB\xBF/', '', $resp) ?? $resp);
    if ($status >= 200 && $status < 300 && stripos($resp, 'success') === 0) {
        return ['ok' => true, 'detail' => substr($resp, 0, 80)];
    }
    return ['ok' => false, 'detail' => 'http ' . $status . ' ' . substr(preg_replace('/\s+/', ' ', $resp) ?? '', 0, 160)];
}
