import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { fbmWorld, surface } from './textures';
import { mulberry32 } from './tree';

export interface Glow {
  material: THREE.MeshStandardMaterial;
  day: number;
  night: number;
}

/** 共享材质与夜间发光注册表 */
export class Kit {
  glows: Glow[] = [];
  stone = this.pbr('stone', 1.6, '#ffffff', 0.9);
  stoneDark = this.pbr('stone', 1.2, '#8f8f8a', 0.95);
  rock = this.pbr('rock', 1.2, '#ffffff', 1);
  red = new THREE.MeshStandardMaterial({ color: '#a3241f', roughness: 0.55, metalness: 0.05 });
  redCloth = new THREE.MeshStandardMaterial({ color: '#c8262c', roughness: 0.85, side: THREE.DoubleSide });
  tile = new THREE.MeshStandardMaterial({ color: '#2f3a3d', roughness: 0.5, metalness: 0.15 });
  wall = new THREE.MeshStandardMaterial({ color: '#e9e5da', roughness: 0.95 });
  wood = new THREE.MeshStandardMaterial({ color: '#5b3d26', roughness: 0.8 });
  gold = new THREE.MeshStandardMaterial({ color: '#d6a642', roughness: 0.35, metalness: 0.8 });

  private pbr(kind: 'stone' | 'rock', repeat: number, color: string, rough: number) {
    const t = surface(kind, 512);
    const map = t.map.clone();
    const nm = t.normalMap.clone();
    map.repeat.set(repeat, repeat);
    nm.repeat.set(repeat, repeat);
    map.needsUpdate = nm.needsUpdate = true;
    return new THREE.MeshStandardMaterial({ map, normalMap: nm, color, roughness: rough, normalScale: new THREE.Vector2(1.1, 1.1) });
  }

  glow(color: string, day = 0.15, night = 3): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: day, roughness: 0.6 });
    this.glows.push({ material: m, day, night });
    return m;
  }
}

function mesh(g: THREE.BufferGeometry, m: THREE.Material | THREE.Material[], cast = true) {
  const o = new THREE.Mesh(g, m);
  o.castShadow = cast;
  o.receiveShadow = true;
  return o;
}

export function boxUV(w: number, h: number, d: number) {
  const g = new THREE.BoxGeometry(w, h, d);
  return g;
}

export function stoneLantern(k: Kit): THREE.Group {
  const g = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, y: number) => {
    const m = mesh(geo, mat);
    m.position.y = y;
    g.add(m);
    return m;
  };
  add(new THREE.CylinderGeometry(0.42, 0.5, 0.22, 8), k.stone, 0.11);
  add(new THREE.CylinderGeometry(0.15, 0.19, 0.9, 8), k.stone, 0.67);
  add(new THREE.CylinderGeometry(0.34, 0.2, 0.16, 8), k.stone, 1.2);
  add(new THREE.BoxGeometry(0.44, 0.44, 0.44), k.glow('#ffb45a', 0.2, 3.2), 1.5);
  const frame = add(new THREE.BoxGeometry(0.52, 0.08, 0.52), k.stone, 1.76);
  void frame;
  const roof = add(new THREE.ConeGeometry(0.55, 0.36, 4), k.stoneDark, 1.98);
  roof.rotation.y = Math.PI / 4;
  add(new THREE.SphereGeometry(0.1, 8, 6), k.stone, 2.22);
  return g;
}

