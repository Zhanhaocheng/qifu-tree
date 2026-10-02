-- 祈福树 MySQL 表结构（MySQL 5.6+ / MariaDB 10+，InnoDB，utf8mb4）
-- 对应 Node 版 SQLite/libSQL 表结构。可重复执行（IF NOT EXISTS）。
--
-- 注意：SQLite 的 `username COLLATE NOCASE` 只对 ASCII 字母不区分大小写。
-- 为了精确一致，这里 username 用 utf8mb4_bin 保存原样，另设 username_key
-- （ASCII 小写后的用户名，utf8mb4_bin，唯一）负责「不区分大小写」唯一性与登录查找。
-- 不使用 utf8mb4_general_ci，因为它还会把 café/cafe、不同的生僻字/emoji 当成同一个名字。

CREATE TABLE IF NOT EXISTS users (
  id BIGINT NOT NULL AUTO_INCREMENT,
  username VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  username_key VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  password_hash VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  energy BIGINT NOT NULL DEFAULT 0,
  coins BIGINT NOT NULL DEFAULT 0,
  streak INT NOT NULL DEFAULT 0,
  last_checkin VARCHAR(10) CHARACTER SET ascii COLLATE ascii_bin NULL,
  terrain VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_username_key (username_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS user_terrains (
  user_id BIGINT NOT NULL,
  terrain VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  PRIMARY KEY (user_id, terrain),
  CONSTRAINT fk_user_terrains_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS prayers (
  id BIGINT NOT NULL AUTO_INCREMENT,
  user_id BIGINT NOT NULL,
  item_type VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  text TEXT CHARACTER SET utf8mb4 NOT NULL,
  position INT NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (id),
  KEY idx_prayers_user (user_id),
  KEY idx_prayers_created (created_at),
  CONSTRAINT fk_prayers_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sessions (
  token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  PRIMARY KEY (token_hash),
  KEY idx_sessions_user (user_id),
  KEY idx_sessions_expires (expires_at),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS topups (
  id BIGINT NOT NULL AUTO_INCREMENT,
  user_id BIGINT NOT NULL,
  pack_id VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  coins INT NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (id),
  KEY idx_topups_user (user_id),
  CONSTRAINT fk_topups_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Node 版把限流放在进程内存里；PHP 每次请求都是新进程，所以放到数据库。
CREATE TABLE IF NOT EXISTS rate_limits (
  k CHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  cnt INT NOT NULL,
  until_ms BIGINT NOT NULL,
  PRIMARY KEY (k)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 单行锁：让并发祈福分配到不重复的 position
CREATE TABLE IF NOT EXISTS meta (
  k VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  v VARCHAR(255) NOT NULL DEFAULT '',
  PRIMARY KEY (k)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO meta (k, v) VALUES ('prayer_lock', '');

-- 支付宝充值订单（待支付 pending / 已支付 paid / 已关闭 closed）。
-- 代码里也会在首次下单/通知时自动执行同一条 CREATE TABLE IF NOT EXISTS，所以老站点不重新安装也能用。
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
