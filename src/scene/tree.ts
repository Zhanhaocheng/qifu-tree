import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { fbmWorld } from './textures';

export interface StageParams {
  height: number;
  splitHeight: number;
  trunkRadius: number;
  limbs: number;
  limbLength: number;
  levels: number;
  roots: number;
  leaves: number;
  leafSize: number;
  tagScale: number;
  cameraDistance: number;
  tagCapacity: number;
  decor: number;
}

export const STAGE_PARAMS: StageParams[] = [
  { height: 4.8, splitHeight: 1.8, trunkRadius: 0.46, limbs: 4, limbLength: 2.7, levels: 2, roots: 5, leaves: 800, leafSize: 1.0, tagScale: 0.8, cameraDistance: 12.5, tagCapacity: 12, decor: 3 },
  { height: 10, splitHeight: 3.8, trunkRadius: 1.0, limbs: 4, limbLength: 5.2, levels: 3, roots: 7, leaves: 3200, leafSize: 1.35, tagScale: 1.1, cameraDistance: 21, tagCapacity: 40, decor: 8 },
  { height: 16, splitHeight: 5.8, trunkRadius: 1.75, limbs: 5, limbLength: 7.4, levels: 3, roots: 9, leaves: 8500, leafSize: 1.7, tagScale: 1.6, cameraDistance: 40, tagCapacity: 120, decor: 20 },
  { height: 23, splitHeight: 8.2, trunkRadius: 2.8, limbs: 6, limbLength: 11, levels: 4, roots: 12, leaves: 17000, leafSize: 2.2, tagScale: 2.1, cameraDistance: 70, tagCapacity: 300, decor: 40 },
];

export interface TreeStyle {
  leafColors: string[];
  accentColors: string[];
  accentRate: number;
  density: number;
}

export interface Anchor {
  position: THREE.Vector3;
}

