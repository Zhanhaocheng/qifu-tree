<?php
// 支付宝库的纯函数单元测试（不连数据库、不联网）。用法：php scripts/pay/unit.php
define('QIFU', 1);
require __DIR__ . '/../../php-backend/api/lib/core.php';
require __DIR__ . '/../../php-backend/api/lib/db.php';
require __DIR__ . '/../../php-backend/api/lib/game.php';
require __DIR__ . '/../../php-backend/api/lib/alipay.php';

$fails = 0;
function check(string $name, bool $ok): void
{
    global $fails;
    echo ($ok ? 'PASS ' : 'FAIL ') . $name . "\n";
    if (!$ok) {
        $fails++;
    }
}
function gen_key(): array
{
    $res = openssl_pkey_new(['private_key_bits' => 2048, 'private_key_type' => OPENSSL_KEYTYPE_RSA]);
    openssl_pkey_export($res, $pkcs8);
    $det = openssl_pkey_get_details($res);
    return [$pkcs8, $det['key'], $res];
}
function strip_pem(string $pem): string
{
    return preg_replace('/-----[A-Z ]+-----|\s+/', '', $pem);
}

[$priv, $pub] = gen_key();

// 密钥格式归一化：带头尾 PEM、裸 base64（PKCS8）、裸 base64（PKCS1）、带字面 \n 的一行
$pkcs8Raw = strip_pem($priv);
check('private: PEM', q_ali_to_pem($priv, ['PRIVATE KEY', 'RSA PRIVATE KEY'], true) !== null);
check('private: raw base64 PKCS8', q_ali_to_pem($pkcs8Raw, ['PRIVATE KEY', 'RSA PRIVATE KEY'], true) !== null);
exec('openssl genrsa -traditional 2048 2>/dev/null', $lines);
$pkcs1 = implode("\n", $lines);
check('private: raw base64 PKCS1', strpos($pkcs1, 'BEGIN RSA PRIVATE KEY') !== false
    && q_ali_to_pem(strip_pem($pkcs1), ['PRIVATE KEY', 'RSA PRIVATE KEY'], true) !== null);
check('private: 字面 \\n 一行', q_ali_to_pem(str_replace("\n", '\\n', trim($priv)), ['PRIVATE KEY', 'RSA PRIVATE KEY'], true) !== null);
check('private: 垃圾输入返回 null', q_ali_to_pem('not a key!!', ['PRIVATE KEY'], true) === null);
check('public: raw base64', q_ali_to_pem(strip_pem($pub), ['PUBLIC KEY'], false) !== null);
check('public: 公钥不能当私钥', q_ali_to_pem($pub, ['PRIVATE KEY'], true) === null);

// 签名内容：排序、跳过空值、排除 sign
$content = q_ali_sign_content(['b' => '2', 'a' => '1', 'c' => '', 'sign' => 'x', 'd' => null, 'e' => 'x y&z']);
check('sign content', $content === 'a=1&b=2&e=x y&z');
check('sign content exclude sign_type', q_ali_sign_content(['a' => '1', 'sign_type' => 'RSA2', 'sign' => 'x'], ['sign', 'sign_type']) === 'a=1');

// 签名/验签往返（用环境变量里的临时密钥）
$GLOBALS['__cfg'] = null;
putenv('QIFU_ALIPAY_PRIVATE_KEY=' . $priv);
$_ENV['QIFU_ALIPAY_PRIVATE_KEY'] = $priv;
$sig = q_ali_rsa2_sign('hello=world');
check('rsa2 sign/verify roundtrip', q_ali_rsa2_verify('hello=world', $sig, $pub));
check('rsa2 verify rejects tampered content', !q_ali_rsa2_verify('hello=World', $sig, $pub));
check('rsa2 verify rejects bad base64', !q_ali_rsa2_verify('hello=world', '***', $pub));
check('rsa2 verify rejects empty sign', !q_ali_rsa2_verify('hello=world', '', $pub));
[, $otherPub] = gen_key();
check('rsa2 verify rejects other key', !q_ali_rsa2_verify('hello=world', $sig, $otherPub));

// 响应原文提取（花括号与转义引号出现在字符串里）
$inner = '{"code":"10000","msg":"a}b{\"x\":1}","qr_code":"https://qr.alipay.com/x"}';
$body = '{"alipay_trade_precreate_response":' . $inner . ',"sign":"abc"}';
check('extract_response keeps raw text', q_ali_extract_response($body, 'alipay_trade_precreate_response') === $inner);
check('extract_response missing key', q_ali_extract_response($body, 'alipay_trade_query_response') === null);
check('extract_response truncated', q_ali_extract_response('{"k":{"a":1', 'k') === null);

