import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ITEMS, type ItemId, type PrayerTag, type TerrainId } from '../../shared/game';
import { applyHeightFog } from './fogPatch';
import { Fauna, Particles, type AnimalSound } from './fauna';
import { Kit } from './props';
import { SkyRig, glowTexture } from './sky';
import { TERRACE_H, TERRACE_R, build as buildTerrain, type TerrainWorld } from './terrain';
import { glyphAtlas, leafTexture, surface } from './textures';
import { STAGE_PARAMS, buildTree, mulberry32, type Anchor, type BuiltTree } from './tree';

export type Quality = 'low' | 'medium' | 'high';
const QUALITIES: Quality[] = ['low', 'medium', 'high'];
const LEAF_BUDGET: Record<Quality, number> = { low: 0.3, medium: 0.6, high: 1 };
const MAX_TAGS = 300;
const MAX_SPARKS = 240;
const MAX_DECOR = 60;
const SUN_K = 1.9;
const HEMI_K = 1.6;

applyHeightFog();

interface TagInst {
  tag: PrayerTag;
  anchor: THREE.Vector3;
  length: number;
  phase: number;
  spawn: number;
}

export interface SceneEvents {
  onPick?: (tag: PrayerTag | null, x: number, y: number) => void;
  onFrame?: (state: { wind: number; night: number; hour: number; terrain: TerrainId }) => void;
  onQuality?: (q: Quality) => void;
  onAnimal?: (kind: AnimalSound, pos: THREE.Vector3, camPos: THREE.Vector3) => void;
}

type Uniforms = Record<string, { value: unknown }>;

