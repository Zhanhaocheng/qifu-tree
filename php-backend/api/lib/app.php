<?php
if (!defined('QIFU')) { http_response_code(403); exit; }

/* ------------------------------------------------------- test account */

function q_test_account(): ?array
{
    if (q_cfg_bool('TEST_ACCOUNT_DISABLED')) {
        return null;
    }
    $user = trim((string) q_cfg('TEST_ACCOUNT_USER', ''));
    $pass = (string) q_cfg('TEST_ACCOUNT_PASSWORD', '');
    return [
        'username' => $user !== '' ? $user : 'qifu_test',
        'password' => $pass !== '' ? $pass : 'Qifu@Test2026',
    ];
}

function q_is_test_account(?array $cfg, string $username): bool
{
    return $cfg !== null && strtolower(q_username_key($cfg['username'])) === q_username_key($username);
}

/** 幂等地保证测试账号存在、密码正确、余额不低于上限值 */
function q_ensure_test_account(): void
{
    $cfg = q_test_account();
    if ($cfg === null) {
        return;
    }
    $key = q_username_key($cfg['username']);
    $existing = q_row('SELECT password_hash FROM users WHERE username_key = ?', [$key]);
    $stale = $existing === null || !password_verify($cfg['password'], $existing['password_hash']);
    $hash = $stale ? password_hash($cfg['password'], PASSWORD_BCRYPT, ['cost' => 10]) : $existing['password_hash'];
    q_run(
        'INSERT INTO users (username, username_key, password_hash, energy, coins, created_at) VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash),
           energy = GREATEST(energy, VALUES(energy)), coins = GREATEST(coins, VALUES(coins))',
        [$cfg['username'], $key, $hash, Q_UNLIMITED_BALANCE, Q_UNLIMITED_BALANCE, q_now()]
    );
}

/* ----------------------------------------------------- rate limiting */

function q_rl_key(string $key): string
{
    return sha1($key);
}

function q_throttled(string $key): bool
{
    $r = q_row('SELECT cnt, until_ms FROM rate_limits WHERE k = ?', [q_rl_key($key)]);
    return $r !== null && (int) $r['cnt'] >= 8 && (int) $r['until_ms'] > q_now();
}

function q_note_failure(string $key): void
{
    $now = q_now();
    q_run(
        'INSERT INTO rate_limits (k, cnt, until_ms) VALUES (?, 1, ?)
         ON DUPLICATE KEY UPDATE cnt = IF(until_ms > ?, cnt + 1, 1), until_ms = IF(until_ms > ?, until_ms, ?)',
        [q_rl_key($key), $now + 600000, $now, $now, $now + 600000]
    );
    if (mt_rand(1, 50) === 1) {
        q_run('DELETE FROM rate_limits WHERE until_ms < ?', [$now]);
        q_run('DELETE FROM sessions WHERE expires_at < ?', [$now]);
    }
}

function q_clear_failures(string $key): void
{
    q_run('DELETE FROM rate_limits WHERE k = ?', [q_rl_key($key)]);
}

/* ------------------------------------------------------ users/sessions */

function q_get_user(int $id): ?array
{
    return q_row('SELECT * FROM users WHERE id = ?', [$id]);
}

function q_ensure_terrain(array &$u): array
{
    $id = (int) $u['id'];
    if (empty($u['terrain'])) {
        $u['terrain'] = q_default_terrain($id);
        q_run('UPDATE users SET terrain = ? WHERE id = ?', [$u['terrain'], $id]);
        q_run('INSERT IGNORE INTO user_terrains (user_id, terrain) VALUES (?, ?)', [$id, $u['terrain']]);
    }
    $owned = array_map(
        static function ($r) { return $r['terrain']; },
        q_rows('SELECT terrain FROM user_terrains WHERE user_id = ? ORDER BY terrain', [$id])
    );
    if (!in_array($u['terrain'], $owned, true)) {
        q_run('INSERT IGNORE INTO user_terrains (user_id, terrain) VALUES (?, ?)', [$id, $u['terrain']]);
        $owned[] = $u['terrain'];
    }
    return ['terrain' => $u['terrain'], 'owned' => $owned];
}

function q_public_user(array $u): array
{
    $t = q_ensure_terrain($u);
    $n = (int) q_val('SELECT COUNT(*) FROM prayers WHERE user_id = ?', [(int) $u['id']]);
    $last = $u['last_checkin'];
    return [
        'id' => (int) $u['id'],
        'username' => $u['username'],
        'energy' => (int) $u['energy'],
        'coins' => (int) $u['coins'],
        'streak' => ($last === q_today() || $last === q_yesterday()) ? (int) $u['streak'] : 0,
        'checkedInToday' => $last === q_today(),
        'prayerCount' => $n,
        'stage' => q_stage_of($n),
        'terrain' => $t['terrain'],
        'ownedTerrains' => $t['owned'],
    ];
}