export function pavilion(k: Kit): THREE.Group {
  const g = new THREE.Group();
  const base = mesh(new THREE.BoxGeometry(6.4, 0.5, 6.4), k.stone);
  base.position.y = 0.25;
  g.add(base);
  const step = mesh(new THREE.BoxGeometry(7.2, 0.25, 7.2), k.stoneDark);
  step.position.y = 0.12;
  g.add(step);
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const p = mesh(new THREE.CylinderGeometry(0.19, 0.22, 4, 12), k.red);
      p.position.set(sx * 2.5, 2.5, sz * 2.5);
      g.add(p);
      const foot = mesh(new THREE.CylinderGeometry(0.32, 0.34, 0.2, 10), k.stone);
      foot.position.set(sx * 2.5, 0.6, sz * 2.5);
      g.add(foot);
    }
  for (const y of [4.25, 3.4]) {
    for (const sx of [-1, 1]) {
      const b1 = mesh(new THREE.BoxGeometry(0.22, 0.26, 5.5), k.red);
      b1.position.set(sx * 2.5, y, 0);
      g.add(b1);
      const b2 = mesh(new THREE.BoxGeometry(5.5, 0.26, 0.22), k.red);
      b2.position.set(0, y, sx * 2.5);
      g.add(b2);
    }
  }
  const profile = (r: number, h: number) =>
    [new THREE.Vector2(0.001, h), new THREE.Vector2(r * 0.28, h * 0.62), new THREE.Vector2(r * 0.62, h * 0.24), new THREE.Vector2(r, 0)];
  const roofGeo = new THREE.LatheGeometry(profile(5.2, 2.3), 4);
  const roof = mesh(roofGeo, k.tile);
  roof.position.y = 4.4;
  roof.rotation.y = Math.PI / 4;
  g.add(roof);
  const roof2 = mesh(new THREE.LatheGeometry(profile(2.5, 1.5), 4), k.tile);
  roof2.position.y = 6.5;
  roof2.rotation.y = Math.PI / 4;
  g.add(roof2);
  const top = mesh(new THREE.SphereGeometry(0.22, 10, 8), k.gold);
  top.position.y = 8.1;
  g.add(top);
  for (const [sx, sz] of [
    [-2.5, -2.5],
    [2.5, -2.5],
    [-2.5, 2.5],
    [2.5, 2.5],
  ]) {
    const l = mesh(new THREE.SphereGeometry(0.32, 12, 10), k.glow('#ff3b2a', 0.35, 3.6), false);
    l.scale.y = 1.25;
    l.position.set(sx * 1.08, 3.0, sz * 1.08);
    g.add(l);
    const tassel = mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.3, 4), k.gold, false);
    tassel.position.set(sx * 1.08, 2.6, sz * 1.08);
    g.add(tassel);
  }
  return g;
}

export function paifang(k: Kit): THREE.Group {
  const g = new THREE.Group();
  const cols = [-3.6, -1.2, 1.2, 3.6];
  cols.forEach((x, i) => {
    const h = i === 0 || i === 3 ? 4.4 : 5.4;
    const p = mesh(new THREE.CylinderGeometry(0.22, 0.26, h, 12), k.red);
    p.position.set(x, h / 2, 0);
    g.add(p);
    const foot = mesh(new THREE.BoxGeometry(0.8, 0.5, 0.8), k.stone);
    foot.position.set(x, 0.25, 0);
    g.add(foot);
  });
  const beam = mesh(new THREE.BoxGeometry(8.4, 0.4, 0.5), k.red);
  beam.position.y = 4.2;
  g.add(beam);
  const beam2 = mesh(new THREE.BoxGeometry(4.2, 0.4, 0.5), k.red);
  beam2.position.y = 5.3;
  g.add(beam2);
  const plaqueTex = calligraphyTexture('祈福', '#e6c36a', '#3a0f0d');
  const plaque = mesh(new THREE.BoxGeometry(2.0, 0.9, 0.12), new THREE.MeshStandardMaterial({ map: plaqueTex, roughness: 0.6 }));
  plaque.position.y = 4.9;
  g.add(plaque);
  const mainRoof = mesh(new THREE.LatheGeometry([new THREE.Vector2(0.001, 1.1), new THREE.Vector2(1.0, 0.7), new THREE.Vector2(2.4, 0.2), new THREE.Vector2(3.1, 0)], 4), k.tile);
  mainRoof.scale.set(1.45, 1, 0.42);
  mainRoof.rotation.y = Math.PI / 4;
  mainRoof.position.y = 5.55;
  g.add(mainRoof);
  for (const s of [-1, 1]) {
    const r = mesh(new THREE.LatheGeometry([new THREE.Vector2(0.001, 0.8), new THREE.Vector2(0.8, 0.5), new THREE.Vector2(1.7, 0.15), new THREE.Vector2(2.2, 0)], 4), k.tile);
    r.scale.set(1.0, 1, 0.42);
    r.rotation.y = Math.PI / 4;
    r.position.set(s * 2.4, 4.6, 0);
    g.add(r);
  }
  return g;
}

