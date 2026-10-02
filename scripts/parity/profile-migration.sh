#!/usr/bin/env bash
# 验证 PHP 端对「老库」的自动补列：用旧版 users 表（没有 nickname/avatar/age）+ 已有用户，
# 并发打一批请求，确认：补列成功且只补一次、已有数据不变、已有用户昵称=用户名、资料可保存；
# 再验证数据库账号没有 ALTER 权限时接口降级而不是整站报错。
# 需要 QIFU_DB_NAME/USER/PASS 指向可清空的测试库；降级场景还需要 mysql root 权限（sudo mysql）。
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${QIFU_DB_NAME:?set QIFU_DB_* to a scratch database}"
export QIFU_DB_HOST="${QIFU_DB_HOST:-127.0.0.1}" QIFU_DB_PORT="${QIFU_DB_PORT:-3306}" QIFU_TRUST_PROXY_HEADERS=1
PORT=47351
fail() { echo "FAIL: $*"; exit 1; }
sql() { php -r '
$p=new PDO("mysql:host=".getenv("QIFU_DB_HOST").";port=".getenv("QIFU_DB_PORT").";dbname=".getenv("QIFU_DB_NAME").";charset=utf8mb4",getenv("QIFU_DB_USER"),getenv("QIFU_DB_PASS"));
$r=$p->query($argv[1]); if($r){foreach($r->fetchAll(PDO::FETCH_NUM) as $row){echo implode("|",array_map("strval",$row)),"\n";}}' "$1"; }

reset_old_schema() {
  php -r '
$p=new PDO("mysql:host=".getenv("QIFU_DB_HOST").";port=".getenv("QIFU_DB_PORT").";dbname=".getenv("QIFU_DB_NAME").";charset=utf8mb4",getenv("QIFU_DB_USER"),getenv("QIFU_DB_PASS"));
$p->exec("SET FOREIGN_KEY_CHECKS=0");
foreach($p->query("SHOW TABLES")->fetchAll(PDO::FETCH_COLUMN) as $t){$p->exec("DROP TABLE `$t`");}
$s=file_get_contents("php-backend/api/lib/schema.sql");
$s=preg_replace("/^\s*(nickname|avatar|age) .*\n/m","",$s);
$s=preg_replace("/^--.*$/m","",$s);
foreach(explode(";\n",$s."\n") as $st){$st=trim($st); if($st!=="")$p->exec($st);}
$h=password_hash("123456",PASSWORD_BCRYPT,["cost"=>4]);
$ins=$p->prepare("INSERT INTO users (username,username_key,password_hash,energy,coins,streak,created_at) VALUES (?,?,?,?,?,?,?)");
$ins->execute(["老用户","老用户",$h,11,22,3,1]); $ins->execute(["Bob_B","bob_b",$h,5,6,0,2]);
'
  sql "SHOW COLUMNS FROM users LIKE 'nickname'" | grep -q . && fail "old schema should not have nickname"
  return 0
}

start_php() { # $1 = DB user, $2 = DB pass
  QIFU_DB_USER="$1" QIFU_DB_PASS="$2" QIFU_TEST_NOW_FILE=/nonexistent php -S 127.0.0.1:$PORT -t php-backend scripts/parity/router.php > /tmp/php-migrate.log 2>&1 &
  PHP_PID=$!
  for i in $(seq 1 40); do curl -s -o /dev/null localhost:$PORT/api/config && break; sleep 0.25; done
}
stop_php() { kill $PHP_PID 2>/dev/null || true; wait $PHP_PID 2>/dev/null || true; }
trap 'stop_php' EXIT

echo "== 1. 老库 + 并发首次访问"
reset_old_schema
start_php "$QIFU_DB_USER" "$QIFU_DB_PASS"
PIDS=""
for i in $(seq 1 12); do curl -s -o /dev/null -X POST -H 'x-forwarded-for: 10.2.0.'$i -d '{"username":"老用户","password":"123456"}' "localhost:$PORT/api/login" & PIDS="$PIDS $!"; done
wait $PIDS
sql "SHOW COLUMNS FROM users" | cut -d'|' -f1 | tr '\n' ' '; echo
for c in nickname avatar age; do sql "SHOW COLUMNS FROM users LIKE '$c'" | grep -q . || fail "column $c missing"; done
[ "$(sql "SELECT COUNT(*) FROM users WHERE nickname IS NULL")" = "0" ] || fail "nickname not backfilled"
[ "$(sql "SELECT nickname FROM users WHERE username='老用户'")" = "老用户" ] || fail "nickname != username"
[ "$(sql "SELECT energy,coins,streak FROM users WHERE username='老用户'")" = "11|22|3" ] || fail "existing data changed"
LOGIN=$(curl -s -i -X POST -H 'x-forwarded-for: 10.2.1.1' -d '{"username":"老用户","password":"123456"}' "localhost:$PORT/api/login")
echo "$LOGIN" | grep -q '"nickname":"老用户","avatar":null,"age":null' || fail "login user lacks profile fields: $LOGIN"
TOKEN=$(echo "$LOGIN" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
R=$(curl -s -X PUT -H "authorization: Bearer $TOKEN" -d '{"nickname":"新昵称","age":30,"avatar":"preset:crane"}' "localhost:$PORT/api/profile")
echo "$R" | grep -q '"nickname":"新昵称","avatar":"preset:crane","age":30' || fail "profile save failed: $R"
curl -s "localhost:$PORT/api/prayers" | grep -q '"tags":\[\]' || fail "prayers broke"
stop_php
echo "ok"

echo "== 2. 没有 ALTER 权限：降级运行"
reset_old_schema
sudo mysql -e "CREATE USER IF NOT EXISTS 'qifu_ro'@'127.0.0.1' IDENTIFIED BY 'ropass'; GRANT SELECT,INSERT,UPDATE,DELETE ON \`$QIFU_DB_NAME\`.* TO 'qifu_ro'@'127.0.0.1'; FLUSH PRIVILEGES;"
start_php qifu_ro ropass
LOGIN=$(curl -s -X POST -H 'x-forwarded-for: 10.2.2.1' -d '{"username":"Bob_B","password":"123456"}' "localhost:$PORT/api/login")
echo "$LOGIN" | grep -q '"nickname":"Bob_B","avatar":null,"age":null' || fail "degraded login should fall back to username: $LOGIN"
TOKEN=$(echo "$LOGIN" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
R=$(curl -s -w ' %{http_code}' -X PUT -H "authorization: Bearer $TOKEN" -d '{"nickname":"x"}' "localhost:$PORT/api/profile")
echo "$R" | grep -q ' 503$' || fail "expected 503 when columns are missing: $R"
curl -s -o /dev/null -w '%{http_code}' -X POST -H 'x-forwarded-for: 10.2.2.2' -d '{"username":"降级新用户","password":"123456"}' "localhost:$PORT/api/register" | grep -q 200 || fail "register must still work"
curl -s "localhost:$PORT/api/prayers" | grep -q '"tags"' || fail "prayers must still work"
stop_php
sudo mysql -e "DROP USER IF EXISTS 'qifu_ro'@'127.0.0.1';"
echo "ok"
echo "PROFILE MIGRATION OK"
