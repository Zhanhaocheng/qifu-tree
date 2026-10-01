import * as THREE from 'three';
import { glowTexture } from './sky';

/** 与 src/fx.ts 中 `qifu:fx` 事件契约对应的最小子集（场景侧不依赖 UI 代码） */
export type FxKind = 'coins' | 'petals' | 'lantern' | 'sparkle';
export interface FxDetail {
  type: 'payment' | 'terrain-unlock' | 'terrain-switch' | 'pray' | 'checkin';
  intensity?: number;
  particles?: FxKind[];
  palette?: string[];
  count?: number;
  origin?: 'tree' | 'tag' | 'terrain' | 'screen';
  tagId?: number | null;
}

export interface FxHost {
  camera: THREE.Camera;
  center: () => THREE.Vector3;
  treeTop: () => THREE.Vector3;
  crownRadius: () => number;
  tagPos: (id: number) => THREE.Vector3 | null;
  groundY: (x: number, z: number) => number;
  quality: () => 'low' | 'medium' | 'high';
}

interface P {
  alive: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  max: number;
  size: number;
  spin: number;
  rot: number;
  phase: number;
  color: THREE.Color;
}

const mk = (): P => ({ alive: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), life: 0, max: 1, size: 1, spin: 0, rot: 0, phase: 0, color: new THREE.Color() });

const GLOW_VERT = /* glsl */ `
  attribute vec3 aColor; attribute float aSize; attribute float aAlpha; varying vec3 vC; varying float vA;
  void main() {
    vC = aColor; vA = aAlpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * (320.0 / max(-mv.z, 0.5));
    gl_Position = projectionMatrix * mv;
  }
`;
const GLOW_FRAG = /* glsl */ `
  uniform sampler2D uMap; varying vec3 vC; varying float vA;
  void main() { vec4 t = texture2D(uMap, gl_PointCoord); gl_FragColor = vec4(vC * (1.0 + t.a * 1.4), t.a * vA); }
`;

export class Fx3D {
  readonly group = new THREE.Group();
  private coins: THREE.InstancedMesh;
  private petals: THREE.InstancedMesh;
  private lanterns: THREE.InstancedMesh;
  private glow: THREE.Points;
  private ring: THREE.Mesh;
  private ringT = 99;
  private cp: P[] = [];
  private pp: P[] = [];
  private lp: P[] = [];
  private gp: P[] = [];
  private dummy = new THREE.Object3D();
  private tmp = new THREE.Vector3();
  private reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  private listener = (e: Event) => this.onEvent((e as CustomEvent<FxDetail>).detail);

