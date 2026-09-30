import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { TerrainId } from '../../shared/game';
import { glowTexture } from './sky';
import type { ParticleKind, QualityLevel, TerrainWorld } from './terrain';
import { mulberry32 } from './tree';

export type AnimalSound = 'bird' | 'crane' | 'deer' | 'crow' | 'bell' | 'rabbit';

export interface FaunaEnv {
  night: number;
  wind: number;
  time: number;
  camPos: THREE.Vector3;
  center: THREE.Vector3;
}

const mat = (color: string, rough = 0.85) => new THREE.MeshStandardMaterial({ color, roughness: rough });

function ell(rx: number, ry: number, rz: number, m: THREE.Material, x = 0, y = 0, z = 0) {
  const g = new THREE.SphereGeometry(1, 14, 10);
  const o = new THREE.Mesh(g, m);
  o.scale.set(rx, ry, rz);
  o.position.set(x, y, z);
  o.castShadow = true;
  return o;
}

function cyl(r0: number, r1: number, h: number, m: THREE.Material, x = 0, y = 0, z = 0) {
  const g = new THREE.CylinderGeometry(r1, r0, h, 8);
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z);
  o.castShadow = true;
  return o;
}

type Kind = 'rabbit' | 'deer' | 'crane' | 'camel';

interface Creature {
  kind: Kind;
  group: THREE.Group;
  legs: THREE.Object3D[];
  head?: THREE.Object3D;
  neck?: THREE.Object3D;
  speed: number;
  state: 'idle' | 'move';
  timer: number;
  target: THREE.Vector3;
  heading: number;
  phase: number;
  nextCall: number;
  path?: { radius: number; angle: number; dir: number };
  scale: number;
}

function makeRabbit(snow: boolean): Creature {
  const g = new THREE.Group();
  const fur = mat(snow ? '#f3f3ef' : '#a8927a');
  const body = ell(0.16, 0.14, 0.24, fur, 0, 0.16, 0);
  const head = new THREE.Group();
  head.position.set(0, 0.26, 0.2);
  head.add(ell(0.09, 0.085, 0.11, fur));
  for (const s of [-1, 1]) {
    const ear = ell(0.028, 0.14, 0.03, fur, s * 0.04, 0.16, -0.02);
    ear.rotation.z = -s * 0.15;
    head.add(ear);
    const eye = ell(0.014, 0.014, 0.014, mat('#111111', 0.3), s * 0.06, 0.03, 0.08);
    head.add(eye);
  }
  const tail = ell(0.05, 0.05, 0.05, mat('#ffffff'), 0, 0.2, -0.24);
  const haunch = ell(0.14, 0.13, 0.15, fur, 0, 0.14, -0.1);
  g.add(body, head, tail, haunch);
  g.traverse((o) => ((o as THREE.Mesh).castShadow = true));
  return base('rabbit', g, [], head, undefined, 1.4, 1.2);
}

function makeDeer(): Creature {
  const g = new THREE.Group();
  const fur = mat('#a9713f');
  const belly = mat('#d8c3a0');
  const body = ell(0.32, 0.3, 0.75, fur, 0, 1.0, 0);
  const under = ell(0.28, 0.2, 0.6, belly, 0, 0.88, 0);
  const neck = new THREE.Group();
  neck.position.set(0, 1.15, 0.6);
  const neckMesh = cyl(0.11, 0.09, 0.6, fur, 0, 0.25, 0.08);
  neckMesh.rotation.x = 0.55;
  neck.add(neckMesh);
  const head = new THREE.Group();
  head.position.set(0, 0.55, 0.22);
  head.add(ell(0.09, 0.1, 0.19, fur, 0, 0, 0.06));
  head.add(ell(0.045, 0.045, 0.06, mat('#151515', 0.4), 0, -0.02, 0.24));
  for (const s of [-1, 1]) {
    const ear = ell(0.03, 0.08, 0.05, fur, s * 0.1, 0.09, -0.04);
    ear.rotation.z = -s * 0.7;
    head.add(ear);
    const ant = cyl(0.012, 0.008, 0.36, mat('#5b4634'), s * 0.06, 0.28, -0.02);
    ant.rotation.z = -s * 0.25;
    head.add(ant);
    const tine = cyl(0.008, 0.005, 0.2, mat('#5b4634'), s * 0.11, 0.35, 0.03);
    tine.rotation.z = -s * 0.7;
    head.add(tine);
  }
  neck.add(head);
  const tail = ell(0.05, 0.07, 0.05, mat('#f2ead8'), 0, 1.15, -0.78);
  g.add(body, under, neck, tail);
  const legs: THREE.Object3D[] = [];
  for (const [x, z] of [
    [-0.18, 0.5],
    [0.18, 0.5],
    [-0.18, -0.5],
    [0.18, -0.5],
  ]) {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.85, z);
    pivot.add(cyl(0.05, 0.035, 0.85, fur, 0, -0.42, 0));
    legs.push(pivot);
    g.add(pivot);
  }
  g.traverse((o) => ((o as THREE.Mesh).castShadow = true));
  return base('deer', g, legs, head, neck, 1.1, 1.0);
}

