import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { NOISE_GLSL, noiseTexture } from './sky';
import { fbmWorld, surface } from './textures';
import { rockGeometry } from './props';

export type Quality = 'low' | 'medium' | 'high';

export interface WindUniforms {
  uTime: { value: number };
  uWind: { value: number };
  uGrow: { value: number };
  uSunDir: { value: THREE.Vector3 };
  uSunColor: { value: THREE.Color };
  uNight: { value: number };
  [k: string]: { value: unknown };
}

export function makeWindUniforms(): WindUniforms {
  return {
    uTime: { value: 0 },
    uWind: { value: 0 },
    uGrow: { value: 1 },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: { value: new THREE.Color('#ffffff') },
    uNight: { value: 0 },
  };
}

const sm = THREE.MathUtils.smoothstep;
const clamp = THREE.MathUtils.clamp;

export interface GroundCtx {
  group: THREE.Group;
  heightAt: (x: number, z: number) => number;
  isWater: (x: number, z: number) => boolean;
  rng: () => number;
  quality: Quality;
  uniforms: WindUniforms;
  disposables: { dispose(): void }[];
  terraceR: number;
  terraceH: number;
  splat: (x: number, z: number, h: number, slope: number) => number;
  id: string;
}

// ------------------------------------------------------------------ materials

const WIND_VERT_PARS = `
  uniform float uTime; uniform float uWind; uniform float uBendK;
  varying float vH; varying vec3 vWPos; varying float vSeed;
`;

function windChunk(heightExpr: string) {
  return /* glsl */ `
    vH = ${heightExpr};
    vec4 mvPosition = vec4(transformed, 1.0);
    #ifdef USE_INSTANCING
      vec3 ip = vec3(instanceMatrix[3]);
      float camD = distance(ip.xz, cameraPosition.xz);
      mvPosition.y *= 1.0 - smoothstep(58.0, 82.0, camD);
      mvPosition = instanceMatrix * mvPosition;
      float wave = sin(dot(ip.xz, vec2(0.13, 0.09)) - uTime * 1.35) * 0.5 + 0.5;
      float slow = sin(dot(ip.xz, vec2(-0.045, 0.06)) - uTime * 0.55) * 0.5 + 0.5;
      float gust = uWind * (0.35 + 0.65 * slow);
      float flut = sin(uTime * 3.3 + ip.x * 2.9 + ip.z * 2.1);
      float bend = vH * vH * uBendK;
      mvPosition.x += (wave * 0.16 + gust * 0.55 + flut * 0.025 * (0.3 + uWind)) * bend;
      mvPosition.z += ((wave - 0.5) * 0.09 + flut * 0.018) * bend;
      mvPosition.y -= (gust * 0.12 + wave * 0.03) * bend;
      vWPos = (modelMatrix * mvPosition).xyz;
      vSeed = fract(sin(dot(ip.xz, vec2(12.9898, 78.233))) * 43758.5453);
    #else
      vWPos = (modelMatrix * mvPosition).xyz; vSeed = 0.0;
    #endif
    mvPosition = modelViewMatrix * mvPosition;
    gl_Position = projectionMatrix * mvPosition;
  `;
}

