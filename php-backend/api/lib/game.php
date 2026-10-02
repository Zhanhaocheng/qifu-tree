<?php
if (!defined('QIFU')) { http_response_code(403); exit; }

// 与 shared/game.ts 保持一致（scripts/parity 会比对 /api/config 的输出）

const Q_MAX_WISH_LENGTH = 60;
const Q_START_ENERGY = 30;

function q_items(): array
{
    return [
        ['id' => 'wood', 'name' => '平安木牌', 'desc' => '朴素木牌，寄托一份平安', 'currency' => 'energy', 'cost' => 30, 'reward' => 0, 'growth' => 1, 'glow' => false, 'color' => '#c9955a'],
        ['id' => 'ribbon', 'name' => '红绸福带', 'desc' => '一条红绸，系上心愿', 'currency' => 'energy', 'cost' => 58, 'reward' => 0, 'growth' => 1, 'glow' => false, 'color' => '#d8343a'],
        ['id' => 'gold', 'name' => '金色福牌', 'desc' => '金牌高悬，福气加倍', 'currency' => 'coins', 'cost' => 28, 'reward' => 0, 'growth' => 2, 'glow' => false, 'color' => '#f2c14e'],
        ['id' => 'lantern', 'name' => '祈福灯', 'desc' => '夜里会发出温暖的光', 'currency' => 'coins', 'cost' => 68, 'reward' => 0, 'growth' => 3, 'glow' => true, 'color' => '#ff8a3d'],
        ['id' => 'lotus', 'name' => '莲花灯', 'desc' => '莲开一盏，福泽绵长', 'currency' => 'coins', 'cost' => 88, 'reward' => 0, 'growth' => 5, 'glow' => true, 'color' => '#ff8fc0'],
    ];
}

function q_packs(): array
{
    $packs = [
        ['id' => 'p1', 'coins' => 60, 'price' => 1, 'label' => '小福包'],
        ['id' => 'p5', 'coins' => 330, 'price' => 5, 'label' => '中福包'],
        ['id' => 'p10', 'coins' => 1180, 'price' => 10, 'label' => '大福包'],
    ];
    if (q_cfg_bool('PAY_TEST_PRICES')) {
        // 真实支付联调用的临时价（分），福币数量不变。下单、/config、前端显示都读这里
        $testCents = ['p1' => 1, 'p5' => 2, 'p10' => 3];
        foreach ($packs as &$p) {
            $p['price'] = $testCents[$p['id']] / 100;
        }
        unset($p);
    }
    return $packs;
}

/** 档位的实付金额（分）；price 可能是整数元或测试价的小数元 */
function q_pack_cents(array $pack): int
{
    return (int) round($pack['price'] * 100);
}

function q_terrains(): array
{
    return [
        ['id' => 'mountain', 'name' => '山巅云海', 'subtitle' => '孤峰之上', 'desc' => '绝壁孤峰，脚下云海翻涌，远山如黛', 'price' => 888, 'swatch' => ['#8fb4d9', '#f4efe4']],
        ['id' => 'bamboo', 'name' => '竹林溪谷', 'subtitle' => '幽篁听泉', 'desc' => '竹影婆娑，溪水潺潺，薄雾里有鹿与蜻蜓', 'price' => 888, 'swatch' => ['#3f7a4a', '#b8d9a0']],
        ['id' => 'jiangnan', 'name' => '江南水乡', 'subtitle' => '烟雨小桥', 'desc' => '粉墙黛瓦，拱桥乌篷，一池莲叶伴垂柳', 'price' => 888, 'swatch' => ['#5f8f9c', '#e8e2d2']],
        ['id' => 'desert', 'name' => '大漠孤烟', 'subtitle' => '长河落日', 'desc' => '沙丘如浪，孤烟直上，驼铃隐隐', 'price' => 888, 'swatch' => ['#d9a25b', '#f3d9a0']],
        ['id' => 'snow', 'name' => '雪山寒林', 'subtitle' => '千山鸟飞绝', 'desc' => '雪峰环绕，寒松覆雪，红绸格外醒目', 'price' => 888, 'swatch' => ['#a9c4dc', '#ffffff']],
    ];
}

function q_find(array $list, $id): ?array
{
    if (!is_string($id)) {
        return null;
    }
    foreach ($list as $x) {
        if ($x['id'] === $id) {
            return $x;
        }
    }
    return null;
}

function q_stage_of(int $count): int
{
    $mins = [0, 3, 12, 40];
    $s = 0;
    foreach ($mins as $i => $min) {
        if ($count >= $min) {
            $s = $i;
        }
    }
    return $s;
}

function q_checkin_reward(int $streak): int
{
    return 20 + min($streak - 1, 6) * 5;
}

/** Math.imul(userId + 7, 2654435761) >>> 0, 然后 (h >>> 8) % 地形数 */
function q_default_terrain(int $userId): string
{
    $h = (($userId + 7) * 2654435761) & 0xFFFFFFFF;
    $terrains = q_terrains();
    return $terrains[($h >> 8) % count($terrains)]['id'];
}