function makeCrane(): Creature {
  const g = new THREE.Group();
  const white = mat('#f6f4ee');
  const black = mat('#1c1c1c');
  const body = ell(0.22, 0.2, 0.42, white, 0, 0.95, 0);
  const tailf = ell(0.14, 0.05, 0.22, black, 0, 0.98, -0.46);
  const neck = new THREE.Group();
  neck.position.set(0, 1.05, 0.34);
  const n1 = cyl(0.04, 0.03, 0.55, white, 0, 0.25, 0.05);
  n1.rotation.x = 0.35;
  neck.add(n1);
  const head = new THREE.Group();
  head.position.set(0, 0.55, 0.16);
  head.add(ell(0.05, 0.05, 0.07, white));
  const beak = cyl(0.02, 0.004, 0.24, mat('#d6b06a', 0.5), 0, -0.01, 0.18);
  beak.rotation.x = Math.PI / 2;
  head.add(beak);
  head.add(ell(0.035, 0.012, 0.035, mat('#d8232a', 0.5), 0, 0.045, 0.0));
  neck.add(head);
  const wingL = ell(0.05, 0.16, 0.36, white, -0.2, 1.0, -0.05);
  const wingR = ell(0.05, 0.16, 0.36, white, 0.2, 1.0, -0.05);
  g.add(body, tailf, neck, wingL, wingR);
  const legs: THREE.Object3D[] = [];
  for (const x of [-0.08, 0.08]) {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.85, 0);
    pivot.add(cyl(0.012, 0.01, 0.85, black, 0, -0.42, 0));
    legs.push(pivot);
    g.add(pivot);
  }
  g.traverse((o) => ((o as THREE.Mesh).castShadow = true));
  return base('crane', g, legs, head, neck, 0.5, 1.0);
}

function makeCamel(): Creature {
  const g = new THREE.Group();
  const fur = mat('#b98b56', 0.95);
  const body = ell(0.5, 0.5, 1.05, fur, 0, 1.55, 0);
  const hump1 = ell(0.3, 0.38, 0.3, fur, 0, 2.05, 0.35);
  const hump2 = ell(0.3, 0.38, 0.3, fur, 0, 2.05, -0.4);
  const neck = new THREE.Group();
  neck.position.set(0, 1.7, 0.95);
  const nm = cyl(0.17, 0.12, 1.1, fur, 0, 0.5, 0.2);
  nm.rotation.x = 0.7;
  neck.add(nm);
  const head = new THREE.Group();
  head.position.set(0, 1.0, 0.55);
  head.add(ell(0.13, 0.15, 0.3, fur, 0, 0, 0.08));
  neck.add(head);
  g.add(body, hump1, hump2, neck);
  const legs: THREE.Object3D[] = [];
  for (const [x, z] of [
    [-0.28, 0.7],
    [0.28, 0.7],
    [-0.28, -0.7],
    [0.28, -0.7],
  ]) {
    const pivot = new THREE.Group();
    pivot.position.set(x, 1.3, z);
    pivot.add(cyl(0.11, 0.06, 1.35, fur, 0, -0.66, 0));
    legs.push(pivot);
    g.add(pivot);
  }
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 0.7), mat('#8c2f2a'));
  pack.position.set(0, 2.05, 0);
  g.add(pack);
  g.traverse((o) => ((o as THREE.Mesh).castShadow = true));
  return base('camel', g, legs, head, neck, 0.7, 1.0);
}

function base(kind: Kind, group: THREE.Group, legs: THREE.Object3D[], head: THREE.Object3D | undefined, neck: THREE.Object3D | undefined, speed: number, scale: number): Creature {
  return { kind, group, legs, head, neck, speed, state: 'idle', timer: Math.random() * 3, target: new THREE.Vector3(), heading: Math.random() * 6, phase: Math.random() * 10, nextCall: 15 + Math.random() * 40, scale };
}