// 金额
check('cents 6.00', q_ali_cents('6.00') === 600);
check('cents 98', q_ali_cents('98') === 9800);
check('cents 0.1', q_ali_cents('0.1') === 10);
check('cents 1.005 rejected', q_ali_cents('1.005') === null);
check('cents -1 rejected', q_ali_cents('-1') === null);
check('cents "" rejected', q_ali_cents('') === null);
check('amount fmt', q_ali_amount(3000) === '30.00' && q_ali_amount(5) === '0.05');

// 订单号
check('order no format', q_pay_valid_order_no(q_pay_new_order_no()));
check('order no rejects injection', !q_pay_valid_order_no("QF1' OR 1=1"));

// 证书 SN：issuer（最具体的在前）+ 十进制序列号 的 md5
$dir = sys_get_temp_dir() . '/qifu-unit-' . getmypid();
mkdir($dir);
$serialHex = '1234567890ABCDEF1234567890';
$cmd = 'openssl req -x509 -newkey rsa:2048 -nodes -keyout ' . escapeshellarg("$dir/k.pem") . ' -out ' . escapeshellarg("$dir/c.pem")
    . ' -subj "/C=CN/O=Ant Financial/OU=Certification Authority/CN=Test CA R1" -days 3 -set_serial 0x' . $serialHex . ' 2>/dev/null';
exec($cmd);
$certPem = (string) @file_get_contents("$dir/c.pem");
$expect = md5('CN=Test CA R1,OU=Certification Authority,O=Ant Financial,C=CN' . '1442304682740643783150283421840');
check('hex2dec', q_ali_hex2dec($serialHex) === '1442304682740643783150283421840');
check('cert sn', $certPem !== '' && q_ali_cert_sn($certPem) === $expect);
$rootFile = "$dir/root.crt";
file_put_contents($rootFile, $certPem . $certPem);
putenv('QIFU_ALIPAY_ROOT_CERT_PATH=' . $rootFile);
$_ENV['QIFU_ALIPAY_ROOT_CERT_PATH'] = $rootFile;
check('root cert sn joins with _', q_ali_root_cert_sn() === $expect . '_' . $expect);
foreach (glob("$dir/*") as $f) {
    unlink($f);
}
rmdir($dir);

// 订单表 DDL 与 schema.sql 保持一致
$norm = static function (string $s): string { return preg_replace('/\s+/', ' ', trim(rtrim(trim($s), ';'))); };
$schema = file_get_contents(__DIR__ . '/../../php-backend/schema.sql');
$ok = preg_match('/CREATE TABLE IF NOT EXISTS pay_orders .*?;/s', $schema, $m) === 1 && $norm($m[0]) === $norm(Q_PAY_ORDERS_DDL);
check('pay_orders DDL == schema.sql', $ok);
check('schema.sql copies identical', file_get_contents(__DIR__ . '/../../php-backend/schema.sql') === file_get_contents(__DIR__ . '/../../php-backend/api/lib/schema.sql'));

// 测试价开关：默认正式价；开启后 0.01/0.02/0.03，福币数量不变
$packs = static function () { return array_map(static function ($p) { return [$p['id'], $p['coins'], $p['price'], q_pack_cents($p)]; }, q_packs()); };
check('packs default prices 6/30/98', $packs() === [['p6', 60, 6, 600], ['p30', 330, 30, 3000], ['p98', 1180, 98, 9800]]);
putenv('QIFU_PAY_TEST_PRICES=1');
$_ENV['QIFU_PAY_TEST_PRICES'] = '1';
check('packs test prices 0.01/0.02/0.03', $packs() === [['p6', 60, 0.01, 1], ['p30', 330, 0.02, 2], ['p98', 1180, 0.03, 3]]);
check('test price amount strings', array_map(static function ($p) { return q_ali_amount(q_pack_cents($p)); }, q_packs()) === ['0.01', '0.02', '0.03']);
putenv('QIFU_PAY_TEST_PRICES=0');
$_ENV['QIFU_PAY_TEST_PRICES'] = '0';
check('PAY_TEST_PRICES=0 means official prices', $packs()[0][3] === 600);

// 默认的 notify / return 地址固定
check('default notify url', q_ali_notify_url() === 'http://qifu.laixi.cn/api/index.php?path=/pay/alipay/notify');
check('default return url', q_ali_return_url() === 'http://qifu.laixi.cn/api/index.php?path=/pay/alipay/return');
check('site url from return url', q_ali_site_url() === 'http://qifu.laixi.cn');
check('any alipay key switches to alipay mode', q_pay_mode() === 'alipay');

echo $fails ? "\n$fails FAILED\n" : "\nall unit checks passed\n";
exit($fails ? 1 : 0);
