#!/usr/bin/env bash
# 支付宝充值自动化测试：PHP 单元测试 + 集成测试（真实 PHP 内置服务器 + MySQL/MariaDB，伪造的支付宝网关与临时密钥）。
# 需要 QIFU_DB_NAME / QIFU_DB_USER / QIFU_DB_PASS（可选 QIFU_DB_HOST、QIFU_DB_PORT）指向「可被清空的测试库」。
# 可选 PHP_DISABLE_FUNCTIONS=...：在函数被禁用的环境下运行集成测试。
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${QIFU_DB_NAME:?set QIFU_DB_* to a scratch database}"
php scripts/pay/unit.php
node --test scripts/pay/alipay.test.mjs
