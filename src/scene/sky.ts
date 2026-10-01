import * as THREE from 'three';
import { mulberry32 } from './tree';
import { moonTexture } from './textures';

interface Key {
  h: number;
  top: string;
  mid: string;
  horizon: string;
  sun: string;
  sunI: number;
  hemiSky: string;
  hemiGround: string;
  hemiI: number;
}

const NIGHT = { top: '#040716', mid: '#0a1330', horizon: '#142349', sun: '#8aa4ff', sunI: 0.0, hemiSky: '#4560b0', hemiGround: '#1a2236', hemiI: 0.62 };

const KEYS: Key[] = [
  { h: 0, ...NIGHT },
  { h: 4.6, ...NIGHT },
  { h: 5.5, top: '#1d2a66', mid: '#7a5a96', horizon: '#ff9a6c', sun: '#ffb27a', sunI: 0.9, hemiSky: '#7a80b8', hemiGround: '#3b2c2c', hemiI: 0.6 },
  { h: 6.6, top: '#3566b8', mid: '#9cb4d8', horizon: '#ffd2a0', sun: '#ffd9b0', sunI: 1.8, hemiSky: '#9cb8e8', hemiGround: '#5c6b3f', hemiI: 0.75 },
  { h: 9, top: '#1f66cc', mid: '#5ea0e6', horizon: '#c4e2f7', sun: '#fff3d6', sunI: 3.0, hemiSky: '#a9d2f5', hemiGround: '#66774a', hemiI: 0.95 },
  { h: 14.5, top: '#1f66cc', mid: '#5ea0e6', horizon: '#c4e2f7', sun: '#fff3d6', sunI: 3.0, hemiSky: '#a9d2f5', hemiGround: '#66774a', hemiI: 0.95 },
  { h: 16.8, top: '#2b66c0', mid: '#7fa8d8', horizon: '#f8dcae', sun: '#ffd19a', sunI: 2.3, hemiSky: '#a6c3e6', hemiGround: '#5f6a42', hemiI: 0.8 },
  { h: 18.1, top: '#26306e', mid: '#9a5a8a', horizon: '#ff7a48', sun: '#ff8f55', sunI: 1.6, hemiSky: '#9a86b0', hemiGround: '#4a3636', hemiI: 0.85 },
  { h: 19.3, top: '#10163c', mid: '#3a2f6a', horizon: '#8a4a78', sun: '#8aa4ff', sunI: 0.0, hemiSky: '#38477f', hemiGround: '#1a1a26', hemiI: 0.58 },
  { h: 21, ...NIGHT },
  { h: 24, ...NIGHT },
];

export interface SkyState {
  top: THREE.Color;
  mid: THREE.Color;
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
  mix(out.mid, a.mid, b.mid);
  mix(out.horizon, a.horizon, b.horizon);
  mix(out.sunColor, a.sun, b.sun);
  mix(out.hemiSky, a.hemiSky, b.hemiSky);
  mix(out.hemiGround, a.hemiGround, b.hemiGround);
  out.sunIntensity = THREE.MathUtils.lerp(a.sunI, b.sunI, t);
  out.hemiIntensity = THREE.MathUtils.lerp(a.hemiI, b.hemiI, t);

  const ang = (Math.PI * (h - 6)) / 12;
  const place = (v: THREE.Vector3, hx: number, y: number, hz: number) => {
    const hl = Math.hypot(hx, hz);
    const k = Math.sqrt(Math.max(0, 1 - y * y)) / hl;
    v.set(hx * k, y, hz * k);
  };
  place(out.sunDir, Math.cos(ang) * 0.5, Math.sin(ang), -0.8);
  place(out.moonDir, Math.cos(ang - 0.35) * 0.45, -Math.sin(ang - 0.35), -0.75);
  out.night = 1 - THREE.MathUtils.smoothstep(out.sunDir.y, -0.22, 0.03);
  out.hour = h;
  return out;
}