function q_reload_public(int $id): array
{
    return q_public_user(q_get_user($id));
}

function q_session_tokens(): array
{
    $tokens = [];
    if (preg_match('/^Bearer\s+(\S+)$/Di', q_header('authorization'), $m)) {
        $tokens[] = $m[1];
    }
    $cookie = $_COOKIE[Q_SESSION_COOKIE] ?? '';
    if (is_string($cookie) && $cookie !== '') {
        $tokens[] = $cookie;
    }
    return array_values(array_unique($tokens));
}

function q_start_session(int $userId): string
{
    $token = q_new_token();
    q_run('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)', [q_hash_token($token), $userId, q_now() + Q_SESSION_TTL_MS]);
    q_set_session_cookie($token);
    return $token;
}

function q_current_user(): ?array
{
    foreach (q_session_tokens() as $token) {
        $row = q_row('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?', [q_hash_token($token)]);
        if ($row === null) {
            continue;
        }
        if ((int) $row['expires_at'] < q_now()) {
            q_run('DELETE FROM sessions WHERE token_hash = ?', [q_hash_token($token)]);
            continue;
        }
        $user = q_get_user((int) $row['user_id']);
        if ($user !== null) {
            return $user;
        }
    }
    return null;
}

function q_str($v): string
{
    return is_string($v) ? $v : '';
}

/* ------------------------------------------------------------ handlers */

function h_register()
{
    $b = q_request_body();
    $username = q_trim(q_str($b['username'] ?? null));
    $password = q_str($b['password'] ?? null);
    if (!preg_match('/^[\p{L}\p{N}_-]{2,20}$/uD', $username)) {
        return q_fail('用户名需为 2-20 位的字母、数字、汉字、下划线或短横线');
    }
    $plen = q_utf16_length($password);
    if ($plen < 6 || $plen > 72) {
        return q_fail('密码长度需在 6-72 位之间');
    }
    $key = 'reg:' . q_client_ip();
    if (q_throttled($key)) {
        return q_fail('操作过于频繁，请稍后再试', 429);
    }
    $taken = q_row('SELECT 1 FROM users WHERE username_key = ?', [q_username_key($username)]);
    if (!$taken && q_is_test_account(q_test_account(), $username)) {
        q_ensure_test_account();
        $taken = true;
    }
    if ($taken) {
        return q_fail('用户名已被使用', 409);
    }
    $hash = password_hash($password, PASSWORD_BCRYPT, ['cost' => 10]);
    try {
        [$id] = q_run(
            'INSERT INTO users (username, username_key, password_hash, energy, coins, created_at) VALUES (?, ?, ?, ?, 0, ?)',
            [$username, q_username_key($username), $hash, Q_START_ENERGY, q_now()]
        );
    } catch (PDOException $e) {
        if (($e->errorInfo[1] ?? 0) === 1062) {
            return q_fail('用户名已被使用', 409);
        }
        throw $e;
    }
    q_note_failure($key);
    $token = q_start_session($id);
    $u = q_get_user($id);
    q_ensure_terrain($u);
    q_json(['user' => q_reload_public($id), 'token' => $token]);
}

function h_login()
{
    $b = q_request_body();
    $username = q_trim(q_str($b['username'] ?? null));
    $password = q_str($b['password'] ?? null);
    $key = 'login:' . q_client_ip() . ':' . q_lower($username);
    if (q_throttled($key)) {
        return q_fail('尝试次数过多，请 10 分钟后再试', 429);
    }
    if (q_is_test_account(q_test_account(), $username)) {
        q_ensure_test_account();
    }
    $u = q_row('SELECT * FROM users WHERE username_key = ?', [q_username_key($username)]);
    $ok = $u !== null && password_verify($password, $u['password_hash']);
    if ($u === null || !$ok) {
        q_note_failure($key);
        return q_fail('用户名或密码错误', 401);
    }
    q_clear_failures($key);
    $token = q_start_session((int) $u['id']);
    q_json(['user' => q_public_user($u), 'token' => $token]);
}

function h_logout()
{
    foreach (q_session_tokens() as $token) {
        q_run('DELETE FROM sessions WHERE token_hash = ?', [q_hash_token($token)]);
    }
    q_clear_session_cookie();
    q_json(['ok' => true]);
}

