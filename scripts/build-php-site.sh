#!/usr/bin/env bash
# 组装「PHP 虚拟主机」上传包：前端静态文件 + api/ + schema.sql
# 用法：scripts/build-php-site.sh [输出目录，默认 dist-php]
# 产物：<out>/qifu-php-site/（可直接 FTP 上传到 WEB 目录）、<out>/qifu-php-site.zip、
#       <out>/qifu-frontend-query-style.zip（主机不支持 URL 重写时，仅替换前端用）
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="${1:-dist-php}"
rm -rf "$OUT"; mkdir -p "$OUT"

# 1) 同域 REST 风格前端（不设置 VITE_API_BASE）
env -u VITE_API_BASE -u VITE_API_STYLE npm run build
SITE="$OUT/qifu-php-site"
mkdir -p "$SITE"
cp -r dist/. "$SITE/"
mkdir -p "$SITE/api"
cp -r php-backend/api/. "$SITE/api/"
rm -f "$SITE/api/config.php" "$SITE/api/import.sql"
cp php-backend/schema.sql "$SITE/schema.sql"
cp php-backend/upgrade-profile.sql "$SITE/upgrade-profile.sql"
cp php-backend/api/lib/schema.sql "$SITE/api/lib/schema.sql"

# 2) 查询风格前端（/api/index.php?path=/xxx），仅前端文件
env -u VITE_API_BASE VITE_API_STYLE=query npm run build
Q="$OUT/qifu-frontend-query-style"
mkdir -p "$Q"; cp -r dist/. "$Q/"

(cd "$OUT" && rm -f qifu-php-site.zip qifu-frontend-query-style.zip \
  && (cd qifu-php-site && zip -qr -X ../qifu-php-site.zip . -x '*.DS_Store') \
  && (cd qifu-frontend-query-style && zip -qr -X ../qifu-frontend-query-style.zip . -x '*.DS_Store'))

# 恢复默认构建产物，避免把查询风格的 dist 留在本地
env -u VITE_API_BASE -u VITE_API_STYLE npm run build >/dev/null
echo "OK: $OUT/qifu-php-site.zip  $OUT/qifu-frontend-query-style.zip"