function wingGeometry(kind: 'butterfly' | 'dragonfly' | 'bird'): THREE.BufferGeometry {
  if (kind === 'butterfly') {
    const g = new THREE.BufferGeometry();
    const v = [0, 0, 0.14, 0.28, 0, 0.16, 0.3, 0, -0.1, 0, 0, -0.08, 0, 0, 0.14, 0, 0, -0.08, -0.3, 0, -0.1, -0.28, 0, 0.16];
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    g.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
    g.computeVertexNormals();
    return g;
  }
  if (kind === 'dragonfly') {
    const parts: THREE.BufferGeometry[] = [];
    const body = new THREE.CylinderGeometry(0.012, 0.006, 0.42, 5).rotateX(Math.PI / 2).translate(0, 0, -0.1);
    parts.push(body.toNonIndexed());
    const head = new THREE.SphereGeometry(0.028, 6, 5).translate(0, 0, 0.14);
    parts.push(head.toNonIndexed());
    for (const z of [0.06, -0.02]) {
      for (const s of [-1, 1]) {
        const w = new THREE.PlaneGeometry(0.3, 0.05).rotateX(-Math.PI / 2).translate(s * 0.17, 0, z);
        parts.push(w.toNonIndexed());
      }
    }
    return mergeGeometries(parts)!;
  }
  const g = new THREE.BufferGeometry();
  const v = [
    0, 0, 0.35, -0.08, 0, 0, 0.08, 0, 0, 0, 0, -0.3, -0.08, 0, 0, 0.08, 0, 0,
    -0.08, 0, 0.1, -0.9, 0.05, -0.05, -0.08, 0, -0.15,
    0.08, 0, 0.1, 0.08, 0, -0.15, 0.9, 0.05, -0.05,
  ];
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
}