export interface BuiltTree {
  bark: THREE.BufferGeometry;
  leaves: { matrices: Float32Array; colors: Float32Array; count: number };
  anchors: Anchor[];
  decor: Anchor[];
  height: number;
  crownCenter: THREE.Vector3;
  crownRadius: number;
  rootReach: number;
  trunkRadius: number;
  trunkBand: number;
  trunkCurve: THREE.CatmullRomCurve3;
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

interface TubeOpts {
  r0: number;
  r1: number;
  seg: number;
  around: number;
  flare?: number;
  lobes?: number;
  lobeAmp?: number;
  twist?: number;
  tile?: number;
  phase?: number;
  knots?: number;
  seed?: number;
}

function tube(pts: THREE.Vector3[], o: TubeOpts): { geo: THREE.BufferGeometry; curve: THREE.CatmullRomCurve3 } {
  const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5);
  const frames = curve.computeFrenetFrames(o.seg, false);
  const length = curve.getLength();
  const tile = o.tile ?? 2.4;
  const uRep = Math.max(1, Math.round((Math.PI * 2 * ((o.r0 + o.r1) / 2)) / tile));
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const p = new THREE.Vector3();
  for (let i = 0; i <= o.seg; i++) {
    const t = i / o.seg;
    curve.getPoint(t, p);
    const N = frames.normals[i];
    const B = frames.binormals[i];
    let r = o.r0 + (o.r1 - o.r0) * Math.pow(t, 0.85);
    if (o.flare) r *= 1 + o.flare * Math.exp(-t * (14 * (1 + o.r0 * 0.4)));
    for (let j = 0; j <= o.around; j++) {
      const a = (j / o.around) * Math.PI * 2;
      const lobe = o.lobes ? 1 + (o.lobeAmp ?? 0.1) * Math.sin(o.lobes * a + (o.twist ?? 0) * t * 6 + (o.phase ?? 0)) : 1;
      const knot = o.knots ? 1 + o.knots * (fbmWorld(Math.cos(a) * 1.7 + (o.seed ?? 0), Math.sin(a) * 1.7 + t * length * 0.45, 3, (o.seed ?? 0) + 5) - 0.5) : 1;
      const rr = r * lobe * knot;
      pos.push(p.x + (N.x * Math.cos(a) + B.x * Math.sin(a)) * rr, p.y + (N.y * Math.cos(a) + B.y * Math.sin(a)) * rr, p.z + (N.z * Math.cos(a) + B.z * Math.sin(a)) * rr);
      uv.push((j / o.around) * uRep, (t * length) / tile);
    }
  }
  const row = o.around + 1;
  for (let i = 0; i < o.seg; i++) {
    for (let j = 0; j < o.around; j++) {
      const a = i * row + j;
      idx.push(a, a + row, a + 1, a + 1, a + row, a + row + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return { geo, curve };
}

export function buildTree(stage: number, leafBudget: number, style: TreeStyle, seed = 20240611): BuiltTree {
  const p = STAGE_PARAMS[stage];
  const rng = mulberry32(seed + stage * 977);
  const parts: THREE.BufferGeometry[] = [];
  const leafPoints: THREE.Vector3[] = [];
  const anchorPts: THREE.Vector3[] = [];
  let maxY = 0;
  let maxReach = 0;
  let vines = 0;

  const tan = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const randUnit = () => new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize();

  // ---- trunk (gnarled, fluted, sinuous)
  const R = p.trunkRadius;
  const trunkPts: THREE.Vector3[] = [];
  const sway = 0.18 + stage * 0.12;
  const ph = rng() * 6;
  const trunkSeg = 8;
  for (let i = 0; i <= trunkSeg; i++) {
    const t = i / trunkSeg;
    trunkPts.push(new THREE.Vector3(Math.sin(t * 3.4 + ph) * R * sway * 3 * t, -R * 0.4 + t * (p.splitHeight + R * 0.4), Math.cos(t * 2.7 + ph * 1.3) * R * sway * 2.4 * t));
  }
  const trunk = tube(trunkPts, {
    r0: R * 1.05,
    r1: R * 0.72,
    seg: 56,
    around: stage >= 2 ? 48 : stage >= 1 ? 30 : 22,
    knots: 0.2 + stage * 0.05,
    seed: ph * 3,
    flare: 0.85 + stage * 0.15,
    lobes: stage >= 2 ? 6 : 4,
    lobeAmp: 0.06 + stage * 0.035,
    twist: 1.2 + stage * 0.3,
    tile: 2.6,
    phase: ph,
  });
  parts.push(trunk.geo);
  const trunkTop = trunkPts[trunkPts.length - 1].clone();

  // ---- roots
  const rootBase = new THREE.Vector3(0, 0, 0);
  let rootReach = R * 3;
  for (let i = 0; i < p.roots; i++) {
    const ang = (i / p.roots) * Math.PI * 2 + (rng() - 0.5) * 0.5;
    const dir = new THREE.Vector3(Math.cos(ang), 0, Math.sin(ang));
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    const reach = Math.min(9.2, R * (2.7 + rng() * 2.0) + (stage === 0 ? 0.7 : 1.0));
    rootReach = Math.max(rootReach, reach);
    const meander = (rng() - 0.5) * R * 1.4;
    const pts = [
      rootBase.clone().addScaledVector(dir, R * 0.5).setY(R * 2.4 + rng() * R),
      rootBase.clone().addScaledVector(dir, R * 1.4).addScaledVector(side, meander * 0.3).setY(R * 1.15),
      rootBase.clone().addScaledVector(dir, reach * 0.55).addScaledVector(side, meander * 0.8).setY(R * 0.42),
      rootBase.clone().addScaledVector(dir, reach * 0.85).addScaledVector(side, meander).setY(R * 0.12 + rng() * R * 0.15),
      rootBase.clone().addScaledVector(dir, reach).addScaledVector(side, meander * 1.1).setY(-R * 0.35),
    ];
    const root = tube(pts, { r0: R * 0.74, r1: R * 0.05, seg: 20, around: stage >= 1 ? 12 : 8, flare: 0.3, lobes: 3, lobeAmp: 0.1, knots: 0.22, seed: i * 7, tile: 2.2, phase: i });
    parts.push(root.geo);
    if (stage >= 2 && i % 2 === 0) {
      const from = root.curve.getPoint(0.35);
      const d2 = dir.clone().applyAxisAngle(up, (rng() > 0.5 ? 1 : -1) * (0.5 + rng() * 0.5));
      const sub = [from, from.clone().addScaledVector(d2, reach * 0.3).setY(R * 0.3), from.clone().addScaledVector(d2, reach * 0.55).setY(R * 0.08), from.clone().addScaledVector(d2, reach * 0.7).setY(-R * 0.3)];
      parts.push(tube(sub, { r0: R * 0.22, r1: R * 0.03, seg: 8, around: 6, tile: 2 }).geo);
    }
  }

  // ---- branches
  const growBranch = (start: THREE.Vector3, dir: THREE.Vector3, length: number, radius: number, level: number, outward: THREE.Vector3) => {
    const seg = 3 + Math.min(2, p.levels - level);
    const pts = [start.clone()];
    const d = dir.clone().normalize();
    const cur = start.clone();
    const upBias = level === 0 ? 0.28 : 0.14;
    for (let k = 0; k < seg; k++) {
      d.add(randUnit().multiplyScalar(0.55)).addScaledVector(up, upBias * (1 - level * 0.15)).addScaledVector(outward, 0.18);
      if (level >= 2) d.y -= 0.12;
      d.normalize();
      cur.addScaledVector(d, length / seg);
      pts.push(cur.clone());
    }
    const isThin = level >= p.levels;
    const b = tube(pts, {
      r0: radius,
      r1: radius * (isThin ? 0.3 : 0.5),
      seg: Math.max(5, 3 * seg),
      around: level <= 1 ? (stage >= 2 ? 18 : 12) : stage >= 2 ? 8 : 6,
      knots: level <= 1 ? 0.16 : 0.08,
      seed: rng() * 50,
      lobes: level === 0 ? 4 : 0,
      lobeAmp: 0.07,
      tile: 2.4,
      phase: rng() * 6,
    });
    parts.push(b.geo);
    const end = pts[pts.length - 1];
    maxY = Math.max(maxY, end.y);
    maxReach = Math.max(maxReach, Math.hypot(end.x, end.z));

    if (level >= p.levels - 1 || (stage >= 2 && level >= p.levels - 2)) {
      for (const t of [0.4, 0.6, 0.8, 1]) leafPoints.push(b.curve.getPoint(t));
    }
    if (level >= 1 && stage >= 1 && vines < 12 + stage * 12 && rng() < 0.5) {
      vines++;
      const vp = b.curve.getPoint(0.45 + rng() * 0.55);
      const vl = (1.0 + rng() * 2.6) * (0.5 + stage * 0.35);
      const vpts = [vp, vp.clone().add(new THREE.Vector3((rng() - 0.5) * 0.3, -vl * 0.35, (rng() - 0.5) * 0.3)), vp.clone().add(new THREE.Vector3((rng() - 0.5) * 0.5, -vl * 0.7, (rng() - 0.5) * 0.5)), vp.clone().add(new THREE.Vector3((rng() - 0.5) * 0.6, -vl, (rng() - 0.5) * 0.6))];
      parts.push(tube(vpts, { r0: 0.03 + R * 0.014, r1: 0.006, seg: 6, around: 4, tile: 1.4 }).geo);
    }
    if (level >= 1) {
      for (const t of [0.35, 0.6, 0.85, 1]) anchorPts.push(b.curve.getPoint(t));
    }
    if (level >= p.levels) return;
    const kids = level === 0 ? 3 + Math.floor(rng() * 2) : 2 + Math.floor(rng() * 2);
    for (let i = 0; i < kids; i++) {
      const t = 0.3 + (i / kids) * 0.62 + rng() * 0.08;
      const at = b.curve.getPoint(Math.min(0.98, t));
      b.curve.getTangent(Math.min(0.98, t), tan);
      const az = rng() * Math.PI * 2;
      const polar = 0.5 + rng() * 0.7;
      const helper = Math.abs(tan.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : up.clone();
      const s1 = new THREE.Vector3().crossVectors(tan, helper).normalize();
      const s2 = new THREE.Vector3().crossVectors(tan, s1).normalize();
      const nd = tan.clone().multiplyScalar(Math.cos(polar)).addScaledVector(s1, Math.sin(polar) * Math.cos(az)).addScaledVector(s2, Math.sin(polar) * Math.sin(az));
      growBranch(at, nd, length * (0.55 + rng() * 0.2), radius * (0.5 - t * 0.12), level + 1, outward);
    }
    const tipDir = pts[pts.length - 1].clone().sub(pts[pts.length - 2]).normalize();
    if (level < p.levels) growBranch(end.clone(), tipDir.add(randUnit().multiplyScalar(0.4)), length * 0.6, radius * 0.42, level + 1, outward);
  };

  const limbStartR = R * 0.62;
  for (let i = 0; i < p.limbs; i++) {
    const az = (i / p.limbs) * Math.PI * 2 + rng() * 0.6;
    const outward = new THREE.Vector3(Math.cos(az), 0, Math.sin(az));
    const dir = outward.clone().multiplyScalar(1.0).addScaledVector(up, 0.85 - stage * 0.08).normalize();
    growBranch(trunkTop.clone().addScaledVector(up, -R * 0.15 * rng()), dir, p.limbLength * (0.85 + rng() * 0.3), limbStartR, 0, outward);
  }
  if (stage >= 2) {
    const dir = up.clone().add(randUnit().multiplyScalar(0.25)).normalize();
    growBranch(trunkTop.clone(), dir, p.limbLength * 0.9, R * 0.5, 1, new THREE.Vector3());
  }
  const sideCount = stage >= 1 ? 2 + stage : 0;
  for (let i = 0; i < sideCount; i++) {
    const t = 0.55 + rng() * 0.4;
    const at = trunkPts.length ? new THREE.CatmullRomCurve3(trunkPts).getPoint(t) : trunkTop;
    const az = rng() * Math.PI * 2;
    const outward = new THREE.Vector3(Math.cos(az), 0, Math.sin(az));
    growBranch(at, outward.clone().addScaledVector(up, 0.45).normalize(), p.limbLength * 0.65, R * 0.4, 1, outward);
  }

  const height = Math.max(maxY, p.height * 0.8);
  const crownCenter = new THREE.Vector3(0, trunkTop.y + (height - trunkTop.y) * 0.45, 0);
  const crownRadius = Math.max(2, maxReach * 0.95, (height - trunkTop.y) * 0.8);

  // ---- leaves
  const leafCount = Math.max(30, Math.round(p.leaves * leafBudget * style.density));
  const matrices = new Float32Array(leafCount * 16);
  const colors = new Float32Array(leafCount * 3);
  const m = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scl = new THREE.Vector3();
  const euler = new THREE.Euler();
  const color = new THREE.Color();
  const spread = 0.8 + p.leafSize * 1.0;
  const palette = style.leafColors.map((c) => new THREE.Color(c));
  const accents = style.accentColors.map((c) => new THREE.Color(c));
  const pointsForLeaves = leafPoints.length ? leafPoints : [trunkTop];
  for (let i = 0; i < leafCount; i++) {
    const c = pointsForLeaves[Math.floor(rng() * pointsForLeaves.length)];
    const off = randUnit().multiplyScalar(spread * (0.3 + rng() * 0.9));
    off.y *= 0.75;
    pos.copy(c).add(off);
    pos.y = Math.max(pos.y, p.splitHeight * (0.82 + rng() * 0.25));
    euler.set((rng() - 0.5) * 1.6, rng() * Math.PI * 2, (rng() - 0.5) * 1.6);
    quat.setFromEuler(euler);
    const s = p.leafSize * (0.75 + rng() * 0.6);
    scl.set(s, s, s);
    m.compose(pos, quat, scl);
    m.toArray(matrices, i * 16);
    const base = rng() < style.accentRate && accents.length ? accents[Math.floor(rng() * accents.length)] : palette[Math.floor(rng() * palette.length)];
    color.copy(base);
    color.offsetHSL((rng() - 0.5) * 0.03, (rng() - 0.5) * 0.1, (rng() - 0.5) * 0.08);
    const dist = pos.distanceTo(crownCenter) / crownRadius;
    color.multiplyScalar(0.5 + 0.55 * Math.min(1, dist));
    color.toArray(colors, i * 3);
  }

  // ---- anchors
  const visible = anchorPts.filter((a) => Math.hypot(a.x, a.z) > crownRadius * 0.3 && a.y > trunkTop.y * 0.75);
  const pool = (visible.length > 20 ? visible : anchorPts).map((v) => v.clone());
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const decorN = Math.min(p.decor, Math.floor(pool.length * 0.25));
  const decor = pool.splice(0, decorN).map((position) => ({ position }));
  const anchors = pool.map((position) => ({ position }));

  const bark = mergeGeometries(parts, false)!;
  return {
    bark,
    leaves: { matrices, colors, count: leafCount },
    anchors,
    decor,
    height,
    crownCenter,
    crownRadius,
    rootReach,
    trunkRadius: R,
    trunkBand: Math.min(trunkTop.y * 0.32, 2.6 + stage),
    trunkCurve: trunk.curve,
  };
}
