#!/usr/bin/env bash
# 真实短信发送测试（美联软通 5C）：在你自己的电脑上用真实手机号发一条验证码短信，并打印平台的原始返回。
# 用来判断：接口/凭据是否可用、是否需要先报备签名/模板（返回里出现 Black keywords / 签名 / 模板 之类的提示时）。
#
# 用法（凭据只放环境变量，不要写进文件、不要提交 Git）：
#   export SMS_USERNAME='平台用户名'
#   export SMS_PASSWORD_MD5='32位MD5密码'
#   export SMS_APIKEY='apikey'
#   ./scripts/sms-send-test.sh 13800138000            # 会先让你确认，再真实发送一条
#   ./scripts/sms-send-test.sh 13800138000 -y         # 不再确认
#   ./scripts/sms-send-test.sh 13800138000 --dry-run  # 只打印将要发送的内容（凭据打码），不联网
# 可选环境变量：SMS_SIGN（默认【阳光互联】）、SMS_API_URL（默认 https://m.5c.com.cn/api/send/index.php；
#   如果提示证书错误，可临时改成 http://m.5c.com.cn/api/send/index.php）、SMS_CODE（指定验证码，默认随机 6 位）
# 兼容 macOS 自带 bash 3.2 / curl。
set -u

MOBILE="${1:-}"
YES=0; DRY=0
shift || true
for a in "$@"; do
  case "$a" in
    -y|--yes) YES=1 ;;
    --dry-run) DRY=1 ;;
    *) echo "未知参数：$a"; exit 2 ;;
  esac
done

if ! printf '%s' "$MOBILE" | grep -Eq '^1[3-9][0-9]{9}$'; then
  echo "用法：$0 <11位手机号> [-y] [--dry-run]"; exit 2
fi
for v in SMS_USERNAME SMS_PASSWORD_MD5 SMS_APIKEY; do
  if [ -z "${!v:-}" ]; then echo "缺少环境变量 $v（见脚本开头的用法）"; exit 2; fi
done
if ! printf '%s' "$SMS_PASSWORD_MD5" | grep -Eq '^[0-9a-fA-F]{32}$'; then
  echo "SMS_PASSWORD_MD5 必须是 32 位十六进制 MD5"; exit 2
fi

SIGN="${SMS_SIGN:-【阳光互联】}"
case "$SIGN" in 【*) ;; *) SIGN="【${SIGN}】" ;; esac
URL="${SMS_API_URL:-https://m.5c.com.cn/api/send/index.php}"
CODE="${SMS_CODE:-$(printf '%06d' $(( (RANDOM * 32768 + RANDOM) % 1000000 )))}"
CONTENT="${SIGN}您的验证码是${CODE}，5分钟内有效。"
MD5LOWER="$(printf '%s' "$SMS_PASSWORD_MD5" | tr 'A-F' 'a-f')"
mask() { printf '%s' "$1" | awk '{ n=length($0); if (n<=4) print "****"; else print substr($0,1,2) "****" substr($0,n-1) }'; }

echo "接口：$URL"
echo "手机：${MOBILE:0:3}****${MOBILE:7}"
echo "内容：$CONTENT"
echo "凭据：username=$(mask "$SMS_USERNAME") apikey=$(mask "$SMS_APIKEY") password_md5=$(mask "$MD5LOWER")"

if [ "$DRY" = 1 ]; then echo "(dry-run：未联网，未发送)"; exit 0; fi
if [ "$YES" != 1 ]; then
  printf '将向 %s 真实发送一条短信（会消耗短信条数）。继续？[y/N] ' "$MOBILE"
  read -r ans; case "$ans" in y|Y|yes) ;; *) echo "已取消"; exit 1 ;; esac
fi

RESP="$(curl -sS -m 20 -w '\n__HTTP__%{http_code}' "$URL" \
  --data-urlencode "username=$SMS_USERNAME" \
  --data-urlencode "password_md5=$MD5LOWER" \
  --data-urlencode "apikey=$SMS_APIKEY" \
  --data-urlencode "mobile=$MOBILE" \
  --data-urlencode "content=$CONTENT" \
  --data-urlencode "encode=UTF-8" 2>&1)"
RC=$?
HTTP="${RESP##*__HTTP__}"; BODY="${RESP%$'\n'__HTTP__*}"
echo "----------------------------------------"
if [ $RC -ne 0 ]; then
  echo "curl 失败（退出码 $RC）：$BODY"
  echo "→ 网络不通或证书问题。可试：SMS_API_URL=http://m.5c.com.cn/api/send/index.php"; exit 3
fi
echo "HTTP 状态：$HTTP"
echo "平台原始返回：$BODY"
echo "----------------------------------------"

case "$BODY" in
  success:*)                      echo "含义：提交成功（msgid 为平台流水号）。请查看手机是否收到短信；没收到时到 m.5c.com.cn 后台看发送状态/状态报告。" ;;
  *"Missing username"*)           echo "含义：用户名为空" ;;
  *"Missing password"*)           echo "含义：密码为空" ;;
  *"Missing apikey"*)             echo "含义：APIKEY 为空" ;;
  *"Missing recipient"*)          echo "含义：手机号为空" ;;
  *"Missing message content"*)    echo "含义：短信内容为空或编码不正确" ;;
  *"Account is blocked"*)         echo "含义：账号被禁用，联系平台客服" ;;
  *"Unrecognized encoding"*)      echo "含义：编码未能识别（应为 UTF-8）" ;;
  *"APIKEY or password error"*)   echo "含义：APIKEY 或密码错误，检查 SMS_APIKEY / SMS_PASSWORD_MD5" ;;
  *"Unauthorized IP address"*)    echo "含义：未授权 IP。平台开了 IP 白名单：把本机出口 IP（以及线上服务器 IP）加入白名单，或关闭白名单" ;;
  *"balance is insufficient"*)    echo "含义：余额不足，请充值" ;;
  *"Throughput Rate Exceeded"*)   echo "含义：发送频率受限，稍后再试" ;;
  *"Invalid md5 password length"*) echo "含义：MD5 密码长度不是 32 位" ;;
  *"Black keywords"*)             echo "含义：内容命中屏蔽词，需要调整文案" ;;
  error:*)                        echo "含义：平台拒绝。若提示与签名/模板/报备相关，说明需要先在平台报备签名或模板；其余请把上面原始返回发给开发者" ;;
  *)                              echo "含义：未识别的返回，请把上面的原始返回发给开发者" ;;
esac
