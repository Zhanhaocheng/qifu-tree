import * as THREE from 'three';
import { mulberry32 } from './tree';

interface Key {
  h: number;
  top: string;
  horizon: string;
  sun: string;
  sunI: number;
  hemiSky: string;
  hemiGround: string;
  hemiI: number;
}

const KEYS: Key[] = [
  { h: 0, top: '#050818', horizon: '#0d1530', sun: '#8aa4ff', sunI: 0.0, hemiSky: '#2b3a78', hemiGround: '#10131f', hemiI: 0.55 },
  { h: 4.8, top: '#070b1f', horizon: '#141c3c', sun: '#8aa4ff', sunI: 0.0, hemiSky: '#2b3a78', hemiGround: '#10131f', hemiI: 0.55 },
  { h: 5.9, top: '#3b3f7a', horizon: '#f0956b', sun: '#ffb27a', sunI: 1.0, hemiSky: '#7a80b8', hemiGround: '#3b2c2c', hemiI: 0.6 },
  { h: 7.5, top: '#4f8fd6', horizon: '#f7d7b0', sun: '#ffe2b8', sunI: 2.2, hemiSky: '#9cc4f0', hemiGround: '#5c6b3f', hemiI: 0.8 },
  { h: 10, top: '#3d86dc', horizon: '#bfe1f7', sun: '#fff6e3', sunI: 3.0, hemiSky: '#a9d2f5', hemiGround: '#66774a', hemiI: 0.95 },
  { h: 14, top: '#3d86dc', horizon: '#bfe1f7', sun: '#fff6e3', sunI: 3.0, hemiSky: '#a9d2f5', hemiGround: '#66774a', hemiI: 0.95 },
  { h: 16.8, top: '#5a90d0', horizon: '#f6d9a8', sun: '#ffd9a0', sunI: 2.2, hemiSky: '#a6c3e6', hemiGround: '#5f6a42', hemiI: 0.8 },
  { h: 18.2, top: '#40407f', horizon: '#ff8a5c', sun: '#ff9a62', sunI: 1.1, hemiSky: '#8a7aa8', hemiGround: '#3b2c2c', hemiI: 0.6 },
  { h: 19.4, top: '#141a44', horizon: '#6a4a78', sun: '#8aa4ff', sunI: 0.0, hemiSky: '#38477f', hemiGround: '#1a1a26', hemiI: 0.55 },
  { h: 21, top: '#050818', horizon: '#0d1530', sun: '#8aa4ff', sunI: 0.0, hemiSky: '#2b3a78', hemiGround: '#10131f', hemiI: 0.55 },
  { h: 24, top: '#050818', horizon: '#0d1530', sun: '#8aa4ff', sunI: 0.0, hemiSky: '#2b3a78', hemiGround: '#10131f', hemiI: 0.55 },
];

export interface SkyState {
  top: THREE.Color;
  horizon: THREE.Color;
  sunColor: THREE.Color;
  sunIntensity: number;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  hemiIntensity: number;
  sunDir: THREE.Vector3;
  moonDir: THREE.Vector3;
  night: number;
  hour: number;
}

const cache = new Map<string, THREE.Color>();
const col = (s: string) => {
  let c = cache.get(s);
  if (!c) cache.set(s, (c = new THREE.Color(s)));
  return c;
};

export function sampleSky(hour: number, out: SkyState): SkyState {
  const h = ((hour % 24) + 24) % 24;
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1].h <= h) i++;
  const a = KEYS[i];
  const b = KEYS[i + 1];
  const t = THREE.MathUtils.smoothstep(h, a.h, b.h);
  const mix = (target: THREE.Color, ca: string, cb: string) => target.copy(col(ca)).lerp(col(cb), t);
  mix(out.top, a.top, b.top);
  mix(out.horizon, a.horizon, b.horizon);
  mix(out.sunColor, a.sun, b.sun);
  mix(out.hemiSky, a.hemiSky, b.hemiSky);
  mix(out.hemiGround, a.hemiGround, b.hemiGround);
  out.sunIntensity = THREE.MathUtils.lerp(a.sunI, b.sunI, t);
  out.hemiIntensity = THREE.MathUtils.lerp(a.hemiI, b.hemiI, t);

  const ang = (Math.PI * (h - 6)) / 12;
  out.sunDir.set(-Math.cos(ang) * 0.85, Math.sin(ang), 0.45).normalize();
  out.moonDir.set(Math.cos(ang) * 0.7, -Math.sin(ang), -0.35).normalize();
  out.night = 1 - THREE.MathUtils.smoothstep(out.sunDir.y, -0.12, 0.18);
  out.hour = h;
  return out;
}

export function makeSkyState(): SkyState {
  return {
    top: new THREE.Color(),
    horizon: new THREE.Color(),
    sunColor: new THREE.Color(),
    sunIntensity: 0,
    hemiSky: new THREE.Color(),
    hemiGround: new THREE.Color(),
    hemiIntensity: 0,
    sunDir: new THREE.Vector3(),
    moonDir: new THREE.Vector3(),
    night: 0,
    hour: 12,
  };
}

export function createSkyDome() {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uTop: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color() },
      uSunAmount: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * p;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uSunDir; uniform vec3 uSunColor; uniform float uSunAmount;
      varying vec3 vDir;
      void main() {
        float h = clamp(vDir.y, -0.2, 1.0);
        float t = pow(clamp(h, 0.0, 1.0), 0.55);
        vec3 col = mix(uHorizon, uTop, t);
        col = mix(col, uHorizon * 0.6, smoothstep(0.0, -0.2, vDir.y));
        float s = max(dot(normalize(vDir), normalize(uSunDir)), 0.0);
        col += uSunColor * (pow(s, 600.0) * 2.5 + pow(s, 12.0) * 0.28) * uSunAmount;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(250, 32, 16), material);
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  return mesh;
}

export function createStars() {
  const rng = mulberry32(7);
  const n = 1400;
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const u = rng() * 2 - 1;
    const phi = rng() * Math.PI * 2;
    const y = Math.abs(u) * 0.95 + 0.05;
    const r = Math.sqrt(1 - y * y);
    pos[i * 3] = Math.cos(phi) * r * 220;
    pos[i * 3 + 1] = y * 220;
    pos[i * 3 + 2] = Math.sin(phi) * r * 220;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ color: 0xffffff, size: 1.8, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  return pts;
}

export function glowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.3, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
