#!/usr/bin/env bash
# 本地对比测试：Node(Hono+SQLite) vs PHP(built-in server + MySQL)。
# 需要环境变量 QIFU_DB_HOST/PORT/NAME/USER/PASS 指向一个「可被清空的测试库」。
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${QIFU_DB_NAME:?set QIFU_DB_* to a scratch database}"
export QIFU_DB_HOST="${QIFU_DB_HOST:-127.0.0.1}" QIFU_DB_PORT="${QIFU_DB_PORT:-3306}"
export QIFU_TEST_NOW_FILE=/tmp/qifu-parity-clock
export QIFU_TRUST_PROXY_HEADERS=1 QIFU_INSTALL_SECRET=parity-install-secret-123
export QIFU_ALLOWED_ORIGINS=http://qifu.laixi.cn,https://qifu-tree.vercel.app
export ALLOWED_ORIGINS="$QIFU_ALLOWED_ORIGINS"
echo 1768017600000 > "$QIFU_TEST_NOW_FILE"
NODE_PORT=47341; PHP_PORT=47342

# 清空测试库（仅限测试库！）并用 install.php 安装
php -r '
$p=new PDO("mysql:host=".getenv("QIFU_DB_HOST").";port=".getenv("QIFU_DB_PORT").";dbname=".getenv("QIFU_DB_NAME").";charset=utf8mb4",getenv("QIFU_DB_USER"),getenv("QIFU_DB_PASS"));
$p->exec("SET FOREIGN_KEY_CHECKS=0");
foreach($p->query("SHOW TABLES")->fetchAll(PDO::FETCH_COLUMN) as $t){$p->exec("DROP TABLE `$t`");}
'
for p in $NODE_PORT $PHP_PORT; do if (echo > /dev/tcp/127.0.0.1/$p) 2>/dev/null; then echo "port $p is busy; stop the old test servers first"; exit 1; fi; done
PORT=$NODE_PORT node --import tsx scripts/parity/node-server.ts > /tmp/parity-node.log 2>&1 &
NODE_PID=$!
php -S 127.0.0.1:$PHP_PORT -t php-backend scripts/parity/router.php > /tmp/parity-php.log 2>&1 &
PHP_PID=$!
trap 'kill $NODE_PID $PHP_PID 2>/dev/null || true; pkill -P $NODE_PID 2>/dev/null || true' EXIT
for i in $(seq 1 60); do curl -sf localhost:$NODE_PORT/api/config >/dev/null && curl -s -o /dev/null localhost:$PHP_PORT/api/config && break; sleep 0.5; done
curl -s -X POST -d "key=$QIFU_INSTALL_SECRET" localhost:$PHP_PORT/api/install.php | sed 's/<[^>]*>/ /g' | tr -s ' \n' | head -c 600; echo
node scripts/parity/run.mjs http://127.0.0.1:$NODE_PORT http://127.0.0.1:$PHP_PORT
