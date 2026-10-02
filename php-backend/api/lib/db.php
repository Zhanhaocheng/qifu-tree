<?php
if (!defined('QIFU')) { http_response_code(403); exit; }

function q_pdo(): PDO
{
    static $pdo = null;
    if ($pdo !== null) {
        return $pdo;
    }
    if (!class_exists('PDO') || !in_array('mysql', PDO::getAvailableDrivers(), true)) {
        throw new RuntimeException('服务器 PHP 没有启用 pdo_mysql 扩展');
    }
    $name = (string) q_cfg('DB_NAME', '');
    if ($name === '') {
        throw new RuntimeException('数据库未配置：找不到 api/config.php 或 DB_NAME 为空');
    }
    $dsn = 'mysql:host=' . q_cfg('DB_HOST', 'localhost') . ';port=' . (int) q_cfg('DB_PORT', 3306) . ';dbname=' . $name . ';charset=utf8mb4';
    $pdo = new PDO($dsn, (string) q_cfg('DB_USER', ''), (string) q_cfg('DB_PASS', ''), [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
        PDO::ATTR_STRINGIFY_FETCHES => false,
    ]);
    $pdo->exec("SET NAMES utf8mb4");
    q_ensure_profile_columns($pdo);
    return $pdo;
}

/** 昵称/头像/年龄三列是否可用（老库升级失败时降级：昵称显示用户名，不能保存资料） */
function q_profile_ready(?bool $set = null): bool
{
    static $ready = false;
    if ($set !== null) {
        $ready = $set;
    }
    return $ready;
}

/**
 * 老站点的 users 表没有 nickname / avatar / age：首次访问时自动补列（和 pay_orders 自动建表同一思路）。
 * - 只用 SHOW COLUMNS + ALTER TABLE ... ADD COLUMN（MySQL 5.5/5.6 都支持），不改已有数据；
 * - 缺哪列补哪列；并发时后到的请求会遇到 1060（列已存在），忽略即可；
 * - 刚补上昵称列时，把已有用户的昵称回填为用户名；读取时 NULL 昵称也会回退为用户名，所以回填中断也无害；
 * - users 表还不存在（尚未运行 install.php）或没有 ALTER 权限时不抛错，接口降级运行。
 */
function q_ensure_profile_columns(PDO $pdo): void
{
    try {
        $have = [];
        foreach ($pdo->query('SHOW COLUMNS FROM `users`')->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $have[strtolower((string) $r['Field'])] = true;
        }
    } catch (Throwable $e) {
        return;
    }
    $cols = [
        'nickname' => 'VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL',
        'avatar' => 'TEXT CHARACTER SET ascii COLLATE ascii_bin NULL',
        'age' => 'SMALLINT NULL',
    ];
    $addedNickname = false;
    foreach ($cols as $name => $ddl) {
        if (isset($have[$name])) {
            continue;
        }
        try {
            $pdo->exec("ALTER TABLE `users` ADD COLUMN `$name` $ddl");
            $have[$name] = true;
            $addedNickname = $addedNickname || $name === 'nickname';
        } catch (Throwable $e) {
            if ($e instanceof PDOException && ($e->errorInfo[1] ?? 0) === 1060) {
                $have[$name] = true;
                continue;
            }
            q_log('profile column migration failed (' . $name . '): ' . $e->getMessage());
        }
    }
    if ($addedNickname) {
        try {
            $pdo->exec('UPDATE `users` SET `nickname` = `username` WHERE `nickname` IS NULL');
        } catch (Throwable $e) {
            q_log('nickname backfill failed: ' . $e->getMessage());
        }
    }
    q_profile_ready(isset($have['nickname'], $have['avatar'], $have['age']));
}

function q_exec(string $sql, array $args = []): PDOStatement
{
    $st = q_pdo()->prepare($sql);
    $st->execute(array_values($args));
    return $st;
}

function q_row(string $sql, array $args = []): ?array
{
    $r = q_exec($sql, $args)->fetch();
    return $r === false ? null : $r;
}

function q_rows(string $sql, array $args = []): array
{
    return q_exec($sql, $args)->fetchAll();
}

function q_val(string $sql, array $args = [])
{
    $r = q_exec($sql, $args)->fetch(PDO::FETCH_NUM);
    return $r === false ? null : $r[0];
}

/** 返回 [lastInsertId, affectedRows] */
function q_run(string $sql, array $args = []): array
{
    $st = q_exec($sql, $args);
    return [(int) q_pdo()->lastInsertId(), $st->rowCount()];
}

/** 事务；遇到死锁/锁等待超时自动重试 */
function q_tx(callable $fn)
{
    $pdo = q_pdo();
    for ($try = 1;; $try++) {
        $pdo->beginTransaction();
        try {
            $out = $fn();
            $pdo->commit();
            return $out;
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            $code = $e instanceof PDOException ? ($e->errorInfo[1] ?? 0) : 0;
            if (($code === 1213 || $code === 1205) && $try < 3) {
                q_sleep_ms(50 * $try);
                continue;
            }
            throw $e;
        }
    }
}
