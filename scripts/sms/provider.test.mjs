// PHP 真实发送层测试：把 SMS_API_URL 指向本机的「假短信平台」，验证请求字段、成功/失败解析、用户看到的提示。
// 全程只访问 127.0.0.1，不会调用真实短信平台。用法：node scripts/sms/provider.test.mjs <phpBase>  （PHP 服务器需带 QIFU_SMS_* 环境变量，见 run.sh）
import assert from 'node:assert/strict';
import http from 'node:http';

const [phpBase, fakePortArg] = process.argv.slice(2);
const fakePort = Number(fakePortArg);
const received = [];
let reply = 'success:20260110123456';
let status = 200;
const fake = http.createServer((req, res) => {
  let b = '';
  req.on('data', (d) => (b += d));
  req.on('end', () => {
    received.push({ method: req.method, url: req.url, type: req.headers['content-type'], form: Object.fromEntries(new URLSearchParams(b)) });
    res.statusCode = status;
    res.end(reply);
  });
});
await new Promise((r) => fake.listen(fakePort, '127.0.0.1', r));

let n = 0;
const send = (phone) =>
  fetch(`${phpBase}/api/sms/send`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.77.0.${++n}` },
    body: JSON.stringify({ phone }),
  }).then(async (r) => ({ status: r.status, text: await r.text() }));

try {
  const ok = await send('13912340001');
  assert.equal(ok.status, 200, ok.text);
  assert.equal(received.length, 1);
  const r = received[0];
  assert.equal(r.method, 'POST');
  assert.match(r.type, /application\/x-www-form-urlencoded/);
  assert.equal(r.url, '/api/send/index.php');
  assert.equal(r.form.username, 'fake-user');
  assert.equal(r.form.password_md5, 'abcdef0123456789abcdef0123456789'); // 配置里是大写，发送时转小写
  assert.equal(r.form.apikey, 'fake-apikey');
  assert.equal(r.form.mobile, '13912340001');
  assert.equal(r.form.encode, 'UTF-8');
  assert.match(r.form.content, /^【阳光互联】您的验证码是\d{6}，5分钟内有效。$/);

  const failures = [
    ['error:APIKEY or password error', 200],
    ['error:Unauthorized IP address', 200],
    ['error:Account balance is insufficient', 200],
    ['error:Black keywords is:xx', 200],
    ['<html>gateway</html>', 502],
    ['', 200],
  ];
  for (const [i, [body, st]] of failures.entries()) {
    reply = body;
    status = st;
    const f = await send(`1391234001${i}`);
    assert.equal(f.status, 502, `${body}: ${f.text}`);
    assert.deepEqual(JSON.parse(f.text), { error: '短信发送失败，请稍后再试' });
    assert.ok(!/APIKEY|IP address|balance|keywords|gateway/i.test(f.text));
  }
  console.log('sms provider OK: request format + failure handling');
} finally {
  fake.close();
}
