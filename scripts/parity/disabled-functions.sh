#!/usr/bin/env bash
# 模拟共享主机的 disable_functions：在函数被禁用 + display_errors=1（最坏情况）下运行 diag / install / 全部主要接口。
# 需要 QIFU_DB_* 指向可清空的测试库。用法：scripts/parity/disabled-functions.sh [site目录，默认 php-backend]
set -uo pipefail
cd "$(dirname "$0")/../.."
: "${QIFU_DB_NAME:?set QIFU_DB_* to a scratch database}"
SRC="${1:-php-backend}"
TYPICAL="set_time_limit,ini_set,ini_alter,ini_restore,ignore_user_abort,putenv,error_reporting,header_remove,fastcgi_finish_request,opcache_get_status,opcache_reset,opcache_invalidate,apache_request_headers,getallheaders,exec,passthru,shell_exec,system,proc_open,popen,dl,openlog,syslog,symlink,link,chmod,chown"
EXTREME="$TYPICAL,getenv,ini_get,error_log,usleep,sleep,ctype_digit,mb_strtolower,random_bytes,openssl_random_pseudo_bytes,fopen,fgets,fclose,file_put_contents,fwrite,register_shutdown_function,error_get_last,set_error_handler"
SECRET=disabled-fn-secret-123456
PORT=47360
rc=0
for level in none typical extreme; do
  case $level in none) LIST="";; typical) LIST="$TYPICAL";; extreme) LIST="$EXTREME";; esac
  TMP=$(mktemp -d); mkdir -p "$TMP/site"; cp -r "$SRC/api" "$TMP/site/api"
  cat > "$TMP/site/api/config.php" <<PHPEOF
<?php
if (!defined('QIFU')) { http_response_code(403); exit; }
return ['DB_HOST'=>'${QIFU_DB_HOST:-127.0.0.1}','DB_PORT'=>(int)'${QIFU_DB_PORT:-3306}','DB_NAME'=>'$QIFU_DB_NAME','DB_USER'=>'$QIFU_DB_USER','DB_PASS'=>'$QIFU_DB_PASS',
  'INSTALL_SECRET'=>'$SECRET','TRUST_PROXY_HEADERS'=>true,'ALLOWED_ORIGINS'=>['http://qifu.laixi.cn']];
PHPEOF
  cat > "$TMP/router.php" <<'PHPEOF'
<?php
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$file = __DIR__ . '/site' . $path;
if (is_file($file) && substr($file, -4) === '.php' && basename($file) !== 'config.php' && strpos($path, '/api/lib/') !== 0) { return false; }
require __DIR__ . '/site/api/index.php';
PHPEOF
  # 清空测试库（QIFU_DB_* 的环境变量只用于这一步）
  QIFU_DB_HOST="${QIFU_DB_HOST:-127.0.0.1}" QIFU_DB_PORT="${QIFU_DB_PORT:-3306}" php -r '
    $p=new PDO("mysql:host=".getenv("QIFU_DB_HOST").";port=".getenv("QIFU_DB_PORT").";dbname=".getenv("QIFU_DB_NAME"),getenv("QIFU_DB_USER"),getenv("QIFU_DB_PASS"));
    $p->exec("SET FOREIGN_KEY_CHECKS=0"); foreach($p->query("SHOW TABLES")->fetchAll(PDO::FETCH_COLUMN) as $t){$p->exec("DROP TABLE `$t`");}'
  env -u QIFU_DB_NAME -u QIFU_DB_USER -u QIFU_DB_PASS -u QIFU_DB_HOST -u QIFU_DB_PORT \
    php -d display_errors=1 -d error_reporting=-1 ${LIST:+-d disable_functions="$LIST"} -S 127.0.0.1:$PORT -t "$TMP/site" "$TMP/router.php" > "$TMP/php.log" 2>&1 &
  PID=$!
  sleep 1
  echo "=== disable_functions level: $level"
  node scripts/parity/smoke-flow.mjs "http://127.0.0.1:$PORT" "$SECRET" | grep -E "FAIL|^PASS install|^PASS diag" ; flowrc=${PIPESTATUS[0]}
  kill $PID 2>/dev/null; wait $PID 2>/dev/null
  bad=$(grep -E "Fatal|Warning|Notice|Deprecated|Uncaught" "$TMP/php.log" | grep -v "Accepted\|Closing" | head -5)
  if [ -n "$bad" ]; then echo "PHP log has problems:"; echo "$bad"; flowrc=1; fi
  [ "$flowrc" = 0 ] && echo "level $level: OK" || { echo "level $level: FAILED"; rc=1; }
  rm -rf "$TMP"
done
exit $rc
