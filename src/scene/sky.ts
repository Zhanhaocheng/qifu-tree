import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { mulberry32 } from './tree';
import { moonTexture } from './textures';

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
  out.sunDir.set(-Math.cos(ang) * 0.9, Math.sin(ang), -0.28).normalize();
  out.moonDir.set(Math.cos(ang) * 0.7, -Math.sin(ang), -0.35).normalize();
  out.night = 1 - THREE.MathUtils.smoothstep(out.sunDir.y, -0.22, 0.03);
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

export interface SkyParams {
  turbidity: number;
  rayleigh: number;
  mie: number;
  mieG: number;
  cloudCover: number;
  fogTint: string;
  fogTintAmount: number;
}

const CLOUD_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const CLOUD_FRAG = /* glsl */ `
  uniform float uTime; uniform float uCover; uniform float uBright; uniform float uNight;
  uniform vec3 uSunDir; uniform vec3 uSunColor; uniform vec3 uAmbient;
  varying vec3 vDir;
  float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float vn(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float s = 0.0; float a = 0.5;
    for (int i = 0; i < OCT; i++) { s += a * vn(p); p = p * 2.03 + 17.0; a *= 0.5; }
    return s;
  }
  void main() {
    vec3 d = normalize(vDir);
    if (d.y < 0.01) discard;
    vec2 uv = d.xz / (d.y + 0.22) * 1.6 + vec2(uTime * 0.006, uTime * 0.003);
    float n = fbm(uv * 0.8);
    float detail = fbm(uv * 2.7 + 11.0);
    float dens = smoothstep(1.0 - uCover, 1.0 - uCover + 0.32, n * 0.8 + detail * 0.32);
    vec2 toSun = normalize(uSunDir.xz + 0.0001) * 0.09;
    float nl = fbm((uv + toSun) * 0.8);
    float shade = clamp((n - nl) * 5.0 + 0.55, 0.0, 1.0);
    float sunAmt = max(dot(d, normalize(uSunDir)), 0.0);
    vec3 lit = mix(uAmbient * 0.75, uSunColor * 1.15, shade);
    lit += uSunColor * pow(sunAmt, 6.0) * 0.55 * (1.0 - uNight);
    lit = mix(lit, uAmbient * 0.9, (1.0 - dens) * 0.2);
    float alpha = dens * smoothstep(0.01, 0.22, d.y) * 0.96;
    gl_FragColor = vec4(lit * uBright, alpha);
  }
`;

const NIGHT_FRAG = /* glsl */ `
  uniform float uAlpha; uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uSunDir; uniform vec3 uSunColor; uniform float uSunAmount;
  varying vec3 vDir;
  void main() {
    vec3 d = normalize(vDir);
    float t = pow(clamp(d.y, 0.0, 1.0), 0.55);
    vec3 col = mix(uHorizon, uTop, t);
    col = mix(col, uHorizon * 0.5, smoothstep(0.0, -0.25, d.y));
    float s = max(dot(d, normalize(uSunDir)), 0.0);
    col += uSunColor * (pow(s, 5.0) * 0.35 + pow(s, 40.0) * 0.6) * uSunAmount;
    gl_FragColor = vec4(col * 1.7, uAlpha);
  }
`;

const STAR_VERT = /* glsl */ `
  attribute float aSeed; uniform float uTime; uniform float uPx; varying float vTw; varying float vSeed;
  void main() {
    vSeed = aSeed;
    vTw = 0.65 + 0.35 * sin(uTime * (1.0 + aSeed * 3.0) + aSeed * 40.0);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uPx * (1.2 + aSeed * 2.2);
  }
`;
const STAR_FRAG = /* glsl */ `
  uniform float uOpacity; varying float vTw; varying float vSeed;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float a = smoothstep(0.5, 0.0, length(c));
    vec3 col = mix(vec3(0.75, 0.85, 1.0), vec3(1.0, 0.9, 0.75), fract(vSeed * 7.0));
    gl_FragColor = vec4(col * 1.6, a * vTw * uOpacity);
  }
`;

export class SkyRig {
  readonly group = new THREE.Group();
  readonly state = makeSkyState();
  private sky = new Sky();
  private clouds: THREE.Mesh;
  private night: THREE.Mesh;
  private stars: THREE.Points;
  private moon: THREE.Mesh;
  private moonGlow: THREE.Sprite;
  private sunGlow: THREE.Sprite;
  private fogColor = new THREE.Color();
  private tint = new THREE.Color();

