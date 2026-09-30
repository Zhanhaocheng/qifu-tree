import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ITEMS, type ItemId, type PrayerTag } from '../../shared/game';
import { STAGE_PARAMS, buildTree, mulberry32, type Anchor } from './tree';
import { createSkyDome, createStars, glowTexture, makeSkyState, sampleSky } from './sky';

export type Quality = 'low' | 'medium' | 'high';
const QUALITIES: Quality[] = ['low', 'medium', 'high'];
const LEAF_BUDGET: Record<Quality, number> = { low: 0.35, medium: 0.6, high: 1 };
const MAX_TAGS = 300;
const MAX_PETALS = 140;
const MAX_FIREFLIES = 60;
const MAX_SPARKS = 240;

interface TagInst {
  tag: PrayerTag;
  anchor: THREE.Vector3;
  length: number;
  phase: number;
  spawn: number;
}

export interface SceneEvents {
  onPick?: (tag: PrayerTag | null, x: number, y: number) => void;
  onFrame?: (state: { wind: number; night: number; hour: number }) => void;
  onQuality?: (q: Quality) => void;
}

function addWind(material: THREE.MeshStandardMaterial, uniforms: { uTime: { value: number }; uWind: { value: number }; uGrow: { value: number } }, mode: 'leaf' | 'grass') {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime; uniform float uWind; uniform float uGrow;')
      .replace(
        '#include <project_vertex>',
        mode === 'leaf'
          ? /* glsl */ `
        vec4 mvPosition = vec4(transformed * uGrow, 1.0);
        #ifdef USE_INSTANCING
          vec3 ip = vec3(instanceMatrix[3]);
          mvPosition = instanceMatrix * mvPosition;
          float ph = ip.x * 0.7 + ip.z * 0.9 + ip.y * 0.4;
          float amp = 0.04 + uWind * 0.32;
          mvPosition.xyz += vec3(sin(uTime * 2.1 + ph), sin(uTime * 1.7 + ph * 1.3) * 0.4, cos(uTime * 1.9 + ph * 0.8) * 0.6) * amp * 0.4
            + vec3(uWind * 0.3 * (0.5 + 0.5 * sin(uTime * 3.0 + ph)), 0.0, 0.0);
        #endif
        mvPosition = modelViewMatrix * mvPosition;
        gl_Position = projectionMatrix * mvPosition;`
          : /* glsl */ `
        vec4 mvPosition = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          vec3 ip = vec3(instanceMatrix[3]);
          mvPosition = instanceMatrix * mvPosition;
          float h = max(position.y, 0.0);
          mvPosition.x += sin(uTime * 2.0 + ip.x * 1.7 + ip.z) * h * (0.15 + uWind * 0.9);
          mvPosition.z += cos(uTime * 1.6 + ip.z * 1.3) * h * 0.1 * (0.3 + uWind);
        #endif
        mvPosition = modelViewMatrix * mvPosition;
        gl_Position = projectionMatrix * mvPosition;`,
      );
  };
}

function makeTagGeometry(id: ItemId): THREE.BufferGeometry {
  switch (id) {
    case 'wood': {
      const g = new THREE.BoxGeometry(0.3, 0.46, 0.04);
      g.translate(0, -0.23, 0);
      return g;
    }
    case 'ribbon': {
      const g = new THREE.PlaneGeometry(0.1, 0.95, 1, 4);
      g.translate(0, -0.475, 0);
      const pos = g.attributes.position;
      for (let i = 0; i < pos.count; i++) pos.setZ(i, Math.sin(pos.getY(i) * 7) * 0.03);
      g.computeVertexNormals();
      return g;
    }
    case 'gold': {
      const g = new THREE.BoxGeometry(0.32, 0.46, 0.035);
      g.translate(0, -0.25, 0);
      return g;
    }
    case 'lantern': {
      const body = new THREE.SphereGeometry(0.17, 14, 10);
      body.scale(1, 1.25, 1);
      body.translate(0, -0.26, 0);
      const cap = new THREE.CylinderGeometry(0.06, 0.08, 0.05, 8);
      cap.translate(0, -0.03, 0);
      const tassel = new THREE.CylinderGeometry(0.008, 0.008, 0.22, 4);
      tassel.translate(0, -0.6, 0);
      return mergeGeometries([body.toNonIndexed(), cap.toNonIndexed(), tassel.toNonIndexed()])!;
    }
    case 'lotus': {
      const parts: THREE.BufferGeometry[] = [];
      for (let ring = 0; ring < 2; ring++) {
        const n = ring === 0 ? 8 : 6;
        for (let i = 0; i < n; i++) {
          const petal = new THREE.SphereGeometry(0.1, 8, 6);
          petal.scale(0.55, 1.2, 0.3);
          petal.translate(0, 0.11, 0);
          petal.rotateX(ring === 0 ? 0.95 : 0.45);
          petal.rotateY((i / n) * Math.PI * 2 + ring * 0.4);
          petal.translate(0, -0.3 + ring * 0.04, 0);
          parts.push(petal.toNonIndexed());
        }
      }
      const cap = new THREE.CylinderGeometry(0.01, 0.01, 0.14, 4);
      cap.translate(0, -0.07, 0);
      parts.push(cap.toNonIndexed());
      return mergeGeometries(parts)!;
    }
  }
}