function grassMaterial(u: WindUniforms, base: string, tip: string, dry: string, quality: Quality) {
  const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', side: THREE.DoubleSide, roughness: 0.78, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u, {
      uNoise: { value: noiseTexture() },
      uBase: { value: new THREE.Color(base) },
      uTip: { value: new THREE.Color(tip) },
      uDry: { value: new THREE.Color(dry) },
      uBendK: { value: 1.0 },
    });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${WIND_VERT_PARS}`)
      .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = normalize(vec3(0.0, 1.0, 0.0) + normal * 0.45);')
      .replace('#include <project_vertex>', windChunk('position.y'));
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform vec3 uBase; uniform vec3 uTip; uniform vec3 uDry; uniform vec3 uSunDir; uniform vec3 uSunColor; uniform float uNight;
         varying float vH; varying vec3 vWPos; varying float vSeed;
         ${NOISE_GLSL}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         float patchN = vnoise(vWPos.xz * 0.045);
         float patchF = vnoise(vWPos.xz * 0.21 + 7.0);
         float dryK = smoothstep(0.58, 0.82, patchN) * 0.85 + smoothstep(0.7, 0.95, patchF) * 0.3;
         float lushK = smoothstep(0.5, 0.2, patchN);
         vec3 lush = mix(uBase * (0.5 + 0.35 * lushK), uTip * (0.85 + 0.35 * lushK), smoothstep(0.0, 1.0, vH));
         vec3 dryC = mix(uDry * 0.55, uDry * 1.15, smoothstep(0.0, 1.0, vH));
         vec3 gcol = mix(lush, dryC, clamp(dryK, 0.0, 1.0));
         gcol *= 0.72 + 0.5 * vSeed;
         gcol *= mix(0.3, 1.0, smoothstep(0.0, 0.55, vH));
         diffuseColor.rgb *= gcol;`,
      )
      .replace(
        '#include <opaque_fragment>',
        `vec3 vdir = normalize(cameraPosition - vWPos);
         float back = pow(clamp(dot(-vdir, normalize(uSunDir)), 0.0, 1.0), 3.0);
         outgoingLight += diffuseColor.rgb * uSunColor * back * vH * 1.1 * (1.0 - uNight);
         #include <opaque_fragment>`,
      );
  };
  void quality;
  return mat;
}