export function calligraphyTexture(text: string, bg: string, ink: string, vertical = false): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = vertical ? 256 : 512;
  c.height = vertical ? 512 : 256;
  const g = c.getContext('2d')!;
  g.fillStyle = bg;
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = ink;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const font = '"STKaiti","KaiTi","Kaiti SC","楷体","Noto Serif SC","Songti SC","WenQuanYi Micro Hei",serif';
  const chars = [...text];
  if (vertical) {
    const size = Math.min(150, (c.height - 40) / chars.length);
    g.font = `900 ${size}px ${font}`;
    chars.forEach((ch, i) => g.fillText(ch, c.width / 2, 30 + size * (i + 0.5)));
  } else {
    const size = Math.min(190, (c.width - 40) / chars.length);
    g.font = `900 ${size}px ${font}`;
    chars.forEach((ch, i) => g.fillText(ch, c.width / 2 + (i - (chars.length - 1) / 2) * size, c.height / 2 + 6));
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function stele(k: Kit): THREE.Group {
  const g = new THREE.Group();
  const base = mesh(new THREE.BoxGeometry(1.7, 0.4, 0.9), k.stoneDark);
  base.position.y = 0.2;
  g.add(base);
  const tex = calligraphyTexture('祈福古树', '#8c8b84', '#1c1b18', true);
  const faceMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 });
  const slab = mesh(new THREE.BoxGeometry(1.2, 2.6, 0.34), [k.stone, k.stone, k.stone, k.stone, faceMat, faceMat]);
  slab.position.y = 1.7;
  g.add(slab);
  const cap = mesh(new THREE.ConeGeometry(0.95, 0.5, 4), k.stoneDark);
  cap.rotation.y = Math.PI / 4;
  cap.scale.z = 0.4;
  cap.position.y = 3.25;
  g.add(cap);
  return g;
}

/** 石台、台阶与石板路 */
export function terrace(k: Kit, radius: number, height: number, pathLength: number, rng: () => number): THREE.Group {
  const g = new THREE.Group();
  const paving = mesh(new THREE.CylinderGeometry(radius, radius + 0.3, height, 64), k.stone);
  paving.position.y = height / 2 - 0.02;
  g.add(paving);
  const ring = mesh(new THREE.CylinderGeometry(radius + 0.9, radius + 1.1, height * 0.5, 64), k.stoneDark);
  ring.position.y = height * 0.25 - 0.03;
  g.add(ring);
  const curb = new THREE.InstancedMesh(new THREE.BoxGeometry(1.15, 0.28, 0.5), k.stoneDark, 44);
  curb.castShadow = curb.receiveShadow = true;
  const m = new THREE.Matrix4();
  for (let i = 0; i < 44; i++) {
    const a = (i / 44) * Math.PI * 2;
    m.compose(
      new THREE.Vector3(Math.cos(a) * (radius - 0.1), height + 0.1, Math.sin(a) * (radius - 0.1)),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -a + Math.PI / 2, 0)),
      new THREE.Vector3(1, 1, 1),
    );
    curb.setMatrixAt(i, m);
  }
  g.add(curb);

  const stepN = 6;
  for (let i = 0; i < stepN; i++) {
    const w = 3.4 + i * 0.12;
    const s = mesh(new THREE.BoxGeometry(w, height / stepN + 0.02, 0.9), k.stone);
    s.position.set(0, height - (i + 0.5) * (height / stepN) + 0.005, radius + 0.35 + i * 0.9);
    g.add(s);
  }
  const slabs = Math.floor(pathLength / 1.5);
  const slabMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.14, 1), k.stoneDark, slabs * 2);
  slabMesh.receiveShadow = true;
  slabMesh.castShadow = true;
  let n = 0;
  for (let i = 0; i < slabs; i++) {
    const z = radius + stepN * 0.9 + 0.6 + i * 1.5;
    const x = Math.sin(i * 0.22) * 1.4;
    for (const dx of [-0.85, 0.85]) {
      m.compose(
        new THREE.Vector3(x + dx + (rng() - 0.5) * 0.15, 0.03, z + (rng() - 0.5) * 0.15),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, (rng() - 0.5) * 0.25, 0)),
        new THREE.Vector3(1.55 + rng() * 0.15, 1, 1.3 + rng() * 0.15),
      );
      slabMesh.setMatrixAt(n++, m);
    }
  }
  slabMesh.count = n;
  g.add(slabMesh);
  return g;
}