/* ------------------------------------------------------------ 个人资料校验 */
// 与 shared/game.ts 的 validateProfile 逐条一致（scripts/parity 会比对两边的响应）

const Q_NICKNAME_MAX = 20;
const Q_AGE_MIN = 1;
const Q_AGE_MAX = 120;
const Q_AVATAR_MAX_BYTES = 24 * 1024;
const Q_AVATAR_PRESETS = ['crane', 'lotus', 'koi', 'bamboo', 'plum', 'lantern', 'fu', 'cloud', 'panda', 'rabbit', 'mountain', 'coin'];

const Q_ERR_NICKNAME = '昵称需为 1-20 位的字母、数字、汉字、空格、下划线、短横线、点或间隔号';
const Q_ERR_AGE = '年龄需为 1-120 之间的整数，也可以留空';
const Q_ERR_AVATAR = '头像无效，请重新选择';
const Q_ERR_AVATAR_TYPE = '头像图片格式需为 PNG、JPEG 或 WebP';
const Q_ERR_AVATAR_SIZE = '头像图片过大，请换一张或重新裁剪';
const Q_ERR_PROFILE_EMPTY = '没有需要修改的内容';

/** 返回 null 表示有效，否则是错误提示 */
function q_avatar_error(string $v): ?string
{
    if (strpos($v, 'preset:') === 0) {
        return in_array(substr($v, 7), Q_AVATAR_PRESETS, true) ? null : Q_ERR_AVATAR;
    }
    if (!preg_match('#^data:image/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$#D', $v, $m) || strlen($m[2]) % 4 !== 0) {
        return strpos($v, 'data:image/') === 0 ? Q_ERR_AVATAR_TYPE : Q_ERR_AVATAR;
    }
    $b64 = $m[2];
    $bytes = intdiv(strlen($b64) * 3, 4) - (substr($b64, -2) === '==' ? 2 : (substr($b64, -1) === '=' ? 1 : 0));
    if ($bytes > Q_AVATAR_MAX_BYTES) {
        return Q_ERR_AVATAR_SIZE;
    }
    $head = base64_decode(substr($b64, 0, 24), true);
    if (!is_string($head)) {
        return Q_ERR_AVATAR_TYPE;
    }
    $isPng = substr($head, 0, 8) === "\x89PNG\r\n\x1a\n";
    $isJpeg = substr($head, 0, 3) === "\xff\xd8\xff";
    $isWebp = substr($head, 0, 4) === 'RIFF' && substr($head, 8, 4) === 'WEBP';
    $ok = $m[1] === 'png' ? $isPng : ($m[1] === 'jpeg' ? $isJpeg : $isWebp);
    return $ok ? null : Q_ERR_AVATAR_TYPE;
}

/**
 * 校验并规范化个人资料更新，只处理出现的字段。
 * 成功：['ok' => true, 'value' => [...]]（value 里 nickname => null 表示恢复为用户名）；失败：['ok' => false, 'error' => 文案]
 */
function q_validate_profile(array $b): array
{
    $value = [];
    if (array_key_exists('nickname', $b)) {
        $raw = $b['nickname'];
        if ($raw === null) {
            $value['nickname'] = null;
        } elseif (!is_string($raw)) {
            return ['ok' => false, 'error' => Q_ERR_NICKNAME];
        } else {
            $t = preg_replace('/ {2,}/', ' ', q_trim($raw));
            if ($t === '') {
                $value['nickname'] = null;
            } elseif (!preg_match('/^[\p{L}\p{M}\p{N}_\-·. ]{1,20}$/uD', $t)) {
                return ['ok' => false, 'error' => Q_ERR_NICKNAME];
            } else {
                $value['nickname'] = $t;
            }
        }
    }
    if (array_key_exists('avatar', $b)) {
        $raw = $b['avatar'];
        if ($raw === null || $raw === '') {
            $value['avatar'] = null;
        } elseif (!is_string($raw)) {
            return ['ok' => false, 'error' => Q_ERR_AVATAR];
        } else {
            $err = q_avatar_error($raw);
            if ($err !== null) {
                return ['ok' => false, 'error' => $err];
            }
            $value['avatar'] = $raw;
        }
    }
    if (array_key_exists('age', $b)) {
        $raw = $b['age'];
        $n = false;
        if ($raw === null || $raw === '') {
            $n = null;
        } elseif (is_int($raw)) {
            $n = $raw;
        } elseif (is_float($raw) && is_finite($raw) && floor($raw) == $raw && abs($raw) < 1e15) {
            $n = (int) $raw;
        } elseif (is_string($raw) && preg_match('/^\d{1,3}$/D', $raw)) {
            $n = (int) $raw;
        }
        if ($n === false || ($n !== null && ($n < Q_AGE_MIN || $n > Q_AGE_MAX))) {
            return ['ok' => false, 'error' => Q_ERR_AGE];
        }
        $value['age'] = $n;
    }
    if (!$value) {
        return ['ok' => false, 'error' => Q_ERR_PROFILE_EMPTY];
    }
    return ['ok' => true, 'value' => $value];
}