/** 叶片：4 段渐细、略微前倾的弯曲草叶 */
function bladeGeometry(): THREE.BufferGeometry {
  const rows = 5;
  const pos: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  const w = 0.042;
  for (let i = 0; i < rows; i++) {
    const t = i / (rows - 1);
    const half = w * (1 - Math.pow(t, 1.6) * 0.92);
    const z = t * t * 0.22;
    if (i === rows - 1) {
      pos.push(0, t, z + 0.02);
      nor.push(0, 0.4, 1);
    } else {
      pos.push(-half, t, z, half, t, z);
      nor.push(-0.35, 0.2, 1, 0.35, 0.2, 1);
    }
  }
  for (let i = 0; i < rows - 2; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
  }
  const last = (rows - 2) * 2;
  idx.push(last, last + 1, last + 2);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

export interface GrassOpts {
  base: string;
  tip: string;
  dry: string;
  height: number;
  spread: number;
  density: (x: number, z: number, h: number) => number;
  blades: number;
}

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const tmpP = new THREE.Vector3();
const tmpS = new THREE.Vector3();
const tmpC = new THREE.Color();

export function buildGrass(ctx: GroundCtx, o: GrassOpts) {
  const { rng, heightAt } = ctx;
  const geo = bladeGeometry();
  const mat = grassMaterial(ctx.uniforms, o.base, o.tip, o.dry, ctx.quality);
  const total = o.blades;
  const mesh = new THREE.InstancedMesh(geo, mat, total);
  mesh.frustumCulled = false;
  mesh.receiveShadow = ctx.quality === 'high';
  let placed = 0;
  const spread = o.spread * (ctx.quality === 'low' ? 0.7 : 1);
  const tufts = Math.ceil(total / 7);
  const tryMax = tufts * 4;
  const pathX = (z: number) => Math.sin((z - 8) * 0.22 * 0.667) * 1.4;
  for (let t = 0; t < tryMax && placed < total - 12; t++) {
    const a = rng() * Math.PI * 2;
    const r = Math.pow(rng(), 0.78) * spread;
    const cx = Math.cos(a) * r;
    const cz = Math.sin(a) * r;
    const rr = Math.hypot(cx, cz);
    if (rr < ctx.terraceR + 0.4) continue;
    if (Math.abs(cx - pathX(cz)) < 2.4 && cz > 6 && cz < 40) continue;
    const h = heightAt(cx, cz);
    const dens = o.density(cx, cz, h);
    if (dens <= 0) continue;
    const slope = Math.hypot(heightAt(cx + 1.2, cz) - heightAt(cx - 1.2, cz), heightAt(cx, cz + 1.2) - heightAt(cx, cz - 1.2)) / 2.4;
    const sp = ctx.splat(cx, cz, h, slope);
    if (sp > 0.62) continue;
    if (rng() > dens * (1 - sm(rr, spread * 0.6, spread))) continue;
    const kindRoll = rng();
    const kind = kindRoll < 0.1 ? 2 : kindRoll < 0.3 ? 1 : 0;
    const patch = fbmWorld(cx * 0.12, cz * 0.12, 2, 17);
    const n = kind === 2 ? 5 + Math.floor(rng() * 4) : kind === 1 ? 9 + Math.floor(rng() * 6) : 5 + Math.floor(rng() * 6);
    const tuftH = o.height * (kind === 2 ? 1.9 : kind === 1 ? 0.5 : 1) * (0.8 + patch * 0.8);
    const fade = 1 - sm(rr, spread * 0.82, spread);
    for (let b = 0; b < n && placed < total; b++) {
      const ba = rng() * Math.PI * 2;
      const br = Math.sqrt(rng()) * (kind === 1 ? 0.3 : 0.2);
      const x = cx + Math.cos(ba) * br;
      const z = cz + Math.sin(ba) * br;
      const y = heightAt(x, z) - 0.03;
      const hs = tuftH * (0.55 + rng() * 0.75) * (0.4 + 0.6 * fade + 0.2);
      const lean = (kind === 2 ? 0.55 : 0.12) + rng() * (kind === 2 ? 0.3 : 0.5);
      tmpQ.setFromEuler(tmpE.set(lean, ba + (rng() - 0.5) * 0.9, 0, 'YXZ'));
      tmpE.set(lean, ba + (rng() - 0.5) * 0.9, 0, 'YXZ');
      tmpQ.setFromEuler(tmpE);
      const widthK = (kind === 2 ? 1.5 : kind === 1 ? 0.9 : 1.15) * (0.8 + rng() * 0.6);
      tmpM.compose(tmpP.set(x, y, z), tmpQ, tmpS.set(widthK, hs, 1));
      mesh.setMatrixAt(placed, tmpM);
      tmpC.setHSL(0.02 * (rng() - 0.5), 0.1 * (rng() - 0.5), 0.9 + rng() * 0.2);
      mesh.setColorAt(placed, tmpC);
      placed++;
    }
  }
  mesh.count = placed;
  ctx.group.add(mesh);
  ctx.disposables.push(geo, mat);
  return mesh;
}

/** 树根台座上的短草，贴着土丘生长 */
export function buildBedGrass(ctx: GroundCtx, o: GrassOpts, bedY: (x: number, z: number) => number, bedR: number, count: number) {
  const { rng } = ctx;
  const geo = bladeGeometry();
  const mat = grassMaterial(ctx.uniforms, o.base, o.tip, o.dry, ctx.quality);
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.frustumCulled = false;
  let placed = 0;
  for (let i = 0; i < count * 2 && placed < count; i++) {
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * bedR * 0.96;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (r < 1.0) continue;
    const edge = sm(r, bedR * 0.25, bedR * 0.9);
    if (rng() > 0.25 + edge * 0.75) continue;
    const hs = o.height * (0.35 + rng() * 0.6) * (0.7 + (1 - edge) * 0.0);
    tmpE.set(0.1 + rng() * 0.5, rng() * 6.28, 0, 'YXZ');
    tmpQ.setFromEuler(tmpE);
    tmpM.compose(tmpP.set(x, bedY(x, z) - 0.03, z), tmpQ, tmpS.set(1 + rng() * 0.6, hs, 1));
    mesh.setMatrixAt(placed, tmpM);
    tmpC.setHSL(0.02 * (rng() - 0.5), 0.1 * (rng() - 0.5), 0.9 + rng() * 0.2);
    mesh.setColorAt(placed, tmpC);
    placed++;
  }
  mesh.count = placed;
  ctx.group.add(mesh);
  ctx.disposables.push(geo, mat);
}

// ------------------------------------------------------------------ flowers

function flowerHeadGeometry(kind: 'daisy' | 'cup' | 'spike'): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const mark = (g: THREE.BufferGeometry, center: number) => {
    const n = g.attributes.position.count;
    g.setAttribute('aCenter', new THREE.BufferAttribute(new Float32Array(n).fill(center), 1));
    return g;
  };
  if (kind === 'daisy') {
    const petals = 9;
    for (let i = 0; i < petals; i++) {
      const p = new THREE.PlaneGeometry(0.035, 0.1, 1, 1);
      p.translate(0, 0.055, 0);
      p.rotateX(-1.25);
      p.rotateY((i / petals) * Math.PI * 2);
      parts.push(mark(p.toNonIndexed(), 0));
    }
    const c = new THREE.CircleGeometry(0.036, 8);
    c.rotateX(-Math.PI / 2 + 0.2);
    c.translate(0, 0.01, 0);
    parts.push(mark(c.toNonIndexed(), 1));
  } else if (kind === 'cup') {
    for (let i = 0; i < 5; i++) {
      const p = new THREE.PlaneGeometry(0.085, 0.11, 1, 1);
      p.translate(0, 0.06, 0);
      p.rotateX(-0.9);
      p.rotateY((i / 5) * Math.PI * 2 + 0.3);
      parts.push(mark(p.toNonIndexed(), 0));
    }
    const c = new THREE.SphereGeometry(0.022, 6, 4);
    c.translate(0, 0.02, 0);
    parts.push(mark(c.toNonIndexed(), 1));
  } else {
    for (let i = 0; i < 7; i++) {
      const s = new THREE.SphereGeometry(0.026, 5, 4);
      s.scale(1, 1.3, 1);
      s.translate((i % 2 ? 1 : -1) * 0.012, i * 0.04 - 0.02, (i % 3 - 1) * 0.012);
      parts.push(mark(s.toNonIndexed(), 0));
    }
  }
  return mergeGeometries(parts)!;
}