function h_me()
{
    $u = q_current_user();
    q_json(['user' => $u ? q_public_user($u) : null, 'mode' => (string) q_cfg('MODE', 'local')]);
}

function h_config()
{
    q_json([
        'items' => q_items(),
        'packs' => q_packs(),
        'terrains' => q_terrains(),
        'maxWishLength' => Q_MAX_WISH_LENGTH,
        'mode' => (string) q_cfg('MODE', 'local'),
    ]);
}

function h_checkin()
{
    $u = q_current_user();
    if (!$u) {
        return q_fail('请先登录', 401);
    }
    $id = (int) $u['id'];
    $gained = q_tx(static function () use ($id) {
        $fresh = q_row('SELECT * FROM users WHERE id = ? FOR UPDATE', [$id]);
        if ($fresh['last_checkin'] === q_today()) {
            return null;
        }
        $streak = $fresh['last_checkin'] === q_yesterday() ? (int) $fresh['streak'] + 1 : 1;
        $reward = q_checkin_reward($streak);
        q_run('UPDATE users SET energy = energy + ?, streak = ?, last_checkin = ? WHERE id = ?', [$reward, $streak, q_today(), $id]);
        return $reward;
    });
    if ($gained === null) {
        return q_fail('今天已经签到过了', 409);
    }
    q_json(['gained' => $gained, 'user' => q_reload_public($id)]);
}

function h_pray()
{
    $u = q_current_user();
    if (!$u) {
        return q_fail('请先登录', 401);
    }
    $b = q_request_body();
    $item = q_find(q_items(), $b['item'] ?? null);
    if (!$item) {
        return q_fail('请选择祈福道具');
    }
    $text = q_trim(q_str($b['text'] ?? null));
    if ($text === '') {
        return q_fail('请写下你的心愿');
    }
    if (q_codepoints($text) > Q_MAX_WISH_LENGTH) {
        return q_fail('心愿最多 ' . Q_MAX_WISH_LENGTH . ' 字');
    }
    $id = (int) $u['id'];
    $cfg = q_test_account();
    $res = q_tx(static function () use ($id, $item, $text, $cfg) {
        $fresh = q_row('SELECT * FROM users WHERE id = ? FOR UPDATE', [$id]);
        $balance = (int) ($item['currency'] === 'energy' ? $fresh['energy'] : $fresh['coins']);
        $unlimited = q_is_test_account($cfg, $fresh['username']);
        if (!$unlimited && $balance < $item['cost']) {
            return ['error' => $item['currency'] === 'energy' ? '能量不足，去签到或使用福币道具吧' : '福币不足，请先充值'];
        }
        if ($unlimited) {
            q_run('UPDATE users SET energy = GREATEST(energy, ?), coins = GREATEST(coins, ?) WHERE id = ?', [Q_UNLIMITED_BALANCE, Q_UNLIMITED_BALANCE, $id]);
        } elseif ($item['currency'] === 'energy') {
            q_run('UPDATE users SET energy = energy - ? + ? WHERE id = ?', [$item['cost'], $item['reward'], $id]);
        } else {
            q_run('UPDATE users SET coins = coins - ?, energy = energy + ? WHERE id = ?', [$item['cost'], $item['reward'], $id]);
        }
        q_val("SELECT v FROM meta WHERE k = 'prayer_lock' FOR UPDATE");
        $position = (int) q_val('SELECT COUNT(*) FROM prayers');
        [$pid] = q_run(
            'INSERT INTO prayers (user_id, item_type, text, position, created_at) VALUES (?, ?, ?, ?, ?)',
            [$id, $item['id'], $text, $position, q_now()]
        );
        return ['id' => $pid, 'position' => $position];
    });
    if (isset($res['error'])) {
        return q_fail($res['error'], 402);
    }
    q_json([
        'tag' => [
            'id' => $res['id'],
            'itemType' => $item['id'],
            'text' => $text,
            'position' => $res['position'],
            'username' => $u['username'],
            'createdAt' => q_now(),
            'mine' => true,
        ],
        'reward' => $item['reward'],
        'user' => q_reload_public($id),
    ]);
}

