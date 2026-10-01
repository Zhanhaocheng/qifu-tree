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
    return $pdo;
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