function flowerMaterial(u: WindUniforms) {
  const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', side: THREE.DoubleSide, roughness: 0.55 });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u, { uBendK: { value: 0.9 } });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nattribute float aCenter; varying float vCenter;\n${WIND_VERT_PARS}`)
      .replace('#include <project_vertex>', `vCenter = aCenter;\n${windChunk('clamp(position.y * 2.2 + 0.7, 0.0, 1.6)')}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vCenter; varying float vH;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.95, 0.62, 0.08), vCenter);');
  };
  return mat;
}

export function buildFlowers(ctx: GroundCtx, palette: string[], count: number, innerR: number, outerR: number): THREE.Vector3[] {
  const spots: THREE.Vector3[] = [];
  if (!palette.length || count <= 0) return spots;
  const { rng, heightAt } = ctx;
  const kinds: ('daisy' | 'cup' | 'spike')[] = ['daisy', 'cup', 'spike'];
  const stemGeo = new THREE.CylinderGeometry(0.006, 0.01, 1, 4, 1).translate(0, 0.5, 0);
  const stemMat = new THREE.MeshStandardMaterial({ color: '#4a7a30', roughness: 0.8 });
  stemMat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, ctx.uniforms, { uBendK: { value: 0.9 } });
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\n${WIND_VERT_PARS}`).replace('#include <project_vertex>', windChunk('position.y * 0.8'));
  };
  ctx.disposables.push(stemGeo, stemMat);
  const fm = flowerMaterial(ctx.uniforms);
  ctx.disposables.push(fm);
  const clusters = Math.max(4, Math.round(count / 14));
  const per = [count * 0.45, count * 0.35, count * 0.2];
  kinds.forEach((kind, ki) => {
    const n = Math.round(per[ki]);
    const headGeo = flowerHeadGeometry(kind);
    const heads = new THREE.InstancedMesh(headGeo, fm, n);
    const stems = new THREE.InstancedMesh(stemGeo, stemMat, n);
    heads.frustumCulled = stems.frustumCulled = false;
    let placed = 0;
    const kcl = Math.max(2, Math.round(clusters * (per[ki] / count)));
    for (let c = 0; c < kcl && placed < n; c++) {
      let cx = 0;
      let cz = 0;
      let ok = false;
      for (let tries = 0; tries < 30 && !ok; tries++) {
        const a = rng() * Math.PI * 2;
        const r = innerR + Math.sqrt(rng()) * (outerR - innerR);
        cx = Math.cos(a) * r;
        cz = Math.sin(a) * r;
        const hh = heightAt(cx, cz);
        ok = !ctx.isWater(cx, cz) && hh > -1.2 && fbmWorld(cx * 0.08, cz * 0.08, 2, 44) > 0.42 && !(Math.abs(cx) < 3.5 && cz > 6);
      }
      if (!ok) continue;
      const base = new THREE.Color(palette[Math.floor(rng() * palette.length)]);
      const radius = 0.7 + rng() * 1.9;
      const m = Math.ceil(n / kcl);
      for (let k = 0; k < m && placed < n; k++) {
        const a = rng() * Math.PI * 2;
        const r = Math.sqrt(rng()) * radius;
        const x = cx + Math.cos(a) * r;
        const z = cz + Math.sin(a) * r;
        if (ctx.isWater(x, z)) continue;
        const y = heightAt(x, z);
        const sH = 0.28 + rng() * 0.4;
        const sc = 1.05 + rng() * 0.7;
        tmpE.set((rng() - 0.5) * 0.35, rng() * 6.28, (rng() - 0.5) * 0.35);
        tmpQ.setFromEuler(tmpE);
        tmpM.compose(tmpP.set(x, y - 0.02, z), tmpQ, tmpS.set(sc, sH, sc));
        stems.setMatrixAt(placed, tmpM);
        const up = new THREE.Vector3(0, sH, 0).applyQuaternion(tmpQ);
        tmpM.compose(tmpP.set(x + up.x, y - 0.02 + up.y, z + up.z), tmpQ, tmpS.set(sc, sc, sc));
        heads.setMatrixAt(placed, tmpM);
        tmpC.copy(base).offsetHSL((rng() - 0.5) * 0.04, 0, (rng() - 0.5) * 0.08);
        heads.setColorAt(placed, tmpC);
        if (placed % 5 === 0 && ki === 0) spots.push(new THREE.Vector3(x, y + sH + 0.2, z));
        placed++;
      }
    }
    heads.count = stems.count = placed;
    ctx.group.add(heads, stems);
    ctx.disposables.push(headGeo);
  });
  return spots;
}