function h_terrain()
{
    $u = q_current_user();
    if (!$u) {
        return q_fail('请先登录', 401);
    }
    $b = q_request_body();
    $def = q_find(q_terrains(), $b['terrain'] ?? null);
    if (!$def) {
        return q_fail('未知的地形');
    }
    q_ensure_terrain($u);
    $id = (int) $u['id'];
    $cfg = q_test_account();
    $res = q_tx(static function () use ($id, $def, $cfg) {
        $fresh = q_row('SELECT * FROM users WHERE id = ? FOR UPDATE', [$id]);
        $owned = q_row('SELECT 1 FROM user_terrains WHERE user_id = ? AND terrain = ?', [$id, $def['id']]);
        $spent = 0;
        if (!$owned) {
            $unlimited = q_is_test_account($cfg, $fresh['username']);
            if (!$unlimited && (int) $fresh['coins'] < $def['price']) {
                return ['error' => '福币不足，请先充值'];
            }
            if (!$unlimited) {
                q_run('UPDATE users SET coins = coins - ? WHERE id = ?', [$def['price'], $id]);
            }
            q_run('INSERT INTO user_terrains (user_id, terrain) VALUES (?, ?)', [$id, $def['id']]);
            $spent = $unlimited ? 0 : $def['price'];
        }
        q_run('UPDATE users SET terrain = ? WHERE id = ?', [$def['id'], $id]);
        return ['spent' => $spent];
    });
    if (isset($res['error'])) {
        return q_fail($res['error'], 402);
    }
    q_json(['spent' => $res['spent'], 'user' => q_reload_public($id)]);
}

function h_topup()
{
    $u = q_current_user();
    if (!$u) {
        return q_fail('请先登录', 401);
    }
    if (q_pay_mode() !== 'demo') {
        return q_fail('已启用支付宝充值，请使用支付宝支付', 403);
    }
    $b = q_request_body();
    $pack = q_find(q_packs(), $b['pack'] ?? null);
    if (!$pack) {
        return q_fail('请选择充值档位');
    }
    $id = (int) $u['id'];
    q_tx(static function () use ($id, $pack) {
        q_run('UPDATE users SET coins = coins + ? WHERE id = ?', [$pack['coins'], $id]);
        q_run('INSERT INTO topups (user_id, pack_id, coins, created_at) VALUES (?, ?, ?, ?)', [$id, $pack['id'], $pack['coins'], q_now()]);
    });
    q_json(['added' => $pack['coins'], 'demo' => true, 'user' => q_reload_public($id)]);
}

function h_prayers()
{
    $me = q_current_user();
    $rows = q_rows(
        'SELECT p.id, p.item_type, p.text, p.position, p.created_at, p.user_id, u.username
         FROM prayers p JOIN users u ON u.id = p.user_id
         ORDER BY p.id DESC LIMIT ' . Q_TAG_LIMIT
    );
    $total = (int) q_val('SELECT COUNT(*) FROM prayers');
    $recent = (int) q_val('SELECT COUNT(*) FROM prayers WHERE created_at > ?', [q_now() - 24 * 3600 * 1000]);
    $tags = [];
    foreach (array_reverse($rows) as $r) {
        $tags[] = [
            'id' => (int) $r['id'],
            'itemType' => $r['item_type'],
            'text' => $r['text'],
            'position' => (int) $r['position'],
            'username' => $r['username'],
            'createdAt' => (int) $r['created_at'],
            'mine' => $me !== null && (int) $me['id'] === (int) $r['user_id'],
        ];
    }
    q_json(['tags' => $tags, 'total' => $total, 'recent24h' => $recent]);
}

function q_dispatch(): void
{
    if (q_apply_cors()) {
        return;
    }
    $routes = [
        'POST /register' => 'h_register',
        'POST /login' => 'h_login',
        'POST /logout' => 'h_logout',
        'GET /me' => 'h_me',
        'GET /config' => 'h_config',
        'POST /checkin' => 'h_checkin',
        'POST /pray' => 'h_pray',
        'POST /terrain' => 'h_terrain',
        'POST /topup' => 'h_topup',
        'GET /prayers' => 'h_prayers',
        'GET /pay/info' => 'h_pay_info',
        'POST /pay/alipay/create' => 'h_pay_create',
        'GET /pay/alipay/query' => 'h_pay_query',
        'POST /pay/alipay/recheck' => 'h_pay_recheck',
        'POST /pay/alipay/notify' => 'h_pay_notify',
        'GET /pay/alipay/notify' => 'h_pay_notify',
        'GET /pay/alipay/return' => 'h_pay_return',
    ];
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    if ($method === 'HEAD') {
        $method = 'GET';
    }
    $handler = $routes[$method . ' ' . q_route_path()] ?? null;
    if ($handler === null) {
        q_discard_output();
        http_response_code(404);
        header('Content-Type: text/plain; charset=UTF-8');
        echo '404 Not Found';
        return;
    }
    $handler();
}
