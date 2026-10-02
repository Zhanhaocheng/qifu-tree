#!/usr/bin/env bash
# 短信验证码登录自动化测试（全部使用 mock / 本机假平台，不会调用真实短信平台）：
#   1) Node 单元/集成测试：npm test（server/sms.test.ts）
#   2) 同一套黑盒场景分别跑在 Node 和 PHP 上，并逐字对比两边的响应（parity）
#   3) PHP 真实发送层 vs 本机假平台（请求字段、失败提示不泄露细节）
#   4) 旧库升级：删掉两张新表后，PHP 首次访问 /sms/* 自动补建
# 需要 QIFU_DB_NAME / QIFU_DB_USER / QIFU_DB_PASS（可选 QIFU_DB_HOST、QIFU_DB_PORT）指向「可被清空的测试库」。
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${QIFU_DB_NAME:?set QIFU_DB_* to a scratch database}"
export QIFU_DB_HOST="${QIFU_DB_HOST:-127.0.0.1}" QIFU_DB_PORT="${QIFU_DB_PORT:-3306}"
export QIFU_TEST_NOW_FILE=/tmp/qifu-sms-clock QIFU_TRUST_PROXY_HEADERS=1 QIFU_INSTALL_SECRET=sms-install-secret-123
export QIFU_ALLOWED_ORIGINS=http://qifu.laixi.cn ALLOWED_ORIGINS=http://qifu.laixi.cn
echo 1768017600000 > "$QIFU_TEST_NOW_FILE"
NODE_PORT=47351; PHP_PORT=47352; PHP2_PORT=47353; FAKE_PORT=47354
OUT_NODE=/tmp/qifu-sms-outbox-node; OUT_PHP=/tmp/qifu-sms-outbox-php
for p in $NODE_PORT $PHP_PORT $PHP2_PORT $FAKE_PORT; do if (echo > /dev/tcp/127.0.0.1/$p) 2>/dev/null; then echo "port $p is busy"; exit 1; fi; done

php -r '
$p=new PDO("mysql:host=".getenv("QIFU_DB_HOST").";port=".getenv("QIFU_DB_PORT").";dbname=".getenv("QIFU_DB_NAME").";charset=utf8mb4",getenv("QIFU_DB_USER"),getenv("QIFU_DB_PASS"));
$p->exec("SET FOREIGN_KEY_CHECKS=0");
foreach($p->query("SHOW TABLES")->fetchAll(PDO::FETCH_COLUMN) as $t){$p->exec("DROP TABLE `$t`");}'

LIMITS_NODE="SMS_PHONE_DAILY_LIMIT=3 SMS_IP_DAILY_LIMIT=8 SMS_TOTAL_DAILY_LIMIT=1000"
env $LIMITS_NODE SMS_MOCK=1 SMS_MOCK_OUTBOX=$OUT_NODE PORT=$NODE_PORT node --import tsx scripts/parity/node-server.ts > /tmp/sms-node.log 2>&1 &
NODE_PID=$!
QIFU_SMS_MOCK=1 QIFU_SMS_MOCK_OUTBOX=$OUT_PHP QIFU_SMS_PHONE_DAILY_LIMIT=3 QIFU_SMS_IP_DAILY_LIMIT=8 QIFU_SMS_TOTAL_DAILY_LIMIT=1000 \
  php ${PHP_DISABLE_FUNCTIONS:+-d disable_functions=$PHP_DISABLE_FUNCTIONS} -S 127.0.0.1:$PHP_PORT -t php-backend scripts/parity/router.php > /tmp/sms-php.log 2>&1 &
PHP_PID=$!
trap 'kill $NODE_PID $PHP_PID ${PHP2_PID:-} 2>/dev/null || true; pkill -P $NODE_PID 2>/dev/null || true' EXIT
for i in $(seq 1 60); do curl -sf localhost:$NODE_PORT/api/config >/dev/null && curl -s -o /dev/null localhost:$PHP_PORT/api/config && break; sleep 0.5; done
curl -s -X POST -d "key=$QIFU_INSTALL_SECRET" localhost:$PHP_PORT/api/install.php | sed 's/<[^>]*>/ /g' | tr -s ' \n' | grep -o "sms_codes[^ ]* [^ ]* [^ ]*\|user_phones[^ ]* [^ ]* [^ ]*" || true

# 旧库升级：模拟「线上还没有这两张表」，让 PHP 首次请求时自动补建
php -r '
$p=new PDO("mysql:host=".getenv("QIFU_DB_HOST").";port=".getenv("QIFU_DB_PORT").";dbname=".getenv("QIFU_DB_NAME").";charset=utf8mb4",getenv("QIFU_DB_USER"),getenv("QIFU_DB_PASS"));
$p->exec("DROP TABLE sms_codes"); $p->exec("DROP TABLE user_phones");
echo "dropped sms tables to simulate an old database\n";'

node scripts/sms/e2e.mjs http://127.0.0.1:$NODE_PORT $OUT_NODE /tmp/sms-transcript-node.json
node scripts/sms/e2e.mjs http://127.0.0.1:$PHP_PORT $OUT_PHP /tmp/sms-transcript-php.json
tables=$(php -r '$p=new PDO("mysql:host=".getenv("QIFU_DB_HOST").";port=".getenv("QIFU_DB_PORT").";dbname=".getenv("QIFU_DB_NAME"),getenv("QIFU_DB_USER"),getenv("QIFU_DB_PASS")); echo implode(",",$p->query("SHOW TABLES LIKE \"%sms%\"")->fetchAll(PDO::FETCH_COLUMN)), ",", implode(",",$p->query("SHOW TABLES LIKE \"user_phones\"")->fetchAll(PDO::FETCH_COLUMN));')
echo "tables after lazy migration: $tables"
case "$tables" in *sms_codes*user_phones*) ;; *) echo "FAIL: tables not auto-created"; exit 1 ;; esac

if cmp -s /tmp/sms-transcript-node.json /tmp/sms-transcript-php.json; then
  echo "PARITY OK: Node and PHP transcripts are identical"
else
  echo "PARITY FAIL"; diff <(python3 -m json.tool /tmp/sms-transcript-node.json) <(python3 -m json.tool /tmp/sms-transcript-php.json) | head -40; exit 1
fi

# 真实发送层（PHP）对本机假平台
QIFU_SMS_MOCK= QIFU_SMS_USERNAME=fake-user QIFU_SMS_PASSWORD_MD5=ABCDEF0123456789ABCDEF0123456789 QIFU_SMS_APIKEY=fake-apikey \
  QIFU_SMS_API_URL=http://127.0.0.1:$FAKE_PORT/api/send/index.php QIFU_SMS_PHONE_DAILY_LIMIT=50 QIFU_SMS_IP_DAILY_LIMIT=500 \
  php ${PHP_DISABLE_FUNCTIONS:+-d disable_functions=$PHP_DISABLE_FUNCTIONS} -S 127.0.0.1:$PHP2_PORT -t php-backend scripts/parity/router.php > /tmp/sms-php2.log 2>&1 &
PHP2_PID=$!
sleep 1
node scripts/sms/provider.test.mjs http://127.0.0.1:$PHP2_PORT $FAKE_PORT
echo "ALL SMS TESTS PASSED"
