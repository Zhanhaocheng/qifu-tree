import * as THREE from 'three';

/** 程序化生成的可平铺 PBR 贴图（漫反射 + 法线），无需外部资源。 */

function hash2(x: number, y: number, seed: number) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** 周期为 period 的值噪声，保证贴图无缝 */
export function vnoise(x: number, y: number, period: number, seed = 0, periodY = period) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const p = (a: number, b: number) => hash2(((a % period) + period) % period, ((b % periodY) + periodY) % periodY, seed);
  const a = p(xi, yi);
  const b = p(xi + 1, yi);
  const c = p(xi, yi + 1);
  const d = p(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export function fbm(u: number, v: number, base: number, octaves: number, seed = 0, baseY = base) {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let fx = base;
  let fy = baseY;
  for (let o = 0; o < octaves; o++) {
    sum += amp * vnoise(u * fx, v * fy, Math.round(fx), seed + o * 17, Math.round(fy));
    norm += amp;
    amp *= 0.5;
    fx *= 2;
    fy *= 2;
  }
  return sum / norm;
}

/** 非周期版本，用于地形高度等 */
export function fbmWorld(x: number, z: number, octaves = 4, seed = 0) {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let f = 1;
  for (let o = 0; o < octaves; o++) {
    sum += amp * vnoise(x * f + 1000, z * f + 1000, 1 << 20, seed + o * 31);
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return sum / norm;
}

type Sample = (u: number, v: number) => [number, number, number, number];

function build(size: number, sample: Sample, normalStrength: number, srgb = true) {
  const color = new Uint8ClampedArray(size * size * 4);
  const height = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, g, b, h] = sample(x / size, y / size);
      const i = (y * size + x) * 4;
      color[i] = r * 255;
      color[i + 1] = g * 255;
      color[i + 2] = b * 255;
      color[i + 3] = 255;
      height[y * size + x] = h;
    }
  }
  const normal = new Uint8ClampedArray(size * size * 4);
  const at = (x: number, y: number) => height[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
      const dy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
      const nx = -dx * normalStrength;
      const ny = dy * normalStrength;
      const inv = 1 / Math.hypot(nx, ny, 1);
      const i = (y * size + x) * 4;
      normal[i] = (nx * inv * 0.5 + 0.5) * 255;
      normal[i + 1] = (ny * inv * 0.5 + 0.5) * 255;
      normal[i + 2] = (inv * 0.5 + 0.5) * 255;
      normal[i + 3] = 255;
    }
  }
  const mk = (data: Uint8ClampedArray, isColor: boolean) => {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(data.buffer as ArrayBuffer), size, size), 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    t.colorSpace = isColor && srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    return t;
  };
  return { map: mk(color, true), normalMap: mk(normal, false) };
}

const mixc = (a: number[], b: number[], t: number): [number, number, number] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const hex = (s: string) => {
  const c = new THREE.Color(s).convertLinearToSRGB();
  return [c.r, c.g, c.b];
};
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export type SurfaceKind = 'turf' | 'moss' | 'grass' | 'soil' | 'sand' | 'dune' | 'snow' | 'rock' | 'bark' | 'stone' | 'cliff';

export interface PbrTextures {
  map: THREE.Texture;
  normalMap: THREE.Texture;
}

const cache = new Map<string, PbrTextures>();