export function rockGeometry(seed: number, detail = 3): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const pos = g.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = fbmWorld(v.x * 1.7 + seed, v.z * 1.7 + v.y * 1.3, 4, seed);
    const ridge = 1 - Math.abs(fbmWorld(v.x * 3 + seed, v.y * 3 + v.z * 3, 3, seed + 9) * 2 - 1);
    v.multiplyScalar(0.72 + n * 0.55 + ridge * 0.12);
    pos.setXYZ(i, v.x, v.y * 0.75, v.z);
    uv[i * 2] = v.x * 0.6 + v.y * 0.2;
    uv[i * 2 + 1] = v.z * 0.6 + v.y * 0.5;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

export function scatterRocks(k: Kit, count: number, place: (i: number, rng: () => number) => { x: number; z: number; y: number; s: number } | null, seed: number, mat?: THREE.Material): THREE.InstancedMesh {
  const variants = [rockGeometry(seed, 3), rockGeometry(seed + 5, 3), rockGeometry(seed + 11, 2)];
  const rng = mulberry32(seed);
  const meshes: THREE.Matrix4[][] = [[], [], []];
  for (let i = 0; i < count; i++) {
    const p = place(i, rng);
    if (!p) continue;
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(p.x, p.y + p.s * 0.15, p.z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rng() * 0.4, rng() * 6.28, rng() * 0.4)),
      new THREE.Vector3(p.s * (0.9 + rng() * 0.6), p.s * (0.7 + rng() * 0.5), p.s * (0.9 + rng() * 0.6)),
    );
    meshes[Math.floor(rng() * 3)].push(m);
  }
  const group = new THREE.Group();
  variants.forEach((geo, vi) => {
    const im = new THREE.InstancedMesh(geo, mat ?? k.rock, Math.max(1, meshes[vi].length));
    meshes[vi].forEach((m, i) => im.setMatrixAt(i, m));
    im.count = meshes[vi].length;
    im.castShadow = im.receiveShadow = true;
    group.add(im);
  });
  return group as unknown as THREE.InstancedMesh;
}

/** 松树：树干 + 多层锥形松针，可带积雪 */
export function pineGeometry(seed: number, snowy: boolean): THREE.BufferGeometry {
  const rng = mulberry32(seed);
  const parts: THREE.BufferGeometry[] = [];
  const colorize = (g: THREE.BufferGeometry, base: THREE.Color, snow: boolean) => {
    const n = g.attributes.position.count;
    const nor = g.attributes.normal;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const isSnow = snow && nor.getY(i) > 0.35;
      const c = isSnow ? new THREE.Color('#f4f8ff') : base.clone().multiplyScalar(0.8 + rng() * 0.35);
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  };
  const trunk = new THREE.CylinderGeometry(0.16, 0.34, 6, 7, 1, false).toNonIndexed();
  trunk.translate(0, 3, 0);
  parts.push(colorize(trunk, new THREE.Color('#4a3424'), false));
  const tiers = 6;
  for (let i = 0; i < tiers; i++) {
    const t = i / tiers;
    const r = (2.6 - t * 1.9) * (0.9 + rng() * 0.2);
    const h = 2.2 - t * 0.7;
    const cone = new THREE.ConeGeometry(r, h, 9, 1).toNonIndexed();
    const pos = cone.attributes.position;
    for (let k = 0; k < pos.count; k++) {
      const jitter = 1 + Math.sin(Math.atan2(pos.getZ(k), pos.getX(k)) * 5 + i) * 0.12;
      pos.setXYZ(k, pos.getX(k) * jitter, pos.getY(k), pos.getZ(k) * jitter);
    }
    cone.computeVertexNormals();
    cone.translate(0, 2.6 + t * 4.4, 0);
    parts.push(colorize(cone, new THREE.Color('#1f4a2c'), snowy));
  }
  return mergeGeometries(parts, false)!;
}

export function bambooStalkGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const segs = 9;
  const segH = 1.6;
  const col = (g: THREE.BufferGeometry, c: THREE.Color) => {
    const n = g.attributes.position.count;
    const a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      a[i * 3] = c.r;
      a[i * 3 + 1] = c.g;
      a[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    return g;
  };
  for (let i = 0; i < segs; i++) {
    const r = 0.11 - i * 0.006;
    const s = new THREE.CylinderGeometry(r * 0.9, r, segH, 7, 1, true).toNonIndexed();
    s.translate(0, i * segH + segH / 2, 0);
    parts.push(col(s, new THREE.Color().setHSL(0.24, 0.45, 0.32 + (i % 2) * 0.03)));
    const ring = new THREE.CylinderGeometry(r * 1.25, r * 1.25, 0.08, 7).toNonIndexed();
    ring.translate(0, i * segH, 0);
    parts.push(col(ring, new THREE.Color().setHSL(0.2, 0.4, 0.22)));
  }
  return mergeGeometries(parts, false)!;
}