export class QifuScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  quality: Quality;

  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private clock = new THREE.Clock();
  private time = 0;
  private uniforms = { uTime: { value: 0 }, uWind: { value: 0 }, uGrow: { value: 1 } };

  private sky = makeSkyState();
  private skyDome = createSkyDome();
  private stars = createStars();
  private moon: THREE.Mesh;
  private key: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private ground: THREE.Mesh;
  private groundMat: THREE.MeshStandardMaterial;
  private hills: THREE.Group;

  private treeGroup = new THREE.Group();
  private trunkMesh: THREE.Mesh | null = null;
  private leafMesh: THREE.InstancedMesh | null = null;
  private leafMat: THREE.MeshStandardMaterial;
  private trunkMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true });
  private anchors: Anchor[] = [];
  private treeHeight = 3;
  private stage = -1;
  private growStart = -10;
  private growFromScale = 1;

  private tagMeshes = new Map<ItemId, THREE.InstancedMesh>();
  private tagMats = new Map<ItemId, THREE.MeshStandardMaterial>();
  private stringMesh: THREE.InstancedMesh;
  private tagInsts: TagInst[] = [];
  private byType = new Map<ItemId, TagInst[]>();
  private allTags: PrayerTag[] = [];
  private spawnTimes = new Map<number, number>();
  private knownIds = new Set<number>();
  private tagsLoaded = false;
  private recent24h = 0;

  private petals: THREE.InstancedMesh;
  private petalData: { pos: THREE.Vector3; rot: THREE.Vector3; spin: THREE.Vector3; speed: number; phase: number }[] = [];
  private fireflies: THREE.Points;
  private fireflyBase: Float32Array;
  private sparks: THREE.Points;
  private sparkVel = new Float32Array(MAX_SPARKS * 3);
  private sparkLife = new Float32Array(MAX_SPARKS);
  private sparkCursor = 0;

  private wind = 0.1;
  private nextGust = 3;
  private gustEnd = 0;
  private gustStrength = 0;

  private hourOverride: number | null = null;
  private lastInteraction = 0;
  private focus: { t0: number; from: { target: THREE.Vector3; pos: THREE.Vector3 }; to: { target: THREE.Vector3; pos: THREE.Vector3 }; hold: number } | null = null;
  private restoreView: { target: THREE.Vector3; pos: THREE.Vector3 } | null = null;
  private cameraTween: { t0: number; dur: number; fromDist: number; toDist: number; fromTargetY: number; toTargetY: number } | null = null;

  private fpsFrames = 0;
  private fpsTime = 0;
  private raycaster = new THREE.Raycaster();
  private dummy = new THREE.Object3D();
  private quat = new THREE.Quaternion();
  private euler = new THREE.Euler();
  private glowTex = glowTexture();
  private tmpV = new THREE.Vector3();

  constructor(private canvas: HTMLCanvasElement, private events: SceneEvents = {}, opts: { quality?: Quality; hour?: number | null } = {}) {
    const coarse = matchMedia('(pointer: coarse)').matches || innerWidth < 720;
    this.quality = opts.quality ?? (coarse ? 'medium' : 'high');
    this.hourOverride = opts.hour ?? null;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 600);
    this.scene.fog = new THREE.FogExp2(0xbfe1f7, 0.011);
    this.scene.add(this.skyDome, this.stars);

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
    this.key = new THREE.DirectionalLight(0xffffff, 3);
    this.key.shadow.mapSize.set(2048, 2048);
    const sc = this.key.shadow.camera;
    sc.left = -24;
    sc.right = 24;
    sc.top = 26;
    sc.bottom = -8;
    sc.near = 1;
    sc.far = 140;
    this.key.shadow.bias = -0.0006;
    this.key.shadow.normalBias = 0.05;
    this.key.target.position.set(0, 4, 0);
    this.scene.add(this.hemi, this.key, this.key.target);

    this.moon = new THREE.Mesh(
      new THREE.SphereGeometry(5, 24, 16),
      new THREE.MeshBasicMaterial({ color: 0xf2f0dc, fog: false, transparent: true }),
    );
    this.scene.add(this.moon);

    this.groundMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });
    this.ground = this.makeGround();
    this.hills = this.makeHills();
    this.scene.add(this.ground, this.hills, this.treeGroup);
    this.makeGrassAndRocks();

    this.leafMat = new THREE.MeshStandardMaterial({ roughness: 0.75, side: THREE.DoubleSide, flatShading: true });
    addWind(this.leafMat, this.uniforms, 'leaf');

    for (const item of ITEMS) {
      const glow = item.glow;
      const mat = new THREE.MeshStandardMaterial({
        color: item.color,
        emissive: glow ? item.color : item.id === 'gold' ? '#7a5a10' : '#000000',
        emissiveIntensity: glow ? 1.2 : 0.3,
        roughness: item.id === 'gold' ? 0.3 : 0.6,
        metalness: item.id === 'gold' ? 0.75 : 0,
        side: THREE.DoubleSide,
        flatShading: item.id === 'lotus',
      });
      this.tagMats.set(item.id, mat);
      const mesh = new THREE.InstancedMesh(makeTagGeometry(item.id), mat, MAX_TAGS);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.tagMeshes.set(item.id, mesh);
      this.byType.set(item.id, []);
      this.treeGroup.add(mesh);
    }
    const stringGeo = new THREE.CylinderGeometry(0.008, 0.008, 1, 3);
    stringGeo.translate(0, -0.5, 0);
    this.stringMesh = new THREE.InstancedMesh(stringGeo, new THREE.MeshStandardMaterial({ color: '#8a2a2a', roughness: 1 }), MAX_TAGS);
    this.stringMesh.count = 0;
    this.stringMesh.frustumCulled = false;
    this.stringMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.treeGroup.add(this.stringMesh);

    this.petals = this.makePetals();
    this.fireflyBase = new Float32Array(MAX_FIREFLIES * 4);
    this.fireflies = this.makeFireflies();
    this.sparks = this.makeSparks();
    this.scene.add(this.petals, this.fireflies, this.sparks);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.enablePan = false;
    this.controls.minPolarAngle = 0.35;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.04;
    this.controls.autoRotateSpeed = 0.35;
    this.controls.rotateSpeed = 0.6;
    this.controls.zoomSpeed = 0.7;
    this.controls.addEventListener('start', () => {
      this.lastInteraction = this.time;
      this.focus = null;
      this.events.onPick?.(null, 0, 0);
    });
    this.controls.addEventListener('change', () => (this.lastInteraction = this.time));

    this.bindPicking();
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement ?? canvas);
    this.applyQuality();
    this.setStage(0, false);
    this.resize();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  setHour(h: number | null) {
    this.hourOverride = h;
  }

  setQuality(q: Quality) {
    if (q === this.quality) return;
    this.quality = q;
    this.applyQuality();
    this.rebuildTree(false);
    this.layoutTags();
    this.events.onQuality?.(q);
  }

  getStage() {
    return this.stage;
  }

  getTagCount() {
    return this.tagInsts.length;
  }

  setActivity(recent24h: number) {
    this.recent24h = recent24h;
  }

  private applyQuality() {
    const q = this.quality;
    const dpr = Math.min(devicePixelRatio || 1, q === 'high' ? 2 : q === 'medium' ? 1.5 : 1);
    this.renderer.setPixelRatio(dpr);
    this.renderer.shadowMap.enabled = q !== 'low';
    this.key.castShadow = q !== 'low';
    const size = q === 'high' ? 2048 : 1024;
    if (this.key.shadow.mapSize.x !== size) {
      this.key.shadow.mapSize.set(size, size);
      this.key.shadow.map?.dispose();
      this.key.shadow.map = null;
    }
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (m) m.needsUpdate = true;
    });
    if (q === 'low') {
      this.composer?.dispose();
      this.composer = null;
      this.bloom = null;
    } else if (!this.composer) {
      const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: q === 'high' ? 4 : 2 });
      this.composer = new EffectComposer(this.renderer, rt);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.4, 0.7, 0.92);
      this.composer.addPass(this.bloom);
      this.composer.addPass(new OutputPass());
    }
    this.petals.count = q === 'high' ? MAX_PETALS : q === 'medium' ? 70 : 30;
    this.fireflies.geometry.setDrawRange(0, q === 'high' ? MAX_FIREFLIES : q === 'medium' ? 30 : 14);
    this.resize();
  }

  private resize() {
    const parent = this.canvas.parentElement ?? this.canvas;
    const w = Math.max(1, parent.clientWidth);
    const h = Math.max(1, parent.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.composer?.setPixelRatio(this.renderer.getPixelRatio());
    this.composer?.setSize(w, h);
  }

  // ---------------------------------------------------------------- world

  private makeGround() {
    const geo = new THREE.CircleGeometry(120, 96, 0, Math.PI * 2);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const rng = mulberry32(3);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const r = Math.hypot(x, z);
      const bump = Math.sin(x * 0.11) * Math.cos(z * 0.13) * 0.9 + Math.sin(x * 0.31 + z * 0.17) * 0.25;
      pos.setY(i, r < 6 ? bump * (r / 6) * 0.3 : bump * Math.min(1, (r - 6) / 30));
      c.setHSL(0.27 + rng() * 0.03, 0.42, 0.34 + rng() * 0.05 - Math.min(r / 400, 0.1));
      c.toArray(colors, i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, this.groundMat);
    m.receiveShadow = true;
    return m;
  }

  private makeHills() {
    const g = new THREE.Group();
    const rng = mulberry32(11);
    const mat = new THREE.MeshStandardMaterial({ color: '#4b6b4a', roughness: 1, flatShading: true });
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + rng() * 0.3;
      const d = 95 + rng() * 25;
      const hill = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), mat);
      hill.scale.set(16 + rng() * 22, 6 + rng() * 14, 16 + rng() * 22);
      hill.position.set(Math.cos(a) * d, -1, Math.sin(a) * d);
      g.add(hill);
    }
    return g;
  }

  private makeGrassAndRocks() {
    const rng = mulberry32(5);
    const grassGeo = new THREE.ConeGeometry(0.05, 0.55, 3);
    grassGeo.translate(0, 0.27, 0);
    const grassMat = new THREE.MeshStandardMaterial({ color: '#7fae4f', roughness: 1, side: THREE.DoubleSide });
    addWind(grassMat, this.uniforms, 'grass');
    const count = 2400;
    const grass = new THREE.InstancedMesh(grassGeo, grassMat, count);
    const m = new THREE.Matrix4();
    const col = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const a = rng() * Math.PI * 2;
      const r = 1.2 + Math.pow(rng(), 0.7) * 42;
      const s = 0.7 + rng() * 1.1;
      m.compose(
        new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r),
        new THREE.Quaternion().setFromEuler(new THREE.Euler((rng() - 0.5) * 0.3, rng() * 6, (rng() - 0.5) * 0.3)),
        new THREE.Vector3(s, s * (0.8 + rng() * 0.8), s),
      );
      grass.setMatrixAt(i, m);
      col.setHSL(0.22 + rng() * 0.1, 0.5, 0.3 + rng() * 0.2);
      grass.setColorAt(i, col);
    }
    this.scene.add(grass);

    const rockMat = new THREE.MeshStandardMaterial({ color: '#8b8b86', roughness: 1, flatShading: true });
    const rocks = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), rockMat, 14);
    rocks.castShadow = rocks.receiveShadow = true;
    for (let i = 0; i < 14; i++) {
      const a = rng() * Math.PI * 2;
      const r = 4 + rng() * 30;
      const s = 0.25 + rng() * 0.8;
      m.compose(
        new THREE.Vector3(Math.cos(a) * r, s * 0.2, Math.sin(a) * r),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(rng(), rng() * 6, rng())),
        new THREE.Vector3(s * 1.4, s * 0.7, s),
      );
      rocks.setMatrixAt(i, m);
    }
    this.scene.add(rocks);
  }

  private makePetals() {
    const geo = new THREE.PlaneGeometry(0.16, 0.11);
    const mat = new THREE.MeshStandardMaterial({ color: '#ffc9dc', side: THREE.DoubleSide, roughness: 0.8, emissive: '#ff9bbd', emissiveIntensity: 0.12 });
    const mesh = new THREE.InstancedMesh(geo, mat, MAX_PETALS);
    mesh.frustumCulled = false;
    const rng = mulberry32(9);
    for (let i = 0; i < MAX_PETALS; i++) {
      this.petalData.push({
        pos: new THREE.Vector3((rng() - 0.5) * 40, rng() * 14, (rng() - 0.5) * 40),
        rot: new THREE.Vector3(rng() * 6, rng() * 6, rng() * 6),
        spin: new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).multiplyScalar(3),
        speed: 0.35 + rng() * 0.35,
        phase: rng() * 10,
      });
    }
    return mesh;
  }

  private makeFireflies() {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(MAX_FIREFLIES * 3);
    const rng = mulberry32(21);
    for (let i = 0; i < MAX_FIREFLIES; i++) {
      this.fireflyBase[i * 4] = (rng() - 0.5) * 30;
      this.fireflyBase[i * 4 + 1] = 0.6 + rng() * 5;
      this.fireflyBase[i * 4 + 2] = (rng() - 0.5) * 30;
      this.fireflyBase[i * 4 + 3] = rng() * 100;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      map: this.glowTex,
      color: 0xffe9a0,
      size: 0.7,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    return pts;
  }

  private makeSparks() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_SPARKS * 3).fill(9999), 3));
    const mat = new THREE.PointsMaterial({
      map: this.glowTex,
      color: 0xffd98a,
      size: 0.55,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    return pts;
  }

  private emitSparks(at: THREE.Vector3, n: number) {
    const pos = this.sparks.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < n; i++) {
      const k = this.sparkCursor++ % MAX_SPARKS;
      pos.setXYZ(k, at.x, at.y, at.z);
      const a = Math.random() * Math.PI * 2;
      const up = Math.random() * 1.6 + 0.2;
      const sp = 0.6 + Math.random() * 1.6;
      this.sparkVel[k * 3] = Math.cos(a) * sp;
      this.sparkVel[k * 3 + 1] = up;
      this.sparkVel[k * 3 + 2] = Math.sin(a) * sp;
      this.sparkLife[k] = 1.4 + Math.random() * 0.8;
    }
  }

  // ---------------------------------------------------------------- tree

  setStage(stage: number, animate = true) {
    if (stage === this.stage) return;
    const prevHeight = this.treeHeight;
    const first = this.stage < 0;
    this.stage = stage;
    this.rebuildTree(animate && !first, prevHeight);
    this.layoutTags();
    const p = STAGE_PARAMS[stage];
    this.controls.minDistance = 3.5;
    this.controls.maxDistance = p.cameraDistance * 2.4;
    const targetY = this.treeHeight * 0.42;
    if (first) {
      this.controls.target.set(0, targetY, 0);
      const dir = new THREE.Vector3(0.28, 0.2, 1).normalize();
      this.camera.position.copy(this.controls.target).addScaledVector(dir, p.cameraDistance);
      this.controls.update();
    } else {
      this.cameraTween = {
        t0: this.time,
        dur: 3,
        fromDist: this.camera.position.distanceTo(this.controls.target),
        toDist: p.cameraDistance,
        fromTargetY: this.controls.target.y,
        toTargetY: targetY,
      };
    }
  }

  private rebuildTree(animate: boolean, prevHeight = this.treeHeight) {
    const built = buildTree(this.stage, LEAF_BUDGET[this.quality]);
    if (this.trunkMesh) {
      this.treeGroup.remove(this.trunkMesh);
      this.trunkMesh.geometry.dispose();
    }
    if (this.leafMesh) {
      this.treeGroup.remove(this.leafMesh);
      this.leafMesh.dispose();
    }
    this.trunkMesh = new THREE.Mesh(built.trunk, this.trunkMat);
    this.trunkMesh.castShadow = true;
    this.trunkMesh.receiveShadow = true;
    this.treeGroup.add(this.trunkMesh);

    const leaves = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.5, 0), this.leafMat, built.leaves.count);
    (leaves.instanceMatrix.array as Float32Array).set(built.leaves.matrices);
    leaves.instanceColor = new THREE.InstancedBufferAttribute(built.leaves.colors, 3);
    leaves.castShadow = true;
    leaves.receiveShadow = true;
    leaves.frustumCulled = false;
    this.leafMesh = leaves;
    this.treeGroup.add(leaves);

    this.anchors = built.anchors;
    this.treeHeight = built.height;
    if (animate) {
      this.growStart = this.time;
      this.growFromScale = Math.max(0.3, Math.min(1, prevHeight / built.height));
      this.emitSparks(new THREE.Vector3(0, built.height * 0.6, 0), 60);
    }
    const bs = new THREE.Sphere(new THREE.Vector3(0, built.height / 2, 0), built.height * 1.5);
    for (const m of this.tagMeshes.values()) m.boundingSphere = bs;
    this.stringMesh.boundingSphere = bs;
  }

  // ---------------------------------------------------------------- tags

  setTags(tags: PrayerTag[]) {
    this.allTags = tags;
    const fresh = tags.filter((t) => !this.knownIds.has(t.id));
    for (const t of tags) this.knownIds.add(t.id);
    if (this.tagsLoaded) {
      for (const t of fresh) this.spawnTimes.set(t.id, this.time);
    } else {
      for (const t of tags) this.spawnTimes.set(t.id, this.time - 10);
    }
    this.tagsLoaded = true;
    this.layoutTags();
    return fresh;
  }

  private layoutTags() {
    const cap = STAGE_PARAMS[Math.max(0, this.stage)].tagCapacity;
    const visible = this.allTags.slice(-cap);
    this.tagInsts = [];
    for (const list of this.byType.values()) list.length = 0;
    const n = this.anchors.length;
    if (n === 0) return;
    for (const tag of visible) {
      const rnd = mulberry32(tag.id * 2654435761);
      const base = this.anchors[tag.position % n].position;
      const inst: TagInst = {
        tag,
        anchor: base.clone().add(new THREE.Vector3((rnd() - 0.5) * 0.3, 0, (rnd() - 0.5) * 0.3)),
        length: (0.35 + rnd() * 0.9) * (0.6 + STAGE_PARAMS[this.stage].tagScale * 0.4),
        phase: rnd() * 20,
        spawn: this.spawnTimes.get(tag.id) ?? this.time - 10,
      };
      this.tagInsts.push(inst);
      this.byType.get(tag.itemType)?.push(inst);
    }
    for (const [id, mesh] of this.tagMeshes) mesh.count = this.byType.get(id)!.length;
    this.stringMesh.count = this.tagInsts.length;
  }

  tagWorldPosition(id: number): THREE.Vector3 | null {
    const inst = this.tagInsts.find((t) => t.tag.id === id);
    if (!inst) return null;
    return inst.anchor.clone().multiply(this.treeGroup.scale).add(new THREE.Vector3(0, -inst.length, 0));
  }

  spawnBurst(id: number) {
    const p = this.tagWorldPosition(id);
    if (p) this.emitSparks(p, 50);
  }

  focusTag(id: number) {
    const p = this.tagWorldPosition(id);
    if (!p) return;
    const target = p.clone();
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    const flat = new THREE.Vector3(p.x, 0, p.z);
    if (flat.lengthSq() > 0.01) dir.lerp(flat.normalize().add(new THREE.Vector3(0, 0.15, 0)), 0.75).normalize();
    const pos = target.clone().addScaledVector(dir, Math.max(5, STAGE_PARAMS[this.stage].cameraDistance * 0.4));
    if (!this.restoreView) this.restoreView = { target: this.controls.target.clone(), pos: this.camera.position.clone() };
    this.focus = {
      t0: this.time,
      from: { target: this.controls.target.clone(), pos: this.camera.position.clone() },
      to: { target, pos },
      hold: 3.2,
    };
  }

  private bindPicking() {
    let down: { x: number; y: number; t: number } | null = null;
    this.canvas.addEventListener('pointerdown', (e) => (down = { x: e.clientX, y: e.clientY, t: performance.now() }));
    this.canvas.addEventListener('pointerup', (e) => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      const quick = performance.now() - down.t < 500;
      down = null;
      if (moved > 6 || !quick) return;
      const rect = this.canvas.getBoundingClientRect();
      const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      this.raycaster.setFromCamera(ndc, this.camera);
      this.raycaster.params.Points = { threshold: 0.3 };
      const meshes = [...this.tagMeshes.values()].filter((m) => m.count > 0);
      const hits = this.raycaster.intersectObjects(meshes, false);
      const hit = hits.find((h) => h.instanceId !== undefined);
      if (hit && hit.instanceId !== undefined) {
        const type = [...this.tagMeshes.entries()].find(([, m]) => m === hit.object)![0];
        const inst = this.byType.get(type)![hit.instanceId];
        this.events.onPick?.(inst?.tag ?? null, e.clientX, e.clientY);
      } else {
        this.events.onPick?.(null, e.clientX, e.clientY);
      }
    });
  }

  // ---------------------------------------------------------------- loop

  private updateWind(dt: number) {
    if (this.time > this.nextGust) {
      this.gustStrength = 0.55 + Math.random() * 0.45;
      this.gustEnd = this.time + 3.5 + Math.random() * 3.5;
      this.nextGust = this.gustEnd + 9 + Math.random() * 14;
    }
    const gusting = this.time < this.gustEnd;
    const base = 0.12 + 0.08 * Math.sin(this.time * 0.23);
    const target = gusting ? this.gustStrength : base;
    this.wind += (target - this.wind) * (1 - Math.exp(-dt * (gusting ? 1.4 : 0.55)));
  }

  private currentHour() {
    if (this.hourOverride !== null) return this.hourOverride;
    const d = new Date();
    return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
  }

  private updateSky() {
    const s = sampleSky(this.currentHour(), this.sky);
    const u = this.skyDome.material as THREE.ShaderMaterial;
    u.uniforms.uTop.value.copy(s.top);
    u.uniforms.uHorizon.value.copy(s.horizon);
    u.uniforms.uSunDir.value.copy(s.sunDir);
    u.uniforms.uSunColor.value.copy(s.sunColor);
    u.uniforms.uSunAmount.value = 1 - s.night;
    (this.scene.fog as THREE.FogExp2).color.copy(s.horizon);
    (this.scene.fog as THREE.FogExp2).density = 0.009 + s.night * 0.004;

    const dayW = 1 - s.night;
    this.key.position.copy(s.moonDir).lerp(s.sunDir, dayW).normalize().multiplyScalar(60);
    this.key.color.copy(s.sunColor).lerp(new THREE.Color('#9db4ff'), s.night);
    this.key.intensity = s.sunIntensity * dayW + 0.7 * s.night;
    this.hemi.color.copy(s.hemiSky);
    this.hemi.groundColor.copy(s.hemiGround);
    this.hemi.intensity = s.hemiIntensity * (1 - 0.15 * s.night);
    this.groundMat.color.setScalar(0.85 + 0.15 * dayW);

    this.stars.material.opacity = Math.max(0, s.night * 1.2 - 0.2);
    this.stars.rotation.y = this.time * 0.002;
    this.moon.position.copy(s.moonDir).multiplyScalar(200);
    (this.moon.material as THREE.MeshBasicMaterial).opacity = Math.min(1, s.night * 1.4);
    this.moon.visible = s.night > 0.02;

    const activity = Math.min(1, this.recent24h / 20);
    const glowBoost = 0.3 + s.night * (2.2 + activity * 1.8);
    for (const item of ITEMS) {
      if (item.glow) this.tagMats.get(item.id)!.emissiveIntensity = glowBoost;
    }
    (this.fireflies.material as THREE.PointsMaterial).opacity = s.night * 0.9;
    this.fireflies.visible = s.night > 0.05;
    if (this.bloom) {
      this.bloom.strength = 0.18 + s.night * (0.35 + activity * 0.5);
      this.bloom.radius = 0.6;
      this.bloom.threshold = 0.9 - s.night * 0.15;
    }
    this.renderer.toneMappingExposure = 0.9 + s.night * 0.25;
  }

  private updateTags() {
    const d = this.dummy;
    const t = this.time;
    const sw = this.wind;
    const treeScale = this.treeGroup.scale.x;
    const tagScale = STAGE_PARAMS[this.stage].tagScale;
    const counters = new Map<ItemId, number>();
    let strIndex = 0;
    for (const inst of this.tagInsts) {
      const age = t - inst.spawn;
      const k = Math.min(1, Math.max(0, age / 1.1));
      const ease = 1 + 2.70158 * Math.pow(k - 1, 3) + 1.70158 * Math.pow(k - 1, 2);
      const appear = k <= 0 ? 0.0001 : ease;
      this.euler.set(
        Math.cos(t * 1.1 + inst.phase * 1.7) * (0.03 + 0.08 * sw),
        Math.sin(t * 0.4 + inst.phase) * 0.35,
        Math.sin(t * 1.3 + inst.phase) * (0.04 + 0.12 * sw) + sw * 0.33,
      );
      this.quat.setFromEuler(this.euler);

      d.position.copy(inst.anchor);
      d.quaternion.copy(this.quat);
      d.scale.set(1, inst.length * appear, 1);
      d.updateMatrix();
      this.stringMesh.setMatrixAt(strIndex++, d.matrix);

      const local = this.tmpV.set(0, -inst.length * appear, 0).applyQuaternion(this.quat);
      d.position.copy(inst.anchor).add(local);
      const s = tagScale * appear * (inst.tag.mine ? 1.12 : 1);
      d.scale.setScalar(s);
      d.updateMatrix();
      const idx = counters.get(inst.tag.itemType) ?? 0;
      counters.set(inst.tag.itemType, idx + 1);
      this.tagMeshes.get(inst.tag.itemType)!.setMatrixAt(idx, d.matrix);
    }
    void treeScale;
    for (const m of this.tagMeshes.values()) m.instanceMatrix.needsUpdate = true;
    this.stringMesh.instanceMatrix.needsUpdate = true;
  }

  private updateParticles(dt: number) {
    const night = this.sky.night;
    const d = this.dummy;
    const w = this.wind;
    const span = 26;
    for (let i = 0; i < this.petals.count; i++) {
      const p = this.petalData[i];
      p.pos.y -= p.speed * dt;
      p.pos.x += (0.12 + w * 2.6) * dt + Math.sin(this.time * 0.8 + p.phase) * 0.25 * dt;
      p.pos.z += Math.cos(this.time * 0.6 + p.phase) * 0.35 * dt;
      p.rot.addScaledVector(p.spin, dt * (1 + w * 2));
      if (p.pos.y < 0.05 || p.pos.x > span) {
        p.pos.set((Math.random() - 0.5) * span * 1.4 - (w > 0.3 ? 6 : 0), this.treeHeight * (0.5 + Math.random() * 0.6), (Math.random() - 0.5) * span);
      }
      d.position.copy(p.pos);
      d.rotation.set(p.rot.x, p.rot.y, p.rot.z);
      d.scale.setScalar(1);
      d.updateMatrix();
      this.petals.setMatrixAt(i, d.matrix);
    }
    this.petals.instanceMatrix.needsUpdate = true;

    if (night > 0.05) {
      const pos = this.fireflies.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < MAX_FIREFLIES; i++) {
        const b = i * 4;
        const ph = this.fireflyBase[b + 3];
        pos.setXYZ(
          i,
          this.fireflyBase[b] + Math.sin(this.time * 0.35 + ph) * 2.2 + w * 3,
          this.fireflyBase[b + 1] + Math.sin(this.time * 0.6 + ph * 1.3) * 0.8,
          this.fireflyBase[b + 2] + Math.cos(this.time * 0.3 + ph * 0.7) * 2.2,
        );
      }
      pos.needsUpdate = true;
    }

    const sp = this.sparks.geometry.attributes.position as THREE.BufferAttribute;
    let any = false;
    for (let i = 0; i < MAX_SPARKS; i++) {
      if (this.sparkLife[i] <= 0) continue;
      any = true;
      this.sparkLife[i] -= dt;
      if (this.sparkLife[i] <= 0) {
        sp.setXYZ(i, 9999, 9999, 9999);
        continue;
      }
      this.sparkVel[i * 3 + 1] -= 0.9 * dt;
      sp.setXYZ(i, sp.getX(i) + this.sparkVel[i * 3] * dt, sp.getY(i) + this.sparkVel[i * 3 + 1] * dt, sp.getZ(i) + this.sparkVel[i * 3 + 2] * dt);
    }
    if (any) sp.needsUpdate = true;
  }

  private updateCamera(dt: number) {
    if (this.focus) {
      const f = this.focus;
      const k = Math.min(1, (this.time - f.t0) / 1.4);
      const e = k * k * (3 - 2 * k);
      this.controls.target.lerpVectors(f.from.target, f.to.target, e);
      this.camera.position.lerpVectors(f.from.pos, f.to.pos, e);
      if (this.time - f.t0 > 1.4 + f.hold && this.restoreView) {
        this.focus = null;
        const r = this.restoreView;
        this.restoreView = null;
        this.focus = {
          t0: this.time,
          from: { target: this.controls.target.clone(), pos: this.camera.position.clone() },
          to: { target: r.target, pos: r.pos },
          hold: 1e9,
        };
      }
    } else if (this.cameraTween) {
      const c = this.cameraTween;
      const k = Math.min(1, (this.time - c.t0) / c.dur);
      const e = k * k * (3 - 2 * k);
      const dirv = this.camera.position.clone().sub(this.controls.target).normalize();
      const ty = THREE.MathUtils.lerp(c.fromTargetY, c.toTargetY, e);
      this.controls.target.y = ty;
      this.camera.position.copy(this.controls.target).addScaledVector(dirv, THREE.MathUtils.lerp(c.fromDist, c.toDist, e));
      if (k >= 1) this.cameraTween = null;
    }
    const idle = this.time - this.lastInteraction > 6 && !this.focus;
    this.controls.autoRotate = idle;
    this.controls.update(dt);
  }

  private frame() {
    const dt = Math.min(this.clock.getDelta(), 0.1);
    this.time += dt;
    this.uniforms.uTime.value = this.time;
    this.updateWind(dt);
    this.uniforms.uWind.value = this.wind;

    const gk = Math.min(1, (this.time - this.growStart) / 3);
    const ge = gk * gk * (3 - 2 * gk);
    this.uniforms.uGrow.value = gk >= 1 ? 1 : 0.15 + 0.85 * ge;
    const sc = gk >= 1 ? 1 : THREE.MathUtils.lerp(this.growFromScale, 1, ge);
    this.treeGroup.scale.setScalar(sc);

    this.updateSky();
    this.updateTags();
    this.updateParticles(dt);
    this.updateCamera(dt);

    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);

    this.events.onFrame?.({ wind: this.wind, night: this.sky.night, hour: this.sky.hour });
    this.monitorPerformance(dt);
  }

  private monitorPerformance(dt: number) {
    if (document.hidden) return;
    this.fpsFrames++;
    this.fpsTime += dt;
    if (this.fpsTime < 4) return;
    const fps = this.fpsFrames / this.fpsTime;
    this.fpsFrames = 0;
    this.fpsTime = 0;
    const idx = QUALITIES.indexOf(this.quality);
    if (fps < 24 && idx > 0) this.setQuality(QUALITIES[idx - 1]);
  }
}