function makeTagGeometry(id: ItemId): THREE.BufferGeometry {
  switch (id) {
    case 'wood': {
      const g = new THREE.BoxGeometry(0.3, 0.5, 0.04);
      g.translate(0, -0.25, 0);
      return g;
    }
    case 'ribbon': {
      const g = new THREE.PlaneGeometry(0.16, 1.0, 2, 8);
      g.translate(0, -0.5, 0);
      const pos = g.attributes.position;
      for (let i = 0; i < pos.count; i++) pos.setZ(i, Math.sin(pos.getY(i) * 7) * 0.03);
      g.computeVertexNormals();
      return g;
    }
    case 'gold': {
      const g = new THREE.BoxGeometry(0.32, 0.5, 0.035);
      g.translate(0, -0.27, 0);
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
  private leafUniforms: Uniforms = {
    uTime: this.uniforms.uTime,
    uWind: this.uniforms.uWind,
    uGrow: this.uniforms.uGrow,
    uCrown: { value: new THREE.Vector3() },
    uSunView: { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: { value: new THREE.Color() },
    uTrans: { value: 1 },
  };

  private sky = new SkyRig();
  private key: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private world: TerrainWorld | null = null;
  private kit!: Kit;
  private fauna: Fauna | null = null;
  private particles: Particles | null = null;
  private terrainId: TerrainId = 'mountain';
  private terrainSeed = 1;

  private treeGroup = new THREE.Group();
  private trunkMesh: THREE.Mesh | null = null;
  private leafMesh: THREE.InstancedMesh | null = null;
  private leafMat: THREE.MeshStandardMaterial;
  private barkMat: THREE.MeshStandardMaterial;
  private anchors: Anchor[] = [];
  private treeHeight = 3;
  private stage = -1;
  private growStart = -10;
  private growFromScale = 1;

  private tagMeshes = new Map<ItemId, THREE.InstancedMesh>();
  private tagMats = new Map<ItemId, THREE.MeshStandardMaterial>();
  private glyphAttrs = new Map<ItemId, THREE.InstancedBufferAttribute>();
  private stringMesh: THREE.InstancedMesh;
  private decorMesh: THREE.InstancedMesh;
  private decorAnchors: Anchor[] = [];
  private ropeGroup = new THREE.Group();
  private streamers: THREE.InstancedMesh;
  private streamerData: { pos: THREE.Vector3; phase: number; len: number }[] = [];
  private tagInsts: TagInst[] = [];
  private byType = new Map<ItemId, TagInst[]>();
  private allTags: PrayerTag[] = [];
  private spawnTimes = new Map<number, number>();
  private knownIds = new Set<number>();
  private tagsLoaded = false;
  private recent24h = 0;

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
  private lockQuality: boolean;

  private fpsFrames = 0;
  private fpsTime = 0;
  private raycaster = new THREE.Raycaster();
  private dummy = new THREE.Object3D();
  private quat = new THREE.Quaternion();
  private euler = new THREE.Euler();
  private glowTex = glowTexture();
  private tmpV = new THREE.Vector3();
  private tmpC = new THREE.Color();
  private lightTint = new THREE.Color();

  constructor(private canvas: HTMLCanvasElement, private events: SceneEvents = {}, opts: { quality?: Quality; hour?: number | null; terrain?: TerrainId; seed?: number } = {}) {
    const coarse = matchMedia('(pointer: coarse)').matches || innerWidth < 720;
    this.quality = opts.quality ?? (coarse ? 'medium' : 'high');
    this.lockQuality = !!opts.quality;
    this.hourOverride = opts.hour ?? null;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.7;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.3, 4000);
    this.scene.fog = new THREE.FogExp2(0xbfd2e6, 0.01);
    this.scene.add(this.sky.group);

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
    this.key = new THREE.DirectionalLight(0xffffff, 3);
    this.key.shadow.bias = -0.0004;
    this.key.shadow.normalBias = 0.06;
    this.key.target.position.set(0, 6, 0);
    this.scene.add(this.hemi, this.key, this.key.target);

    this.barkMat = new THREE.MeshStandardMaterial({ roughness: 0.96, color: '#ffffff', normalScale: new THREE.Vector2(1.6, 1.6) });
    this.leafMat = this.makeLeafMaterial();
    this.scene.add(this.treeGroup);

    for (const item of ITEMS) {
      const glow = item.glow;
      let map: THREE.Texture | undefined;
      if (item.id === 'wood') map = glyphAtlas('wood', '#c19058', '#2b160a', 'wood');
      if (item.id === 'ribbon') map = glyphAtlas('ribbon', '#c8262c', '#f7d878');
      if (item.id === 'gold') map = glyphAtlas('gold', '#e4b64c', '#7a1410');
      const mat = new THREE.MeshStandardMaterial({
        color: map ? '#ffffff' : item.color,
        map,
        emissive: glow ? item.color : item.id === 'gold' ? '#7a5a10' : '#000000',
        emissiveIntensity: glow ? 1.2 : item.id === 'gold' ? 0.25 : 0,
        roughness: item.id === 'gold' ? 0.32 : 0.6,
        metalness: item.id === 'gold' ? 0.7 : 0,
        side: THREE.DoubleSide,
        flatShading: item.id === 'lotus',
      });
      if (map) {
        mat.onBeforeCompile = (shader) => {
          shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\nattribute float aGlyph;')
            .replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\nvMapUv.x = (vMapUv.x + aGlyph) * 0.25;\n#endif');
        };
      }
      this.tagMats.set(item.id, mat);
      const geo = makeTagGeometry(item.id);
      const attr = new THREE.InstancedBufferAttribute(new Float32Array(MAX_TAGS), 1);
      geo.setAttribute('aGlyph', attr);
      this.glyphAttrs.set(item.id, attr);
      const mesh = new THREE.InstancedMesh(geo, mat, MAX_TAGS);
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
    this.stringMesh = new THREE.InstancedMesh(stringGeo, new THREE.MeshStandardMaterial({ color: '#8a2a2a', roughness: 1 }), MAX_TAGS + MAX_DECOR);
    this.stringMesh.count = 0;
    this.stringMesh.frustumCulled = false;
    this.stringMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.treeGroup.add(this.stringMesh);

    const ribbonGeo = makeTagGeometry('ribbon');
    ribbonGeo.scale(1.3, 1.8, 1);
    this.decorMesh = new THREE.InstancedMesh(ribbonGeo, new THREE.MeshStandardMaterial({ color: '#c8262c', side: THREE.DoubleSide, roughness: 0.8 }), MAX_DECOR);
    this.decorMesh.count = 0;
    this.decorMesh.frustumCulled = false;
    this.decorMesh.castShadow = true;
    this.treeGroup.add(this.decorMesh);

    const streamerGeo = new THREE.PlaneGeometry(0.16, 1, 1, 6).translate(0, -0.5, 0);
    this.streamers = new THREE.InstancedMesh(streamerGeo, new THREE.MeshStandardMaterial({ color: '#c8262c', side: THREE.DoubleSide, roughness: 0.85 }), 24);
    this.streamers.frustumCulled = false;
    this.streamers.castShadow = true;
    this.treeGroup.add(this.ropeGroup, this.streamers);

    this.sparks = this.makeSparks();
    this.scene.add(this.sparks);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.07;
    this.controls.enablePan = false;
    this.controls.minPolarAngle = 0.3;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.05;
    this.controls.autoRotateSpeed = 0.3;
    this.controls.rotateSpeed = 0.6;
    this.controls.zoomSpeed = 0.7;
    this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_ROTATE };
    this.controls.addEventListener('start', () => {
      this.lastInteraction = this.time;
      this.focus = null;
      this.events.onPick?.(null, 0, 0);
    });
    this.controls.addEventListener('change', () => (this.lastInteraction = this.time));

    this.bindPicking();
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement ?? canvas);
    this.applyQuality();
    this.setTerrain(opts.terrain ?? 'mountain', opts.seed ?? 1, true);
    this.setStage(0, false);
    this.resize();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  setHour(h: number | null) {
    this.hourOverride = h;
  }

  getTerrain() {
    return this.terrainId;
  }

  setQuality(q: Quality) {
    if (q === this.quality) return;
    this.quality = q;
    this.applyQuality();
    this.setTerrain(this.terrainId, this.terrainSeed, true);
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

  // ---------------------------------------------------------------- terrain

  setTerrain(id: TerrainId, seed: number, force = false) {
    if (!force && id === this.terrainId && this.world) return;
    this.terrainId = id;
    this.terrainSeed = seed;
    if (this.world) {
      this.scene.remove(this.world.group);
      this.world.dispose();
    }
    if (this.fauna) {
      this.scene.remove(this.fauna.group);
      this.fauna.dispose();
    }
    if (this.particles) this.scene.remove(this.particles.object);
    this.kit = new Kit();
    this.world = buildTerrain(id, seed, this.quality, this.kit, this.renderer);
    this.scene.add(this.world.group);
    this.fauna = new Fauna(this.world, id, this.quality, seed);
    this.fauna.onCall = (kind, pos) => this.events.onAnimal?.(kind, pos, this.camera.position);
    this.scene.add(this.fauna.group);
    this.particles = new Particles(this.world.particle, this.quality, () => this.treeHeight);
    this.scene.add(this.particles.object);
    this.treeGroup.position.y = TERRACE_H;
    if (this.stage >= 0) {
      this.rebuildTree(false);
      this.layoutTags();
      this.growStart = this.time;
      this.growFromScale = 0.6;
    }
  }

  private makeLeafMaterial() {
    const m = new THREE.MeshStandardMaterial({
      map: leafTexture(),
      alphaTest: 0.45,
      alphaToCoverage: true,
      side: THREE.DoubleSide,
      roughness: 0.7,
      color: new THREE.Color(1.9, 1.9, 1.9),
    });
    const u = this.leafUniforms;
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, u);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime; uniform float uWind; uniform float uGrow; uniform vec3 uCrown;')
        .replace(
          '#include <defaultnormal_vertex>',
          `#include <defaultnormal_vertex>
           #ifdef USE_INSTANCING
             vec3 crownN = normalize(instanceMatrix[3].xyz - uCrown);
             transformedNormal = normalize(mix(transformedNormal, normalMatrix * crownN, 0.62));
           #endif`,
        )
        .replace(
          '#include <project_vertex>',
          `vec4 mvPosition = vec4(transformed * uGrow, 1.0);
           #ifdef USE_INSTANCING
             vec3 ip = vec3(instanceMatrix[3]);
             mvPosition = instanceMatrix * mvPosition;
             float ph = ip.x * 0.7 + ip.z * 0.9 + ip.y * 0.4;
             float amp = 0.05 + uWind * 0.4;
             mvPosition.xyz += vec3(sin(uTime * 2.1 + ph), sin(uTime * 1.7 + ph * 1.3) * 0.4, cos(uTime * 1.9 + ph * 0.8) * 0.6) * amp * 0.35
               + vec3(uWind * 0.35 * (0.5 + 0.5 * sin(uTime * 3.0 + ph)), 0.0, 0.0);
           #endif
           mvPosition = modelViewMatrix * mvPosition;
           gl_Position = projectionMatrix * mvPosition;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uSunView; uniform vec3 uSunColor; uniform float uTrans;')
        .replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;', 'float faceDirection = 1.0;'))
        .replace(
          '#include <opaque_fragment>',
          `float backLit = pow(clamp(dot(-normalize(vViewPosition), uSunView), 0.0, 1.0), 3.0);
           outgoingLight += diffuseColor.rgb * uSunColor * (backLit * 0.9 + 0.1) * uTrans;
           #include <opaque_fragment>`,
        );
    };
    return m;
  }

  private applyQuality() {
    const q = this.quality;
    const dpr = Math.min(devicePixelRatio || 1, q === 'high' ? 2 : q === 'medium' ? 1.5 : 1);
    this.renderer.setPixelRatio(dpr);
    this.sky.setPixelRatio(dpr);
    this.sky.setCloudQuality(q === 'high' ? 5 : q === 'medium' ? 4 : 3);
    this.renderer.shadowMap.enabled = q !== 'low';
    this.key.castShadow = q !== 'low';
    const size = q === 'high' ? 4096 : 2048;
    if (this.key.shadow.mapSize.x !== size) {
      this.key.shadow.mapSize.set(size, size);
      this.key.shadow.map?.dispose();
      this.key.shadow.map = null;
    }
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (m) m.needsUpdate = true;
    });
    this.composer?.dispose();
    this.composer = null;
    this.bloom = null;
    if (q !== 'low') {
      const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: q === 'high' ? 4 : 2 });
      this.composer = new EffectComposer(this.renderer, rt);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.35, 0.7, 1.5);
      this.composer.addPass(this.bloom);
      this.composer.addPass(new OutputPass());
      if (q === 'high') this.composer.addPass(new SMAAPass());
    }
    this.resize();
  }

  private resize() {
    const parent = this.canvas.parentElement ?? this.canvas;
    const w = Math.max(1, parent.clientWidth);
    const h = Math.max(1, parent.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.fov = w / h < 0.8 ? 55 : 42;
    this.camera.updateProjectionMatrix();
    this.composer?.setPixelRatio(this.renderer.getPixelRatio());
    this.composer?.setSize(w, h);
  }

  private makeSparks() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_SPARKS * 3).fill(9999), 3));
    const mat = new THREE.PointsMaterial({ map: this.glowTex, color: 0xffd98a, size: 0.7, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
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
    this.controls.maxDistance = p.cameraDistance * 2.6;
    const targetY = TERRACE_H + this.treeHeight * 0.42;
    if (first) {
      this.controls.target.set(0, targetY, 0);
      const narrow = this.camera.aspect < 0.8;
      const dir = new THREE.Vector3(0.28, 0.22, 1).normalize();
      this.camera.position.copy(this.controls.target).addScaledVector(dir, p.cameraDistance * (narrow ? 1.25 : 1));
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
    if (!this.world) return;
    const built = buildTree(this.stage, LEAF_BUDGET[this.quality], this.world.treeStyle, 20240611 + this.terrainSeed * 17);
    if (this.trunkMesh) {
      this.treeGroup.remove(this.trunkMesh);
      this.trunkMesh.geometry.dispose();
    }
    if (this.leafMesh) {
      this.treeGroup.remove(this.leafMesh);
      this.leafMesh.dispose();
    }
    const bark = surface('bark', this.quality === 'low' ? 256 : 512);
    this.barkMat.map = bark.map;
    this.barkMat.normalMap = bark.normalMap;
    this.barkMat.needsUpdate = true;
    this.trunkMesh = new THREE.Mesh(built.bark, this.barkMat);
    this.trunkMesh.castShadow = true;
    this.trunkMesh.receiveShadow = true;
    this.treeGroup.add(this.trunkMesh);

    const leaves = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), this.leafMat, built.leaves.count);
    (leaves.instanceMatrix.array as Float32Array).set(built.leaves.matrices);
    leaves.instanceColor = new THREE.InstancedBufferAttribute(built.leaves.colors, 3);
    leaves.castShadow = true;
    leaves.receiveShadow = true;
    leaves.frustumCulled = false;
    this.leafMesh = leaves;
    this.treeGroup.add(leaves);
    (this.leafUniforms.uCrown.value as THREE.Vector3).copy(built.crownCenter);

    this.anchors = built.anchors;
    this.decorAnchors = built.decor;
    this.treeHeight = built.height;
    this.buildRope(built);
    if (animate) {
      this.growStart = this.time;
      this.growFromScale = Math.max(0.3, Math.min(1, prevHeight / built.height));
      this.emitSparks(new THREE.Vector3(0, TERRACE_H + built.height * 0.6, 0), 70);
    }
    const bs = new THREE.Sphere(new THREE.Vector3(0, built.height / 2, 0), built.height * 1.6);
    for (const m of this.tagMeshes.values()) m.boundingSphere = bs;
    this.stringMesh.boundingSphere = bs;
    this.decorMesh.boundingSphere = bs;

    const half = Math.max(12, built.crownRadius + 8);
    const sc = this.key.shadow.camera;
    sc.left = -half;
    sc.right = half;
    sc.top = built.height + 6;
    sc.bottom = -half * 0.6;
    sc.near = 1;
    sc.far = 260;
    sc.updateProjectionMatrix();
  }

  private buildRope(built: BuiltTree) {
    while (this.ropeGroup.children.length) {
      const c = this.ropeGroup.children.pop() as THREE.Mesh;
      c.geometry.dispose();
    }
    const t = 0.24;
    const p = built.trunkCurve.getPoint(t);
    const tan = built.trunkCurve.getTangent(t);
    const R = built.trunkRadius * (1.05 - 0.33 * Math.pow(t, 0.85)) * (1 + (0.85 + this.stage * 0.15) * Math.exp(-t * 14 * (1 + built.trunkRadius * 0.4)));
    const ropeR = R * 1.13;
    const tubeR = Math.max(0.05, built.trunkRadius * 0.11);
    const rope = new THREE.Mesh(new THREE.TorusGeometry(ropeR, tubeR, 8, 40), new THREE.MeshStandardMaterial({ color: '#b3202a', roughness: 0.75 }));
    rope.position.copy(p);
    rope.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tan);
    rope.castShadow = true;
    const band = new THREE.Mesh(new THREE.CylinderGeometry(ropeR * 0.99, ropeR * 0.99, tubeR * 3.2, 32, 1, true), new THREE.MeshStandardMaterial({ color: '#c8262c', roughness: 0.9, side: THREE.DoubleSide }));
    band.position.copy(p);
    band.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tan);
    this.ropeGroup.add(rope, band);
    this.streamerData = [];
    const n = 16;
    const side = new THREE.Vector3().crossVectors(tan, new THREE.Vector3(0, 0, 1)).normalize();
    const side2 = new THREE.Vector3().crossVectors(tan, side).normalize();
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const pos = p.clone().addScaledVector(side, Math.cos(a) * ropeR * 1.02).addScaledVector(side2, Math.sin(a) * ropeR * 1.02);
      this.streamerData.push({ pos, phase: i * 1.7, len: (0.6 + (i % 3) * 0.25) * (0.6 + built.trunkRadius * 0.8) });
    }
    this.streamers.count = n;
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
    const sp = STAGE_PARAMS[this.stage];
    const counters = new Map<ItemId, number>();
    for (const tag of visible) {
      const rnd = mulberry32(tag.id * 2654435761);
      const base = this.anchors[tag.position % n].position;
      const inst: TagInst = {
        tag,
        anchor: base.clone().add(new THREE.Vector3((rnd() - 0.5) * 0.3, 0, (rnd() - 0.5) * 0.3)),
        length: (0.4 + rnd() * 1.0) * (0.6 + sp.tagScale * 0.5),
        phase: rnd() * 20,
        spawn: this.spawnTimes.get(tag.id) ?? this.time - 10,
      };
      this.tagInsts.push(inst);
      this.byType.get(tag.itemType)?.push(inst);
      const idx = counters.get(tag.itemType) ?? 0;
      counters.set(tag.itemType, idx + 1);
      const attr = this.glyphAttrs.get(tag.itemType)!;
      attr.setX(idx, tag.id % 4);
    }
    for (const [id, mesh] of this.tagMeshes) {
      mesh.count = this.byType.get(id)!.length;
      this.glyphAttrs.get(id)!.needsUpdate = true;
    }
    this.stringMesh.count = this.tagInsts.length + this.decorAnchors.length;
    this.decorMesh.count = this.decorAnchors.length;
  }

  tagWorldPosition(id: number): THREE.Vector3 | null {
    const inst = this.tagInsts.find((t) => t.tag.id === id);
    if (!inst) return null;
    return inst.anchor.clone().add(new THREE.Vector3(0, -inst.length, 0)).multiplyScalar(this.treeGroup.scale.x).add(new THREE.Vector3(0, TERRACE_H, 0));
  }

  spawnBurst(id: number) {
    const p = this.tagWorldPosition(id);
    if (p) this.emitSparks(p, 60);
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
      if (moved > 8 || !quick) return;
      const rect = this.canvas.getBoundingClientRect();
      const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      this.raycaster.setFromCamera(ndc, this.camera);
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

  private updateEnvironment(dt: number) {
    const world = this.world!;
    const fog = this.sky.update(this.currentHour(), this.time, world.sky, this.camera.position);
    const s = this.sky.state;
    const fogMat = this.scene.fog as THREE.FogExp2;
    fogMat.color.copy(fog);
    fogMat.density = world.fogDensity * (1 + s.night * 0.25);

    const dayW = 1 - s.night;
    this.key.position.copy(s.moonDir).lerp(s.sunDir, dayW).normalize().multiplyScalar(110).add(this.key.target.position);
    this.key.color.copy(s.sunColor).lerp(this.tmpC.set('#a8bcff'), s.night);
    this.key.intensity = (s.sunIntensity * SUN_K * dayW + 1.5 * s.night) * world.lightBias;
    this.hemi.color.copy(s.hemiSky).lerp(fog, 0.25);
    this.hemi.groundColor.copy(s.hemiGround);
    this.hemi.intensity = s.hemiIntensity * HEMI_K * (1 + s.night * 0.35);
    this.renderer.toneMappingExposure = 0.66 + s.night * 0.5;

    this.lightTint.setRGB(0.2, 0.26, 0.45).lerp(this.tmpC.set('#ffffff').multiplyScalar(0.9 + 0.1 * dayW), dayW);
    const trans = this.leafUniforms;
    (trans.uSunColor.value as THREE.Color).copy(s.sunColor).multiplyScalar(dayW * 1.4 + 0.05);
    trans.uTrans.value = 1;
    const sunV = (s.night > 0.5 ? s.moonDir : s.sunDir).clone().transformDirection(this.camera.matrixWorldInverse);
    (trans.uSunView.value as THREE.Vector3).copy(sunV);

    const activity = Math.min(1, this.recent24h / 20);
    const glowBoost = 0.3 + s.night * (1.5 + activity * 1.0);
    for (const item of ITEMS) {
      if (item.glow) this.tagMats.get(item.id)!.emissiveIntensity = glowBoost;
    }
    for (const g of this.kit.glows) g.material.emissiveIntensity = THREE.MathUtils.lerp(g.day, g.night, Math.pow(s.night, 0.8));

    if (this.bloom) {
      this.bloom.strength = 0.18 + s.night * (0.2 + activity * 0.2);
      this.bloom.radius = 0.65;
      this.bloom.threshold = THREE.MathUtils.lerp(2.4, 1.05, s.night);
    }

    world.update(dt, {
      night: s.night,
      sunDir: s.night > 0.6 ? s.moonDir : s.sunDir,
      sunColor: s.night > 0.6 ? this.tmpC.set('#9db4ff') : s.sunColor,
      fogColor: fog,
      fogDensity: fogMat.density,
      wind: this.wind,
      camPos: this.camera.position,
      light: this.lightTint,
      time: this.time,
    });
    this.fauna?.update(dt, { night: s.night, wind: this.wind, time: this.time, camPos: this.camera.position, center: this.controls.target });
    this.particles?.update(dt, this.wind, this.time, this.controls.target, s.night);
  }

  private updateTags() {
    const d = this.dummy;
    const t = this.time;
    const sw = this.wind;
    const tagScale = STAGE_PARAMS[this.stage].tagScale;
    const counters = new Map<ItemId, number>();
    let strIndex = 0;
    for (const inst of this.tagInsts) {
      const age = t - inst.spawn;
      const k = Math.min(1, Math.max(0, age / 1.1));
      const ease = 1 + 2.70158 * Math.pow(k - 1, 3) + 1.70158 * Math.pow(k - 1, 2);
      const appear = k <= 0 ? 0.0001 : ease;
      this.euler.set(Math.cos(t * 1.1 + inst.phase * 1.7) * (0.03 + 0.08 * sw), Math.sin(t * 0.4 + inst.phase) * 0.35, Math.sin(t * 1.3 + inst.phase) * (0.04 + 0.12 * sw) + sw * 0.33);
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
    for (const m of this.tagMeshes.values()) m.instanceMatrix.needsUpdate = true;

    this.decorAnchors.forEach((a, i) => {
      const ph = i * 2.3;
      this.euler.set(Math.cos(t * 1.0 + ph) * (0.03 + 0.06 * sw), i * 1.3, Math.sin(t * 1.2 + ph) * (0.05 + 0.12 * sw) + sw * 0.4);
      d.position.copy(a.position);
      d.quaternion.setFromEuler(this.euler);
      d.scale.setScalar(tagScale * 0.9);
      d.updateMatrix();
      this.decorMesh.setMatrixAt(i, d.matrix);
    });
    this.decorMesh.instanceMatrix.needsUpdate = true;
    this.stringMesh.instanceMatrix.needsUpdate = true;

    this.streamerData.forEach((s, i) => {
      this.euler.set(Math.sin(t * 1.5 + s.phase) * (0.06 + 0.2 * sw), 0, Math.sin(t * 1.9 + s.phase * 1.3) * (0.08 + 0.3 * sw) + sw * 0.5);
      d.position.copy(s.pos);
      d.quaternion.setFromEuler(this.euler);
      d.scale.set(1.6, s.len, 1);
      d.updateMatrix();
      this.streamers.setMatrixAt(i, d.matrix);
    });
    this.streamers.instanceMatrix.needsUpdate = true;
  }

  private updateSparks(dt: number) {
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
      this.controls.target.y = THREE.MathUtils.lerp(c.fromTargetY, c.toTargetY, e);
      this.camera.position.copy(this.controls.target).addScaledVector(dirv, THREE.MathUtils.lerp(c.fromDist, c.toDist, e));
      if (k >= 1) this.cameraTween = null;
    }
    this.controls.autoRotate = this.time - this.lastInteraction > 6 && !this.focus;
    this.controls.update(dt);
    const groundY = this.world ? this.world.heightAt(this.camera.position.x, this.camera.position.z) : 0;
    if (this.camera.position.y < groundY + 0.8) this.camera.position.y = groundY + 0.8;
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
    this.treeGroup.scale.setScalar(gk >= 1 ? 1 : THREE.MathUtils.lerp(this.growFromScale, 1, ge));

    this.updateCamera(dt);
    this.camera.updateMatrixWorld();
    this.updateEnvironment(dt);
    this.updateTags();
    this.updateSparks(dt);

    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);

    this.events.onFrame?.({ wind: this.wind, night: this.sky.state.night, hour: this.sky.state.hour, terrain: this.terrainId });
    this.monitorPerformance(dt);
  }

  private monitorPerformance(dt: number) {
    if (document.hidden || this.lockQuality) return;
    this.fpsFrames++;
    this.fpsTime += dt;
    if (this.fpsTime < 5) return;
    const fps = this.fpsFrames / this.fpsTime;
    this.fpsFrames = 0;
    this.fpsTime = 0;
    const idx = QUALITIES.indexOf(this.quality);
    if (fps < 22 && idx > 0) this.setQuality(QUALITIES[idx - 1]);
  }
}

void TERRACE_R;
