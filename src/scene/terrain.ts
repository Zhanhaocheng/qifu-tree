import * as THREE from 'three';
import { Water } from 'three/examples/jsm/objects/Water.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { TerrainId } from '../../shared/game';
import type { SkyParams } from './sky';
import { fbmWorld, leafTexture, surface, waterNormal, type SurfaceKind } from './textures';
import { NOISE_GLSL, noiseTexture } from './sky';
import type { TreeStyle } from './tree';
import { mulberry32 } from './tree';
import { Kit, archBridge, bambooStalkGeometry, house, paifang, pavilion, pineGeometry, scatterRocks, stele, stoneLantern, terrace, wupengBoat, type Glow } from './props';

export type ParticleKind = 'petal' | 'leaf' | 'snow' | 'sand' | 'bamboo';
export type QualityLevel = 'low' | 'medium' | 'high';

export interface TerrainEnv {
  night: number;
  sunDir: THREE.Vector3;
  sunColor: THREE.Color;
  fogColor: THREE.Color;
  fogDensity: number;
  wind: number;
  camPos: THREE.Vector3;
  light: THREE.Color;
  time: number;
}

export interface TerrainWorld {
  id: TerrainId;
  group: THREE.Group;
  glows: Glow[];
  sky: SkyParams;
  fogDensity: number;
  treeStyle: TreeStyle;
  particle: ParticleKind;
  terraceHeight: number;
  heightAt(x: number, z: number): number;
  isWater(x: number, z: number): boolean;
  update(dt: number, env: TerrainEnv): void;
  dispose(): void;
  lightBias: number;
  flowerSpots: THREE.Vector3[];
  waterSpots: THREE.Vector3[];
  onWater: { object: THREE.Object3D; base: THREE.Vector3; phase: number }[];
}

export const TERRACE_R = 9.4;
export const TERRACE_H = 0.55;

const sm = THREE.MathUtils.smoothstep;
const lerp = THREE.MathUtils.lerp;
const clamp = THREE.MathUtils.clamp;

interface TerrainConfig {
  id: TerrainId;
  sky: SkyParams;
  fogDensity: number;
  treeStyle: TreeStyle;
  particle: ParticleKind;
  a: SurfaceKind;
  b: SurfaceKind;
  tileA: number;
  height: (x: number, z: number) => number;
  splat: (x: number, z: number, h: number, slope: number) => number;
  grass: { count: number; base: string; tip: string; height: number; spread: number; density: (x: number, z: number, h: number) => number } | null;
  flowers: string[];
  ridges: { radius: number; base: number; amp: number; freq: number; sharp: number; color: string; mist: number; snowLine?: number }[];
  waterLevel: number | null;
  waterColor: string;
  lightBias: number;
}

const flatMask = (r: number, a = 10, b = 26) => sm(r, a, b);