export function surface(kind: SurfaceKind, size = 512): PbrTextures {
  const key = `${kind}:${size}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let tex: PbrTextures;
  switch (kind) {
    case 'bark':
      tex = build(
        size,
        (u, v) => {
          const warp = fbm(u, v, 4, 3, 5) * 0.06;
          const ridge = 1 - Math.abs(fbm(u + warp, v * 0.5, 10, 4, 1, 3) * 2 - 1);
          const cracks = Math.pow(ridge, 2.4);
          const broad = fbm(u, v, 3, 4, 9);
          const lichen = clamp01((fbm(u, v, 6, 4, 33) - 0.58) * 5);
          const base = mixc(hex('#2c2118'), hex('#6d5a48'), cracks * 0.8 + broad * 0.25);
          const moss = mixc(base, hex('#59703a'), lichen * 0.6);
          return [moss[0], moss[1], moss[2], cracks * 1.0 + broad * 0.25];
        },
        7,
      );
      break;
    case 'grass':
    case 'turf':
      tex = build(
        size,
        (u, v) => {
          const n1 = fbm(u, v, 8, 5, 3);
          const n2 = fbm(u, v, 32, 3, 8);
          const patch = fbm(u, v, 3, 3, 19);
          const dry = clamp01((patch - 0.45) * 3);
          const g = mixc(hex(kind === 'turf' ? '#4c6b36' : '#3e6f2a'), hex('#8fb04a'), n1 * 0.8 + n2 * 0.3);
          const c = mixc(g, hex('#8c7a45'), dry * 0.5);
          return [c[0], c[1], c[2], n1 * 0.6 + n2 * 0.4];
        },
        3,
      );
      break;
    case 'moss':
      tex = build(
        size,
        (u, v) => {
          const n1 = fbm(u, v, 10, 5, 4);
          const n2 = fbm(u, v, 40, 3, 12);
          const c = mixc(hex('#264a26'), hex('#72a24a'), n1 * 0.9 + n2 * 0.2);
          return [c[0], c[1], c[2], n1 * 0.5 + n2 * 0.5];
        },
        4,
      );
      break;
    case 'soil':
      tex = build(
        size,
        (u, v) => {
          const n1 = fbm(u, v, 8, 5, 6);
          const grit = fbm(u, v, 64, 2, 40);
          const pebble = clamp01((vnoise(u * 24, v * 24, 24, 77) - 0.78) * 6);
          const c0 = mixc(hex('#3d2b1d'), hex('#7a5a3c'), n1 * 0.9 + grit * 0.3);
          const c = mixc(c0, hex('#9a978c'), pebble * 0.6);
          return [c[0], c[1], c[2], n1 * 0.5 + grit * 0.25 + pebble * 0.8];
        },
        5,
      );
      break;
    case 'sand':
    case 'dune':
      tex = build(
        size,
        (u, v) => {
          const ripple = Math.sin((u * 14 + fbm(u, v, 6, 3, 2) * 2.4) * Math.PI * 2) * 0.5 + 0.5;
          const grain = fbm(u, v, 96, 2, 51);
          const broad = fbm(u, v, 4, 4, 9);
          const c = mixc(hex('#c68e4e'), hex('#f0cf94'), broad * 0.7 + ripple * 0.35 + grain * 0.15);
          return [c[0], c[1], c[2], ripple * 0.5 + grain * 0.2];
        },
        kind === 'dune' ? 4 : 3,
      );
      break;
    case 'snow':
      tex = build(
        size,
        (u, v) => {
          const n1 = fbm(u, v, 6, 5, 14);
          const sparkle = clamp01((vnoise(u * 128, v * 128, 128, 3) - 0.9) * 10);
          const c = mixc(hex('#c9d8ea'), hex('#ffffff'), n1 * 0.9 + sparkle * 0.5);
          return [c[0], c[1], c[2], n1 * 0.6 + sparkle * 0.1];
        },
        2.5,
      );
      break;
    case 'rock':
    case 'cliff':
      tex = build(
        size,
        (u, v) => {
          const strata = Math.sin((v * 9 + fbm(u, v, 5, 4, 8) * 3) * Math.PI * 2) * 0.5 + 0.5;
          const n1 = fbm(u, v, 6, 5, 22);
          const crack = Math.pow(1 - Math.abs(fbm(u, v, 7, 4, 44) * 2 - 1), 5);
          const c0 = mixc(hex(kind === 'cliff' ? '#4c4a48' : '#5a5853'), hex('#a8a59b'), n1 * 0.85 + strata * 0.25);
          const c = mixc(c0, hex('#1e1c1a'), crack * 0.5);
          return [c[0], c[1], c[2], n1 * 0.7 + strata * 0.3 - crack * 0.6];
        },
        5,
      );
      break;
    case 'stone':
      tex = build(
        size,
        (u, v) => {
          const n1 = fbm(u, v, 8, 4, 31);
          const n2 = fbm(u, v, 48, 2, 32);
          const c = mixc(hex('#77766f'), hex('#b3b1a6'), n1 * 0.9 + n2 * 0.25);
          const pit = clamp01((vnoise(u * 32, v * 32, 32, 90) - 0.85) * 6);
          const cc = mixc(c, hex('#3f3e3a'), pit * 0.5);
          return [cc[0], cc[1], cc[2], n1 * 0.4 + n2 * 0.3 - pit * 0.4];
        },
        3,
      );
      break;
  }
  cache.set(key, tex);
  return tex;
}

export function waterNormal(size = 256): THREE.Texture {
  const key = `water:${size}`;
  const hit = cache.get(key);
  if (hit) return hit.normalMap;
  const t = build(
    size,
    (u, v) => {
      const h = fbm(u, v, 6, 4, 60) + fbm(u, v, 16, 3, 61) * 0.5;
      return [0.5, 0.5, 0.5, h];
    },
    6,
  );
  cache.set(key, t);
  return t.normalMap;
}

export function leafTexture(): THREE.CanvasTexture {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, size, size);
  const rng = (() => {
    let s = 12345;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  })();
  const leaf = (x: number, y: number, len: number, wid: number, rot: number, tone: number) => {
    g.save();
    g.translate(x, y);
    g.rotate(rot);
    const grad = g.createLinearGradient(0, 0, 0, -len);
    const a = Math.round(150 + tone * 90);
    grad.addColorStop(0, `rgb(${a * 0.72},${a * 0.72},${a * 0.72})`);
    grad.addColorStop(1, `rgb(${Math.min(255, a * 1.15)},${Math.min(255, a * 1.15)},${Math.min(255, a * 1.15)})`);
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(0, 0);
    g.bezierCurveTo(wid, -len * 0.25, wid * 0.8, -len * 0.8, 0, -len);
    g.bezierCurveTo(-wid * 0.8, -len * 0.8, -wid, -len * 0.25, 0, 0);
    g.fill();
    g.strokeStyle = 'rgba(40,40,40,0.55)';
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(0, -len * 0.92);
    g.stroke();
    g.restore();
  };
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + rng() * 0.4;
    const r = 20 + rng() * 60;
    leaf(size / 2 + Math.cos(a) * r * 0.5, size / 2 + 28 + Math.sin(a) * r * 0.5, 62 + rng() * 34, 17 + rng() * 9, a + Math.PI / 2 + (rng() - 0.5) * 0.6, rng());
  }
  for (let i = 0; i < 14; i++) leaf(size / 2 + (rng() - 0.5) * 40, size / 2 + 40, 70 + rng() * 40, 18 + rng() * 8, (rng() - 0.5) * 2.4, rng());
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function moonTexture(): THREE.CanvasTexture {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f0ecd8';
  g.fillRect(0, 0, size, size);
  const img = g.getImageData(0, 0, size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = fbm(x / size, y / size, 4, 5, 70);
      const k = 0.78 + n * 0.3;
      const i = (y * size + x) * 4;
      img.data[i] *= k;
      img.data[i + 1] *= k;
      img.data[i + 2] *= k * 0.97;
    }
  }
  g.putImageData(img, 0, 0);
  for (let i = 0; i < 20; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 3 + Math.random() * 14;
    const gr = g.createRadialGradient(x, y, r * 0.2, x, y, r);
    gr.addColorStop(0, 'rgba(120,115,100,0.35)');
    gr.addColorStop(1, 'rgba(120,115,100,0)');
    g.fillStyle = gr;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** 祈福牌书法字图集：每个道具一张，横向 4 格，每格一个字 */
export const GLYPHS: Record<string, string[]> = {
  wood: ['福', '安', '愿', '顺'],
  ribbon: ['心', '想', '事', '成'],
  gold: ['喜', '寿', '康', '禄'],
  lantern: ['福', '吉', '祥', '瑞'],
  lotus: ['莲', '福', '和', '缘'],
};

export function glyphAtlas(type: string, bg: string, ink: string, extra: 'wood' | 'plain' = 'plain'): THREE.CanvasTexture {
  const cw = 128;
  const ch = 256;
  const c = document.createElement('canvas');
  c.width = cw * 4;
  c.height = ch;
  const g = c.getContext('2d')!;
  const chars = GLYPHS[type] ?? GLYPHS.wood;
  for (let i = 0; i < 4; i++) {
    const x0 = i * cw;
    const grd = g.createLinearGradient(x0, 0, x0 + cw, ch);
    grd.addColorStop(0, bg);
    grd.addColorStop(1, bg);
    g.fillStyle = grd;
    g.fillRect(x0, 0, cw, ch);
    if (extra === 'wood') {
      for (let k = 0; k < 40; k++) {
        g.strokeStyle = `rgba(60,30,10,${0.04 + Math.random() * 0.08})`;
        g.lineWidth = 1 + Math.random() * 1.5;
        const y = Math.random() * ch;
        g.beginPath();
        g.moveTo(x0, y);
        g.bezierCurveTo(x0 + cw * 0.3, y + (Math.random() - 0.5) * 10, x0 + cw * 0.7, y + (Math.random() - 0.5) * 10, x0 + cw, y);
        g.stroke();
      }
    }
    g.save();
    g.beginPath();
    g.rect(x0, 0, cw, ch);
    g.clip();
    g.fillStyle = ink;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `900 ${type === 'ribbon' ? 84 : 104}px "STKaiti","KaiTi","Kaiti SC","楷体","Noto Serif SC","Songti SC","WenQuanYi Micro Hei",serif`;
    g.shadowColor = 'rgba(0,0,0,0.25)';
    g.shadowBlur = 3;
    g.translate(x0 + cw / 2, ch * 0.5);
    g.rotate((Math.random() - 0.5) * 0.12);
    g.fillText(chars[i], 0, 0);
    g.fillText(chars[i], 0.8, 0.5);
    g.restore();
    g.fillStyle = ink;
    g.globalAlpha = 0.5;
    g.fillRect(x0 + cw / 2 - 3, 8, 6, 6);
    g.globalAlpha = 1;
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
