// bcryptjs(Node) <-> password_hash/password_verify(PHP) 双向兼容，含中文/emoji/72 字节边界
import bcrypt from 'bcryptjs';
import { execFileSync } from 'node:child_process';

const pws = ['123456', 'Qifu@Test2026', '密码测试123', '😀'.repeat(18), 'a'.repeat(72), 'p@ss word'];
const php = (code, input) => execFileSync('php', ['-r', code], { input: JSON.stringify(input) }).toString();
let bad = 0;
const nodeHashes = await Promise.all(pws.map((p) => bcrypt.hash(p, 10)));
const ok1 = JSON.parse(php('$d=json_decode(stream_get_contents(STDIN),true);echo json_encode(array_map(fn($i)=>password_verify($d["p"][$i],$d["h"][$i]),array_keys($d["p"])));', { p: pws, h: nodeHashes }));
const phpHashes = JSON.parse(php('$d=json_decode(stream_get_contents(STDIN),true);echo json_encode(array_map(fn($p)=>password_hash($p,PASSWORD_BCRYPT,["cost"=>10]),$d));', pws));
const ok2 = await Promise.all(pws.map((p, i) => bcrypt.compare(p, phpHashes[i])));
const neg = JSON.parse(php('echo json_encode(password_verify("wrong", json_decode(stream_get_contents(STDIN))));', nodeHashes[0]));
console.log('node prefix', nodeHashes[0].slice(0, 4), '| php prefix', phpHashes[0].slice(0, 4));
console.log('node->php verify', ok1.every(Boolean), '| php->node verify', ok2.every(Boolean), '| wrong pw rejected', neg === false);
process.exit(ok1.every(Boolean) && ok2.every(Boolean) && neg === false ? 0 : 1);