const CONFIGS: Record<TerrainId, TerrainConfig> = {
  mountain: {
    id: 'mountain',
    sky: { turbidity: 2.4, rayleigh: 2.6, mie: 0.004, mieG: 0.82, cloudCover: 0.42, fogTint: '#9dbbdc', fogTintAmount: 0.5 },
    fogDensity: 0.0056,
    treeStyle: { leafColors: ['#3f7a3a', '#4c8b42', '#5f9a4c', '#356a35'], accentColors: ['#d8a83a', '#c7523a'], accentRate: 0.06, density: 1 },
    particle: 'petal',
    a: 'turf',
    b: 'cliff',
    tileA: 0.24,
    height: (x, z) => {
      const r = Math.hypot(x, z);
      const th = Math.atan2(z, x);
      const edge = 40 + 6 * fbmWorld(Math.cos(th) * 1.6 + 3, Math.sin(th) * 1.6, 3, 4) + 3 * Math.sin(th * 3);
      const base = flatMask(r) * (fbmWorld(x * 0.05, z * 0.05, 4, 1) * 4.5 - 1.8);
      const rim = sm(r, edge - 12, edge - 1) * 1.2;
      return base + rim - 140 * sm(r - edge, -1.5, 7);
    },
    splat: (x, z, h, slope) => clamp(slope * 2.2 + sm(fbmWorld(x * 0.09, z * 0.09, 3, 8), 0.55, 0.7) * 0.7 + (h < -1.5 ? 1 : 0), 0, 1),
    grass: { count: 1, base: '#3e6b2c', tip: '#9cc257', height: 0.5, spread: 42, density: (x, z, h) => (h > -1.2 ? 1 : 0) },
    flowers: ['#ffffff', '#f5d76e', '#c7a0e8'],
    ridges: [
      { radius: 170, base: 18, amp: 70, freq: 2.2, sharp: 1.6, color: '#2c4054', mist: 0.08, snowLine: 62 },
      { radius: 225, base: 30, amp: 95, freq: 1.7, sharp: 1.5, color: '#4a6178', mist: 0.24 },
      { radius: 290, base: 44, amp: 120, freq: 1.3, sharp: 1.4, color: '#8399ad', mist: 0.48, snowLine: 110 },
    ],
    waterLevel: null,
    waterColor: '#2d5b6b',
    lightBias: 1.05,
  },
  bamboo: {
    id: 'bamboo',
    sky: { turbidity: 5, rayleigh: 1.9, mie: 0.006, mieG: 0.78, cloudCover: 0.5, fogTint: '#b9d4bd', fogTintAmount: 0.5 },
    fogDensity: 0.0135,
    treeStyle: { leafColors: ['#2f7a3c', '#3f8f45', '#5da24f', '#2a6a38'], accentColors: ['#b8d94a'], accentRate: 0.07, density: 1 },
    particle: 'bamboo',
    a: 'moss',
    b: 'soil',
    tileA: 0.3,
    height: (x, z) => {
      const r = Math.hypot(x, z);
      const hills = sm(r, 42, 110) * 26 * (0.45 + fbmWorld(x * 0.02, z * 0.02, 3, 6));
      const base = flatMask(r, 9, 28) * (fbmWorld(x * 0.05, z * 0.05, 4, 2) * 3.6 - 1.2);
      const xs = 15 + 7 * Math.sin(z * 0.055 + 1.2);
      const dist = Math.abs(x - xs);
      const channel = Math.exp(-((dist / 3.6) ** 2)) * 2.6 * sm(Math.abs(z), 0, 8);
      return base + hills - channel;
    },
    splat: (x, z, h, slope) => clamp(slope * 2 + sm(-h, 0.1, 0.9) + sm(fbmWorld(x * 0.08, z * 0.08, 3, 9), 0.55, 0.68) * 0.8, 0, 1),
    grass: { count: 1, base: '#2e5f2a', tip: '#8cc45a', height: 0.55, spread: 44, density: (x, z, h) => (h > -0.25 ? 1 : 0) },
    flowers: ['#ffffff', '#f3b6d5', '#f5e27a'],
    ridges: [
      { radius: 130, base: 8, amp: 32, freq: 3, sharp: 1.0, color: '#2f5a3d', mist: 0.1 },
      { radius: 185, base: 16, amp: 55, freq: 2.2, sharp: 1.2, color: '#4a7a5c', mist: 0.3 },
      { radius: 250, base: 26, amp: 85, freq: 1.6, sharp: 1.3, color: '#7da090', mist: 0.5 },
    ],
    waterLevel: -0.55,
    waterColor: '#1d4a44',
    lightBias: 0.9,
  },
  jiangnan: {
    id: 'jiangnan',
    sky: { turbidity: 6, rayleigh: 1.4, mie: 0.007, mieG: 0.75, cloudCover: 0.62, fogTint: '#d5dde0', fogTintAmount: 0.55 },
    fogDensity: 0.011,
    treeStyle: { leafColors: ['#4a8c48', '#5ea052', '#3b7a40', '#6aad5a'], accentColors: ['#f0a8b8', '#e8c86a'], accentRate: 0.08, density: 1 },
    particle: 'petal',
    a: 'grass',
    b: 'soil',
    tileA: 0.26,
    height: (x, z) => {
      const r = Math.hypot(x, z);
      const base = flatMask(r, 10, 30) * (fbmWorld(x * 0.05, z * 0.05, 4, 3) * 1.4 - 0.5);
      const dx = (x - 30) / 1.05;
      const dz = (z + 34) / 0.85;
      const d = Math.hypot(dx, dz) - 34 + fbmWorld(x * 0.04, z * 0.04, 3, 15) * 9;
      const basin = 3.6 * sm(-d, -3, 6);
      const far = sm(r, 90, 160) * 14 * fbmWorld(x * 0.02, z * 0.02, 3, 4);
      return base + far - basin;
    },
    splat: (x, z, h, slope) => clamp(slope * 2 + sm(-h, -0.2, 0.6) * 0.9 + sm(fbmWorld(x * 0.1, z * 0.1, 3, 10), 0.62, 0.72) * 0.7, 0, 1),
    grass: { count: 1, base: '#3a7028', tip: '#a6cc5e', height: 0.5, spread: 44, density: (x, z, h) => (h > 0.05 ? 1 : 0) },
    flowers: ['#ffffff', '#ffd4e6', '#ffe27a'],
    ridges: [
      { radius: 190, base: 6, amp: 22, freq: 3.2, sharp: 0.9, color: '#5d7c68', mist: 0.2 },
      { radius: 240, base: 10, amp: 40, freq: 2.4, sharp: 1.0, color: '#83a09c', mist: 0.4 },
      { radius: 300, base: 16, amp: 62, freq: 1.8, sharp: 1.1, color: '#a9bdc0', mist: 0.6 },
    ],
    waterLevel: -0.5,
    waterColor: '#2c5560',
    lightBias: 0.85,
  },
  desert: {
    id: 'desert',
    sky: { turbidity: 9, rayleigh: 1.1, mie: 0.012, mieG: 0.9, cloudCover: 0.12, fogTint: '#f0cc98', fogTintAmount: 0.6 },
    fogDensity: 0.0082,
    treeStyle: { leafColors: ['#b7a437', '#c9a83a', '#a89a34', '#d3b13f'], accentColors: ['#e07a2a', '#8fa23a'], accentRate: 0.1, density: 0.85 },
    particle: 'leaf',
    a: 'dune',
    b: 'soil',
    tileA: 0.16,
    height: (x, z) => {
      const r = Math.hypot(x, z);
      const amp = 0.5 + sm(r, 14, 80) * 9;
      const ridge = 1 - Math.abs(fbmWorld(x * 0.028, z * 0.036, 3, 5) * 2 - 1);
      const d = Math.pow(ridge, 1.7) * amp * 1.5 + fbmWorld(x * 0.09, z * 0.09, 3, 6) * amp * 0.35;
      return flatMask(r, 9, 26) * d;
    },
    splat: (x, z, h, slope) => clamp(slope * 1.4 + sm(fbmWorld(x * 0.07, z * 0.07, 3, 11), 0.62, 0.75) * 0.9, 0, 1),
    grass: { count: 1, base: '#8a7a3a', tip: '#d9c877', height: 0.4, spread: 40, density: (x, z, h) => (fbmWorld(x * 0.08, z * 0.08, 2, 21) > 0.62 ? 1 : 0) },
    flowers: [],
    ridges: [
      { radius: 150, base: 8, amp: 24, freq: 3, sharp: 0.9, color: '#b3804c', mist: 0.1 },
      { radius: 215, base: 14, amp: 42, freq: 2.2, sharp: 1.0, color: '#c9955a', mist: 0.3 },
      { radius: 290, base: 22, amp: 70, freq: 1.6, sharp: 1.6, color: '#b1876a', mist: 0.5 },
    ],
    waterLevel: null,
    waterColor: '#2d5b6b',
    lightBias: 1.15,
  },
  snow: {
    id: 'snow',
    sky: { turbidity: 2.4, rayleigh: 2.4, mie: 0.003, mieG: 0.8, cloudCover: 0.5, fogTint: '#b9d0ea', fogTintAmount: 0.55 },
    fogDensity: 0.0105,
    treeStyle: { leafColors: ['#5c7a5a', '#6f8f6c', '#7d9a80'], accentColors: ['#f2f6ff', '#e9c6cf'], accentRate: 0.38, density: 0.5 },
    particle: 'snow',
    a: 'snow',
    b: 'soil',
    tileA: 0.2,
    height: (x, z) => {
      const r = Math.hypot(x, z);
      const drift = flatMask(r, 9, 28) * (fbmWorld(x * 0.045, z * 0.045, 4, 7) * 5 - 2);
      const far = sm(r, 55, 120) * 16 * fbmWorld(x * 0.02, z * 0.02, 3, 12);
      return drift + far;
    },
    splat: (x, z, h, slope) => clamp(slope * 2.5 + sm(fbmWorld(x * 0.11, z * 0.11, 3, 13), 0.66, 0.76) * 0.8, 0, 1),
    grass: { count: 1, base: '#8d8a5c', tip: '#d8d6b0', height: 0.55, spread: 40, density: (x, z, h) => (fbmWorld(x * 0.07, z * 0.07, 2, 22) > 0.6 ? 1 : 0) },
    flowers: [],
    ridges: [
      { radius: 150, base: 24, amp: 60, freq: 2.6, sharp: 1.9, color: '#63788f', mist: 0.1, snowLine: 26 },
      { radius: 215, base: 34, amp: 90, freq: 2.0, sharp: 1.8, color: '#7f94aa', mist: 0.3, snowLine: 40 },
      { radius: 290, base: 50, amp: 130, freq: 1.5, sharp: 1.7, color: '#a9b9ca', mist: 0.5, snowLine: 60 },
    ],
    waterLevel: null,
    waterColor: '#2d5b6b',
    lightBias: 1.1,
  },
};

