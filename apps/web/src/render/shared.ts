import * as THREE from 'three';

/** Uniforms shared by every wind-animated or weather-aware material. */
export const shared = {
  uTime: { value: 0 },
  uWind: { value: 2 },
  uDry: { value: 0 },
  uWet: { value: 0 },
};

/** Patch a standard material so instanced foliage sways. `base` is the height (object space) where sway starts. */
export function addWind(mat: THREE.Material, base: number, strength: number): void {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = shared.uTime;
    sh.uniforms.uWind = shared.uWind;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uWind;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec4 wp = instanceMatrix * vec4(transformed, 1.0);
          float hgt = max(0.0, transformed.y - ${base.toFixed(2)});
          float gust = 0.6 + 0.4 * sin(uTime * 0.31 + wp.x * 0.013 + wp.z * 0.017);
          float sw = sin(uTime * 1.3 + wp.x * 0.21 + wp.z * 0.17) + 0.5 * sin(uTime * 2.9 + wp.x * 0.63 + wp.y * 0.9);
          float amt = sw * uWind * gust * ${strength.toFixed(4)} * hgt;
          transformed.x += amt;
          transformed.z += amt * 0.6;
        #endif`,
      );
  };
}
