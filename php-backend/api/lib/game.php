<?php
if (!defined('QIFU')) { http_response_code(403); exit; }

// 与 shared/game.ts 保持一致（scripts/parity 会比对 /api/config 的输出）

const Q_MAX_WISH_LENGTH = 60;
const Q_START_ENERGY = 30;

function q_items(): array
{
    return [
        ['id' => 'wood', 'name' => '平安木牌', 'desc' => '朴素木牌，寄托一份平安', 'currency' => 'energy', 'cost' => 10, 'reward' => 0, 'growth' => 1, 'glow' => false, 'color' => '#c9955a'],
        ['id' => 'ribbon', 'name' => '红绸福带', 'desc' => '一条红绸，系上心愿', 'currency' => 'energy', 'cost' => 25, 'reward' => 5, 'growth' => 1, 'glow' => false, 'color' => '#d8343a'],
        ['id' => 'gold', 'name' => '金色福牌', 'desc' => '金牌高悬，福气加倍', 'currency' => 'coins', 'cost' => 8, 'reward' => 40, 'growth' => 2, 'glow' => false, 'color' => '#f2c14e'],
        ['id' => 'lantern', 'name' => '祈福灯', 'desc' => '夜里会发出温暖的光', 'currency' => 'coins', 'cost' => 18, 'reward' => 100, 'growth' => 3, 'glow' => true, 'color' => '#ff8a3d'],
        ['id' => 'lotus', 'name' => '莲花灯', 'desc' => '莲开一盏，福泽绵长', 'currency' => 'coins', 'cost' => 38, 'reward' => 260, 'growth' => 5, 'glow' => true, 'color' => '#ff8fc0'],
    ];
}

function q_packs(): array
{
    $packs = [
        ['id' => 'p6', 'coins' => 60, 'price' => 6, 'label' => '小福包'],
        ['id' => 'p30', 'coins' => 330, 'price' => 30, 'label' => '中福包'],
        ['id' => 'p98', 'coins' => 1180, 'price' => 98, 'label' => '大福包'],
    ];
    if (q_cfg_bool('PAY_TEST_PRICES')) {
        // 真实支付联调用的临时价（分），福币数量不变。下单、/config、前端显示都读这里
        $testCents = ['p6' => 1, 'p30' => 2, 'p98' => 3];
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
        ['id' => 'mountain', 'name' => '山巅云海', 'subtitle' => '孤峰之上', 'desc' => '绝壁孤峰，脚下云海翻涌，远山如黛', 'price' => 30, 'swatch' => ['#8fb4d9', '#f4efe4']],
        ['id' => 'bamboo', 'name' => '竹林溪谷', 'subtitle' => '幽篁听泉', 'desc' => '竹影婆娑，溪水潺潺，薄雾里有鹿与蜻蜓', 'price' => 30, 'swatch' => ['#3f7a4a', '#b8d9a0']],
        ['id' => 'jiangnan', 'name' => '江南水乡', 'subtitle' => '烟雨小桥', 'desc' => '粉墙黛瓦，拱桥乌篷，一池莲叶伴垂柳', 'price' => 30, 'swatch' => ['#5f8f9c', '#e8e2d2']],
        ['id' => 'desert', 'name' => '大漠孤烟', 'subtitle' => '长河落日', 'desc' => '沙丘如浪，孤烟直上，驼铃隐隐', 'price' => 30, 'swatch' => ['#d9a25b', '#f3d9a0']],
        ['id' => 'snow', 'name' => '雪山寒林', 'subtitle' => '千山鸟飞绝', 'desc' => '雪峰环绕，寒松覆雪，红绸格外醒目', 'price' => 30, 'swatch' => ['#a9c4dc', '#ffffff']],
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
