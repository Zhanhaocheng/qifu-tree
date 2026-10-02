-- 祈福树：为已有的 users 表补上「昵称 / 头像 / 年龄」三列（MySQL 5.5+ / MariaDB 均可）。
-- 通常不需要手动执行：新版 api 第一次访问数据库时会自动完成同样的升级。
-- 只有在数据库账号没有 ALTER 权限、自动升级失败时，才在 phpMyAdmin 里手动执行本文件。
-- 每条 ALTER 只能执行一次；如果提示 "Duplicate column name"，说明该列已经存在，跳过即可。
-- 只增加可为空的新列，不修改、不删除任何现有数据。

ALTER TABLE users ADD COLUMN nickname VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL;
ALTER TABLE users ADD COLUMN avatar TEXT CHARACTER SET ascii COLLATE ascii_bin NULL;
ALTER TABLE users ADD COLUMN age SMALLINT NULL;

-- 已有用户的昵称默认等于用户名（可重复执行）
UPDATE users SET nickname = username WHERE nickname IS NULL;
