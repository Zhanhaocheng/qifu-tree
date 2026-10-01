import * as THREE from 'three';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

const FULLSCREEN_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

/** 屏幕空间径向模糊：从太阳/月亮的亮部拉出穿过树冠与云层的光柱 */
export function createGodRayPass(samples: number) {
  const pass = new ShaderPass({
    name: 'GodRays',
    defines: { SAMPLES: samples },
    uniforms: {
      tDiffuse: { value: null },
      uSun: { value: new THREE.Vector2(0.5, 0.5) },
      uIntensity: { value: 0 },
      uTint: { value: new THREE.Color(1, 0.9, 0.7) },
      uThreshold: { value: 2.0 },
      uAspect: { value: 1 },
    },
    vertexShader: FULLSCREEN_VERT,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse; uniform vec2 uSun; uniform float uIntensity; uniform vec3 uTint; uniform float uThreshold; uniform float uAspect;
      varying vec2 vUv;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      void main() {
        vec4 base = texture2D(tDiffuse, vUv);
        if (uIntensity < 0.002) { gl_FragColor = base; return; }
        vec2 toSun = uSun - vUv;
        float dist = length(vec2(toSun.x * uAspect, toSun.y));
        vec2 step = toSun * (0.92 / float(SAMPLES));
        vec2 p = vUv + step * hash(vUv * 713.0);
        float decay = 1.0;
        vec3 acc = vec3(0.0);
        for (int i = 0; i < SAMPLES; i++) {
          p += step;
          vec2 q = clamp(p, vec2(0.001), vec2(0.999));
          vec3 c = texture2D(tDiffuse, q).rgb;
          float l = max(c.r, max(c.g, c.b));
          float m = smoothstep(uThreshold, uThreshold + 2.5, l);
          acc += c * m * decay;
          decay *= 0.965;
        }
        acc /= float(SAMPLES);
        float fall = exp(-dist * 1.6);
        vec3 rays = acc * uTint * fall * uIntensity;
        gl_FragColor = vec4(base.rgb + rays, base.a);
      }
    `,
  });
  pass.needsSwap = true;
  return pass;
}

/** 最终调色：暗角、对比与饱和、夜间冷调、轻微胶片颗粒 */
export function createGradePass() {
  return new ShaderPass({
    name: 'Grade',
    uniforms: {
      tDiffuse: { value: null },
      uTime: { value: 0 },
      uVignette: { value: 0.32 },
      uContrast: { value: 1.06 },
      uSaturation: { value: 1.1 },
      uNight: { value: 0 },
      uGrain: { value: 0.025 },
      uWarm: { value: new THREE.Color(1, 1, 1) },
    },
    vertexShader: FULLSCREEN_VERT,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse; uniform float uTime; uniform float uVignette; uniform float uContrast; uniform float uSaturation; uniform float uNight; uniform float uGrain; uniform vec3 uWarm;
      varying vec2 vUv;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + uTime) * 43758.5453); }
      void main() {
        vec4 t = texture2D(tDiffuse, vUv);
        vec3 c = t.rgb;
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c = mix(vec3(l), c, uSaturation);
        c = (c - 0.5) * uContrast + 0.5;
        c *= uWarm;
        c = mix(c, c * vec3(0.86, 0.95, 1.12), uNight * 0.6);
        vec2 q = vUv - 0.5;
        float v = smoothstep(0.85, 0.2, length(q * vec2(1.0, 1.1)));
        c *= mix(1.0 - uVignette, 1.0, v);
        c += (hash(vUv * 1000.0) - 0.5) * uGrain;
        gl_FragColor = vec4(max(c, 0.0), t.a);
      }
    `,
  });
}