export function makeSkyState(): SkyState {
  return {
    top: new THREE.Color(),
    mid: new THREE.Color(),
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

export function glowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.2, 'rgba(255,255,255,0.55)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.14)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 256x256 随机噪声：R/G 通道相互错位，用于着色器内廉价的平滑值噪声 */
let noiseTex: THREE.DataTexture | null = null;
export function noiseTexture(): THREE.DataTexture {
  if (noiseTex) return noiseTex;
  const n = 256;
  const data = new Uint8Array(n * n * 4);
  const rng = mulberry32(90210);
  const base = new Uint8Array(n * n);
  for (let i = 0; i < base.length; i++) base[i] = Math.floor(rng() * 256);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = (y * n + x) * 4;
      data[i] = base[y * n + x];
      data[i + 1] = base[((y + 17) % n) * n + ((x + 37) % n)];
      data[i + 2] = base[((y + 101) % n) * n + ((x + 59) % n)];
      data[i + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  noiseTex = t;
  return t;
}

export const NOISE_GLSL = /* glsl */ `
  uniform sampler2D uNoise;
  float vnoise(vec2 x) {
    vec2 p = floor(x); vec2 f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return texture2D(uNoise, (p + f + 0.5) / 256.0).r;
  }
  float vnoiseG(vec2 x) {
    vec2 p = floor(x); vec2 f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return texture2D(uNoise, (p + f + 0.5) / 256.0).g;
  }
`;

export interface SkyParams {
  turbidity: number;
  rayleigh: number;
  mie: number;
  mieG: number;
  cloudCover: number;
  fogTint: string;
  fogTintAmount: number;
}

const DOME_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const DOME_FRAG = /* glsl */ `
  uniform float uTime; uniform float uCover; uniform float uNight; uniform float uGain; uniform float uHaze;
  uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uHorizon;
  uniform vec3 uSunDir; uniform vec3 uSunColor; uniform vec3 uMoonDir;
  uniform vec3 uLightDir; uniform vec3 uLightColor; uniform vec3 uAmbient;
  varying vec3 vDir;
  ${NOISE_GLSL}

  float fbm(vec2 p) {
    float s = 0.0; float a = 0.5;
    for (int i = 0; i < OCT; i++) { s += a * vnoise(p); p = p * 2.07 + vec2(17.3, 9.1); a *= 0.5; }
    return s;
  }
  float fbm3(vec2 p) {
    float s = 0.0; float a = 0.5;
    for (int i = 0; i < 3; i++) { s += a * vnoiseG(p); p = p * 2.11 + vec2(3.7, 21.9); a *= 0.5; }
    return s;
  }

  float cloudShape(vec2 p, float cover) {
    float n = fbm(p);
    float large = fbm3(p * 0.28 + 4.0);
    float v = n * 0.78 + large * 0.42;
    return smoothstep(1.0 - cover, 1.0 - cover + 0.2, v);
  }

  void main() {
    vec3 d = normalize(vDir);
    float y = d.y;
    float yy = clamp(y, 0.0, 1.0);

    vec3 base = mix(uHorizon, uMid, smoothstep(0.0, 0.2, yy));
    base = mix(base, uTop, smoothstep(0.1, 0.8, yy));
    base = mix(base, uHorizon * 0.85, smoothstep(0.0, -0.25, y));
    base = mix(base, uHorizon * 1.12, exp(-yy * 16.0) * uHaze);

    float s = max(dot(d, normalize(uSunDir)), 0.0);
    float sunUp = smoothstep(-0.12, 0.08, uSunDir.y);
    float low = 1.0 - smoothstep(0.05, 0.5, uSunDir.y);
    vec3 sky = base;
    sky += uSunColor * (pow(s, 4.0) * 0.18 + pow(s, 24.0) * 0.5 + pow(s, 200.0) * 1.6) * sunUp;
    sky += uSunColor * pow(s, 2.2) * exp(-yy * 5.0) * low * 0.75 * sunUp;
    sky += uSunColor * smoothstep(0.99955, 0.99985, s) * 34.0 * sunUp;

    float m = max(dot(d, normalize(uMoonDir)), 0.0);
    vec3 moonCol = vec3(0.62, 0.74, 1.0);
    sky += moonCol * (pow(m, 14.0) * 0.12 + pow(m, 90.0) * 0.34 + pow(m, 700.0) * 0.5) * uNight;
    float ring = smoothstep(0.018, 0.0, abs(acos(clamp(m, 0.0, 1.0)) - 0.37)) * 0.05;
    sky += moonCol * ring * uNight;

    if (uNight > 0.05 && y > 0.0) {
      vec3 ax = normalize(vec3(0.35, 0.75, -0.55));
      float band = exp(-pow(dot(d, ax) * 3.4, 2.0));
      vec2 q = d.xz / (y + 0.35) * 3.0 + d.y * 4.0;
      float dust = fbm(q * 1.4);
      float lanes = smoothstep(0.35, 0.75, fbm3(q * 2.4 + 9.0));
      float mw = band * (0.25 + dust * 0.9) * (1.0 - lanes * 0.55);
      sky += vec3(0.28, 0.32, 0.55) * mw * 0.28 * uNight * smoothstep(0.0, 0.25, y);
    }

    float sl = dot(sky, vec3(0.2126, 0.7152, 0.0722));
    sky = mix(vec3(sl), sky, (1.12 + 0.55 * smoothstep(0.05, 0.5, uSunDir.y)) * (1.0 - 0.3 * uNight) + 0.3 * uNight);
    vec3 outc = sky;
    if (y > 0.0) {
      vec2 wind = vec2(uTime * 0.0065, uTime * 0.0032);
      float sunLit = max(dot(d, normalize(uLightDir)), 0.0);
      vec2 ld = normalize(uLightDir.xz + 0.0001);

      // cirrus
      vec2 pc = d.xz / (y + 0.3) * 1.8;
      pc = vec2(pc.x * 0.45 + pc.y * 0.2, pc.y * 1.7 - pc.x * 0.3) * 1.1 + wind * 1.6;
      float ci = smoothstep(0.52, 0.9, fbm3(pc * 2.0) * 0.8 + fbm3(pc * 5.0 + 3.0) * 0.4);
      ci *= smoothstep(0.02, 0.28, y) * 0.5;
      vec3 ciCol = mix(uAmbient * 1.15, uLightColor * 1.25, 0.55 + 0.45 * pow(sunLit, 3.0));
      outc = mix(outc, ciCol, ci * (1.0 - 0.7 * uNight));

      // two cumulus decks
      for (int L = 0; L < DECKS; L++) {
        float fl = float(L);
        vec2 p = d.xz / (y + 0.14 + fl * 0.07) * (2.4 + fl * 1.1) + wind * (1.4 + fl * 1.0) + vec2(fl * 31.7, fl * 12.3);
        float cov = uCover * (1.0 - fl * 0.12);
        float dens = cloudShape(p, cov);
        if (dens > 0.003) {
          float sh = 0.0;
          for (int k = 1; k <= TAPS; k++) sh += cloudShape(p + ld * 0.1 * float(k), cov);
          sh /= float(TAPS);
          float lit = exp(-max(sh - dens * 0.18, 0.0) * 2.4);
          float core = smoothstep(0.35, 1.0, dens);
          float edge = pow(1.0 - dens, 2.0);
          vec3 shadowCol = uAmbient * (1.0 - 0.3 * core);
          vec3 c = mix(shadowCol, uLightColor * 2.1, lit);
          c += uLightColor * edge * lit * (0.25 + 1.4 * pow(sunLit, 5.0));
          c *= mix(1.0, 0.8, core * (1.0 - lit));
          float fogK = 1.0 - smoothstep(0.0, 0.24, y);
          c = mix(c, uHorizon * 1.05, fogK * 0.62);
          float a = dens * smoothstep(0.015, 0.09, y) * 0.97;
          outc = mix(outc, c, a);
        }
      }
    }
    outc *= uGain;
    gl_FragColor = vec4(outc, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const STAR_VERT = /* glsl */ `
  attribute float aSeed; uniform float uTime; uniform float uPx; varying float vTw; varying float vSeed;
  void main() {
    vSeed = aSeed;
    vTw = 0.6 + 0.4 * sin(uTime * (0.8 + aSeed * 3.0) + aSeed * 40.0);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uPx * (1.0 + pow(aSeed, 3.0) * 5.0);
  }
`;
const STAR_FRAG = /* glsl */ `
  uniform float uOpacity; varying float vTw; varying float vSeed;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float r = length(c);
    float a = smoothstep(0.5, 0.0, r);
    a = a * a + smoothstep(0.12, 0.0, r);
    vec3 col = mix(vec3(0.7, 0.82, 1.0), vec3(1.0, 0.88, 0.7), fract(vSeed * 7.0));
    gl_FragColor = vec4(col * (1.2 + vSeed * 2.4), a * vTw * uOpacity);
  }
`;

export type SkyQuality = 'low' | 'medium' | 'high';

export class SkyRig {
  readonly group = new THREE.Group();
  readonly state = makeSkyState();
  private dome: THREE.Mesh;
  private stars: THREE.Points;
  private moon: THREE.Mesh;
  private moonMat: THREE.MeshBasicMaterial;
  private fogColor = new THREE.Color();
  private tint = new THREE.Color();
  private lightDir = new THREE.Vector3();
  private lightColor = new THREE.Color();
  private ambient = new THREE.Color();

  constructor() {
    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(1400, 48, 24),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        defines: { OCT: 5, DECKS: 2, TAPS: 3 },
        uniforms: {
          uNoise: { value: noiseTexture() },
          uTime: { value: 0 },
          uCover: { value: 0.5 },
          uNight: { value: 0 },
          uGain: { value: 1.6 },
          uHaze: { value: 0.6 },
          uTop: { value: new THREE.Color() },
          uMid: { value: new THREE.Color() },
          uHorizon: { value: new THREE.Color() },
          uSunDir: { value: new THREE.Vector3(0, 1, 0) },
          uSunColor: { value: new THREE.Color() },
          uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
          uLightDir: { value: new THREE.Vector3(0, 1, 0) },
          uLightColor: { value: new THREE.Color() },
          uAmbient: { value: new THREE.Color() },
        },
        vertexShader: DOME_VERT,
        fragmentShader: DOME_FRAG,
      }),
    );
    this.dome.renderOrder = -30;
    this.dome.frustumCulled = false;

    const rng = mulberry32(7);
    const n = 3600;
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const u = rng();
      const phi = rng() * Math.PI * 2;
      const y = Math.pow(u, 0.75) * 0.99 + 0.01;
      const r = Math.sqrt(1 - y * y);
      pos[i * 3] = Math.cos(phi) * r * 1300;
      pos[i * 3 + 1] = y * 1300;
      pos[i * 3 + 2] = Math.sin(phi) * r * 1300;
      seed[i] = rng();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    this.stars = new THREE.Points(
      geo,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        fog: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uTime: { value: 0 }, uPx: { value: 2 }, uOpacity: { value: 0 } },
        vertexShader: STAR_VERT,
        fragmentShader: STAR_FRAG,
      }),
    );
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -27;

    this.moonMat = new THREE.MeshBasicMaterial({ map: moonTexture(), fog: false, toneMapped: false, color: new THREE.Color(2.4, 2.4, 2.3) });
    this.moon = new THREE.Mesh(new THREE.SphereGeometry(46, 40, 24), this.moonMat);
    this.moon.renderOrder = -26;
    this.moon.frustumCulled = false;

    this.group.add(this.dome, this.stars, this.moon);
  }

  setQuality(q: SkyQuality) {
    const m = this.dome.material as THREE.ShaderMaterial;
    const next = q === 'high' ? { OCT: 6, DECKS: 2, TAPS: 4 } : q === 'medium' ? { OCT: 4, DECKS: 2, TAPS: 2 } : { OCT: 3, DECKS: 1, TAPS: 2 };
    if (m.defines.OCT !== next.OCT || m.defines.DECKS !== next.DECKS || m.defines.TAPS !== next.TAPS) {
      Object.assign(m.defines, next);
      m.needsUpdate = true;
    }
  }

  setPixelRatio(px: number) {
    (this.stars.material as THREE.ShaderMaterial).uniforms.uPx.value = px * 1.5;
  }

  /** 返回雾色 */
  update(hour: number, time: number, params: SkyParams, camPos: THREE.Vector3): THREE.Color {
    const s = sampleSky(hour, this.state);
    this.group.position.copy(camPos);

    const day = 1 - s.night;
    this.lightDir.copy(s.night > 0.5 ? s.moonDir : s.sunDir);
    this.lightColor.copy(s.night > 0.5 ? this.tint.set('#a8c0ff') : s.sunColor);
    this.ambient.copy(s.hemiSky).lerp(s.horizon, 0.45);

    const u = (this.dome.material as THREE.ShaderMaterial).uniforms;
    u.uTime.value = time;
    u.uCover.value = Math.min(0.9, params.cloudCover * 0.78 + 0.02);
    u.uNight.value = s.night;
    u.uGain.value = 0.62 + day * 0.33;
    u.uHaze.value = 0.35 + params.fogTintAmount * 0.5;
    u.uTop.value.copy(s.top);
    u.uMid.value.copy(s.mid);
    u.uHorizon.value.copy(s.horizon);
    u.uSunDir.value.copy(s.sunDir);
    u.uSunColor.value.copy(s.sunColor);
    u.uMoonDir.value.copy(s.moonDir);
    u.uLightDir.value.copy(this.lightDir);
    u.uLightColor.value.copy(this.lightColor).multiplyScalar(s.night > 0.5 ? 0.55 : 1);
    u.uAmbient.value.copy(this.ambient).multiplyScalar(0.55 + day * 0.7);

    const st = (this.stars.material as THREE.ShaderMaterial).uniforms;
    st.uTime.value = time;
    st.uOpacity.value = Math.max(0, s.night * 1.3 - 0.25);

    this.moon.position.copy(s.moonDir).multiplyScalar(1100);
    const moonVis = THREE.MathUtils.smoothstep(s.moonDir.y, -0.1, 0.1) * Math.min(1, s.night * 1.6);
    this.moon.visible = moonVis > 0.01;
    this.moon.lookAt(camPos);

    this.fogColor.copy(s.horizon).lerp(this.tint.set(params.fogTint), params.fogTintAmount * (1 - s.night * 0.6));
    return this.fogColor;
  }
}
