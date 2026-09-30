import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export interface StageParams {
  trunkLength: number;
  trunkRadius: number;
  depth: number;
  leaves: number;
  tagScale: number;
  cameraDistance: number;
  tagCapacity: number;
}

export const STAGE_PARAMS: StageParams[] = [
  { trunkLength: 1.5, trunkRadius: 0.07, depth: 3, leaves: 90, tagScale: 0.7, cameraDistance: 8, tagCapacity: 12 },
  { trunkLength: 3.0, trunkRadius: 0.17, depth: 4, leaves: 500, tagScale: 1.0, cameraDistance: 13, tagCapacity: 40 },
  { trunkLength: 4.4, trunkRadius: 0.32, depth: 5, leaves: 1700, tagScale: 1.4, cameraDistance: 19, tagCapacity: 120 },
  { trunkLength: 5.2, trunkRadius: 0.55, depth: 6, leaves: 4000, tagScale: 1.8, cameraDistance: 27, tagCapacity: 300 },
];

export interface Anchor {
  position: THREE.Vector3;
}

export interface BuiltTree {
  trunk: THREE.BufferGeometry;
  leaves: { matrices: Float32Array; colors: Float32Array; count: number };
  anchors: Anchor[];
  height: number;
}

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Branch {
  start: THREE.Vector3;
  dir: THREE.Vector3;
  length: number;
  radius: number;
  level: number;
}

const UP = new THREE.Vector3(0, 1, 0);

function perturb(dir: THREE.Vector3, polar: number, azimuth: number): THREE.Vector3 {
  const helper = Math.abs(dir.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : UP.clone();
  const side = new THREE.Vector3().crossVectors(dir, helper).normalize();
  const side2 = new THREE.Vector3().crossVectors(dir, side).normalize();
  const radial = side.multiplyScalar(Math.cos(azimuth)).add(side2.multiplyScalar(Math.sin(azimuth)));
  return dir.clone().multiplyScalar(Math.cos(polar)).add(radial.multiplyScalar(Math.sin(polar))).normalize();
}

export function buildTree(stage: number, leafBudget: number, seed = 20240611): BuiltTree {
  const p = STAGE_PARAMS[stage];
  const rng = mulberry32(seed + stage * 977);
  const branches: Branch[] = [];

  const grow = (b: Branch) => {
    branches.push(b);
    if (b.level >= p.depth) return;
    const end = b.start.clone().addScaledVector(b.dir, b.length);
    const n = b.level === 0 ? 3 : 2 + (rng() < 0.45 ? 1 : 0);
    const az0 = rng() * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      const az = az0 + (i * Math.PI * 2) / n + (rng() - 0.5) * 0.7;
      const polar = 0.35 + rng() * 0.45;
      const dir = perturb(b.dir, polar, az);
      dir.y += 0.16;
      dir.normalize();
      grow({
        start: end,
        dir,
        length: b.length * (0.7 + rng() * 0.1),
        radius: b.radius * 0.64,
        level: b.level + 1,
      });
    }
    if (b.level <= 1) {
      const sideCount = b.level === 0 ? 4 : 2;
      for (let i = 0; i < sideCount; i++) {
        const t = 0.5 + rng() * 0.4;
        const start = b.start.clone().addScaledVector(b.dir, b.length * t);
        const dir = perturb(b.dir, 0.9 + rng() * 0.4, rng() * Math.PI * 2);
        dir.y += 0.1;
        dir.normalize();
        grow({
          start,
          dir,
          length: b.length * (b.level === 0 ? 0.65 : 0.6),
          radius: b.radius * 0.5,
          level: b.level + 2,
        });
      }
    }
  };

  grow({ start: new THREE.Vector3(0, 0, 0), dir: new THREE.Vector3(0, 1, 0), length: p.trunkLength, radius: p.trunkRadius, level: 0 });

  const parts: THREE.BufferGeometry[] = [];
  const anchors: Anchor[] = [];
  const leafCandidates: THREE.Vector3[] = [];
  const q = new THREE.Quaternion();
  let maxY = 0;

  for (const b of branches) {
    const end = b.start.clone().addScaledVector(b.dir, b.length);
    maxY = Math.max(maxY, end.y);
    const bottomR = b.level === 0 ? b.radius * 1.5 : b.radius / 0.64;
    const g = new THREE.CylinderGeometry(b.radius * 0.95, Math.min(bottomR, b.radius * 1.6), b.length, b.level === 0 ? 9 : 5, 1);
    g.translate(0, b.length / 2, 0);
    q.setFromUnitVectors(UP, b.dir);
    g.applyQuaternion(q);
    g.translate(b.start.x, b.start.y, b.start.z);
    const colorAttr = new Float32Array(g.attributes.position.count * 3);
    const shade = 0.85 + rng() * 0.3;
    for (let i = 0; i < g.attributes.position.count; i++) {
      colorAttr[i * 3] = 0.36 * shade;
      colorAttr[i * 3 + 1] = 0.24 * shade;
      colorAttr[i * 3 + 2] = 0.15 * shade;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colorAttr, 3));
    parts.push(g);

    if (b.level >= 1) {
      for (const t of [0.45, 0.75, 1]) {
        anchors.push({ position: b.start.clone().addScaledVector(b.dir, b.length * t) });
      }
    }
    if (b.level >= p.depth - 2) leafCandidates.push(end);
    if (b.level >= p.depth - 1) leafCandidates.push(b.start.clone().addScaledVector(b.dir, b.length * 0.5));
  }

  for (let i = anchors.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [anchors[i], anchors[j]] = [anchors[j], anchors[i]];
  }

  const leafCount = Math.max(20, Math.round(p.leaves * leafBudget));
  const matrices = new Float32Array(leafCount * 16);
  const colors = new Float32Array(leafCount * 3);
  const m = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scl = new THREE.Vector3();
  const euler = new THREE.Euler();
  const color = new THREE.Color();
  const spread = 0.55 + stage * 0.45;
  const leafSize = 0.5 + stage * 0.12;

  for (let i = 0; i < leafCount; i++) {
    const c = leafCandidates[Math.floor(rng() * leafCandidates.length)];
    pos.set(c.x + (rng() - 0.5) * spread * 2, c.y + (rng() - 0.35) * spread * 1.6, c.z + (rng() - 0.5) * spread * 2);
    euler.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI);
    quat.setFromEuler(euler);
    const s = leafSize * (0.7 + rng() * 0.6);
    scl.set(s, s * 0.35, s);
    m.compose(pos, quat, scl);
    m.toArray(matrices, i * 16);
    const r = rng();
    if (r < 0.07 && stage >= 2) color.setHSL(0.94 + rng() * 0.04, 0.6, 0.78);
    else if (r < 0.12 && stage >= 1) color.setHSL(0.12, 0.7, 0.6);
    else color.setHSL(0.25 + rng() * 0.09, 0.5 + rng() * 0.2, 0.3 + rng() * 0.16);
    color.toArray(colors, i * 3);
  }

  return {
    trunk: mergeGeometries(parts, false)!,
    leaves: { matrices, colors, count: leafCount },
    anchors,
    height: maxY,
  };
}