/** 民居：白墙黛瓦 */
export function house(k: Kit, w: number, d: number, h: number): THREE.Group {
  const g = new THREE.Group();
  const body = mesh(new THREE.BoxGeometry(w, h, d), k.wall);
  body.position.y = h / 2;
  g.add(body);
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2 - 0.5, 0);
  shape.lineTo(w / 2 + 0.5, 0);
  shape.quadraticCurveTo(w * 0.28, h * 0.12, 0.0, h * 0.42);
  shape.quadraticCurveTo(-w * 0.28, h * 0.12, -w / 2 - 0.5, 0);
  const roofGeo = new THREE.ExtrudeGeometry(shape, { depth: d + 1.0, bevelEnabled: false });
  roofGeo.translate(0, 0, -d / 2 - 0.5);
  const roof = mesh(roofGeo, k.tile);
  roof.position.y = h;
  g.add(roof);
  const beam = mesh(new THREE.BoxGeometry(w + 0.2, 0.25, 0.3), k.wood);
  beam.position.set(0, h * 0.62, d / 2 + 0.05);
  g.add(beam);
  for (let i = 0; i < 2; i++) {
    const win = mesh(new THREE.BoxGeometry(w * 0.16, h * 0.28, 0.08), k.wood);
    win.position.set((i - 0.5) * w * 0.4, h * 0.5, d / 2 + 0.02);
    g.add(win);
  }
  const lamp = mesh(new THREE.SphereGeometry(0.18, 10, 8), k.glow('#ff5a3a', 0.35, 3.4), false);
  lamp.scale.y = 1.2;
  lamp.position.set(w * 0.42, h * 0.58, d / 2 + 0.3);
  g.add(lamp);
  return g;
}

export function archBridge(k: Kit, span: number, width: number): THREE.Group {
  const g = new THREE.Group();
  const shape = new THREE.Shape();
  const half = span / 2;
  shape.moveTo(-half - 1, 0);
  shape.lineTo(half + 1, 0);
  shape.lineTo(half + 0.6, 0.9);
  shape.absarc(0, 0.9, half * 0.98, 0.0, Math.PI, false);
  shape.lineTo(-half - 1, 0);
  const hole = new THREE.Path();
  hole.absarc(0, 0.0, half * 0.72, 0, Math.PI, false);
  hole.lineTo(half * 0.72, 0);
  shape.holes.push(hole);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false, curveSegments: 24 });
  geo.translate(0, 0, -width / 2);
  const body = mesh(geo, k.stone);
  g.add(body);
  for (const s of [-1, 1]) {
    const rail = mesh(new THREE.BoxGeometry(span * 1.02, 0.35, 0.22), k.stoneDark);
    rail.position.set(0, half + 1.0, s * (width / 2 - 0.1));
    g.add(rail);
  }
  return g;
}

export function wupengBoat(k: Kit): THREE.Group {
  const g = new THREE.Group();
  const hull = mesh(new THREE.CapsuleGeometry(0.55, 4.6, 6, 12), k.wood);
  hull.rotation.z = Math.PI / 2;
  hull.scale.set(1, 1, 0.55);
  hull.position.y = 0.1;
  g.add(hull);
  const canopyGeo = new THREE.CylinderGeometry(0.62, 0.62, 2.4, 12, 1, true, 0, Math.PI);
  const canopy = mesh(canopyGeo, new THREE.MeshStandardMaterial({ color: '#2d2a28', roughness: 0.9, side: THREE.DoubleSide }));
  canopy.rotation.z = Math.PI / 2;
  canopy.rotation.y = Math.PI;
  canopy.position.set(0, 0.5, 0);
  g.add(canopy);
  const lamp = mesh(new THREE.SphereGeometry(0.16, 10, 8), k.glow('#ff8a3a', 0.4, 3.6), false);
  lamp.position.set(1.7, 0.85, 0);
  g.add(lamp);
  const pole = mesh(new THREE.CylinderGeometry(0.04, 0.04, 3.4, 5), k.wood);
  pole.rotation.z = 0.5;
  pole.position.set(-2.4, 0.9, 0.55);
  g.add(pole);
  return g;
}

export function tagPlane(): THREE.PlaneGeometry {
  return new THREE.PlaneGeometry(1, 1);
}
