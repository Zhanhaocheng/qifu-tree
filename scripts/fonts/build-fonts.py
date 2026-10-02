#!/usr/bin/env python3
"""
把界面用到的中文字体子集化为 woff2，输出到 src/fonts/。
字体源文件（TTF，体积很大，不入库）：
  - 霞鹜文楷 LXGW WenKai v1.522 Medium（单字重，覆盖 400-700，层级靠字号/字距/毛笔体）  (SIL OFL 1.1，允许商用与网页子集化分发)
    https://github.com/lxgw/LxgwWenKai/releases
  - 马善政楷书 Ma Shan Zheng (SIL OFL 1.1)
    https://github.com/google/fonts/tree/main/ofl/mashanzheng
用法：python3 scripts/fonts/build-fonts.py <放 TTF 的目录>
依赖：pip install fonttools brotli jieba
子集划分（font-display: swap + unicode-range，只下载用得到的）：
  kai-core  界面静态文案里出现过的全部字符（首屏必需）
  kai-more  高频常用字（心愿牌、用户名），仅在出现这些字时才下载
  brush                        标题、弹窗标题、成功提示用的毛笔体，只含标题字
"""
import re, sys, glob, os, collections
from fontTools import subset
from fontTools.ttLib import TTFont

SRC = sys.argv[1] if len(sys.argv) > 1 else '/tmp/fonts'
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'src', 'fonts')
os.makedirs(OUT, exist_ok=True)

CJK = re.compile(r'[\u3000-\u303f\u3400-\u9fff\uff00-\uffef\u2018-\u201d\u2026\u00b7\u2014]')
files = [f'{ROOT}/src/{n}' for n in ('ui.ts', 'main.ts', 'fx.ts', 'api.ts', 'motion.ts')] + [f'{ROOT}/shared/game.ts', f'{ROOT}/index.html', f'{ROOT}/server/app.ts'] \
    + [f'{ROOT}/php-backend/api/lib/{n}.php' for n in ('app', 'game', 'core')]
COMMENT = re.compile(r'/\*.*?\*/|(?<![:\'"`])//[^\n]*|<!--.*?-->|(?m:^\s*#[^\n]*)', re.S)
ui = set()
for f in files:
    if os.path.exists(f):
        ui |= set(CJK.findall(COMMENT.sub('', open(f, encoding='utf-8', errors='ignore').read())))

ASCII = ''.join(chr(c) for c in range(0x20, 0x7f))
SYMS = '·—…“”‘’×¥￥'

# 高频字：按 jieba 词频折算字频
import jieba
freq = collections.Counter()
dic = os.path.join(os.path.dirname(jieba.__file__), 'dict.txt')
for line in open(dic, encoding='utf-8'):
    p = line.split()
    if len(p) < 2: continue
    for ch in p[0]:
        if '\u4e00' <= ch <= '\u9fff': freq[ch] += int(p[1])
top = [c for c, _ in freq.most_common(900)]
more = ''.join(c for c in top if c not in ui)

DISPLAY = '祈福树登录注册挂一块牌商店选择地形已解锁心愿上能量币支付成功签到连续天获得返还今日愿平安喜乐吉祥如意福寿康宁0123456789+-/'

def make(src, text, name, weight_tag='', flavor_feature=True):
    opt = subset.Options()
    opt.flavor = 'woff2'
    opt.layout_features = ['kern', 'liga', 'calt', 'locl', 'ccmp', 'vert']
    opt.name_IDs = [0, 1, 2, 3, 4, 6, 13, 14]
    opt.notdef_outline = True
    opt.hinting = False
    opt.desubroutinize = True
    font = subset.load_font(src, opt)
    s = subset.Subsetter(opt)
    s.populate(text=text)
    s.subset(font)
    path = os.path.join(OUT, name + '.woff2')
    subset.save_font(font, path, opt)
    print(f'{name}: {len(set(text))} glyphs, {os.path.getsize(path)/1024:.1f} KB')

core = ASCII + SYMS + ''.join(sorted(ui))
make(f'{SRC}/LXGWWenKai-Medium.ttf', core, 'kai-core')
make(f'{SRC}/LXGWWenKai-Medium.ttf', more, 'kai-more')
make(f'{SRC}/MaShanZheng-Regular.ttf', DISPLAY, 'brush')

def ranges(chars):
    cps = sorted(ord(c) for c in set(chars))
    out, a, b = [], cps[0], cps[0]
    for c in cps[1:]:
        if c == b + 1: b = c; continue
        out.append((a, b)); a = b = c
    out.append((a, b))
    return ', '.join(f'U+{x:X}' if x == y else f'U+{x:X}-{y:X}' for x, y in out)

CSS = f"""/* 由 scripts/fonts/build-fonts.py 生成，请勿手改。
   霞鹜文楷（SIL OFL 1.1）与马善政楷书（SIL OFL 1.1）的网页子集，随静态资源自托管，不依赖 Google Fonts。
   unicode-range 保证只有用到对应字符时才会下载；范围之外的字符回退到系统字体。 */
@font-face {{
  font-family: 'Qifu Kai';
  font-style: normal;
  font-weight: 400 700;
  font-display: swap;
  src: url('../fonts/kai-core.woff2') format('woff2');
  unicode-range: U+20-7E, {ranges(''.join(c for c in core if c not in ASCII))};
}}
@font-face {{
  font-family: 'Qifu Kai';
  font-style: normal;
  font-weight: 400 700;
  font-display: swap;
  src: url('../fonts/kai-more.woff2') format('woff2');
  unicode-range: {ranges(more)};
}}
@font-face {{
  font-family: 'Qifu Brush';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url('../fonts/brush.woff2') format('woff2');
  unicode-range: {ranges(DISPLAY)};
}}
"""
os.makedirs(os.path.join(ROOT, 'src', 'styles'), exist_ok=True)
open(os.path.join(ROOT, 'src', 'styles', 'fonts.css'), 'w').write(CSS)