  constructor() {
    const skyMat = this.sky.material as THREE.ShaderMaterial;
    skyMat.fragmentShader = skyMat.fragmentShader.replace('uniform float time;', 'uniform float time;\nuniform float uGain;').replace('gl_FragColor = vec4( texColor, 1.0 );', 'vec3 tcG = texColor * uGain; float lumG = dot(tcG, vec3(0.333)); tcG = mix(vec3(lumG), tcG, 1.85); gl_FragColor = vec4( tcG, 1.0 );');
    skyMat.uniforms.uGain = { value: 0.05 };
    this.sky.scale.setScalar(1800);
    this.sky.renderOrder = -30;
    (this.sky.material as THREE.ShaderMaterial).depthWrite = false;

    this.night = new THREE.Mesh(
      new THREE.SphereGeometry(1400, 24, 12),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        transparent: true,
        depthWrite: false,
        fog: false,
        uniforms: { uAlpha: { value: 0 }, uTop: { value: new THREE.Color('#050a1e') }, uHorizon: { value: new THREE.Color('#14203f') }, uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunColor: { value: new THREE.Color() }, uSunAmount: { value: 1 } },
        vertexShader: CLOUD_VERT,
        fragmentShader: NIGHT_FRAG,
      }),
    );
    this.night.renderOrder = -29;

    this.clouds = new THREE.Mesh(
      new THREE.SphereGeometry(1300, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        transparent: true,
        depthWrite: false,
        fog: false,
        defines: { OCT: 5 },
        uniforms: {
          uTime: { value: 0 },
          uCover: { value: 0.5 },
          uBright: { value: 1 },
          uNight: { value: 0 },
          uSunDir: { value: new THREE.Vector3(0, 1, 0) },
          uSunColor: { value: new THREE.Color() },
          uAmbient: { value: new THREE.Color() },
        },
        vertexShader: CLOUD_VERT,
        fragmentShader: CLOUD_FRAG,
      }),
    );
    this.clouds.renderOrder = -28;

    const rng = mulberry32(7);
    const n = 2200;
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const u = rng();
      const phi = rng() * Math.PI * 2;
      const y = Math.pow(u, 0.7) * 0.98 + 0.02;
      const r = Math.sqrt(1 - y * y);
      pos[i * 3] = Math.cos(phi) * r * 1200;
      pos[i * 3 + 1] = y * 1200;
      pos[i * 3 + 2] = Math.sin(phi) * r * 1200;
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

    const glow = glowTexture();
    this.moon = new THREE.Mesh(new THREE.SphereGeometry(34, 32, 20), new THREE.MeshBasicMaterial({ map: moonTexture(), fog: false, toneMapped: false, color: new THREE.Color(2.2, 2.2, 2.1) }));
    this.moon.renderOrder = -26;
    this.moonGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: '#a9c2ff', blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false, toneMapped: false }));
    this.moonGlow.scale.setScalar(420);
    this.moonGlow.renderOrder = -25;
    this.sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: '#ffcf8a', blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false, toneMapped: false }));
    this.sunGlow.scale.setScalar(520);
    this.sunGlow.renderOrder = -25;

    this.group.add(this.sky, this.night, this.clouds, this.stars, this.moon, this.moonGlow, this.sunGlow);
  }

  setCloudQuality(oct: number) {
    const m = this.clouds.material as THREE.ShaderMaterial;
    if (m.defines.OCT !== oct) {
      m.defines.OCT = oct;
      m.needsUpdate = true;
    }
  }

  setPixelRatio(px: number) {
    (this.stars.material as THREE.ShaderMaterial).uniforms.uPx.value = px * 1.6;
  }

  /** 返回雾色 */
  update(hour: number, time: number, params: SkyParams, camPos: THREE.Vector3): THREE.Color {
    const s = sampleSky(hour, this.state);
    this.group.position.copy(camPos);

    const su = (this.sky.material as THREE.ShaderMaterial).uniforms;
    su.turbidity.value = params.turbidity;
    su.rayleigh.value = params.rayleigh * (1 - s.night * 0.8);
    su.mieCoefficient.value = params.mie;
    su.mieDirectionalG.value = params.mieG;
    su.sunPosition.value.copy(s.sunDir);

    const nu = (this.night.material as THREE.ShaderMaterial).uniforms;
    nu.uAlpha.value = 1 - THREE.MathUtils.smoothstep(s.sunDir.y, 0.08, 0.5);
    su.uGain.value = 0.05 + 0.11 * (1 - THREE.MathUtils.smoothstep(s.sunDir.y, 0.25, 0.9));
    nu.uTop.value.copy(s.top);
    nu.uHorizon.value.copy(s.horizon);
    nu.uSunDir.value.copy(s.sunDir);
    nu.uSunColor.value.copy(s.sunColor);
    nu.uSunAmount.value = 1 - s.night;

    const cu = (this.clouds.material as THREE.ShaderMaterial).uniforms;
    cu.uTime.value = time;
    cu.uCover.value = params.cloudCover;
    cu.uNight.value = s.night;
    cu.uSunDir.value.copy(s.night > 0.5 ? s.moonDir : s.sunDir);
    cu.uSunColor.value.copy(s.night > 0.5 ? this.tint.set('#9db4ff') : s.sunColor);
    cu.uAmbient.value.copy(s.hemiSky).lerp(s.horizon, 0.5);
    cu.uBright.value = 0.5 + s.sunIntensity * 0.42 + s.night * 0.09;

    const st = (this.stars.material as THREE.ShaderMaterial).uniforms;
    st.uTime.value = time;
    st.uOpacity.value = Math.max(0, s.night * 1.3 - 0.25);

    this.moon.position.copy(s.moonDir).multiplyScalar(1000);
    const moonVis = THREE.MathUtils.smoothstep(s.moonDir.y, -0.12, 0.1) * Math.min(1, s.night * 1.6 + 0.0);
    this.moon.visible = moonVis > 0.01;
    (this.moon.material as THREE.MeshBasicMaterial).opacity = 1;
    this.moonGlow.position.copy(this.moon.position);
    (this.moonGlow.material as THREE.SpriteMaterial).opacity = moonVis * 0.8;
    this.moonGlow.visible = moonVis > 0.01;
    this.sunGlow.position.copy(s.sunDir).multiplyScalar(1000);
    const sunVis = THREE.MathUtils.smoothstep(s.sunDir.y, -0.08, 0.06);
    (this.sunGlow.material as THREE.SpriteMaterial).opacity = sunVis * 0.55;
    (this.sunGlow.material as THREE.SpriteMaterial).color.copy(s.sunColor);
    this.sunGlow.visible = sunVis > 0.01;

    this.fogColor.copy(s.horizon).lerp(this.tint.set(params.fogTint), params.fogTintAmount * (1 - s.night * 0.6));
    return this.fogColor;
  }
}
