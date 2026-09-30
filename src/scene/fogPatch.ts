import * as THREE from 'three';

/**
 * 高度雾：靠近地面的雾更浓，向上逐渐稀薄，形成薄雾缭绕、远山如墨的层次感。
 * 通过替换 three.js 的雾 shader chunk 全局生效。
 */
let applied = false;

export function applyHeightFog() {
  if (applied) return;
  applied = true;
  const C = THREE.ShaderChunk as Record<string, string>;
  C.fog_pars_vertex = C.fog_pars_vertex.replace('varying float vFogDepth;', 'varying float vFogDepth;\n\tvarying float vFogY;');
  C.fog_vertex = C.fog_vertex.replace(
    'vFogDepth = - mvPosition.z;',
    `vFogDepth = - mvPosition.z;
	#ifdef USE_INSTANCING
		vFogY = ( modelMatrix * instanceMatrix * vec4( position, 1.0 ) ).y;
	#else
		vFogY = ( modelMatrix * vec4( position, 1.0 ) ).y;
	#endif`,
  );
  C.fog_pars_fragment = C.fog_pars_fragment.replace('varying float vFogDepth;', 'varying float vFogDepth;\n\tvarying float vFogY;');
  C.fog_fragment = C.fog_fragment.replace(
    'float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );',
    `float hm = max( 0.5 * ( cameraPosition.y + vFogY ), 0.0 );
		float hk = 0.42 + 0.58 * exp( - hm * 0.045 ) + 1.1 * exp( - hm * 0.7 );
		float fd = fogDensity * hk;
		float fogFactor = 1.0 - exp( - fd * fd * vFogDepth * vFogDepth );`,
  );
}
