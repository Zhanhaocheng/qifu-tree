<?php
if (!defined('QIFU')) { http_response_code(403); exit; }

// 手机号 + 短信验证码登录/注册，以及已登录账号绑定手机号。
// 与用户表完全解耦：只新增 sms_codes、user_phones 两张表（首次访问 /sms/* 时自动 CREATE TABLE IF NOT EXISTS），
// 不改动 users 表的任何字段。短信发送本身见 sms_sender.php。

const Q_SMS_CODE_LEN = 6;
const Q_SMS_TTL_MS = 300000;
const Q_SMS_RESEND_MS = 60000;
const Q_SMS_MAX_ATTEMPTS = 5;
const Q_SMS_DAY_MS = 86400000;
const Q_SMS_MSG_BAD_CODE = '验证码错误或已过期';
const Q_SMS_MSG_SEND_FAILED = '短信发送失败，请稍后再试';

const Q_SMS_DDL = [
    <<<'SQL'
CREATE TABLE IF NOT EXISTS sms_codes (
  id BIGINT NOT NULL AUTO_INCREMENT,
  phone CHAR(11) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  purpose VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  code_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  ip VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT '',
  user_id BIGINT NULL,
  status TINYINT NOT NULL DEFAULT 0,
  attempts INT NOT NULL DEFAULT 0,
  expires_at BIGINT NOT NULL,
  used_at BIGINT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (id),
  KEY idx_sms_codes_phone (phone, created_at),
  KEY idx_sms_codes_ip (ip, created_at),
  KEY idx_sms_codes_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
SQL,
    <<<'SQL'
CREATE TABLE IF NOT EXISTS user_phones (
  user_id BIGINT NOT NULL,
  phone CHAR(11) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (user_id),
  UNIQUE KEY uq_user_phones_phone (phone),
  CONSTRAINT fk_user_phones_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
SQL,
];

function q_sms_ensure_tables(): void
{
    static $done = false;
    if (!$done) {
        foreach (Q_SMS_DDL as $ddl) {
            q_pdo()->exec($ddl);
        }
        $done = true;
    }
}

function q_sms_limit(string $key, int $default): int
{
    $v = (int) q_cfg($key, $default);
    return $v > 0 ? $v : $default;
}

function q_sms_valid_phone(string $phone): bool
{
    return (bool) preg_match('/^1[3-9][0-9]{9}$/D', $phone);
}

function q_sms_mask(string $phone): string
{
    return substr($phone, 0, 3) . '****' . substr($phone, -4);
}

/** 6 位验证码：加密安全随机，拒绝采样避免取模偏差 */
function q_sms_new_code(): string
{
    $limit = 4294000000; // floor(2^32 / 1e6) * 1e6
    do {
        $n = unpack('N', q_random_bytes(4))[1];
    } while ($n >= $limit);
    return str_pad((string) ($n % 1000000), Q_SMS_CODE_LEN, '0', STR_PAD_LEFT);
}

/** 服务端只存哈希：HMAC(手机号:用途:验证码)。密钥可在 config 里设 SMS_CODE_SECRET，缺省由数据库口令等派生 */
function q_sms_hash(string $phone, string $purpose, string $code): string
{
    $secret = (string) q_cfg('SMS_CODE_SECRET', '');
    if ($secret === '') {
        $secret = hash('sha256', 'qifu-sms|' . q_cfg('DB_PASS', '') . '|' . q_cfg('INSTALL_SECRET', ''));
    }
    return hash_hmac('sha256', $phone . ':' . $purpose . ':' . $code, $secret);
}

function q_sms_gen_username(string $phone): string
{
    $alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
    $bytes = q_random_bytes(4);
    $suffix = '';
    for ($i = 0; $i < 4; $i++) {
        $suffix .= $alphabet[ord($bytes[$i]) % strlen($alphabet)];
    }
    return substr($phone, 0, 3) . '_' . substr($phone, -4) . '_' . $suffix;
}

function q_sms_phone_of(array $b): string
{
    return q_trim(q_str($b['phone'] ?? null));
}

function q_sms_log(string $msg): void
{
    q_log('sms: ' . $msg);
}

/** 校验验证码并作废（原子）。成功返回 true；任何失败原因都只返回 false（统一提示，不区分不存在/过期/次数用尽/错误）。 */
function q_sms_consume(string $phone, string $purpose, string $code, ?int $userId): bool
{
    $now = q_now();
    $row = q_row(
        'SELECT id, code_hash, attempts, expires_at, user_id FROM sms_codes
         WHERE phone = ? AND purpose = ? AND status = 1 AND used_at IS NULL ORDER BY id DESC LIMIT 1',
        [$phone, $purpose]
    );
    if ($row === null || (int) $row['expires_at'] <= $now || (int) $row['attempts'] >= Q_SMS_MAX_ATTEMPTS) {
        return false;
    }
    if ($purpose === 'bind' && (int) $row['user_id'] !== $userId) {
        return false;
    }
    [, $n] = q_run(
        'UPDATE sms_codes SET attempts = attempts + 1 WHERE id = ? AND used_at IS NULL AND attempts < ?',
        [(int) $row['id'], Q_SMS_MAX_ATTEMPTS]
    );
    if ($n !== 1) {
        return false;
    }
    if (!hash_equals((string) $row['code_hash'], q_sms_hash($phone, $purpose, $code))) {
        return false;
    }
    [, $used] = q_run('UPDATE sms_codes SET used_at = ? WHERE id = ? AND used_at IS NULL', [$now, (int) $row['id']]);
    return $used === 1;
}

/* ------------------------------------------------------------ handlers */

function h_sms_info()
{
    q_json([
        'enabled' => q_sms_enabled(),
        'mock' => q_sms_enabled() && q_sms_mock(),
        'codeLength' => Q_SMS_CODE_LEN,
        'resendSeconds' => (int) (Q_SMS_RESEND_MS / 1000),
        'expiresMinutes' => (int) (Q_SMS_TTL_MS / 60000),
    ]);
}

function h_sms_send()
{
    if (!q_sms_enabled()) {
        return q_fail('短信登录暂未开放', 503);
    }
    $b = q_request_body();
    $phone = q_sms_phone_of($b);
    $purpose = q_str($b['purpose'] ?? null) === 'bind' ? 'bind' : 'login';
    if (!q_sms_valid_phone($phone)) {
        return q_fail('请输入正确的 11 位手机号');
    }
    $user = null;
    q_sms_ensure_tables();
    if ($purpose === 'bind') {
        $user = q_current_user();
        if (!$user) {
            return q_fail('请先登录', 401);
        }
        $owner = q_val('SELECT user_id FROM user_phones WHERE phone = ?', [$phone]);
        if ($owner !== null && (int) $owner !== (int) $user['id']) {
            return q_fail('该手机号已绑定其他账号', 409);
        }
    }
    $ip = q_client_ip();
    $now = q_now();
    $code = q_sms_new_code();

    // 先占位（status=0）再检查频率：并发请求里 id 较大的一方会被拒绝，不会出现「两条同时放行」
    [$id] = q_run(
        'INSERT INTO sms_codes (phone, purpose, code_hash, ip, user_id, status, expires_at, created_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)',
        [$phone, $purpose, q_sms_hash($phone, $purpose, $code), substr($ip, 0, 64), $user ? (int) $user['id'] : null, $now + Q_SMS_TTL_MS, $now]
    );
    $reject = static function (string $msg, int $status = 429, array $extra = []) use ($id) {
        q_run('DELETE FROM sms_codes WHERE id = ?', [$id]);
        q_json(['error' => $msg] + $extra, $status);
    };

    $last = q_val('SELECT MAX(created_at) FROM sms_codes WHERE phone = ? AND status <> 2 AND id < ?', [$phone, $id]);
    if ($last !== null && (int) $last > $now - Q_SMS_RESEND_MS) {
        $wait = (int) ceil(((int) $last + Q_SMS_RESEND_MS - $now) / 1000);
        return $reject('操作太频繁，请 ' . $wait . ' 秒后再获取验证码', 429, ['retryAfter' => $wait]);
    }
    $since = $now - Q_SMS_DAY_MS;
    if ((int) q_val('SELECT COUNT(*) FROM sms_codes WHERE phone = ? AND status <> 2 AND created_at > ?', [$phone, $since]) > q_sms_limit('SMS_PHONE_DAILY_LIMIT', 10)) {
        return $reject('该手机号今日获取验证码次数已达上限，请明天再试');
    }
    if ((int) q_val('SELECT COUNT(*) FROM sms_codes WHERE ip = ? AND created_at > ?', [substr($ip, 0, 64), $since]) > q_sms_limit('SMS_IP_DAILY_LIMIT', 30)) {
        return $reject('当前网络今日获取验证码次数已达上限，请明天再试');
    }
    if ((int) q_val('SELECT COUNT(*) FROM sms_codes WHERE status <> 2 AND created_at > ?', [$since]) > q_sms_limit('SMS_TOTAL_DAILY_LIMIT', 3000)) {
        q_sms_log('global daily limit reached');
        return $reject('短信服务繁忙，请稍后再试', 503);
    }

    $res = q_sms_provider_send($phone, q_sms_render($code, (int) (Q_SMS_TTL_MS / 60000)));
    if (!$res['ok']) {
        q_run('UPDATE sms_codes SET status = 2 WHERE id = ?', [$id]);
        q_sms_log('send failed for ' . q_sms_mask($phone) . ': ' . $res['detail']);
        return q_fail(Q_SMS_MSG_SEND_FAILED, 502);
    }
    q_run('UPDATE sms_codes SET status = 1 WHERE id = ?', [$id]);
    q_run(
        'UPDATE sms_codes SET used_at = ? WHERE phone = ? AND purpose = ? AND used_at IS NULL AND id < ?',
        [$now, $phone, $purpose, $id]
    );
    if (mt_rand(1, 50) === 1) {
        q_run('DELETE FROM sms_codes WHERE created_at < ?', [$now - 3 * Q_SMS_DAY_MS]);
    }
    q_json(['ok' => true, 'resendSeconds' => (int) (Q_SMS_RESEND_MS / 1000), 'expiresMinutes' => (int) (Q_SMS_TTL_MS / 60000)]);
}

/** 手机号已有账号 -> 返回其 id；没有 -> 自动注册（用户名：前 3 位_后 4 位_随机后缀，密码为随机且不可知，只能验证码登录） */
function q_sms_find_or_create_user(string $phone): array
{
    $find = static function () use ($phone) {
        $id = q_val('SELECT user_id FROM user_phones WHERE phone = ?', [$phone]);
        return $id === null ? null : (int) $id;
    };
    $id = $find();
    if ($id !== null) {
        return [$id, false];
    }
    $hash = password_hash(bin2hex(q_random_bytes(24)), PASSWORD_BCRYPT, ['cost' => 10]);
    for ($try = 0; $try < 8; $try++) {
        $username = q_sms_gen_username($phone);
        try {
            $id = q_tx(static function () use ($username, $hash, $phone) {
                [$uid] = q_run(
                    'INSERT INTO users (username, username_key, password_hash, energy, coins, created_at) VALUES (?, ?, ?, ?, 0, ?)',
                    [$username, q_username_key($username), $hash, Q_START_ENERGY, q_now()]
                );
                q_run('INSERT INTO user_phones (user_id, phone, created_at) VALUES (?, ?, ?)', [$uid, $phone, q_now()]);
                return $uid;
            });
            return [$id, true];
        } catch (PDOException $e) {
            if (($e->errorInfo[1] ?? 0) !== 1062) {
                throw $e;
            }
            $id = $find();
            if ($id !== null) {
                return [$id, false];
            }
        }
    }
    throw new RuntimeException('could not allocate a username for sms signup');
}

function h_sms_login()
{
    if (!q_sms_enabled()) {
        return q_fail('短信登录暂未开放', 503);
    }
    $b = q_request_body();
    $phone = q_sms_phone_of($b);
    $code = q_trim(q_str($b['code'] ?? null));
    if (!q_sms_valid_phone($phone)) {
        return q_fail('请输入正确的 11 位手机号');
    }
    if (!preg_match('/^[0-9]{6}$/D', $code)) {
        return q_fail('请输入 6 位数字验证码');
    }
    q_sms_ensure_tables();
    $key = 'smsv:' . q_client_ip();
    if (q_throttled($key)) {
        return q_fail('尝试次数过多，请 10 分钟后再试', 429);
    }
    if (!q_sms_consume($phone, 'login', $code, null)) {
        q_note_failure($key);
        return q_fail(Q_SMS_MSG_BAD_CODE, 400);
    }
    q_clear_failures($key);
    [$uid, $registered] = q_sms_find_or_create_user($phone);
    $token = q_start_session($uid);
    $u = q_get_user($uid);
    q_ensure_terrain($u);
    q_json(['user' => q_reload_public($uid), 'token' => $token, 'registered' => $registered]);
}

function h_sms_bind()
{
    if (!q_sms_enabled()) {
        return q_fail('短信登录暂未开放', 503);
    }
    $u = q_current_user();
    if (!$u) {
        return q_fail('请先登录', 401);
    }
    $b = q_request_body();
    $phone = q_sms_phone_of($b);
    $code = q_trim(q_str($b['code'] ?? null));
    if (!q_sms_valid_phone($phone)) {
        return q_fail('请输入正确的 11 位手机号');
    }
    if (!preg_match('/^[0-9]{6}$/D', $code)) {
        return q_fail('请输入 6 位数字验证码');
    }
    q_sms_ensure_tables();
    $uid = (int) $u['id'];
    $key = 'smsv:' . q_client_ip();
    if (q_throttled($key)) {
        return q_fail('尝试次数过多，请 10 分钟后再试', 429);
    }
    if (!q_sms_consume($phone, 'bind', $code, $uid)) {
        q_note_failure($key);
        return q_fail(Q_SMS_MSG_BAD_CODE, 400);
    }
    q_clear_failures($key);
    try {
        q_tx(static function () use ($uid, $phone) {
            q_run('DELETE FROM user_phones WHERE user_id = ?', [$uid]);
            q_run('INSERT INTO user_phones (user_id, phone, created_at) VALUES (?, ?, ?)', [$uid, $phone, q_now()]);
        });
    } catch (PDOException $e) {
        if (($e->errorInfo[1] ?? 0) === 1062) {
            return q_fail('该手机号已绑定其他账号', 409);
        }
        throw $e;
    }
    q_json(['ok' => true, 'phone' => q_sms_mask($phone)]);
}

function h_sms_phone()
{
    $u = q_current_user();
    if (!$u) {
        return q_fail('请先登录', 401);
    }
    q_sms_ensure_tables();
    $phone = q_val('SELECT phone FROM user_phones WHERE user_id = ?', [(int) $u['id']]);
    q_json(['phone' => $phone === null ? null : q_sms_mask((string) $phone)]);
}