// ------------------------------------------------------------------ rocks, pebbles, soil

const MOSS: Record<string, { color: string; amount: number }> = {
  mountain: { color: '#56743a', amount: 0.85 },
  bamboo: { color: '#3f6e32', amount: 0.95 },
  jiangnan: { color: '#5b7c3c', amount: 0.8 },
  desert: { color: '#d3ad72', amount: 0.55 },
  snow: { color: '#f3f7ff', amount: 1.0 },
};

export function rockMaterial(id: string): THREE.MeshStandardMaterial {
  const t = surface('rock', 512);
  const map = t.map.clone();
  const nm = t.normalMap.clone();
  map.repeat.set(1.3, 1.3);
  nm.repeat.set(1.3, 1.3);
  map.needsUpdate = nm.needsUpdate = true;
  const moss = MOSS[id] ?? MOSS.mountain;
  const mat = new THREE.MeshStandardMaterial({ map, normalMap: nm, color: '#ffffff', roughness: 0.92, normalScale: new THREE.Vector2(1.6, 1.6) });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, { uNoise: { value: noiseTexture() }, uMoss: { value: new THREE.Color(moss.color) }, uMossAmt: { value: moss.amount } });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWN; varying vec3 vWP;')
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
         #ifdef USE_INSTANCING
           vWN = normalize(mat3(modelMatrix) * (mat3(instanceMatrix) * objectNormal));
         #else
           vWN = normalize(mat3(modelMatrix) * objectNormal);
         #endif`,
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
         #ifdef USE_INSTANCING
           vWP = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
         #else
           vWP = (modelMatrix * vec4(transformed, 1.0)).xyz;
         #endif`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWN; varying vec3 vWP; uniform vec3 uMoss; uniform float uMossAmt;\n${NOISE_GLSL}`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         float mn = vnoise(vWP.xz * 1.7 + vWP.y * 0.9) * 0.6 + vnoise(vWP.xz * 6.3) * 0.4;
         float topK = smoothstep(0.35, 0.82, vWN.y + (mn - 0.5) * 0.7);
         float lowK = smoothstep(1.0, -0.2, vWP.y) * smoothstep(0.35, 0.65, mn) * 0.55;
         float mk = clamp((topK + lowK) * uMossAmt, 0.0, 1.0);
         diffuseColor.rgb = mix(diffuseColor.rgb, uMoss * (0.55 + 0.7 * mn), mk);`,
      );
  };
  return mat;
}

export interface RockSpot {
  x: number;
  z: number;
  s: number;
}

export function buildRocks(ctx: GroundCtx, count: number, big: number) {
  const { rng, heightAt } = ctx;
  const mat = rockMaterial(ctx.id);
  const variants = [rockGeometry(3, 4), rockGeometry(8, 4), rockGeometry(15, 3), rockGeometry(27, 3)];
  const bins: THREE.Matrix4[][] = variants.map(() => []);
  const spots: RockSpot[] = [];
  const clusters = Math.max(4, Math.round(count / 5));
  for (let c = 0; c < clusters; c++) {
    let cx = 0;
    let cz = 0;
    let ok = false;
    for (let t = 0; t < 40 && !ok; t++) {
      const a = rng() * Math.PI * 2;
      const d = ctx.terraceR + 3 + rng() * 44;
      cx = Math.cos(a) * d;
      cz = Math.sin(a) * d;
      ok = !ctx.isWater(cx, cz) && heightAt(cx, cz) > -3 && !(Math.abs(cx) < 4.5 && cz > 6);
    }
    if (!ok) continue;
    const members = 1 + Math.floor(rng() * 4);
    for (let m = 0; m < members; m++) {
      const lead = m === 0;
      const s = (lead ? 0.9 + Math.pow(rng(), 1.6) * big : 0.35 + rng() * 0.8) * (0.9 + rng() * 0.3);
      const a = rng() * Math.PI * 2;
      const d = lead ? 0 : s * 1.3 + rng() * 1.6;
      const x = cx + Math.cos(a) * d;
      const z = cz + Math.sin(a) * d;
      if (ctx.isWater(x, z)) continue;
      const y = heightAt(x, z);
      const flat = rng() < 0.3;
      tmpQ.setFromEuler(tmpE.set(rng() * 0.35, rng() * 6.28, rng() * 0.35));
      tmpM.compose(tmpP.set(x, y + s * 0.1, z), tmpQ, tmpS.set(s * (0.95 + rng() * 0.6), s * (flat ? 0.45 : 0.65 + rng() * 0.5), s * (0.9 + rng() * 0.6)));
      bins[Math.floor(rng() * variants.length)].push(tmpM.clone());
      spots.push({ x, z, s });
    }
  }
  variants.forEach((g, i) => {
    const im = new THREE.InstancedMesh(g, mat, Math.max(1, bins[i].length));
    bins[i].forEach((m, k) => im.setMatrixAt(k, m));
    im.count = bins[i].length;
    im.castShadow = im.receiveShadow = true;
    ctx.group.add(im);
    ctx.disposables.push(g);
  });
  ctx.disposables.push(mat);
  return spots;
}

export function buildPebbles(ctx: GroundCtx, count: number, rocks: RockSpot[], tint: { light: string; dark: string }) {
  const { rng, heightAt } = ctx;
  const geos = [0, 1, 2].map((i) => {
    const g = new THREE.IcosahedronGeometry(1, 1);
    const p = g.attributes.position;
    const v = new THREE.Vector3();
    for (let k = 0; k < p.count; k++) {
      v.fromBufferAttribute(p, k);
      const n = 0.75 + fbmWorld(v.x * 2 + i * 9, v.z * 2 + v.y, 2, i + 3) * 0.5;
      p.setXYZ(k, v.x * n, v.y * n * 0.62, v.z * n);
    }
    g.computeVertexNormals();
    return g;
  });
  const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, flatShading: false });
  const light = new THREE.Color(tint.light);
  const dark = new THREE.Color(tint.dark);
  const per = Math.ceil(count / geos.length);
  const meshes = geos.map((g) => {
    const im = new THREE.InstancedMesh(g, mat, per);
    im.castShadow = ctx.quality !== 'low';
    im.receiveShadow = true;
    im.frustumCulled = false;
    return { im, n: 0 };
  });
  let placed = 0;
  const add = (x: number, z: number, s: number) => {
    const slot = meshes[placed % geos.length];
    if (slot.n >= per) return;
    tmpQ.setFromEuler(tmpE.set(rng() * 0.5, rng() * 6.28, rng() * 0.5));
    tmpM.compose(tmpP.set(x, heightAt(x, z) + s * 0.1, z), tmpQ, tmpS.set(s * (0.9 + rng() * 0.5), s * (0.8 + rng() * 0.5), s * (0.9 + rng() * 0.5)));
    slot.im.setMatrixAt(slot.n, tmpM);
    tmpC.copy(dark).lerp(light, rng());
    slot.im.setColorAt(slot.n, tmpC);
    slot.n++;
    placed++;
  };
  for (const r of rocks) {
    const k = Math.round(2 + r.s * 3);
    for (let i = 0; i < k; i++) {
      const a = rng() * Math.PI * 2;
      const d = r.s * (1.1 + rng() * 1.3);
      add(r.x + Math.cos(a) * d, r.z + Math.sin(a) * d, 0.05 + rng() * 0.11);
    }
  }
  for (let t = 0; t < count * 6 && placed < count; t++) {
    const a = rng() * Math.PI * 2;
    const r = ctx.terraceR + 0.5 + Math.pow(rng(), 0.7) * 34;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (ctx.isWater(x, z)) continue;
    const h = heightAt(x, z);
    const slope = Math.hypot(heightAt(x + 1.2, z) - heightAt(x - 1.2, z), heightAt(x, z + 1.2) - heightAt(x, z - 1.2)) / 2.4;
    const sp = ctx.splat(x, z, h, slope);
    if (sp < 0.3 && rng() > 0.08) continue;
    add(x, z, 0.04 + Math.pow(rng(), 2) * 0.12);
  }
  meshes.forEach(({ im, n }) => {
    im.count = n;
    ctx.group.add(im);
  });
  ctx.disposables.push(mat, ...geos);
}

function litterTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.translate(32, 54);
  const grad = g.createLinearGradient(0, 0, 0, -50);
  grad.addColorStop(0, '#9a9a9a');
  grad.addColorStop(1, '#ffffff');
  g.fillStyle = grad;
  g.beginPath();
  g.moveTo(0, 0);
  g.bezierCurveTo(22, -12, 20, -38, 0, -52);
  g.bezierCurveTo(-20, -38, -22, -12, 0, 0);
  g.fill();
  g.strokeStyle = 'rgba(60,40,20,0.7)';
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(0, 2);
  g.lineTo(0, -46);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildLitter(ctx: GroundCtx, count: number, colors: string[], radius: number, bedY: (x: number, z: number) => number) {
  const { rng } = ctx;
  const tex = litterTexture();
  const geo = new THREE.PlaneGeometry(0.3, 0.3).rotateX(-Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9 });
  const im = new THREE.InstancedMesh(geo, mat, count);
  im.frustumCulled = false;
  im.receiveShadow = true;
  const palette = colors.map((c) => new THREE.Color(c));
  for (let i = 0; i < count; i++) {
    const a = rng() * Math.PI * 2;
    const r = Math.pow(rng(), 0.8) * radius;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const y = r < ctx.terraceR - 0.8 ? bedY(x, z) : ctx.heightAt(x, z);
    tmpQ.setFromEuler(tmpE.set((rng() - 0.5) * 0.4, rng() * 6.28, (rng() - 0.5) * 0.4));
    const s = 0.6 + rng() * 0.9;
    tmpM.compose(tmpP.set(x, y + 0.03 + rng() * 0.05, z), tmpQ, tmpS.set(s, s, s));
    im.setMatrixAt(i, tmpM);
    tmpC.copy(palette[Math.floor(rng() * palette.length)]).offsetHSL((rng() - 0.5) * 0.03, 0, (rng() - 0.5) * 0.12);
    im.setColorAt(i, tmpC);
  }
  ctx.group.add(im);
  ctx.disposables.push(tex, geo, mat);
}

// ------------------------------------------------------------------ root bed

export function bedHeight(R: number, x: number, z: number): number {
  const r = Math.hypot(x, z);
  const mound = 0.4 * Math.exp(-Math.pow(r / (R * 0.5), 2));
  const wob = (fbmWorld(x * 0.35, z * 0.35, 3, 61) - 0.5) * 0.16 * sm(r, 0.8, 3);
  const rim = sm(r, R * 0.82, R) * 0.02;
  return mound + wob + rim;
}

export function buildRootBed(ctx: GroundCtx, kit: { stoneDark: THREE.Material }, soilTint: string, mossTint: string) {
  const R = ctx.terraceR - 0.55;
  const geo = new THREE.CircleGeometry(R, 72, 0, Math.PI * 2);
  const rings = 26;
  const pos: number[] = [];
  const col: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const soil = new THREE.Color(soilTint);
  const moss = new THREE.Color(mossTint);
  const c = new THREE.Color();
  pos.push(0, ctx.terraceH + bedHeight(R, 0, 0), 0);
  col.push(soil.r, soil.g, soil.b);
  uv.push(0, 0);
  const segs = 72;
  for (let ri = 1; ri <= rings; ri++) {
    const r = (ri / rings) * R;
    for (let s = 0; s < segs; s++) {
      const a = (s / segs) * Math.PI * 2;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      pos.push(x, ctx.terraceH + bedHeight(R, x, z), z);
      const m = clamp(sm(r, R * 0.3, R * 0.95) * 0.8 + (fbmWorld(x * 0.4, z * 0.4, 3, 4) - 0.4) * 0.8, 0, 1);
      c.copy(soil).lerp(moss, m).multiplyScalar(0.75 + fbmWorld(x * 0.9, z * 0.9, 3, 8) * 0.5);
      col.push(c.r, c.g, c.b);
      uv.push(x * 0.5, z * 0.5);
    }
  }
  for (let s = 0; s < segs; s++) idx.push(0, 1 + ((s + 1) % segs), 1 + s);
  for (let ri = 1; ri < rings; ri++) {
    const a0 = 1 + (ri - 1) * segs;
    const a1 = 1 + ri * segs;
    for (let s = 0; s < segs; s++) {
      const n = (s + 1) % segs;
      idx.push(a0 + s, a0 + n, a1 + s, a0 + n, a1 + n, a1 + s);
    }
  }
  geo.dispose();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const t = surface('soil', 512);
  const mat = new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, vertexColors: true, roughness: 0.97, normalScale: new THREE.Vector2(1.8, 1.8) });
  const mesh = new THREE.Mesh(g, mat);
  mesh.receiveShadow = true;
  ctx.group.add(mesh);
  ctx.disposables.push(g, mat);
  void kit;
  return { radius: R, y: (x: number, z: number) => ctx.terraceH + bedHeight(R, x, z) };
}