const RIDGE_VERT = /* glsl */ `
  attribute float aTop;
  varying vec3 vWorld; varying float vH; varying float vTop;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz; vH = position.y; vTop = aTop;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;
const RIDGE_FRAG = /* glsl */ `
  uniform vec3 uColor; uniform vec3 uFog; uniform vec3 uLight; uniform vec3 uSunDir; uniform vec3 uSunColor;
  uniform float uMist; uniform float uSnowLine; uniform float uTop; uniform float uRadius; uniform float uTime; uniform float uNight; uniform float uInk;
  varying vec3 vWorld; varying float vH; varying float vTop;
  ${NOISE_GLSL}
  float fbm4(vec2 p) { float s = 0.0; float a = 0.5; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + 11.7; a *= 0.5; } return s; }
  void main() {
    vec2 radial = normalize(vWorld.xz + 1e-4);
    float lightK = clamp(dot(-radial, normalize(uSunDir.xz + 1e-4)) * 0.5 + 0.5, 0.0, 1.0);
    float theta = atan(vWorld.z, vWorld.x) * uRadius * 0.02;
    float below = max(vTop - vH, 0.0);
    vec2 q = vec2(theta + vH * 0.012, vH * 0.07);
    float stroke = fbm4(vec2(q.x * 7.0, q.y * 1.6));
    float wash = fbm4(vec2(theta * 1.7 + 3.0, vH * 0.03));
    float cun = vnoise(vec2(q.x * 26.0 + below * 0.05, q.y * 0.9));
    float tone = 0.62 + 0.55 * stroke + 0.35 * (cun - 0.5) * smoothstep(0.0, 14.0, below);
    float depthFade = smoothstep(0.0, 1.0, vH / max(uTop, 1.0));
    vec3 lit = uLight * 0.52 + uSunColor * (0.18 + 0.85 * lightK);
    vec3 col = uColor * tone * lit;
    col *= mix(1.0, 0.7, smoothstep(0.1, 0.9, wash) * (1.0 - depthFade * 0.5));
    float sn = smoothstep(uSnowLine - 3.0, uSnowLine + 7.0, vH + (stroke - 0.5) * 16.0) * step(0.5, uSnowLine);
    sn *= smoothstep(0.0, 6.0, below + 2.0);
    col = mix(col, vec3(0.93, 0.96, 1.0) * (uLight * 0.62 + uSunColor * (0.25 + 0.7 * lightK)), sn * 0.9);
    float rim = smoothstep(2.6, 0.0, below);
    col = mix(col, col * 0.55, rim * uInk);
    col += uSunColor * rim * pow(1.0 - lightK, 2.0) * 0.18 * (1.0 - uNight);
    float foot = 1.0 - smoothstep(-8.0, uTop * 0.42, vH);
    float drift = fbm4(vec2(theta * 3.0 + uTime * 0.012, vH * 0.045));
    float bands = smoothstep(0.35, 0.8, drift) * smoothstep(uTop * 0.85, uTop * 0.15, vH);
    float mist = clamp(uMist + foot * 0.85 + bands * 0.4 + (1.0 - lightK) * 0.06, 0.0, 1.0);
    col = mix(col, uFog, mist);
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const MIST_FRAG = /* glsl */ `
  uniform vec3 uFog; uniform vec3 uTint; uniform float uTime; uniform float uAlpha; uniform float uRadius; uniform float uH0; uniform float uHeight; uniform float uSeed;
  varying vec3 vWorld; varying float vH; varying float vTop;
  ${NOISE_GLSL}
  float fbm4(vec2 p) { float s = 0.0; float a = 0.5; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + 11.7; a *= 0.5; } return s; }
  void main() {
    float theta = atan(vWorld.z, vWorld.x) * uRadius * 0.02;
    float y = (vH - uH0) / uHeight;
    float band = exp(-pow((y - 0.35) * 2.2, 2.0));
    float n = fbm4(vec2(theta * 5.0 + uTime * 0.02 + uSeed, vH * 0.05 + uTime * 0.004));
    float n2 = fbm4(vec2(theta * 13.0 - uTime * 0.03, vH * 0.12 + uSeed));
    float a = band * smoothstep(0.25, 0.8, n * 0.8 + n2 * 0.35) * uAlpha;
    gl_FragColor = vec4(mix(uFog, uTint, 0.35), a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const CLOUDSEA_FRAG = /* glsl */ `
  uniform float uTime; uniform vec3 uColor; uniform vec3 uShade; uniform vec3 uFog; uniform vec2 uCam; uniform float uAlpha; uniform float uScale; uniform float uFade;
  varying vec3 vWorld;
  float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float vn(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
  float fbm(vec2 p) { float s = 0.0; float a = 0.5; for (int i = 0; i < 5; i++) { s += a * vn(p); p = p * 2.02 + 9.7; a *= 0.5; } return s; }
  void main() {
    vec2 p = vWorld.xz * uScale + vec2(uTime * 0.012, uTime * 0.006);
    float n = fbm(p);
    float d = fbm(p * 2.6 + 4.0);
    float dens = smoothstep(0.32, 0.62, n * 0.85 + d * 0.3);
    float lit = smoothstep(0.3, 0.75, fbm(p * 1.3 + vec2(0.5, 0.2)));
    vec3 col = mix(uShade, uColor, lit);
    float dist = length(vWorld.xz - uCam);
    float fade = 1.0 - smoothstep(uFade * 0.5, uFade, dist);
    col = mix(col, uFog, smoothstep(60.0, uFade, dist) * 0.55);
    gl_FragColor = vec4(col, dens * uAlpha * fade);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

type Ridge = TerrainConfig['ridges'][number];

function expandRidges(src: Ridge[]): Ridge[] {
  const N = 6;
  const out: Ridge[] = [];
  const c0 = new THREE.Color();
  for (let i = 0; i < N; i++) {
    const u = (i / (N - 1)) * (src.length - 1);
    const j = Math.min(src.length - 2, Math.floor(u));
    const t = u - j;
    const a = src[j];
    const b = src[j + 1];
    const mixv = (x: number, y: number) => lerp(x, y, t);
    c0.set(a.color).lerp(new THREE.Color(b.color), t);
    const snowLine = a.snowLine !== undefined || b.snowLine !== undefined ? mixv(a.snowLine ?? b.snowLine!, b.snowLine ?? a.snowLine!) : undefined;
    out.push({
      radius: mixv(a.radius, b.radius) * (0.9 + i * 0.03),
      base: mixv(a.base, b.base),
      amp: mixv(a.amp, b.amp) * (1 + (i % 2 ? 0.1 : -0.08)),
      freq: mixv(a.freq, b.freq) * (i % 2 ? 1.18 : 0.9),
      sharp: mixv(a.sharp, b.sharp),
      color: `#${c0.getHexString()}`,
      mist: clamp(mixv(a.mist, b.mist) * 0.75 + i * 0.045, 0, 0.9),
      snowLine,
    });
  }
  return out;
}

function ridgeGeometry(l: Ridge, seed: number): THREE.BufferGeometry {
  const cols = 720;
  const rows = 6;
  const pos: number[] = [];
  const tops: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= cols; i++) {
    const th = (i / cols) * Math.PI * 2;
    const cx = Math.cos(th);
    const sz = Math.sin(th);
    const n = fbmWorld(cx * l.freq * 2 + 40, sz * l.freq * 2 + 40, 5, seed);
    const ridged = 1 - Math.abs(fbmWorld(cx * l.freq * 3 + 9, sz * l.freq * 3 + 9, 5, seed + 3) * 2 - 1);
    const crag = 1 - Math.abs(fbmWorld(cx * l.freq * 11 + 70, sz * l.freq * 11 + 70, 3, seed + 8) * 2 - 1);
    const shape = Math.pow(clamp(n * 0.55 + ridged * 0.62 + crag * 0.16 * Math.min(1.4, l.sharp), 0, 1.25), l.sharp);
    const top = l.base + shape * l.amp;
    for (let j = 0; j <= rows; j++) {
      const y = lerp(-40, top, j / rows);
      pos.push(cx * l.radius, y, sz * l.radius);
      tops.push(top);
    }
  }
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const a = i * (rows + 1) + j;
      const b = a + rows + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aTop', new THREE.Float32BufferAttribute(tops, 1));
  g.setIndex(idx);
  return g;
}

function mistGeometry(radius: number, h0: number, height: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(radius, radius, height, 160, 4, true);
  g.translate(0, h0 + height / 2, 0);
  const n = g.attributes.position.count;
  g.setAttribute('aTop', new THREE.Float32BufferAttribute(new Float32Array(n), 1));
  return g;
}

function grassGeometry(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const w = 0.035;
  const v = [-w, 0, 0, w, 0, 0, -w * 0.8, 0.5, 0, w * 0.8, 0.5, 0, 0, 1, 0];
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  g.setIndex([0, 1, 2, 2, 1, 3, 2, 3, 4]);
  return g;
}

export function build(id: TerrainId, userSeed: number, quality: QualityLevel, kit: Kit, renderer: THREE.WebGLRenderer): TerrainWorld {
  const cfg = CONFIGS[id];
  const group = new THREE.Group();
  const rng = mulberry32(userSeed * 7919 + id.length * 31);
  const disposables: { dispose(): void }[] = [];
  const texSize = quality === 'low' ? 256 : 512;
  const uniforms = { uTime: { value: 0 }, uWind: { value: 0 }, uGrow: { value: 1 } };
  const updaters: ((dt: number, env: TerrainEnv) => void)[] = [];
  const flowerSpots: THREE.Vector3[] = [];
  const waterSpots: THREE.Vector3[] = [];
  const onWater: TerrainWorld['onWater'] = [];

  const heightAt = (x: number, z: number) => cfg.height(x, z);
  const waterY = cfg.waterLevel;
  const isWater = (x: number, z: number) => waterY !== null && heightAt(x, z) < waterY - 0.05;

  // ------------------------------------------------ ground
  const groundR = 230;
  const segs = quality === 'low' ? 150 : quality === 'medium' ? 230 : 320;
  const geo = new THREE.PlaneGeometry(groundR * 2, groundR * 2, segs, segs);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const n = pos.count;
  const splat = new Float32Array(n);
  const vcol = new Float32Array(n * 3);
  const uv = new Float32Array(n * 2);
  const c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h = heightAt(x, z);
    pos.setY(i, h);
    const e = 1.5;
    const slope = Math.hypot(heightAt(x + e, z) - heightAt(x - e, z), heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e);
    splat[i] = cfg.splat(x, z, h, slope);
    const v = 0.78 + fbmWorld(x * 0.03, z * 0.03, 3, 2) * 0.5;
    c.setScalar(v);
    c.toArray(vcol, i * 3);
    uv[i * 2] = x * cfg.tileA;
    uv[i * 2 + 1] = z * cfg.tileA;
  }
  geo.setAttribute('aSplat', new THREE.BufferAttribute(splat, 1));
  geo.setAttribute('color', new THREE.BufferAttribute(vcol, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  const ta = surface(cfg.a, texSize);
  const tb = surface(cfg.b, texSize);
  const groundMat = new THREE.MeshStandardMaterial({ map: ta.map, normalMap: ta.normalMap, vertexColors: true, roughness: cfg.a === 'snow' ? 0.55 : 0.95, normalScale: new THREE.Vector2(1.4, 1.4) });
  groundMat.onBeforeCompile = (shader) => {
    shader.uniforms.mapB = { value: tb.map };
    shader.uniforms.normalMapB = { value: tb.normalMap };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aSplat; varying float vSplat;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSplat = aSplat;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vSplat; uniform sampler2D mapB; uniform sampler2D normalMapB;')
      .replace(
        '#include <map_fragment>',
        `vec4 dA = texture2D( map, vMapUv );
         vec4 dA2 = texture2D( map, vMapUv * 0.137 + 0.31 );
         vec4 dB = texture2D( mapB, vMapUv * 0.8 );
         float sp = smoothstep(0.25, 0.75, vSplat);
         vec4 sampledDiffuseColor = mix(dA, dB, sp);
         sampledDiffuseColor.rgb *= 0.72 + 0.56 * dot(dA2.rgb, vec3(0.333));
         diffuseColor *= sampledDiffuseColor;`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        THREE.ShaderChunk.normal_fragment_maps.replace(
          /texture2D\( normalMap, vNormalMapUv \)/g,
          'mix( texture2D( normalMap, vNormalMapUv ), texture2D( normalMapB, vNormalMapUv * 0.8 ), smoothstep(0.25, 0.75, vSplat) )',
        ),
      );
  };
  const ground = new THREE.Mesh(geo, groundMat);
  ground.receiveShadow = true;
  group.add(ground);
  disposables.push(geo, groundMat);

  // ------------------------------------------------ distant ridges (ink wash layers)
  const ridgeMats: THREE.ShaderMaterial[] = [];
  const mistMats: THREE.ShaderMaterial[] = [];
  const layers = expandRidges(cfg.ridges);
  const inkStrength = id === 'bamboo' || id === 'jiangnan' ? 0.9 : id === 'desert' ? 0.35 : 0.6;
  layers.forEach((l, i) => {
    const mat = new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      fog: false,
      uniforms: {
        uNoise: { value: noiseTexture() },
        uColor: { value: new THREE.Color(l.color) },
        uFog: { value: new THREE.Color() },
        uLight: { value: new THREE.Color(1, 1, 1) },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunColor: { value: new THREE.Color() },
        uMist: { value: l.mist },
        uSnowLine: { value: l.snowLine ?? 0 },
        uTop: { value: l.base + l.amp },
        uRadius: { value: l.radius },
        uTime: { value: 0 },
        uNight: { value: 0 },
        uInk: { value: inkStrength },
      },
      vertexShader: RIDGE_VERT,
      fragmentShader: RIDGE_FRAG,
    });
    ridgeMats.push(mat);
    const m = new THREE.Mesh(ridgeGeometry(l, userSeed + i * 13 + id.length), mat);
    m.frustumCulled = false;
    m.renderOrder = -10 + i;
    group.add(m);
    disposables.push(m.geometry, mat);

    if (quality !== 'low' && i < layers.length - 1) {
      const h0 = l.base * 0.3;
      const mh = (l.base + l.amp) * 0.5 + 8;
      const mm = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        fog: false,
        side: THREE.DoubleSide,
        uniforms: {
          uNoise: { value: noiseTexture() },
          uFog: { value: new THREE.Color() },
          uTint: { value: new THREE.Color('#ffffff') },
          uTime: { value: 0 },
          uAlpha: { value: 0.5 + i * 0.05 },
          uRadius: { value: l.radius },
          uH0: { value: h0 },
          uHeight: { value: mh },
          uSeed: { value: i * 7.3 },
        },
        vertexShader: RIDGE_VERT,
        fragmentShader: MIST_FRAG,
      });
      mistMats.push(mm);
      const mist = new THREE.Mesh(mistGeometry(l.radius - 3 - i * 0.5, h0, mh), mm);
      mist.frustumCulled = false;
      mist.renderOrder = -2 + i * 0.1;
      group.add(mist);
      disposables.push(mist.geometry, mm);
    }
  });

  // ------------------------------------------------ cloud sea (mountain)
  const cloudMats: THREE.ShaderMaterial[] = [];
  if (id === 'mountain') {
    const layers = [
      { y: -6, alpha: 0.96, scale: 0.006 },
      { y: -11, alpha: 0.85, scale: 0.009 },
      { y: -2.2, alpha: 0.5, scale: 0.012 },
    ];
    layers.forEach((l, i) => {
      const mat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        fog: false,
        side: THREE.DoubleSide,
        uniforms: {
          uTime: { value: 0 },
          uColor: { value: new THREE.Color('#ffffff') },
          uShade: { value: new THREE.Color('#b9c4d6') },
          uFog: { value: new THREE.Color() },
          uCam: { value: new THREE.Vector2() },
          uAlpha: { value: l.alpha },
          uScale: { value: l.scale },
          uFade: { value: 520 },
        },
        vertexShader: RIDGE_VERT,
        fragmentShader: CLOUDSEA_FRAG,
      });
      cloudMats.push(mat);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400, 1, 1).rotateX(-Math.PI / 2), mat);
      m.position.y = l.y;
      m.renderOrder = -3 + i;
      m.frustumCulled = false;
      group.add(m);
    });
  }

  // ------------------------------------------------ water
  let waterObj: Water | null = null;
  let simpleWater: THREE.Mesh | null = null;
  if (waterY !== null) {
    const wgeo = new THREE.PlaneGeometry(600, 600);
    wgeo.rotateX(-Math.PI / 2);
    const nm = waterNormal(256);
    nm.wrapS = nm.wrapT = THREE.RepeatWrapping;
    if (quality !== 'low') {
      waterObj = new Water(wgeo, {
        textureWidth: quality === 'high' ? 1024 : 512,
        textureHeight: quality === 'high' ? 1024 : 512,
        waterNormals: nm,
        sunDirection: new THREE.Vector3(0, 1, 0),
        sunColor: 0xffffff,
        waterColor: new THREE.Color(cfg.waterColor).getHex(),
        distortionScale: 2.4,
        fog: true,
        alpha: 0.94,
      });
      waterObj.position.y = waterY;
      waterObj.material.uniforms.size.value = 3.5;
      group.add(waterObj);
    } else {
      simpleWater = new THREE.Mesh(wgeo, new THREE.MeshStandardMaterial({ color: cfg.waterColor, roughness: 0.15, metalness: 0.4, transparent: true, opacity: 0.85, normalMap: nm }));
      simpleWater.position.y = waterY;
      group.add(simpleWater);
    }
  }

  // ------------------------------------------------ terrace, path, structures
  group.add(terrace(kit, TERRACE_R, TERRACE_H, 26, rng));
  const lanternSpots: [number, number][] = [];
  for (let i = 0; i < 5; i++) {
    const z = 11 + i * 4.6;
    const x = Math.sin((z - 9) * 0.22 * (1 / 1.5) * 1.5) * 1.4;
    lanternSpots.push([x - 2.6, z], [x + 2.6, z]);
  }
  lanternSpots.push([-2.6, TERRACE_R + 1.2], [2.6, TERRACE_R + 1.2]);
  const lanternProto = stoneLantern(kit);
  lanternSpots.forEach(([x, z], i) => {
    const l = lanternProto.clone();
    l.position.set(x, heightAt(x, z), z);
    l.rotation.y = (i % 2 ? 1 : -1) * 0.2;
    group.add(l);
  });
  const st = stele(kit);
  st.position.set(10, heightAt(10, 6), 6);
  st.rotation.y = -0.5;
  group.add(st);
  const pav = pavilion(kit);
  const pavPos = id === 'jiangnan' ? new THREE.Vector3(-20, 0, 6) : new THREE.Vector3(-18, 0, 9);
  pavPos.y = heightAt(pavPos.x, pavPos.z);
  pav.position.copy(pavPos);
  pav.rotation.y = 0.5;
  group.add(pav);
  const gate = paifang(kit);
  gate.position.set(Math.sin(19 * 0.22) * 1.4 * 0, heightAt(0, 33), 33);
  gate.scale.setScalar(1.1);
  group.add(gate);

  // ------------------------------------------------ grass & flowers
  if (cfg.grass) {
    const gcfg = cfg.grass;
    const total = quality === 'high' ? 90000 : quality === 'medium' ? 38000 : 12000;
    const g = grassGeometry();
    const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', side: THREE.DoubleSide, roughness: 0.85 });
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms, { uBase: { value: new THREE.Color(gcfg.base) }, uTip: { value: new THREE.Color(gcfg.tip) } });
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime; uniform float uWind; varying float vH;')
        .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = normalize(vec3(0.0, 1.0, 0.0) + normal * 0.35);')
        .replace(
          '#include <project_vertex>',
          `vH = position.y;
           vec4 mvPosition = vec4(transformed, 1.0);
           #ifdef USE_INSTANCING
             vec3 ip = vec3(instanceMatrix[3]);
             mvPosition = instanceMatrix * mvPosition;
             float ph = ip.x * 0.9 + ip.z * 1.3;
             float bend = position.y * position.y;
             float gust = uWind * (0.6 + 0.4 * sin(ip.x * 0.15 + uTime * 0.7));
             mvPosition.x += (sin(uTime * 1.8 + ph) * 0.05 + gust * 0.35 + sin(uTime * 4.0 + ph * 2.0) * 0.02 * uWind) * bend * instanceMatrix[1][1];
             mvPosition.z += cos(uTime * 1.5 + ph * 1.2) * 0.04 * bend * instanceMatrix[1][1] * (0.4 + uWind);
           #endif
           mvPosition = modelViewMatrix * mvPosition;
           gl_Position = projectionMatrix * mvPosition;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uBase; uniform vec3 uTip; varying float vH;')
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= mix(uBase * 0.55, uTip, smoothstep(0.0, 1.0, vH));');
    };
    const grass = new THREE.InstancedMesh(g, mat, total);
    grass.receiveShadow = quality === 'high';
    grass.frustumCulled = false;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const col = new THREE.Color();
    let placed = 0;
    const spread = gcfg.spread * (quality === 'low' ? 0.7 : 1);
    const tries = total * 2.2;
    for (let t = 0; t < tries && placed < total; t++) {
      const clump = t % 5 !== 0;
      const a = rng() * Math.PI * 2;
      const r = Math.sqrt(rng()) * spread;
      let x = Math.cos(a) * r;
      let z = Math.sin(a) * r;
      if (clump) {
        const cx = Math.floor(x / 1.6);
        const cz = Math.floor(z / 1.6);
        const hcl = Math.sin(cx * 12.9898 + cz * 78.233) * 43758.5453;
        x = (cx + 0.5 + (hcl - Math.floor(hcl)) * 0.6) * 1.6 + (rng() - 0.5) * 0.9;
        z = (cz + 0.5 + (Math.sin(hcl) * 0.5 + 0.5) * 0.6) * 1.6 + (rng() - 0.5) * 0.9;
      }
      const rr = Math.hypot(x, z);
      if (rr < TERRACE_R + 1.6) continue;
      if (Math.abs(x - Math.sin((z - 8) * 0.22 * 0.667) * 1.4) < 2.5 && z > 6 && z < 40) continue;
      const h = heightAt(x, z);
      const dens = gcfg.density(x, z, h);
      if (dens <= 0 || rng() > dens * (1 - sm(rr, spread * 0.55, spread))) continue;
      const hs = gcfg.height * (0.55 + rng() * 0.9) * (1 + fbmWorld(x * 0.2, z * 0.2, 2, 1) * 0.6);
      q.setFromEuler(e.set((rng() - 0.5) * 0.25, rng() * 6.28, (rng() - 0.5) * 0.25));
      m.compose(new THREE.Vector3(x, h - 0.02, z), q, new THREE.Vector3(1.6 + rng() * 1.6, hs, 1));
      grass.setMatrixAt(placed, m);
      col.setHSL(0.02 * (rng() - 0.5), 0.15 * (rng() - 0.5), 0.9 + rng() * 0.25);
      col.multiplyScalar(0.8 + rng() * 0.4);
      grass.setColorAt(placed, col);
      placed++;
    }
    grass.count = placed;
    group.add(grass);
    disposables.push(g, mat);

    if (cfg.flowers.length) {
      const fc = quality === 'high' ? 520 : quality === 'medium' ? 260 : 100;
      const stem = new THREE.CylinderGeometry(0.008, 0.012, 0.42, 4).translate(0, 0.21, 0);
      const head = new THREE.SphereGeometry(0.05, 6, 4).scale(1, 0.6, 1).translate(0, 0.44, 0);
      const fgeo = mergeGeometries([stem.toNonIndexed(), head.toNonIndexed()])!;
      const fmat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.7 });
      fmat.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader;
      };
      const flowers = new THREE.InstancedMesh(fgeo, fmat, fc);
      let fp = 0;
      for (let t = 0; t < fc * 4 && fp < fc; t++) {
        const a = rng() * Math.PI * 2;
        const r = 9 + Math.sqrt(rng()) * 32;
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        const h = heightAt(x, z);
        if (isWater(x, z) || fbmWorld(x * 0.1, z * 0.1, 2, 44) < 0.5) continue;
        m.compose(new THREE.Vector3(x, h, z), q.setFromEuler(e.set((rng() - 0.5) * 0.3, rng() * 6, (rng() - 0.5) * 0.3)), new THREE.Vector3().setScalar(0.8 + rng() * 0.8));
        flowers.setMatrixAt(fp, m);
        col.set(cfg.flowers[Math.floor(rng() * cfg.flowers.length)]);
        flowers.setColorAt(fp, col);
        if (fp % 6 === 0) flowerSpots.push(new THREE.Vector3(x, h + 0.5, z));
        fp++;
      }
      flowers.count = fp;
      group.add(flowers);
    }
  }

  // ------------------------------------------------ rocks
  const rockCount = quality === 'low' ? 14 : 34;
  const rocks = scatterRocks(
    kit,
    rockCount,
    (i, r) => {
      const a = r() * Math.PI * 2;
      const d = 10 + r() * 46;
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      if (isWater(x, z) || (Math.abs(x) < 4 && z > 6)) return null;
      const h = heightAt(x, z);
      if (h < -20) return null;
      return { x, z, y: h, s: 0.35 + Math.pow(r(), 2.2) * (id === 'mountain' || id === 'snow' ? 2.6 : 1.6) };
    },
    userSeed + 3,
    id === 'snow' ? undefined : undefined,
  );
  group.add(rocks);

  // ------------------------------------------------ terrain specifics
  const shared = { group, heightAt, isWater, rng, kit, quality, uniforms, disposables };
  if (id === 'mountain') buildMountain(shared);
  if (id === 'bamboo') buildBamboo(shared, cfg, waterSpots);
  if (id === 'jiangnan') buildJiangnan(shared, updaters, onWater, waterSpots);
  if (id === 'desert') buildDesert(shared, updaters);
  if (id === 'snow') buildSnow(shared);

  // ------------------------------------------------ frame update
  const tmpC = new THREE.Color();
  const update = (dt: number, env: TerrainEnv) => {
    uniforms.uTime.value = env.time;
    uniforms.uWind.value = env.wind;
    for (const rm of ridgeMats) {
      rm.uniforms.uFog.value.copy(env.fogColor);
      rm.uniforms.uLight.value.copy(env.light);
      rm.uniforms.uSunDir.value.copy(env.sunDir);
      rm.uniforms.uSunColor.value.copy(env.sunColor).multiplyScalar(1 - env.night * 0.85);
      rm.uniforms.uTime.value = env.time;
      rm.uniforms.uNight.value = env.night;
    }
    for (const mm of mistMats) {
      mm.uniforms.uFog.value.copy(env.fogColor);
      mm.uniforms.uTint.value.copy(env.light).multiplyScalar(0.8 + 0.3 * (1 - env.night));
      mm.uniforms.uTime.value = env.time;
    }
    for (const cm of cloudMats) {
      cm.uniforms.uTime.value = env.time;
      cm.uniforms.uFog.value.copy(env.fogColor);
      cm.uniforms.uCam.value.set(env.camPos.x, env.camPos.z);
      cm.uniforms.uColor.value.copy(env.sunColor).lerp(tmpC.set('#ffffff'), 0.55).multiplyScalar(0.55 + 0.6 * (1 - env.night)).lerp(env.light, env.night * 0.6);
      cm.uniforms.uShade.value.copy(env.fogColor).multiplyScalar(0.62 + 0.2 * (1 - env.night));
    }
    if (waterObj) {
      const u = waterObj.material.uniforms;
      u.time.value += dt * 0.6;
      u.sunDirection.value.copy(env.sunDir.y > -0.05 ? env.sunDir : env.sunDir.clone().negate()).normalize();
      u.sunColor.value.copy(env.sunColor).multiplyScalar(0.4 + 0.6 * (1 - env.night));
      u.waterColor.value.set(cfg.waterColor).multiplyScalar(0.2 + 0.8 * (1 - env.night * 0.8)).lerp(env.fogColor, 0.15);
    }
    if (simpleWater) (simpleWater.material as THREE.MeshStandardMaterial).color.set(cfg.waterColor).multiplyScalar(0.3 + 0.7 * (1 - env.night));
    for (const u of updaters) u(dt, env);
  };

  return {
    id,
    group,
    glows: kit.glows,
    sky: cfg.sky,
    fogDensity: cfg.fogDensity,
    treeStyle: cfg.treeStyle,
    particle: cfg.particle,
    terraceHeight: TERRACE_H,
    heightAt,
    isWater,
    update,
    lightBias: cfg.lightBias,
    flowerSpots,
    waterSpots,
    onWater,
    dispose() {
      group.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
      });
      disposables.forEach((d) => d.dispose());
      waterObj?.material.dispose();
    },
  };
}

interface Shared {
  group: THREE.Group;
  heightAt: (x: number, z: number) => number;
  isWater: (x: number, z: number) => boolean;
  rng: () => number;
  kit: Kit;
  quality: QualityLevel;
  uniforms: { uTime: { value: number }; uWind: { value: number }; uGrow: { value: number } };
  disposables: { dispose(): void }[];
}

function pineField(s: Shared, count: number, snowy: boolean, place: (r: () => number) => { x: number; z: number } | null, scale: [number, number]) {
  const geo = [pineGeometry(1, snowy), pineGeometry(2, snowy), pineGeometry(3, snowy)];
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: false });
  const bins: THREE.Matrix4[][] = [[], [], []];
  for (let i = 0; i < count; i++) {
    const p = place(s.rng);
    if (!p) continue;
    const h = s.heightAt(p.x, p.z);
    const sc = scale[0] + s.rng() * (scale[1] - scale[0]);
    bins[i % 3].push(
      new THREE.Matrix4().compose(new THREE.Vector3(p.x, h - 0.2, p.z), new THREE.Quaternion().setFromEuler(new THREE.Euler((s.rng() - 0.5) * 0.08, s.rng() * 6, (s.rng() - 0.5) * 0.08)), new THREE.Vector3(sc, sc * (0.9 + s.rng() * 0.4), sc)),
    );
  }
  geo.forEach((g, i) => {
    const im = new THREE.InstancedMesh(g, mat, Math.max(1, bins[i].length));
    bins[i].forEach((m, k) => im.setMatrixAt(k, m));
    im.count = bins[i].length;
    im.castShadow = s.quality !== 'low';
    im.receiveShadow = true;
    s.group.add(im);
  });
  s.disposables.push(mat);
}

function buildMountain(s: Shared) {
  pineField(
    s,
    9,
    false,
    (r) => {
      const a = r() * Math.PI * 2;
      const d = 24 + r() * 9;
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      if (z > 4 && Math.abs(x) < 14) return null;
      return s.heightAt(x, z) > -1 ? { x, z } : null;
    },
    [0.9, 1.5],
  );
  pineField(
    s,
    40,
    false,
    (r) => {
      const a = r() * Math.PI * 2;
      const d = 34 + r() * 8;
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      return s.heightAt(x, z) > -3 ? { x, z } : null;
    },
    [0.6, 1.2],
  );
}

function bambooGrove(s: Shared, count: number, place: (r: () => number) => { x: number; z: number } | null, colorHue = 0.24) {
  const stalkGeo = bambooStalkGeometry();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, s.uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime; uniform float uWind;')
      .replace(
        '#include <project_vertex>',
        `vec4 mvPosition = vec4(transformed, 1.0);
         #ifdef USE_INSTANCING
           vec3 ip = vec3(instanceMatrix[3]);
           mvPosition = instanceMatrix * mvPosition;
           float hh = max(position.y, 0.0) / 14.0;
           float ph = ip.x * 0.6 + ip.z * 0.8;
           mvPosition.x += hh * hh * (sin(uTime * 1.3 + ph) * 0.35 + uWind * 1.4);
           mvPosition.z += hh * hh * cos(uTime * 1.1 + ph) * 0.3;
         #endif
         mvPosition = modelViewMatrix * mvPosition;
         gl_Position = projectionMatrix * mvPosition;`,
      );
  };
  const stalks = new THREE.InstancedMesh(stalkGeo, mat, count);
  stalks.castShadow = s.quality !== 'low';
  stalks.frustumCulled = false;
  const leafTex = leafTexture();
  const leafMat = new THREE.MeshStandardMaterial({ map: leafTex, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.8, color: new THREE.Color().setHSL(colorHue, 0.5, 0.55) });
  leafMat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, s.uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime; uniform float uWind;')
      .replace(
        '#include <project_vertex>',
        `vec4 mvPosition = vec4(transformed, 1.0);
         #ifdef USE_INSTANCING
           vec3 ip = vec3(instanceMatrix[3]);
           mvPosition = instanceMatrix * mvPosition;
           float hh = clamp(mvPosition.y / 14.0, 0.0, 1.0);
           float ph = ip.x * 0.6 + ip.z * 0.8;
           mvPosition.x += hh * hh * (sin(uTime * 1.3 + ph) * 0.35 + uWind * 1.4) + sin(uTime * 3.0 + ph * 3.0) * 0.05 * uWind;
           mvPosition.z += hh * hh * cos(uTime * 1.1 + ph) * 0.3;
         #endif
         mvPosition = modelViewMatrix * mvPosition;
         gl_Position = projectionMatrix * mvPosition;`,
      );
  };
  const leavesPer = 7;
  const leaves = new THREE.InstancedMesh(new THREE.PlaneGeometry(1.7, 1.7), leafMat, count * leavesPer);
  leaves.frustumCulled = false;
  leaves.castShadow = false;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const col = new THREE.Color();
  let placed = 0;
  let lp = 0;
  for (let i = 0; i < count * 3 && placed < count; i++) {
    const p = place(s.rng);
    if (!p) continue;
    const h = s.heightAt(p.x, p.z);
    const hs = 0.7 + s.rng() * 0.6;
    const lean = new THREE.Euler((s.rng() - 0.5) * 0.12, s.rng() * 6.28, (s.rng() - 0.5) * 0.12);
    m.compose(new THREE.Vector3(p.x, h - 0.1, p.z), q.setFromEuler(lean), new THREE.Vector3(1, hs, 1));
    stalks.setMatrixAt(placed, m);
    const top = 14.4 * hs;
    for (let k = 0; k < leavesPer; k++) {
      const y = top - s.rng() * 4.2 * hs;
      const spread = 0.4 + (1 - (top - y) / (4.2 * hs)) * 0.8;
      m.compose(
        new THREE.Vector3(p.x + (s.rng() - 0.5) * 1.6 * spread, h + y, p.z + (s.rng() - 0.5) * 1.6 * spread),
        q.setFromEuler(e.set((s.rng() - 0.5) * 2.4, s.rng() * 6.28, (s.rng() - 0.5) * 2.4)),
        new THREE.Vector3().setScalar(0.8 + s.rng() * 0.8),
      );
      leaves.setMatrixAt(lp, m);
      col.setHSL(0.22 + s.rng() * 0.07, 0.55, 0.5 + s.rng() * 0.25);
      leaves.setColorAt(lp, col);
      lp++;
    }
    placed++;
  }
  stalks.count = placed;
  leaves.count = lp;
  s.group.add(stalks, leaves);
  s.disposables.push(mat, leafMat);
}

function buildBamboo(s: Shared, cfg: TerrainConfig, waterSpots: THREE.Vector3[]) {
  void cfg;
  const total = s.quality === 'high' ? 620 : s.quality === 'medium' ? 320 : 120;
  bambooGrove(s, total, (r) => {
    const a = r() * Math.PI * 2;
    const d = 22 + Math.pow(r(), 0.6) * 60;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    if (s.isWater(x, z) || s.heightAt(x, z) < -0.3) return null;
    if (fbmWorld(x * 0.06, z * 0.06, 3, 31) < 0.42) return null;
    if (Math.abs(x) < 6 && z > 6) return null;
    return { x, z };
  });
  const bridge = archBridge(s.kit, 11, 3.2);
  const xs = 15 + 7 * Math.sin(20 * 0.055 + 1.2);
  bridge.position.set(xs, -0.45, 20);
  s.group.add(bridge);
  for (let i = 0; i < 12; i++) waterSpots.push(new THREE.Vector3(15 + 7 * Math.sin((i - 6) * 8 * 0.055 + 1.2), -0.3, (i - 6) * 8));
}

function buildJiangnan(s: Shared, updaters: ((dt: number, env: TerrainEnv) => void)[], onWater: TerrainWorld['onWater'], waterSpots: THREE.Vector3[]) {
  const houses = new THREE.Group();
  const spots: [number, number, number][] = [
    [-34, -30, 0.4],
    [-42, -22, 0.2],
    [-27, -42, 0.5],
    [-50, -38, 0.1],
    [-22, -34, 0.7],
    [58, -8, -0.5],
    [66, -18, -0.3],
  ];
  spots.forEach(([x, z, ry], i) => {
    const h = house(s.kit, 5 + (i % 3), 4 + (i % 2), 3.4 + (i % 2) * 0.5);
    h.position.set(x, s.heightAt(x, z), z);
    h.rotation.y = ry;
    houses.add(h);
  });
  s.group.add(houses);

  const bridge = archBridge(s.kit, 12, 3.4);
  bridge.position.set(12, -0.5, -12);
  bridge.rotation.y = 0.3;
  s.group.add(bridge);

  const boat = wupengBoat(s.kit);
  boat.position.set(34, -0.42, -18);
  s.group.add(boat);
  onWater.push({ object: boat, base: boat.position.clone(), phase: 0 });
  updaters.push((_, env) => {
    boat.position.x = 34 + Math.sin(env.time * 0.05) * 8;
    boat.position.z = -18 + Math.cos(env.time * 0.04) * 6;
    boat.position.y = -0.42 + Math.sin(env.time * 0.9) * 0.04;
    boat.rotation.y = Math.PI / 2 + Math.cos(env.time * 0.05) * 0.3;
    boat.rotation.z = Math.sin(env.time * 0.8) * 0.02;
  });

  const lotusGeo = new THREE.CircleGeometry(0.75, 20).rotateX(-Math.PI / 2);
  const lotusMat = new THREE.MeshStandardMaterial({ color: '#4c8c4a', roughness: 0.6, side: THREE.DoubleSide });
  const lotusN = 90;
  const lotus = new THREE.InstancedMesh(lotusGeo, lotusMat, lotusN);
  const m = new THREE.Matrix4();
  let lp = 0;
  const col = new THREE.Color();
  for (let t = 0; t < 1200 && lp < lotusN; t++) {
    const x = 6 + s.rng() * 46;
    const z = -6 - s.rng() * 46;
    if (!s.isWater(x, z) || s.heightAt(x, z) > -1.6) continue;
    m.compose(new THREE.Vector3(x, -0.47, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, s.rng() * 6, 0)), new THREE.Vector3().setScalar(0.6 + s.rng() * 0.9));
    lotus.setMatrixAt(lp, m);
    col.setHSL(0.3 + s.rng() * 0.05, 0.5, 0.25 + s.rng() * 0.15);
    lotus.setColorAt(lp, col);
    if (lp % 9 === 0) waterSpots.push(new THREE.Vector3(x, -0.4, z));
    lp++;
  }
  lotus.count = lp;
  lotus.receiveShadow = true;
  s.group.add(lotus);

  // 垂柳
  const strandGeo = new THREE.PlaneGeometry(0.16, 3.6, 1, 4).translate(0, -1.8, 0);
  const strandMat = new THREE.MeshStandardMaterial({ color: '#6c9a4a', side: THREE.DoubleSide, roughness: 0.8 });
  strandMat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, s.uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime; uniform float uWind;')
      .replace(
        '#include <project_vertex>',
        `vec4 mvPosition = vec4(transformed, 1.0);
         #ifdef USE_INSTANCING
           vec3 ip = vec3(instanceMatrix[3]);
           mvPosition = instanceMatrix * mvPosition;
           float d = -position.y / 3.6;
           float ph = ip.x * 0.7 + ip.z * 0.4;
           mvPosition.x += d * d * (sin(uTime * 1.2 + ph) * 0.35 + uWind * 1.2);
           mvPosition.z += d * d * cos(uTime * 0.9 + ph) * 0.3;
         #endif
         mvPosition = modelViewMatrix * mvPosition;
         gl_Position = projectionMatrix * mvPosition;`,
      );
  };
  const willowSpots: [number, number][] = [
    [8, -8],
    [22, 10],
    [-6, -22],
    [5, -34],
    [-22, 22],
  ];
  const strandsPer = s.quality === 'low' ? 60 : 160;
  const strands = new THREE.InstancedMesh(strandGeo, strandMat, willowSpots.length * strandsPer);
  strands.frustumCulled = false;
  let sp = 0;
  const trunkMat = new THREE.MeshStandardMaterial({ color: '#4a3a2c', roughness: 0.95 });
  for (const [wx, wz] of willowSpots) {
    const h = s.heightAt(wx, wz);
    const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(wx, h - 0.3, wz), new THREE.Vector3(wx + 0.4, h + 1.5, wz), new THREE.Vector3(wx - 0.2, h + 3, wz + 0.3), new THREE.Vector3(wx + 0.6, h + 4.6, wz)]);
    const trunk = new THREE.Mesh(new THREE.TubeGeometry(curve, 14, 0.32, 8), trunkMat);
    trunk.castShadow = true;
    s.group.add(trunk);
    for (let i = 0; i < strandsPer; i++) {
      const a = s.rng() * Math.PI * 2;
      const r = Math.sqrt(s.rng()) * 3.4;
      m.compose(
        new THREE.Vector3(wx + 0.6 + Math.cos(a) * r, h + 4.6 - r * 0.25 + s.rng() * 0.4, wz + Math.sin(a) * r),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, s.rng() * 6, 0)),
        new THREE.Vector3(1, 0.7 + s.rng() * 0.7, 1),
      );
      strands.setMatrixAt(sp, m);
      col.setHSL(0.24 + s.rng() * 0.05, 0.45, 0.4 + s.rng() * 0.15);
      strands.setColorAt(sp, col);
      sp++;
    }
  }
  s.group.add(strands);
  s.disposables.push(lotusMat, strandMat, trunkMat);
}

function buildDesert(s: Shared, updaters: ((dt: number, env: TerrainEnv) => void)[]) {
  // 孤烟：远处升起的烟柱
  const smokeCount = 42;
  const tex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,0.7)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  const sprites: THREE.Sprite[] = [];
  const base = new THREE.Vector3(-70, 0, -95);
  base.y = s.heightAt(base.x, base.z);
  const smokeMat = new THREE.SpriteMaterial({ map: tex, color: '#8f8479', transparent: true, depthWrite: false, opacity: 0.5 });
  for (let i = 0; i < smokeCount; i++) {
    const sp = new THREE.Sprite(smokeMat.clone());
    sp.userData.t = i / smokeCount;
    sprites.push(sp);
    s.group.add(sp);
  }
  updaters.push((dt, env) => {
    for (const sp of sprites) {
      sp.userData.t = (sp.userData.t + dt * 0.02) % 1;
      const t = sp.userData.t as number;
      const y = base.y + t * 90;
      sp.position.set(base.x + Math.sin(t * 6 + env.time * 0.1) * 1.5 + t * t * 10 * (0.3 + env.wind), y, base.z);
      sp.scale.setScalar(4 + t * 14);
      const m = sp.material as THREE.SpriteMaterial;
      m.opacity = Math.sin(t * Math.PI) * 0.4 * (1 - env.night * 0.5);
      m.color.set('#9a8f83').lerp(env.fogColor, 0.35 + t * 0.3);
    }
  });
  // 枯木
  const deadMat = new THREE.MeshStandardMaterial({ color: '#4a3a2e', roughness: 1 });
  for (let i = 0; i < 6; i++) {
    const a = s.rng() * Math.PI * 2;
    const d = 22 + s.rng() * 30;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    const h = s.heightAt(x, z);
    const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(x, h - 0.2, z), new THREE.Vector3(x + 0.3, h + 1, z - 0.2), new THREE.Vector3(x - 0.4, h + 2.2, z + 0.3), new THREE.Vector3(x + 0.2, h + 3, z)]);
    const t = new THREE.Mesh(new THREE.TubeGeometry(curve, 10, 0.16, 6), deadMat);
    t.castShadow = true;
    s.group.add(t);
    for (let b = 0; b < 3; b++) {
      const c2 = new THREE.CatmullRomCurve3([curve.getPoint(0.6 + b * 0.12), curve.getPoint(0.6 + b * 0.12).add(new THREE.Vector3((s.rng() - 0.5) * 1.4, 0.6, (s.rng() - 0.5) * 1.4)), curve.getPoint(0.6 + b * 0.12).add(new THREE.Vector3((s.rng() - 0.5) * 2.4, 1.3, (s.rng() - 0.5) * 2.4))]);
      const tb = new THREE.Mesh(new THREE.TubeGeometry(c2, 6, 0.05, 5), deadMat);
      s.group.add(tb);
    }
  }
  s.disposables.push(deadMat);
}

function buildSnow(s: Shared) {
  pineField(
    s,
    s.quality === 'low' ? 60 : 200,
    true,
    (r) => {
      const a = r() * Math.PI * 2;
      const d = 24 + Math.pow(r(), 0.7) * 90;
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      if (Math.abs(x) < 6 && z > 6) return null;
      if (fbmWorld(x * 0.05, z * 0.05, 3, 51) < 0.4) return null;
      return { x, z };
    },
    [0.8, 1.7],
  );
  const pondGeo = new THREE.CircleGeometry(7, 40).rotateX(-Math.PI / 2);
  const pond = new THREE.Mesh(pondGeo, new THREE.MeshStandardMaterial({ color: '#a8c9dc', roughness: 0.05, metalness: 0.5 }));
  const px = -22;
  const pz = -14;
  pond.position.set(px, s.heightAt(px, pz) + 0.06, pz);
  pond.receiveShadow = true;
  s.group.add(pond);
}