  constructor(private host: FxHost) {
    const MC = 90;
    const MP = 140;
    const ML = 28;
    const MG = 520;
    for (let i = 0; i < MC; i++) this.cp.push(mk());
    for (let i = 0; i < MP; i++) this.pp.push(mk());
    for (let i = 0; i < ML; i++) this.lp.push(mk());
    for (let i = 0; i < MG; i++) this.gp.push(mk());

    const coinGeo = new THREE.CylinderGeometry(0.17, 0.17, 0.035, 18).rotateZ(Math.PI / 2);
    this.coins = new THREE.InstancedMesh(coinGeo, new THREE.MeshStandardMaterial({ color: '#f2c14e', metalness: 0.9, roughness: 0.28, emissive: '#8a5a10', emissiveIntensity: 0.55 }), MC);
    const petalGeo = new THREE.PlaneGeometry(0.16, 0.24, 1, 2);
    const pp = petalGeo.attributes.position;
    for (let i = 0; i < pp.count; i++) pp.setZ(i, Math.pow(pp.getY(i) * 4, 2) * 0.012);
    petalGeo.computeVertexNormals();
    this.petals = new THREE.InstancedMesh(petalGeo, new THREE.MeshStandardMaterial({ color: '#ffffff', side: THREE.DoubleSide, roughness: 0.7, emissive: '#ff9bbd', emissiveIntensity: 0.18 }), MP);
    const lanternGeo = new THREE.SphereGeometry(0.2, 12, 8).scale(1, 1.25, 1);
    this.lanterns = new THREE.InstancedMesh(lanternGeo, new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }), ML);
    for (const m of [this.coins, this.petals, this.lanterns]) {
      m.frustumCulled = false;
      m.count = 0;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(m);
    }
    this.coins.castShadow = true;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MG * 3), 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(MG * 3), 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(MG), 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(MG), 1));
    this.glow = new THREE.Points(
      geo,
      new THREE.ShaderMaterial({ uniforms: { uMap: { value: glowTexture() } }, vertexShader: GLOW_VERT, fragmentShader: GLOW_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }),
    );
    this.glow.frustumCulled = false;
    this.group.add(this.glow);

    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.92, 1, 96).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#fff3c4', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide }),
    );
    this.ring.visible = false;
    this.ring.frustumCulled = false;
    this.group.add(this.ring);

    window.addEventListener('qifu:fx', this.listener);
  }

  dispose() {
    window.removeEventListener('qifu:fx', this.listener);
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
    });
  }

  private take(pool: P[]): P | null {
    for (const p of pool) if (!p.alive) return p;
    return null;
  }

  private onEvent(d: FxDetail) {
    if (!d || this.reduce) return;
    const q = this.host.quality();
    const qk = q === 'high' ? 1 : q === 'medium' ? 0.7 : 0.45;
    const inten = THREE.MathUtils.clamp(d.intensity ?? 2, 1, 3);
    const palette = (d.palette?.length ? d.palette : ['#ffd76a', '#fff3c4']).map((c) => new THREE.Color(c));
    const total = Math.max(8, Math.round((d.count ?? 30) * qk * (0.75 + inten * 0.25)));
    const kinds = d.particles?.length ? d.particles : (['sparkle'] as FxKind[]);

    let origin: THREE.Vector3;
    let mode: 'rain' | 'burst' | 'field' | 'screen' = 'rain';
    const tagPos = d.type === 'pray' && d.tagId != null ? this.host.tagPos(d.tagId) : null;
    if (d.origin === 'tag' && tagPos) {
      origin = tagPos;
      mode = 'burst';
    } else if (d.origin === 'terrain') {
      origin = this.host.center().clone();
      mode = 'field';
    } else if (d.origin === 'screen') {
      origin = this.host.camera.getWorldDirection(this.tmp).clone().multiplyScalar(9).add(this.host.camera.position);
      mode = 'screen';
    } else {
      origin = this.host.treeTop().clone();
      mode = 'rain';
    }

    // pray 已由 scene.spawnBurst(tagId) 播放过火花，这里只补充金币/花瓣/灯火，避免重复
    const sparkAlready = d.type === 'pray' && !!tagPos;
    kinds.forEach((kind, i) => {
      if (kind === 'sparkle' && sparkAlready) return;
      const share = i === 0 ? 0.6 : 0.4 / Math.max(1, kinds.length - 1);
      this.spawn(kind, Math.round(total * share), origin, mode, palette, inten);
    });
    if (d.type === 'terrain-unlock' || d.type === 'terrain-switch') {
      this.ringT = 0;
      this.ring.position.set(origin.x, this.host.groundY(origin.x, origin.z) + 0.15, origin.z);
      (this.ring.material as THREE.MeshBasicMaterial).color.copy(palette[0]);
      this.ring.visible = true;
    }
  }

  private spawn(kind: FxKind, n: number, origin: THREE.Vector3, mode: 'rain' | 'burst' | 'field' | 'screen', palette: THREE.Color[], inten: number) {
    const crown = this.host.crownRadius();
    for (let i = 0; i < n; i++) {
      const pool = kind === 'coins' ? this.cp : kind === 'petals' ? this.pp : kind === 'lantern' ? this.lp : this.gp;
      const p = this.take(pool);
      if (!p) break;
      p.alive = true;
      p.phase = Math.random() * 10;
      p.rot = Math.random() * 6;
      p.spin = (Math.random() - 0.5) * 8;
      p.color.copy(palette[i % palette.length]);
      const a = Math.random() * Math.PI * 2;
      if (mode === 'rain') {
        const r = Math.sqrt(Math.random()) * Math.max(2, crown * 0.55);
        p.pos.set(origin.x + Math.cos(a) * r, origin.y + 1 + Math.random() * 4, origin.z + Math.sin(a) * r);
        p.vel.set((Math.random() - 0.5) * 2, 2 + Math.random() * 3, (Math.random() - 0.5) * 2);
      } else if (mode === 'burst') {
        p.pos.copy(origin);
        const sp = 1.2 + Math.random() * 2.6 * (0.7 + inten * 0.2);
        p.vel.set(Math.cos(a) * sp, 1.5 + Math.random() * 3, Math.sin(a) * sp);
      } else if (mode === 'field') {
        const r = 3 + Math.sqrt(Math.random()) * 26;
        const x = origin.x + Math.cos(a) * r;
        const z = origin.z + Math.sin(a) * r;
        p.pos.set(x, this.host.groundY(x, z) + 0.2, z);
        p.vel.set((Math.random() - 0.5) * 0.8, 1.4 + Math.random() * 2.4, (Math.random() - 0.5) * 0.8);
      } else {
        const r = Math.random() * 4;
        p.pos.set(origin.x + Math.cos(a) * r, origin.y + (Math.random() - 0.3) * 3, origin.z + Math.sin(a) * r);
        p.vel.set((Math.random() - 0.5) * 2, 2 + Math.random() * 3, (Math.random() - 0.5) * 2);
      }
      if (kind === 'coins') {
        p.max = p.life = 3.2 + Math.random() * 1.6;
        p.size = 0.8 + Math.random() * 0.5;
      } else if (kind === 'petals') {
        p.max = p.life = 4.5 + Math.random() * 3;
        p.size = 0.9 + Math.random() * 0.8;
        p.vel.multiplyScalar(0.6);
      } else if (kind === 'lantern') {
        p.max = p.life = 5 + Math.random() * 3;
        p.size = 0.7 + Math.random() * 0.6;
        p.vel.set((Math.random() - 0.5) * 0.8, 0.9 + Math.random() * 0.8, (Math.random() - 0.5) * 0.8);
      } else {
        p.max = p.life = 1.2 + Math.random() * 1.4;
        p.size = 0.5 + Math.random() * 0.7;
        p.vel.multiplyScalar(0.7);
      }
    }
  }

  update(dt: number, wind: number, time: number) {
    const d = this.dummy;
    let n = 0;
    for (const p of this.cp) {
      if (!p.alive) continue;
      p.life -= dt;
      const gy = this.host.groundY(p.pos.x, p.pos.z) + 0.18;
      p.vel.y -= 9 * dt;
      p.pos.addScaledVector(p.vel, dt);
      if (p.pos.y < gy) {
        p.pos.y = gy;
        p.vel.y = Math.abs(p.vel.y) * 0.35;
        p.vel.x *= 0.6;
        p.vel.z *= 0.6;
        if (p.vel.y < 0.6) p.vel.y = 0;
        p.spin *= 0.6;
      }
      if (p.life <= 0) {
        p.alive = false;
        continue;
      }
      p.rot += p.spin * dt * 3;
      d.position.copy(p.pos);
      d.rotation.set(p.rot, p.phase, p.vel.y > 0 ? p.rot * 0.5 : 0);
      d.scale.setScalar(p.size * Math.min(1, p.life * 2));
      d.updateMatrix();
      this.coins.setMatrixAt(n++, d.matrix);
    }
    this.coins.count = n;
    this.coins.instanceMatrix.needsUpdate = true;

    n = 0;
    for (const p of this.pp) {
      if (!p.alive) continue;
      p.life -= dt;
      p.vel.y += (-0.8 - p.vel.y) * Math.min(1, dt * 1.2);
      p.vel.x += (wind * 2.2 + Math.sin(time * 1.3 + p.phase) * 0.8 - p.vel.x) * Math.min(1, dt * 1.4);
      p.vel.z += (Math.cos(time * 1.1 + p.phase) * 0.7 - p.vel.z) * Math.min(1, dt * 1.4);
      p.pos.addScaledVector(p.vel, dt);
      const gy = this.host.groundY(p.pos.x, p.pos.z) + 0.04;
      if (p.pos.y < gy) {
        p.pos.y = gy;
        p.vel.set(0, 0, 0);
        p.life = Math.min(p.life, 1.2);
      }
      if (p.life <= 0) {
        p.alive = false;
        continue;
      }
      p.rot += p.spin * dt;
      d.position.copy(p.pos);
      d.rotation.set(p.rot * 0.7, p.rot, Math.sin(time * 2 + p.phase) * 0.8);
      d.scale.setScalar(p.size * Math.min(1, p.life * 1.5));
      d.updateMatrix();
      this.petals.setMatrixAt(n, d.matrix);
      this.petals.setColorAt(n, p.color);
      n++;
    }
    this.petals.count = n;
    this.petals.instanceMatrix.needsUpdate = true;
    if (this.petals.instanceColor) this.petals.instanceColor.needsUpdate = true;

    n = 0;
    for (const p of this.lp) {
      if (!p.alive) continue;
      p.life -= dt;
      p.pos.x += (p.vel.x + wind * 0.8 + Math.sin(time * 0.8 + p.phase) * 0.3) * dt;
      p.pos.y += p.vel.y * dt;
      p.pos.z += (p.vel.z + Math.cos(time * 0.7 + p.phase) * 0.3) * dt;
      if (p.life <= 0) {
        p.alive = false;
        continue;
      }
      const fade = Math.min(1, p.life * 1.2, (p.max - p.life) * 2);
      const flick = 0.85 + 0.15 * Math.sin(time * 9 + p.phase * 3);
      d.position.copy(p.pos);
      d.rotation.set(0, 0, 0);
      d.scale.setScalar(p.size * fade);
      d.updateMatrix();
      this.lanterns.setMatrixAt(n, d.matrix);
      this.lanterns.setColorAt(n, this.tmp2(p.color, 2.2 * flick));
      n++;
    }
    this.lanterns.count = n;
    this.lanterns.instanceMatrix.needsUpdate = true;
    if (this.lanterns.instanceColor) this.lanterns.instanceColor.needsUpdate = true;

    const pos = this.glow.geometry.attributes.position as THREE.BufferAttribute;
    const col = this.glow.geometry.attributes.aColor as THREE.BufferAttribute;
    const size = this.glow.geometry.attributes.aSize as THREE.BufferAttribute;
    const alpha = this.glow.geometry.attributes.aAlpha as THREE.BufferAttribute;
    let gi = 0;
    const halo = (p: P, s: number, a: number) => {
      pos.setXYZ(gi, p.pos.x, p.pos.y, p.pos.z);
      col.setXYZ(gi, p.color.r, p.color.g, p.color.b);
      size.setX(gi, s);
      alpha.setX(gi, a);
      gi++;
    };
    for (const p of this.gp) {
      if (!p.alive) continue;
      p.life -= dt;
      p.vel.y -= 0.6 * dt;
      p.pos.addScaledVector(p.vel, dt);
      if (p.life <= 0) {
        p.alive = false;
        continue;
      }
      const k = p.life / p.max;
      halo(p, p.size * (0.6 + k) * 0.55, Math.min(1, k * 2.4) * (0.6 + 0.4 * Math.sin(time * 18 + p.phase * 5)));
    }
    for (const p of this.lp) {
      if (p.alive && gi < pos.count) halo(p, 2.4 * p.size, 0.55 * Math.min(1, p.life, (p.max - p.life) * 2));
    }
    for (let i = gi; i < pos.count; i++) alpha.setX(i, 0);
    pos.needsUpdate = col.needsUpdate = size.needsUpdate = alpha.needsUpdate = true;

    if (this.ring.visible) {
      this.ringT += dt;
      const k = this.ringT / 2.2;
      this.ring.scale.setScalar(2 + k * 34);
      (this.ring.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.9 * (1 - k));
      if (k >= 1) this.ring.visible = false;
    }
  }

  private c2 = new THREE.Color();
  private tmp2(c: THREE.Color, k: number) {
    return this.c2.copy(c).multiplyScalar(k);
  }
}
