<?php
if (!defined('QIFU')) { http_response_code(403); exit; }

// 支付宝（RSA2）接入：不依赖任何第三方 SDK，只用 openssl + curl / stream。
// 支持 alipay.trade.wap.pay（手机）、alipay.trade.page.pay / alipay.trade.precreate（电脑）、
// alipay.trade.query（查单补单）、异步通知验签；密钥模式与证书模式。

const Q_ALI_PROD_GATEWAY = 'https://openapi.alipay.com/gateway.do';
const Q_ALI_SANDBOX_GATEWAY = 'https://openapi-sandbox.dl.alipaydev.com/gateway.do';
// 用户会把这两个地址填进支付宝后台，主机不支持 URL 重写，所以固定为查询式路由
const Q_ALI_DEFAULT_NOTIFY = 'http://qifu.laixi.cn/api/index.php?path=/pay/alipay/notify';
const Q_ALI_DEFAULT_RETURN = 'http://qifu.laixi.cn/api/index.php?path=/pay/alipay/return';
const Q_ALI_QUERY_THROTTLE_MS = 4000;

const Q_PAY_ORDERS_DDL = <<<'SQL'
CREATE TABLE IF NOT EXISTS pay_orders (
  id BIGINT NOT NULL AUTO_INCREMENT,
  out_trade_no VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id BIGINT NOT NULL,
  pack_id VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  coins INT NOT NULL,
  amount_cents INT NOT NULL,
  channel VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'pending',
  trade_no VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  qr_code VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NULL,
  created_at BIGINT NOT NULL,
  paid_at BIGINT NULL,
  last_query_at BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_pay_orders_no (out_trade_no),
  UNIQUE KEY uq_pay_orders_trade (trade_no),
  KEY idx_pay_orders_user (user_id, status),
  CONSTRAINT fk_pay_orders_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
SQL;

/* ------------------------------------------------------------- config */

function q_ali_str(string $key): string
{
    $v = q_cfg($key, '');
    return is_string($v) ? trim($v) : '';
}

function q_ali_app_id(): string
{
    return q_ali_str('ALIPAY_APP_ID');
}

function q_ali_cert_mode(): bool
{
    return q_cfg_bool('ALIPAY_CERT_MODE');
}

function q_ali_notify_url(): string
{
    $v = q_ali_str('ALIPAY_NOTIFY_URL');
    return $v !== '' ? $v : Q_ALI_DEFAULT_NOTIFY;
}

function q_ali_return_url(): string
{
    $v = q_ali_str('ALIPAY_RETURN_URL');
    return $v !== '' ? $v : Q_ALI_DEFAULT_RETURN;
}

/** 站点根地址（scheme://host[:port]），取自 return 地址，用于 return 页跳回站点 */
function q_ali_site_url(): string
{
    $u = parse_url(q_ali_return_url());
    if (!is_array($u) || empty($u['host'])) {
        return '';
    }
    return ($u['scheme'] ?? 'http') . '://' . $u['host'] . (isset($u['port']) ? ':' . $u['port'] : '');
}

function q_ali_gateway(): string
{
    $g = q_ali_str('ALIPAY_GATEWAY');
    if ($g !== '') {
        return $g;
    }
    return q_cfg_bool('ALIPAY_SANDBOX') ? Q_ALI_SANDBOX_GATEWAY : Q_ALI_PROD_GATEWAY;
}

/** 'qr'（当面付 precreate 二维码，默认）或 'page'（电脑网站支付 page.pay，跳转到支付宝） */
function q_ali_pc_mode(): string
{
    return strtolower(q_ali_str('ALIPAY_PC_MODE')) === 'page' ? 'page' : 'qr';
}

function q_ali_timeout(): string
{
    $v = q_ali_str('ALIPAY_ORDER_TIMEOUT');
    return preg_match('/^\d{1,4}[mhd]$/D', $v) ? $v : '30m';
}

/** 配置文本值，或（行内值为空时）从文件读取。私钥文件务必放在网站目录之外。 */
function q_ali_secret(string $inlineKey, string $pathKey): string
{
    $v = q_ali_str($inlineKey);
    if ($v !== '') {
        return $v;
    }
    $path = q_ali_str($pathKey);
    if ($path !== '' && @is_file($path) && @is_readable($path)) {
        return trim((string) @file_get_contents($path));
    }
    return '';
}

/**
 * 把「裸 base64 / 带头尾的 PEM / 带字面 \n 的一行文本」统一成 PEM。
 * $wrappers 依次尝试，返回第一个能被 openssl 解析的结果。
 */
function q_ali_to_pem(string $raw, array $wrappers, bool $private): ?string
{
    $raw = trim(str_replace(["\r\n", "\r", '\\n'], "\n", $raw));
    if ($raw === '') {
        return null;
    }
    $try = static function (string $pem) use ($private) {
        $k = $private ? @openssl_pkey_get_private($pem) : @openssl_pkey_get_public($pem);
        return $k !== false;
    };
    if (strpos($raw, '-----BEGIN') !== false) {
        return $try($raw) ? $raw : null;
    }
    $b64 = preg_replace('/\s+/', '', $raw);
    if ($b64 === null || $b64 === '' || !preg_match('#^[A-Za-z0-9+/=]+$#D', $b64)) {
        return null;
    }
    $body = chunk_split($b64, 64, "\n");
    foreach ($wrappers as $label) {
        $pem = "-----BEGIN $label-----\n$body-----END $label-----\n";
        if ($try($pem)) {
            return $pem;
        }
    }
    return null;
}

function q_ali_private_pem(): ?string
{
    static $cache = [];
    $raw = q_ali_secret('ALIPAY_PRIVATE_KEY', 'ALIPAY_PRIVATE_KEY_PATH');
    $k = sha1($raw);
    if (!array_key_exists($k, $cache)) {
        $cache[$k] = q_ali_to_pem($raw, ['PRIVATE KEY', 'RSA PRIVATE KEY'], true);
    }
    return $cache[$k];
}

/** 读取一个或多个 PEM 证书（文件可包含多段） */
function q_ali_read_certs(string $path): array
{
    if ($path === '' || !@is_file($path) || !@is_readable($path)) {
        return [];
    }
    $txt = (string) @file_get_contents($path);
    if (!preg_match_all('/-----BEGIN CERTIFICATE-----.+?-----END CERTIFICATE-----/s', $txt, $m)) {
        return [];
    }
    return $m[0];
}

/** 支付宝公钥 PEM（密钥模式取 ALIPAY_PUBLIC_KEY，证书模式取支付宝公钥证书里的公钥） */
function q_ali_alipay_public_pem(): ?string
{
    static $cache = [];
    if (q_ali_cert_mode()) {
        $certs = q_ali_read_certs(q_ali_str('ALIPAY_PUBLIC_CERT_PATH'));
        if (!$certs) {
            return null;
        }
        $k = sha1($certs[0]);
        if (!array_key_exists($k, $cache)) {
            $res = @openssl_x509_read($certs[0]);
            $pub = $res ? @openssl_pkey_get_public($res) : false;
            $det = $pub ? openssl_pkey_get_details($pub) : null;
            $cache[$k] = is_array($det) && isset($det['key']) ? $det['key'] : null;
        }
        return $cache[$k];
    }
    $raw = q_ali_secret('ALIPAY_PUBLIC_KEY', 'ALIPAY_PUBLIC_KEY_PATH');
    $k = sha1($raw);
    if (!array_key_exists($k, $cache)) {
        $cache[$k] = q_ali_to_pem($raw, ['PUBLIC KEY'], false);
    }
    return $cache[$k];
}

/** 配置问题清单；空数组表示可以收款 */
function q_ali_problems(): array
{
    $p = [];
    if (!q_fn('openssl_sign') || !q_fn('openssl_verify')) {
        $p[] = 'PHP 缺少 openssl 扩展或相关函数被禁用';
    }
    if (!q_fn('curl_init') && !(q_fn('file_get_contents') && (bool) q_call('ini_get', 'allow_url_fopen'))) {
        $p[] = 'curl 与 allow_url_fopen 都不可用，无法联系支付宝网关';
    }
    if (q_ali_app_id() === '') {
        $p[] = 'ALIPAY_APP_ID 未填写';
    }
    if (q_ali_private_pem() === null) {
        $p[] = 'ALIPAY_PRIVATE_KEY 未填写或格式无法识别（应用私钥，PKCS1 / PKCS8 均可）';
    }
    if (q_ali_cert_mode()) {
        if (q_ali_alipay_public_pem() === null) {
            $p[] = '证书模式：ALIPAY_PUBLIC_CERT_PATH（支付宝公钥证书）无法读取';
        }
        if (q_ali_cert_sn_of_file(q_ali_str('ALIPAY_APP_CERT_PATH')) === null) {
            $p[] = '证书模式：ALIPAY_APP_CERT_PATH（应用公钥证书）无法读取';
        }
        if (q_ali_root_cert_sn() === null) {
            $p[] = '证书模式：ALIPAY_ROOT_CERT_PATH（支付宝根证书）无法读取';
        }
    } elseif (q_ali_alipay_public_pem() === null) {
        $p[] = 'ALIPAY_PUBLIC_KEY 未填写或格式无法识别（支付宝公钥，不是应用公钥）';
    }
    if (!preg_match('#^https?://#i', q_ali_notify_url()) || !preg_match('#^https?://#i', q_ali_return_url())) {
        $p[] = 'ALIPAY_NOTIFY_URL / ALIPAY_RETURN_URL 必须是 http(s):// 开头的完整地址';
    }
    return $p;
}

/**
 * 'demo'：完全没有配置支付宝（沿用模拟充值）；'alipay'：只要填过任何支付宝密钥相关配置就走真实支付。
 * 配置填了一半时也是 'alipay'（但不可用），避免因漏填而退回「免费到账」的模拟充值。
 */
function q_pay_mode(): string
{
    foreach (['ALIPAY_APP_ID', 'ALIPAY_PRIVATE_KEY', 'ALIPAY_PRIVATE_KEY_PATH', 'ALIPAY_PUBLIC_KEY', 'ALIPAY_PUBLIC_KEY_PATH'] as $k) {
        if (q_ali_str($k) !== '') {
            return 'alipay';
        }
    }
    return 'demo';
}

function q_pay_ready(): bool
{
    static $ready = null;
    if ($ready === null) {
        $ready = q_pay_mode() === 'alipay' && q_ali_problems() === [];
    }
    return $ready;
}

/* ------------------------------------------------------ cert mode SN */

function q_ali_hex2dec(string $hex): string
{
    $dec = [0];
    foreach (str_split(strtolower(ltrim($hex, '0x')) ?: '0') as $ch) {
        $carry = hexdec($ch);
        for ($i = count($dec) - 1; $i >= 0; $i--) {
            $v = $dec[$i] * 16 + $carry;
            $dec[$i] = $v % 10;
            $carry = intdiv($v, 10);
        }
        while ($carry > 0) {
            array_unshift($dec, $carry % 10);
            $carry = intdiv($carry, 10);
        }
    }
    return implode('', $dec);
}

/** 证书 SN = md5(issuer 的 RFC2253 形式（最具体的在前） + 序列号十进制) */
function q_ali_cert_sn(string $certPem): ?string
{
    $info = @openssl_x509_parse($certPem);
    if (!is_array($info) || empty($info['issuer'])) {
        return null;
    }
    $parts = [];
    foreach (array_reverse($info['issuer'], true) as $k => $v) {
        foreach ((array) $v as $one) {
            $parts[] = $k . '=' . $one;
        }
    }
    $serial = isset($info['serialNumberHex']) ? q_ali_hex2dec((string) $info['serialNumberHex']) : (string) ($info['serialNumber'] ?? '');
    if ($serial === '') {
        return null;
    }
    return md5(implode(',', $parts) . $serial);
}

function q_ali_cert_sn_of_file(string $path): ?string
{
    $certs = q_ali_read_certs($path);
    return $certs ? q_ali_cert_sn($certs[0]) : null;
}

function q_ali_root_cert_sn(): ?string
{
    $sns = [];
    foreach (q_ali_read_certs(q_ali_str('ALIPAY_ROOT_CERT_PATH')) as $pem) {
        $info = @openssl_x509_parse($pem);
        $alg = is_array($info) ? (string) ($info['signatureTypeSN'] ?? '') : '';
        if (in_array($alg, ['RSA-SHA1', 'RSA-SHA256'], true) && ($sn = q_ali_cert_sn($pem)) !== null) {
            $sns[] = $sn;
        }
    }
    return $sns ? implode('_', $sns) : null;
}

/* --------------------------------------------------------- sign/verify */

function q_ali_sign_content(array $params, array $exclude = ['sign']): string
{
    ksort($params, SORT_STRING);
    $pairs = [];
    foreach ($params as $k => $v) {
        $k = (string) $k;
        if (in_array($k, $exclude, true) || !is_scalar($v)) {
            continue;
        }
        $v = (string) $v;
        if ($v === '') {
            continue;
        }
        $pairs[] = $k . '=' . $v;
    }
    return implode('&', $pairs);
}

function q_ali_rsa2_sign(string $content): string
{
    $pem = q_ali_private_pem();
    $key = $pem !== null ? @openssl_pkey_get_private($pem) : false;
    if ($key === false || !openssl_sign($content, $sig, $key, OPENSSL_ALGO_SHA256)) {
        throw new RuntimeException('支付宝签名失败：应用私钥不可用');
    }
    return base64_encode($sig);
}

function q_ali_rsa2_verify(string $content, string $signB64, ?string $publicPem = null): bool
{
    $publicPem = $publicPem ?? q_ali_alipay_public_pem();
    $sig = base64_decode($signB64, true);
    if ($publicPem === null || $sig === false || $sig === '') {
        return false;
    }
    $key = @openssl_pkey_get_public($publicPem);
    return $key !== false && openssl_verify($content, $sig, $key, OPENSSL_ALGO_SHA256) === 1;
}

/** 校验异步通知 / 同步返回参数：只接受 RSA2；sign 与 sign_type 不参与签名 */
function q_ali_verify_params(array $params): bool
{
    $sign = $params['sign'] ?? null;
    if (!is_string($sign) || $sign === '') {
        return false;
    }
    if (isset($params['sign_type']) && $params['sign_type'] !== 'RSA2') {
        return false;
    }
    foreach ($params as $v) {
        if (!is_scalar($v)) {
            return false;
        }
    }
    return q_ali_rsa2_verify(q_ali_sign_content($params, ['sign', 'sign_type']), $sign);
}

/* ------------------------------------------------------------- requests */

function q_ali_beijing_time(): string
{
    return (new DateTimeImmutable('@' . intdiv(q_now(), 1000)))
        ->setTimezone(new DateTimeZone('Asia/Shanghai'))
        ->format('Y-m-d H:i:s');
}

function q_ali_cents(string $amount): ?int
{
    if (!preg_match('/^(\d{1,9})(?:\.(\d{1,2}))?$/D', $amount, $m)) {
        return null;
    }
    return (int) $m[1] * 100 + (int) str_pad($m[2] ?? '0', 2, '0');
}

function q_ali_amount(int $cents): string
{
    return sprintf('%d.%02d', intdiv($cents, 100), $cents % 100);
}

/** 构造并签名一次网关请求的全部参数（含 sign） */
function q_ali_build_request(string $method, array $biz, array $extra = []): array
{
    $params = [
        'app_id' => q_ali_app_id(),
        'method' => $method,
        'format' => 'JSON',
        'charset' => 'utf-8',
        'sign_type' => 'RSA2',
        'timestamp' => q_ali_beijing_time(),
        'version' => '1.0',
        'biz_content' => json_encode($biz, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
    ] + $extra;
    if (q_ali_cert_mode()) {
        $params['app_cert_sn'] = (string) q_ali_cert_sn_of_file(q_ali_str('ALIPAY_APP_CERT_PATH'));
        $params['alipay_root_cert_sn'] = (string) q_ali_root_cert_sn();
    }
    $params['sign'] = q_ali_rsa2_sign(q_ali_sign_content($params));
    return $params;
}

function q_ali_gateway_url(): string
{
    $g = q_ali_gateway();
    return $g . (strpos($g, '?') === false ? '?' : '&') . 'charset=utf-8';
}

/** @return array{0:int,1:string} [HTTP 状态码, 响应体] */
function q_ali_http_post(string $url, array $fields): array
{
    $body = http_build_query($fields, '', '&', PHP_QUERY_RFC1738);
    $verify = q_cfg_bool('ALIPAY_SSL_VERIFY', true);
    if (q_fn('curl_init') && q_fn('curl_exec')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $body,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 8,
            CURLOPT_TIMEOUT => 20,
            CURLOPT_SSL_VERIFYPEER => $verify,
            CURLOPT_SSL_VERIFYHOST => $verify ? 2 : 0,
            CURLOPT_HTTPHEADER => ['Content-Type: application/x-www-form-urlencoded;charset=utf-8'],
        ]);
        $out = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err = curl_error($ch);
        curl_close($ch);
        if (!is_string($out)) {
            throw new RuntimeException('联系支付宝网关失败：' . $err);
        }
        return [$status, $out];
    }
    if (q_fn('file_get_contents') && q_fn('stream_context_create')) {
        $ctx = stream_context_create([
            'http' => [
                'method' => 'POST',
                'header' => "Content-Type: application/x-www-form-urlencoded;charset=utf-8\r\n",
                'content' => $body,
                'timeout' => 20,
                'ignore_errors' => true,
            ],
            'ssl' => ['verify_peer' => $verify, 'verify_peer_name' => $verify],
        ]);
        $out = @file_get_contents($url, false, $ctx);
        if (!is_string($out)) {
            throw new RuntimeException('联系支付宝网关失败（stream）');
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
 * 从网关 JSON 响应里取出 "xxx_response" 的原始子串（验签必须用原文，不能重新编码）。
 */
function q_ali_extract_response(string $body, string $key): ?string
{
    $needle = '"' . $key . '"';
    $pos = strpos($body, $needle);
    if ($pos === false) {
        return null;
    }
    $i = strpos($body, ':', $pos + strlen($needle));
    if ($i === false) {
        return null;
    }
    $i++;
    $n = strlen($body);
    while ($i < $n && strpos(" \t\r\n", $body[$i]) !== false) {
        $i++;
    }
    if ($i >= $n || $body[$i] !== '{') {
        return null;
    }
    $depth = 0;
    $inStr = false;
    for ($j = $i; $j < $n; $j++) {
        $c = $body[$j];
        if ($inStr) {
            if ($c === '\\') {
                $j++;
            } elseif ($c === '"') {
                $inStr = false;
            }
        } elseif ($c === '"') {
            $inStr = true;
        } elseif ($c === '{') {
            $depth++;
        } elseif ($c === '}' && --$depth === 0) {
            return substr($body, $i, $j - $i + 1);
        }
    }
    return null;
}

/**
 * 调用网关并验证响应签名。返回响应对象（含 code / msg / sub_code / sub_msg 及业务字段）。
 * 响应缺失、不是合法 JSON 或验签失败一律抛异常，绝不信任未验签的内容。
 */
function q_ali_call(string $method, array $biz, array $extra = []): array
{
    $params = q_ali_build_request($method, $biz, $extra);
    [$status, $body] = q_ali_http_post(q_ali_gateway_url(), $params);
    $key = str_replace('.', '_', $method) . '_response';
    $raw = q_ali_extract_response($body, $key);
    if ($raw === null) {
        q_log("alipay $method 响应异常 HTTP $status: " . substr($body, 0, 300));
        throw new RuntimeException('支付宝返回了无法识别的内容');
    }
    $decoded = json_decode($body, true);
    $sign = is_array($decoded) ? ($decoded['sign'] ?? null) : null;
    if (!is_string($sign) || !q_ali_rsa2_verify($raw, $sign)) {
        q_log("alipay $method 响应验签失败");
        throw new RuntimeException('支付宝响应验签失败');
    }
    $data = json_decode($raw, true);
    if (!is_array($data)) {
        throw new RuntimeException('支付宝响应解析失败');
    }
    return $data;
}

/* ---------------------------------------------------------------- orders */

function q_pay_ensure_table(): void
{
    static $done = false;
    if (!$done) {
        q_pdo()->exec(Q_PAY_ORDERS_DDL);
        $done = true;
    }
}

function q_pay_new_order_no(): string
{
    return 'QF' . (new DateTimeImmutable('@' . intdiv(q_now(), 1000)))->format('ymdHis') . bin2hex(q_random_bytes(6));
}

function q_pay_valid_order_no(string $s): bool
{
    return (bool) preg_match('/^[A-Za-z0-9_]{6,40}$/D', $s);
}

function q_pay_get_order(string $no): ?array
{
    return q_row('SELECT * FROM pay_orders WHERE out_trade_no = ?', [$no]);
}

/**
 * 入账（幂等）：行锁住订单后再判断状态，通知、查单、return 并发到达也只会加一次福币。
 * @return string 'credited' | 'already' | 'mismatch'（金额不符）| 'unknown'（订单不存在）
 */
function q_pay_settle(string $outTradeNo, string $tradeNo, int $amountCents): string
{
    return q_tx(static function () use ($outTradeNo, $tradeNo, $amountCents) {
        $o = q_row('SELECT * FROM pay_orders WHERE out_trade_no = ? FOR UPDATE', [$outTradeNo]);
        if ($o === null) {
            return 'unknown';
        }
        if ((int) $o['amount_cents'] !== $amountCents) {
            return 'mismatch';
        }
        if ($o['status'] === 'paid') {
            return 'already';
        }
        $now = q_now();
        q_run(
            "UPDATE pay_orders SET status = 'paid', trade_no = ?, paid_at = ? WHERE id = ? AND status <> 'paid'",
            [$tradeNo !== '' ? $tradeNo : null, $now, (int) $o['id']]
        );
        q_run('UPDATE users SET coins = coins + ? WHERE id = ?', [(int) $o['coins'], (int) $o['user_id']]);
        q_run(
            'INSERT INTO topups (user_id, pack_id, coins, created_at) VALUES (?, ?, ?, ?)',
            [(int) $o['user_id'], $o['pack_id'], (int) $o['coins'], $now]
        );
        return 'credited';
    });
}

function q_pay_close_pending(string $outTradeNo): void
{
    q_run("UPDATE pay_orders SET status = 'closed' WHERE out_trade_no = ? AND status = 'pending'", [$outTradeNo]);
}

/**
 * 主动向支付宝查单，已支付则入账（补单）。$force=false 时同一订单 4 秒内只查一次，防止前端轮询打爆网关。
 * 网关异常只记日志并返回当前订单状态。
 */
function q_pay_sync_order(array $order, bool $force = false): array
{
    if ($order['status'] === 'paid' || !q_pay_ready()) {
        return $order;
    }
    $now = q_now();
    if (!$force && $now - (int) $order['last_query_at'] < Q_ALI_QUERY_THROTTLE_MS) {
        return $order;
    }
    q_run('UPDATE pay_orders SET last_query_at = ? WHERE id = ?', [$now, (int) $order['id']]);
    try {
        $r = q_ali_call('alipay.trade.query', ['out_trade_no' => $order['out_trade_no']]);
        $code = (string) ($r['code'] ?? '');
        if ($code === '10000') {
            $status = (string) ($r['trade_status'] ?? '');
            if (in_array($status, ['TRADE_SUCCESS', 'TRADE_FINISHED'], true)) {
                $cents = q_ali_cents((string) ($r['total_amount'] ?? ''));
                if (($r['out_trade_no'] ?? '') === $order['out_trade_no'] && $cents !== null) {
                    $res = q_pay_settle($order['out_trade_no'], (string) ($r['trade_no'] ?? ''), $cents);
                    if ($res === 'mismatch') {
                        q_log('alipay 查单金额与订单不符 ' . $order['out_trade_no']);
                    }
                }
            } elseif ($status === 'TRADE_CLOSED') {
                q_pay_close_pending($order['out_trade_no']);
            }
        } elseif (($r['sub_code'] ?? '') === 'ACQ.TRADE_NOT_EXIST' && $now - (int) $order['created_at'] > 24 * 3600 * 1000) {
            q_pay_close_pending($order['out_trade_no']);
        }
    } catch (Throwable $e) {
        q_log('alipay 查单失败 ' . $order['out_trade_no'] . ': ' . $e->getMessage());
    }
    return q_pay_get_order($order['out_trade_no']) ?? $order;
}

/**
 * 处理异步通知参数，返回要回写给支付宝的纯文本：'success'（已处理，支付宝不再重发）或 'fail'。
 * 与具体 HTTP 层解耦，便于测试。
 */
function q_pay_handle_notify(array $p): string
{
    try {
        if (!q_pay_ready()) {
            q_log('alipay 通知被拒绝：支付配置不可用');
            return 'fail';
        }
        if (!q_ali_verify_params($p)) {
            q_log('alipay 通知验签失败');
            return 'fail';
        }
        if (($p['app_id'] ?? '') !== q_ali_app_id()) {
            q_log('alipay 通知 app_id 不匹配');
            return 'fail';
        }
        $seller = q_ali_str('ALIPAY_SELLER_ID');
        if ($seller !== '' && ($p['seller_id'] ?? '') !== $seller) {
            q_log('alipay 通知 seller_id 不匹配');
            return 'fail';
        }
        $no = (string) ($p['out_trade_no'] ?? '');
        if (!q_pay_valid_order_no($no)) {
            q_log('alipay 通知订单号非法');
            return 'fail';
        }
        q_pay_ensure_table();
        $status = (string) ($p['trade_status'] ?? '');
        if (in_array($status, ['TRADE_SUCCESS', 'TRADE_FINISHED'], true)) {
            $cents = q_ali_cents((string) ($p['total_amount'] ?? ''));
            if ($cents === null) {
                q_log('alipay 通知金额非法');
                return 'fail';
            }
            $res = q_pay_settle($no, (string) ($p['trade_no'] ?? ''), $cents);
            if ($res === 'credited' || $res === 'already') {
                return 'success';
            }
            if ($res === 'unknown') {
                // 验签通过但不是本站的订单（例如同一个应用被多个站点共用）：确认收到，免得支付宝反复重发
                q_log("alipay 通知订单不存在 $no");
                return 'success';
            }
            q_log("alipay 通知金额与订单不符 $no");
            return 'fail';
        }
        if ($status === 'TRADE_CLOSED') {
            q_pay_close_pending($no);
        }
        return 'success';
    } catch (Throwable $e) {
        q_log('alipay 通知处理异常: ' . $e->getMessage());
        return 'fail';
    }
}

/* -------------------------------------------------------------- handlers */

function q_text(string $body, int $status = 200): void
{
    q_discard_output();
    http_response_code($status);
    header('Content-Type: text/plain; charset=UTF-8');
    header('Cache-Control: no-store');
    echo $body;
}

function h_pay_info()
{
    $mode = q_pay_mode();
    q_json([
        'mode' => $mode,
        'ready' => $mode === 'alipay' ? q_pay_ready() : true,
        'sandbox' => q_cfg_bool('ALIPAY_SANDBOX'),
        'pcMode' => q_ali_pc_mode(),
    ]);
}

function q_pay_order_json(array $o, ?array $user = null): array
{
    $out = [
        'orderNo' => $o['out_trade_no'],
        'status' => $o['status'],
        'channel' => $o['channel'],
        'packId' => $o['pack_id'],
        'coins' => (int) $o['coins'],
        'amount' => q_ali_amount((int) $o['amount_cents']),
    ];
    if ($user !== null) {
        $out['user'] = $user;
    }
    return $out;
}

function h_pay_create()
{
    $u = q_current_user();
    if (!$u) {
        return q_fail('请先登录', 401);
    }
    if (q_pay_mode() !== 'alipay') {
        return q_fail('支付宝充值尚未启用');
    }
    if (!q_pay_ready()) {
        q_log('alipay 下单被拒绝：' . implode('；', q_ali_problems()));
        return q_fail('支付暂时不可用，请稍后再试', 503);
    }
    $b = q_request_body();
    $pack = q_find(q_packs(), $b['pack'] ?? null);
    if (!$pack) {
        return q_fail('请选择充值档位');
    }
    $mobile = ($b['device'] ?? '') === 'mobile';
    $channel = $mobile ? 'wap' : (q_ali_pc_mode() === 'page' ? 'page' : 'qr');
    $id = (int) $u['id'];

    q_pay_ensure_table();
    $recent = (int) q_val(
        "SELECT COUNT(*) FROM pay_orders WHERE user_id = ? AND status = 'pending' AND created_at > ?",
        [$id, q_now() - 600000]
    );
    if ($recent >= 10) {
        return q_fail('未完成的订单太多，请稍后再试', 429);
    }

    $no = q_pay_new_order_no();
    $cents = (int) $pack['price'] * 100;
    q_run(
        'INSERT INTO pay_orders (out_trade_no, user_id, pack_id, coins, amount_cents, channel, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [$no, $id, $pack['id'], (int) $pack['coins'], $cents, $channel, 'pending', q_now()]
    );

    $subject = '祈福树福币·' . $pack['label'];
    $biz = [
        'out_trade_no' => $no,
        'total_amount' => q_ali_amount($cents),
        'subject' => $subject,
        'timeout_express' => q_ali_timeout(),
    ];
    $notify = ['notify_url' => q_ali_notify_url()];
    try {
        if ($channel === 'qr') {
            $r = q_ali_call('alipay.trade.precreate', $biz, $notify);
            if (($r['code'] ?? '') !== '10000' || empty($r['qr_code']) || ($r['out_trade_no'] ?? '') !== $no) {
                throw new RuntimeException('precreate 失败：' . ($r['sub_msg'] ?? $r['msg'] ?? '未知错误'));
            }
            q_run('UPDATE pay_orders SET qr_code = ? WHERE out_trade_no = ?', [substr((string) $r['qr_code'], 0, 255), $no]);
            return q_json([
                'orderNo' => $no,
                'channel' => $channel,
                'amount' => q_ali_amount($cents),
                'qrCode' => (string) $r['qr_code'],
            ]);
        }
        $biz['product_code'] = $mobile ? 'QUICK_WAP_WAY' : 'FAST_INSTANT_TRADE_PAY';
        if ($mobile) {
            $site = q_ali_site_url();
            if ($site !== '') {
                $biz['quit_url'] = $site . '/';
            }
        }
        $params = q_ali_build_request(
            $mobile ? 'alipay.trade.wap.pay' : 'alipay.trade.page.pay',
            $biz,
            $notify + ['return_url' => q_ali_return_url()]
        );
        return q_json([
            'orderNo' => $no,
            'channel' => $channel,
            'amount' => q_ali_amount($cents),
            'form' => ['action' => q_ali_gateway_url(), 'fields' => $params],
        ]);
    } catch (Throwable $e) {
        q_log('alipay 下单失败 ' . $no . ': ' . $e->getMessage());
        q_pay_close_pending($no);
        $out = ['error' => '支付宝下单失败，请稍后再试'];
        if (q_cfg_bool('DEBUG')) {
            $out['detail'] = $e->getMessage();
        }
        return q_json($out, 502);
    }
}

function h_pay_query()
{
    $u = q_current_user();
    if (!$u) {
        return q_fail('请先登录', 401);
    }
    $no = is_string($_GET['orderNo'] ?? null) ? $_GET['orderNo'] : '';
    if (!q_pay_valid_order_no($no)) {
        return q_fail('订单号不正确');
    }
    q_pay_ensure_table();
    $o = q_pay_get_order($no);
    if ($o === null || (int) $o['user_id'] !== (int) $u['id']) {
        return q_fail('订单不存在', 404);
    }
    $o = q_pay_sync_order($o);
    q_json(q_pay_order_json($o, $o['status'] === 'paid' ? q_reload_public((int) $u['id']) : null));
}

/** 补单：重新查询当前用户最近 48 小时内所有未支付订单，把已付款但没入账的补上 */
function h_pay_recheck()
{
    $u = q_current_user();
    if (!$u) {
        return q_fail('请先登录', 401);
    }
    $id = (int) $u['id'];
    $credited = [];
    if (q_pay_mode() === 'alipay') {
        q_pay_ensure_table();
        $rows = q_rows(
            "SELECT * FROM pay_orders WHERE user_id = ? AND status = 'pending' AND created_at > ? ORDER BY id DESC LIMIT 5",
            [$id, q_now() - 48 * 3600 * 1000]
        );
        foreach ($rows as $o) {
            $after = q_pay_sync_order($o);
            if ($after['status'] === 'paid') {
                $credited[] = q_pay_order_json($after);
            }
        }
    }
    q_json(['paid' => $credited, 'user' => q_reload_public($id)]);
}

function h_pay_notify()
{
    $p = $_POST;
    if (!$p && ($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
        $raw = (string) @file_get_contents('php://input');
        if ($raw !== '') {
            parse_str($raw, $p);
        }
    }
    q_text($p ? q_pay_handle_notify($p) : 'fail');
}

function h_pay_return()
{
    $params = $_GET;
    unset($params['path']);
    $no = is_string($params['out_trade_no'] ?? null) ? $params['out_trade_no'] : '';
    if (!q_pay_valid_order_no($no)) {
        $no = '';
    }
    try {
        if ($no !== '' && q_pay_ready() && q_ali_verify_params($params)) {
            q_pay_ensure_table();
            $o = q_pay_get_order($no);
            if ($o !== null) {
                q_pay_sync_order($o, true);
            }
        }
    } catch (Throwable $e) {
        q_log('alipay return 处理异常: ' . $e->getMessage());
    }
    $target = q_ali_site_url() . '/' . ($no !== '' ? '?payOrder=' . rawurlencode($no) : '');
    q_discard_output();
    http_response_code(302);
    header('Location: ' . $target);
    header('Content-Type: text/html; charset=UTF-8');
    header('Cache-Control: no-store');
    $esc = htmlspecialchars($target, ENT_QUOTES, 'UTF-8');
    echo '<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=' . $esc . '"><a href="' . $esc . '">返回祈福树</a>';
}