function flapMaterial(color: string, freq: number, amp: number, doubleSided = true): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color, side: doubleSided ? THREE.DoubleSide : THREE.FrontSide, roughness: 0.7, vertexColors: false });
  m.userData.uTime = { value: 0 };
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = m.userData.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         #ifdef USE_INSTANCING
           float fph = instanceMatrix[3][0] * 3.1 + instanceMatrix[3][2] * 1.7;
         #else
           float fph = 0.0;
         #endif
         float fl = sin(uTime * ${freq.toFixed(1)} + fph) * ${amp.toFixed(2)};
         float ax = abs(transformed.x);
         transformed.y += ax * fl * ${amp > 0.5 ? '1.0' : '0.9'};
         transformed.x *= cos(fl * 0.6);`,
      );
  };
  return m;
}

interface Flyer {
  center: THREE.Vector3;
  r: number;
  fa: number;
  fb: number;
  fc: number;
  pa: number;
  pb: number;
  speed: number;
  height: number;
}

export class Fauna {
  readonly group = new THREE.Group();
  onCall?: (kind: AnimalSound, pos: THREE.Vector3) => void;
  private creatures: Creature[] = [];
  private butterflies: THREE.InstancedMesh | null = null;
  private dragonflies: THREE.InstancedMesh | null = null;
  private birds: THREE.InstancedMesh | null = null;
  private flyers = { b: [] as Flyer[], d: [] as Flyer[] };
  private birdData: { angle: number; radius: number; height: number; speed: number; phase: number; bob: number }[] = [];
  private fireflies: THREE.Points | null = null;
  private fireflyBase: Float32Array = new Float32Array(0);
  private mats: THREE.MeshStandardMaterial[] = [];
  private rng: () => number;
  private dummy = new THREE.Object3D();
  private prevPos = new Map<number, THREE.Vector3>();
  private birdCall = 8;

  constructor(private world: TerrainWorld, private id: TerrainId, quality: QualityLevel, seed: number) {
    this.rng = mulberry32(seed * 131 + 7);
    const q = quality === 'high' ? 1 : quality === 'medium' ? 0.7 : 0.4;
    this.spawnCreatures();
    this.spawnInsects(q);
    this.spawnBirds(q);
    this.spawnFireflies(q);
  }

  private pickGround(minR: number, maxR: number): THREE.Vector3 {
    for (let i = 0; i < 40; i++) {
      const a = this.rng() * Math.PI * 2;
      const r = minR + this.rng() * (maxR - minR);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const h = this.world.heightAt(x, z);
      if (this.world.isWater(x, z) || h < -1.5) continue;
      if (Math.abs(x) < 4 && z > 6) continue;
      return new THREE.Vector3(x, h, z);
    }
    return new THREE.Vector3(12, 0, 12);
  }

  private add(c: Creature, minR = 12, maxR = 34) {
    const p = this.pickGround(minR, maxR);
    c.group.position.copy(p);
    c.group.scale.setScalar(c.scale);
    c.target.copy(p);
    this.group.add(c.group);
    this.creatures.push(c);
  }

  private spawnCreatures() {
    const id = this.id;
    if (id === 'mountain') {
      this.add(makeRabbit(false), 10, 26);
      this.add(makeRabbit(false), 10, 26);
      this.add(makeCrane(), 10, 28);
    } else if (id === 'bamboo') {
      this.add(makeDeer(), 12, 30);
      this.add(makeDeer(), 12, 30);
      this.add(makeRabbit(false), 10, 26);
      this.add(makeRabbit(false), 10, 26);
    } else if (id === 'jiangnan') {
      const c1 = makeCrane();
      const c2 = makeCrane();
      this.add(c1, 10, 30);
      this.add(c2, 10, 30);
      this.add(makeRabbit(false), 10, 24);
    } else if (id === 'desert') {
      for (let i = 0; i < 4; i++) {
        const cam = makeCamel();
        cam.scale = 0.9;
        cam.path = { radius: 58 + i * 0.5, angle: 0.5 + i * 0.09, dir: 1 };
        this.add(cam, 40, 60);
      }
      this.add(makeRabbit(false), 10, 24);
    } else if (id === 'snow') {
      this.add(makeDeer(), 12, 32);
      this.add(makeDeer(), 12, 32);
      this.add(makeRabbit(true), 10, 26);
      this.add(makeRabbit(true), 10, 26);
    }
  }

  private spawnInsects(q: number) {
    const id = this.id;
    const hasFlora = id === 'mountain' || id === 'bamboo' || id === 'jiangnan';
    if (hasFlora) {
      const n = Math.round(26 * q);
      const geo = wingGeometry('butterfly');
      const m = flapMaterial('#ffffff', 22, 0.95);
      this.mats.push(m);
      const im = new THREE.InstancedMesh(geo, m, n);
      im.frustumCulled = false;
      const cols = ['#ffffff', '#f5d34a', '#f08a34', '#5b8fe0', '#ec7fb0'];
      for (let i = 0; i < n; i++) {
        im.setColorAt(i, new THREE.Color(cols[Math.floor(this.rng() * cols.length)]));
        const spot = this.pickGround(9, 20).add(new THREE.Vector3(0, 0.8, 0));
        this.flyers.b.push({ center: spot.clone(), r: 1.5 + this.rng() * 3, fa: 0.3 + this.rng() * 0.4, fb: 0.4 + this.rng() * 0.5, fc: 0.25 + this.rng() * 0.4, pa: this.rng() * 6, pb: this.rng() * 6, speed: 1, height: 0.6 + this.rng() * 1.2 });
      }
      im.scale.setScalar(1);
      this.butterflies = im;
      this.group.add(im);
    }
    if (id === 'bamboo' || id === 'jiangnan') {
      const n = Math.round(8 * q);
      const geo = wingGeometry('dragonfly');
      const m = flapMaterial('#5fb7c9', 55, 0.25);
      this.mats.push(m);
      const im = new THREE.InstancedMesh(geo, m, n);
      im.frustumCulled = false;
      const cols = ['#4a9fb5', '#d84a3a', '#3fa877'];
      for (let i = 0; i < n; i++) {
        im.setColorAt(i, new THREE.Color(cols[i % cols.length]));
        const spot = this.world.waterSpots.length ? this.world.waterSpots[Math.floor(this.rng() * this.world.waterSpots.length)] : this.pickGround(10, 30);
        this.flyers.d.push({ center: spot.clone().add(new THREE.Vector3(0, 0.9, 0)), r: 2 + this.rng() * 3, fa: 0.5 + this.rng() * 0.7, fb: 0.8 + this.rng() * 1.0, fc: 0.5 + this.rng() * 0.6, pa: this.rng() * 6, pb: this.rng() * 6, speed: 1, height: 0.3 + this.rng() * 0.6 });
      }
      this.dragonflies = im;
      this.group.add(im);
    }
  }

  private spawnBirds(q: number) {
    const n = Math.round((this.id === 'desert' ? 4 : this.id === 'snow' ? 7 : 11) * q);
    const dark = this.id === 'snow' || this.id === 'desert';
    const m = flapMaterial(dark ? '#1c1c20' : '#f0efe8', 6, 0.8);
    m.side = THREE.DoubleSide;
    this.mats.push(m);
    const im = new THREE.InstancedMesh(wingGeometry('bird'), m, n);
    im.frustumCulled = false;
    im.castShadow = false;
    for (let i = 0; i < n; i++) {
      this.birdData.push({ angle: this.rng() * 6.28, radius: 18 + this.rng() * 26, height: 13 + this.rng() * 18, speed: (0.05 + this.rng() * 0.05) * (this.rng() > 0.5 ? 1 : -1), phase: this.rng() * 10, bob: this.rng() * 6 });
      im.setColorAt(i, new THREE.Color(1, 1, 1));
    }
    this.birds = im;
    this.group.add(im);
  }

  private spawnFireflies(q: number) {
    if (this.id === 'desert' || this.id === 'snow') return;
    const n = Math.round(70 * q);
    const geo = new THREE.BufferGeometry();
    this.fireflyBase = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const p = this.pickGround(8, 34);
      this.fireflyBase[i * 4] = p.x;
      this.fireflyBase[i * 4 + 1] = p.y + 0.5 + this.rng() * 2.6;
      this.fireflyBase[i * 4 + 2] = p.z;
      this.fireflyBase[i * 4 + 3] = this.rng() * 100;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    const mat2 = new THREE.PointsMaterial({ map: glowTexture(), color: 0xd6ff7a, size: 0.55, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    this.fireflies = new THREE.Points(geo, mat2);
    this.fireflies.frustumCulled = false;
    this.group.add(this.fireflies);
  }

  private wander(c: Creature, dt: number, t: number) {
    const g = c.group;
    const p = g.position;
    if (c.path) {
      const speed = 0.9 / c.path.radius;
      c.path.angle += speed * dt * 0.7 * c.path.dir;
      const nx = Math.cos(c.path.angle) * c.path.radius;
      const nz = Math.sin(c.path.angle) * c.path.radius;
      const h = this.world.heightAt(nx, nz);
      const dx = nx - p.x;
      const dz = nz - p.z;
      if (dx * dx + dz * dz > 1e-6) c.heading = Math.atan2(dx, dz);
      p.set(nx, h, nz);
      g.rotation.y = c.heading;
      c.state = 'move';
      return;
    }
    c.timer -= dt;
    if (c.timer <= 0) {
      if (c.state === 'idle') {
        for (let i = 0; i < 12; i++) {
          const a = this.rng() * 6.28;
          const d = 3 + this.rng() * 9;
          const tx = p.x + Math.cos(a) * d;
          const tz = p.z + Math.sin(a) * d;
          const r = Math.hypot(tx, tz);
          if (r < 10 || r > 42 || this.world.isWater(tx, tz) || this.world.heightAt(tx, tz) < -1) continue;
          if (Math.abs(tx) < 4.5 && tz > 5) continue;
          c.target.set(tx, 0, tz);
          c.state = 'move';
          c.timer = 12;
          break;
        }
        if (c.state === 'idle') c.timer = 1.5;
      } else {
        c.state = 'idle';
        c.timer = 2.5 + this.rng() * 6;
      }
    }
    if (c.state === 'move') {
      const dx = c.target.x - p.x;
      const dz = c.target.z - p.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.4) {
        c.state = 'idle';
        c.timer = 2 + this.rng() * 6;
      } else {
        const want = Math.atan2(dx, dz);
        let diff = want - c.heading;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        c.heading += diff * Math.min(1, dt * 3);
        const sp = c.speed * (c.kind === 'rabbit' ? 1 + Math.max(0, Math.sin(c.phase * 9)) : 1);
        p.x += Math.sin(c.heading) * sp * dt;
        p.z += Math.cos(c.heading) * sp * dt;
      }
    }
    p.y = this.world.heightAt(p.x, p.z);
    g.rotation.y = c.heading;
    void t;
  }

  update(dt: number, env: FaunaEnv) {
    const day = 1 - env.night;
    for (const m of this.mats) m.userData.uTime.value = env.time;

    for (const c of this.creatures) {
      this.wander(c, dt, env.time);
      const moving = c.state === 'move';
      c.phase += dt * (moving ? (c.kind === 'rabbit' ? 1.6 : c.kind === 'camel' ? 2.4 : 4) : 1);
      const swing = moving ? Math.sin(c.phase * (c.kind === 'camel' ? 2.2 : 2.6)) * (c.kind === 'camel' ? 0.4 : 0.55) : 0;
      c.legs.forEach((l, i) => {
        const diag = c.legs.length === 4 ? (i === 0 || i === 3 ? 1 : -1) : i === 0 ? 1 : -1;
        l.rotation.x = swing * diag;
      });
      if (c.kind === 'rabbit') {
        const hop = moving ? Math.abs(Math.sin(c.phase * 5)) * 0.22 : 0;
        c.group.position.y += hop;
        if (c.head) c.head.rotation.x = moving ? -0.15 : Math.sin(env.time * 6 + c.phase) * 0.12 * (Math.sin(env.time * 0.7) > 0.6 ? 1 : 0.2);
      } else if (c.kind === 'deer') {
        const graze = !moving && Math.sin(env.time * 0.15 + c.phase) > 0.2;
        if (c.neck) c.neck.rotation.x = THREE.MathUtils.lerp(c.neck.rotation.x, graze ? 1.05 : 0.05, dt * 2);
        c.group.position.y += moving ? Math.abs(Math.sin(c.phase * 2.6)) * 0.03 : 0;
      } else if (c.kind === 'crane') {
        if (c.neck) c.neck.rotation.x = moving ? Math.sin(c.phase * 2.6) * 0.14 : Math.sin(env.time * 0.6 + c.phase) * 0.06 + (Math.sin(env.time * 0.2 + c.phase) > 0.7 ? 0.5 : 0);
      } else if (c.kind === 'camel') {
        if (c.neck) c.neck.rotation.x = Math.sin(c.phase * 2.2) * 0.07;
        c.group.position.y += Math.abs(Math.sin(c.phase * 2.2)) * 0.05;
      }
      c.nextCall -= dt;
      if (c.nextCall <= 0) {
        c.nextCall = 25 + this.rng() * 50;
        const snd: AnimalSound = c.kind === 'crane' ? 'crane' : c.kind === 'deer' ? 'deer' : c.kind === 'camel' ? 'bell' : 'rabbit';
        if (c.kind !== 'rabbit' && (c.kind === 'camel' || env.night < 0.7)) this.onCall?.(snd, c.group.position);
      }
      if (c.kind === 'camel' && moving && Math.floor(env.time * 1.2) !== Math.floor((env.time - dt) * 1.2) && this.rng() < 0.35) this.onCall?.('bell', c.group.position);
      const d = c.group.position.distanceTo(env.camPos);
      c.group.visible = d < 90;
    }

    const d = this.dummy;
    if (this.butterflies) {
      const im = this.butterflies;
      this.flyers.b.forEach((f, i) => {
        const t = env.time;
        const x = f.center.x + Math.sin(t * f.fa + f.pa) * f.r + Math.sin(t * f.fa * 2.3) * 0.6;
        const z = f.center.z + Math.cos(t * f.fb + f.pb) * f.r;
        const y = Math.max(this.world.heightAt(x, z) + 0.3, f.center.y) + Math.sin(t * f.fc * 3 + f.pa) * 0.35 + f.height * 0.3;
        const prev = this.prevPos.get(i) ?? new THREE.Vector3(x, y, z);
        const dx = x - prev.x;
        const dz = z - prev.z;
        prev.set(x, y, z);
        this.prevPos.set(i, prev);
        d.position.set(x, y, z);
        if (dx * dx + dz * dz > 1e-8) d.rotation.set(0, Math.atan2(dx, dz), Math.sin(t * 2 + f.pa) * 0.3);
        d.scale.setScalar(day > 0.25 ? 2.0 : 0.0001);
        d.updateMatrix();
        im.setMatrixAt(i, d.matrix);
      });
      im.instanceMatrix.needsUpdate = true;
    }
    if (this.dragonflies) {
      const im = this.dragonflies;
      this.flyers.d.forEach((f, i) => {
        const t = env.time;
        const seg = Math.floor(t * 0.5 + f.pa);
        const jitter = (Math.sin(seg * 12.9) * 0.5 + 0.5) * f.r;
        const x = f.center.x + Math.sin(t * f.fa + f.pa) * jitter + Math.sin(t * 7.0) * 0.02;
        const z = f.center.z + Math.cos(t * f.fb + f.pb) * f.r * 0.8;
        const y = f.center.y + Math.sin(t * f.fc + f.pb) * 0.4 + Math.sin(t * 9) * 0.02;
        const key = 1000 + i;
        const prev = this.prevPos.get(key) ?? new THREE.Vector3(x, y, z);
        const dx = x - prev.x;
        const dz = z - prev.z;
        prev.set(x, y, z);
        this.prevPos.set(key, prev);
        d.position.set(x, y, z);
        if (dx * dx + dz * dz > 1e-9) d.rotation.set(0, Math.atan2(dx, dz), 0);
        d.scale.setScalar(day > 0.25 ? 1 : 0.0001);
        d.updateMatrix();
        im.setMatrixAt(i, d.matrix);
      });
      im.instanceMatrix.needsUpdate = true;
    }
    if (this.birds) {
      const im = this.birds;
      this.birdData.forEach((b, i) => {
        b.angle += b.speed * dt * (1 + env.wind * 0.6);
        const x = Math.cos(b.angle) * b.radius;
        const z = Math.sin(b.angle) * b.radius;
        const y = b.height + Math.sin(env.time * 0.4 + b.bob) * 2;
        d.position.set(x, y, z);
        d.rotation.set(0, -b.angle + (b.speed > 0 ? Math.PI : 0) + Math.PI / 2 * (b.speed > 0 ? 1 : -1) + Math.PI, Math.sin(env.time * 0.5 + b.bob) * 0.25);
        d.scale.setScalar(this.id === 'desert' ? 3.2 : 2.4);
        d.updateMatrix();
        im.setMatrixAt(i, d.matrix);
      });
      im.instanceMatrix.needsUpdate = true;
      im.visible = env.night < 0.85;
      this.birdCall -= dt;
      if (this.birdCall <= 0) {
        this.birdCall = 5 + this.rng() * 12;
        if (day > 0.35) this.onCall?.(this.id === 'snow' || this.id === 'desert' ? 'crow' : 'bird', new THREE.Vector3(Math.cos(this.birdData[0].angle) * 30, 20, Math.sin(this.birdData[0].angle) * 30));
      }
    }
    if (this.fireflies) {
      const pts = this.fireflies;
      (pts.material as THREE.PointsMaterial).opacity = Math.max(0, env.night - 0.15) * 1.1;
      pts.visible = env.night > 0.1;
      if (pts.visible) {
        const pos = pts.geometry.attributes.position as THREE.BufferAttribute;
        const n = pos.count;
        for (let i = 0; i < n; i++) {
          const b = i * 4;
          const ph = this.fireflyBase[b + 3];
          const blink = 0.5 + 0.5 * Math.sin(env.time * 1.6 + ph);
          pos.setXYZ(
            i,
            this.fireflyBase[b] + Math.sin(env.time * 0.35 + ph) * 2.4 + env.wind * 2,
            this.fireflyBase[b + 1] + Math.sin(env.time * 0.6 + ph * 1.3) * 0.7 - (1 - blink) * 0.0,
            this.fireflyBase[b + 2] + Math.cos(env.time * 0.3 + ph * 0.7) * 2.4,
          );
        }
        pos.needsUpdate = true;
      }
    }
  }

  dispose() {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
    });
  }
}

/** 落叶 / 花瓣 / 雪 / 风沙 */
export class Particles {
  readonly object = new THREE.Group();
  private inst: THREE.InstancedMesh | null = null;
  private pts: THREE.Points | null = null;
  private data: { pos: THREE.Vector3; rot: THREE.Vector3; spin: THREE.Vector3; speed: number; phase: number }[] = [];
  private dummy = new THREE.Object3D();
  private ptPos: Float32Array = new Float32Array(0);
  private ptVel: Float32Array = new Float32Array(0);

  constructor(private kind: ParticleKind, quality: QualityLevel, private treeHeight: () => number) {
    const q = quality === 'high' ? 1 : quality === 'medium' ? 0.55 : 0.25;
    const rng = mulberry32(99);
    if (kind === 'snow' || kind === 'sand') {
      const n = Math.round((kind === 'snow' ? 3600 : 1400) * q);
      const geo = new THREE.BufferGeometry();
      this.ptPos = new Float32Array(n * 3);
      this.ptVel = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        this.ptPos[i * 3] = (rng() - 0.5) * 70;
        this.ptPos[i * 3 + 1] = rng() * (kind === 'snow' ? 34 : 4);
        this.ptPos[i * 3 + 2] = (rng() - 0.5) * 70;
        this.ptVel[i * 3] = rng();
        this.ptVel[i * 3 + 1] = 0.6 + rng() * 0.8;
        this.ptVel[i * 3 + 2] = rng();
      }
      geo.setAttribute('position', new THREE.BufferAttribute(this.ptPos, 3));
      const m = new THREE.PointsMaterial({ map: glowTexture(), color: kind === 'snow' ? 0xffffff : 0xe8c48a, size: kind === 'snow' ? 0.16 : 0.09, transparent: true, opacity: kind === 'snow' ? 0.9 : 0.45, depthWrite: false, sizeAttenuation: true, toneMapped: false });
      this.pts = new THREE.Points(geo, m);
      this.pts.frustumCulled = false;
      this.object.add(this.pts);
    } else {
      const n = Math.round(150 * q);
      const isBamboo = kind === 'bamboo';
      const geo = isBamboo ? new THREE.PlaneGeometry(0.05, 0.26) : new THREE.PlaneGeometry(0.16, 0.11);
      const m = new THREE.MeshStandardMaterial({
        color: kind === 'petal' ? '#ffc9dc' : isBamboo ? '#8bb84a' : '#d9a83a',
        side: THREE.DoubleSide,
        roughness: 0.8,
        emissive: kind === 'petal' ? '#ff9bbd' : '#000000',
        emissiveIntensity: 0.12,
      });
      this.inst = new THREE.InstancedMesh(geo, m, n);
      this.inst.frustumCulled = false;
      const col = new THREE.Color();
      for (let i = 0; i < n; i++) {
        this.data.push({
          pos: new THREE.Vector3((rng() - 0.5) * 44, rng() * 14, (rng() - 0.5) * 44),
          rot: new THREE.Vector3(rng() * 6, rng() * 6, rng() * 6),
          spin: new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).multiplyScalar(3),
          speed: 0.35 + rng() * 0.4,
          phase: rng() * 10,
        });
        if (kind === 'petal') col.setHSL(0.94 + rng() * 0.04, 0.6, 0.78 + rng() * 0.15);
        else if (isBamboo) col.setHSL(0.22 + rng() * 0.06, 0.5, 0.45);
        else col.setHSL(0.11 + rng() * 0.04, 0.7, 0.4 + rng() * 0.2);
        this.inst.setColorAt(i, col);
      }
      this.object.add(this.inst);
    }
  }

  update(dt: number, wind: number, time: number, center: THREE.Vector3, night: number) {
    if (this.inst) {
      const span = 26;
      const d = this.dummy;
      this.data.forEach((p, i) => {
        p.pos.y -= p.speed * dt;
        p.pos.x += (0.12 + wind * 2.6) * dt + Math.sin(time * 0.8 + p.phase) * 0.25 * dt;
        p.pos.z += Math.cos(time * 0.6 + p.phase) * 0.35 * dt;
        p.rot.addScaledVector(p.spin, dt * (1 + wind * 2));
        if (p.pos.y < 0.05 || p.pos.x > span) {
          p.pos.set((Math.random() - 0.5) * span * 1.6 - (wind > 0.3 ? 8 : 0), this.treeHeight() * (0.4 + Math.random() * 0.7), (Math.random() - 0.5) * span * 1.6);
        }
        d.position.set(p.pos.x + center.x, p.pos.y, p.pos.z + center.z);
        d.rotation.set(p.rot.x, p.rot.y, p.rot.z);
        d.scale.setScalar(1);
        d.updateMatrix();
        this.inst!.setMatrixAt(i, d.matrix);
      });
      this.inst.instanceMatrix.needsUpdate = true;
    }
    if (this.pts) {
      const snow = this.kind === 'snow';
      const n = this.ptPos.length / 3;
      const pos = this.ptPos;
      const vel = this.ptVel;
      for (let i = 0; i < n; i++) {
        const k = i * 3;
        if (snow) {
          pos[k] += (0.4 + wind * 3 + Math.sin(time * 0.7 + vel[k]) * 0.4) * dt;
          pos[k + 1] -= vel[k + 1] * dt * (0.9 + wind * 0.4);
          pos[k + 2] += Math.cos(time * 0.5 + vel[k + 2] * 6) * 0.3 * dt;
          if (pos[k + 1] < 0) pos[k + 1] = 34;
        } else {
          pos[k] += (2.5 + wind * 9) * vel[k + 1] * dt;
          pos[k + 1] += Math.sin(time * 2 + vel[k] * 30) * 0.3 * dt;
          pos[k + 2] += Math.cos(time + vel[k + 2] * 6) * 0.4 * dt;
          if (pos[k + 1] < 0.05) pos[k + 1] = 0.1;
        }
        if (pos[k] > 35) pos[k] -= 70;
        if (pos[k] < -35) pos[k] += 70;
        if (pos[k + 2] > 35) pos[k + 2] -= 70;
        if (pos[k + 2] < -35) pos[k + 2] += 70;
      }
      (this.pts.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      this.pts.position.set(center.x, snow ? 0 : center.y * 0, center.z);
      (this.pts.material as THREE.PointsMaterial).opacity = (snow ? 0.9 : 0.25 + wind * 0.5) * (1 - night * 0.35);
    }
    void night;
  }
}
