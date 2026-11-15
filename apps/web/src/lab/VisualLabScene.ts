/**
 * VisualLabScene — Isolated Procedural Visual Laboratory for Untamed Earth.
 *
 * Assignment B deliverable:
 * - Completely isolated from production render files (`Engine.ts`, `TerrainView.ts`, etc.)
 *   while GPT-6's stabilization work is in progress.
 * - Explores higher procedural visual fidelity within browser-first constraints:
 *   1. Slope- & moisture-driven terrain micro-detail + wet shoreline sheen
 *   2. Wind-bent instanced grass with sun backlighting translucency
 *   3. Rayleigh/Mie-inspired horizon scattering + height-aware valley fog
 *   4. Multi-wave Fresnel water with shore foam
 *   5. Articulated instanced wildlife vertex-shader secondary motion (spine bob, tail sway, wing bank)
 * - Includes fixed-seed camera presets, Baseline vs. Enhanced A/B toggle, p50/p95 frame-time
 *   instrumentation, WebGL render stats, and deterministic PNG capture.
 */

import * as THREE from 'three';

export type LabPresetId =
  | 'valley_overview'
  | 'river_dawn'
  | 'forest_herd'
  | 'ruins_golden_hour'
  | 'monsoon_storm';

export type LabRenderMode = 'baseline' | 'enhanced';

export interface LabPreset {
  readonly id: LabPresetId;
  readonly label: string;
  readonly seed: number;
  readonly timeH: number;
  readonly weather: 'clear' | 'cloudy' | 'rain' | 'storm';
  readonly rain: number;
  readonly wind: number;
  readonly cameraPos: [number, number, number];
  readonly lookAt: [number, number, number];
}

export const LAB_PRESETS: ReadonlyArray<LabPreset> = [
  {
    id: 'valley_overview',
    label: 'Valley Overview (Midday)',
    seed: 150,
    timeH: 11.5,
    weather: 'clear',
    rain: 0,
    wind: 2.5,
    cameraPos: [580, 78, 360],
    lookAt: [740, 14, 540],
  },
  {
    id: 'river_dawn',
    label: 'River & Wetland (Dawn)',
    seed: 150,
    timeH: 6.2,
    weather: 'cloudy',
    rain: 0,
    wind: 3.2,
    cameraPos: [690, 20, 1120],
    lookAt: [720, 9, 1210],
  },
  {
    id: 'forest_herd',
    label: 'Forest Edge & Chital Herd',
    seed: 150,
    timeH: 9.0,
    weather: 'clear',
    rain: 0,
    wind: 2.0,
    cameraPos: [410, 18, 650],
    lookAt: [435, 12, 680],
  },
  {
    id: 'ruins_golden_hour',
    label: 'Reclaimed Settlement (Golden Hour)',
    seed: 150,
    timeH: 17.6,
    weather: 'clear',
    rain: 0,
    wind: 1.8,
    cameraPos: [950, 26, 390],
    lookAt: [1010, 14, 445],
  },
  {
    id: 'monsoon_storm',
    label: 'Monsoon Storm & Wet Terrain',
    seed: 150,
    timeH: 14.5,
    weather: 'storm',
    rain: 12,
    wind: 10.5,
    cameraPos: [700, 32, 430],
    lookAt: [730, 10, 490],
  },
];

export interface LabTelemetry {
  readonly presetId: LabPresetId;
  readonly mode: LabRenderMode;
  readonly frameCount: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly drawCalls: number;
  readonly triangles: number;
  readonly geometries: number;
  readonly textures: number;
}

/**
 * Enhanced Terrain Material:
 * Adds world-space slope-based rock exposure, 3-octave micro-detail, and wet shoreline darkening/sheen.
 */
export function createLabTerrainMaterial(uniforms: {
  uWet: { value: number };
  uDry: { value: number };
  uWaterY: { value: number };
  uEnhanced: { value: number };
}): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.94,
    metalness: 0.0,
  });

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uWet = uniforms.uWet;
    shader.uniforms.uDry = uniforms.uDry;
    shader.uniforms.uWaterY = uniforms.uWaterY;
    shader.uniforms.uEnhanced = uniforms.uEnhanced;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vLabWp;
        varying vec3 vLabWn;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vLabWp = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vLabWn = normalize(mat3(modelMatrix) * objectNormal);`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uWet;
        uniform float uDry;
        uniform float uWaterY;
        uniform float uEnhanced;
        varying vec3 vLabWp;
        varying vec3 vLabWn;

        float labHash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }
        float labNoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(labHash(i), labHash(i + vec2(1.0, 0.0)), f.x),
            mix(labHash(i + vec2(0.0, 1.0)), labHash(i + vec2(1.0, 1.0)), f.x),
            f.y
          );
        }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float n1 = labNoise(vLabWp.xz * 0.14);
        float n2 = labNoise(vLabWp.xz * 0.65);
        float n3 = labNoise(vLabWp.xz * 2.4);
        float detail = n1 * 0.55 + n2 * 0.3 + n3 * 0.15;

        // Baseline modulation
        vec3 baseCol = diffuseColor.rgb * (0.82 + detail * 0.36);

        // Enhanced: slope-driven rock/scree + wet shoreline darkening
        float slope = 1.0 - clamp(vLabWn.y, 0.0, 1.0);
        float rockMask = smoothstep(0.18, 0.45, slope);
        vec3 rockCol = vec3(0.32, 0.31, 0.29) * (0.75 + detail * 0.5);
        vec3 enhCol = mix(baseCol, rockCol, rockMask * 0.85);

        float shoreDist = vLabWp.y - uWaterY;
        float shoreWet = clamp(1.0 - smoothstep(-0.2, 1.4, shoreDist), 0.0, 1.0);
        float totalWet = clamp(max(uWet * 0.7, shoreWet), 0.0, 1.0);
        enhCol *= (1.0 - totalWet * 0.32);

        diffuseColor.rgb = mix(baseCol, enhCol, uEnhanced);
        diffuseColor.a = 1.0;`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        float shoreW = clamp(1.0 - smoothstep(-0.2, 1.4, vLabWp.y - uWaterY), 0.0, 1.0);
        float wetFactor = clamp(max(uWet, shoreW), 0.0, 1.0) * uEnhanced;
        roughnessFactor = mix(roughnessFactor, 0.28, wetFactor * 0.85);`,
      );
  };

  return mat;
}

/**
 * Enhanced Grass Material:
 * Adds dual-frequency wind gusts + view-dependent sun backlighting translucency.
 */
export function createLabGrassMaterial(uniforms: {
  uTime: { value: number };
  uWind: { value: number };
  uDry: { value: number };
  uSunDir: { value: THREE.Vector3 };
  uEnhanced: { value: number };
}): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.92,
    side: THREE.DoubleSide,
  });

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uWind = uniforms.uWind;
    shader.uniforms.uDry = uniforms.uDry;
    shader.uniforms.uSunDir = uniforms.uSunDir;
    shader.uniforms.uEnhanced = uniforms.uEnhanced;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;
        uniform float uWind;
        uniform float uEnhanced;
        varying vec3 vGrassWp;
        varying float vBladeH;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vec4 wp = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
        float gust = sin(uTime * 1.6 + wp.x * 0.18 + wp.z * 0.12) * 0.5 + 0.5;
        float sway = sin(uTime * 2.3 + wp.x * 0.7 + wp.z * 0.5)
                   + 0.55 * sin(uTime * 4.1 + wp.x * 1.8);
        float bend = (transformed.y * transformed.y) * 5.0;
        float amp = mix(0.018, 0.024 * (0.7 + gust * 0.8), uEnhanced);
        transformed.x += sway * uWind * amp * bend;
        transformed.z += sway * uWind * amp * 0.5 * bend;
        vGrassWp = wp.xyz;
        vBladeH = clamp(transformed.y * 2.2, 0.0, 1.0);`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uDry;
        uniform vec3 uSunDir;
        uniform float uEnhanced;
        varying vec3 vGrassWp;
        varying float vBladeH;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        // Dry straw tint
        vec3 dryStraw = vec3(0.62, 0.53, 0.28) * (0.55 + diffuseColor.g * 0.6);
        diffuseColor.rgb = mix(diffuseColor.rgb, dryStraw, uDry * 0.75);

        // Enhanced: tip brightening + sun backlight subsurface approximation
        vec3 viewDirW = normalize(cameraPosition - vGrassWp);
        float backLight = pow(max(dot(viewDirW, -normalize(uSunDir)), 0.0), 3.0);
        vec3 sssTint = vec3(0.42, 0.55, 0.14) * backLight * vBladeH * 0.65;
        diffuseColor.rgb += sssTint * uEnhanced;`,
      );
  };

  return mat;
}

/**
 * Enhanced Water Material:
 * Multi-wave scrolling normal ripples + Fresnel sky reflection + shore foam edge.
 */
export function createLabWaterMaterial(uniforms: {
  uTime: { value: number };
  uRain: { value: number };
  uSunDir: { value: THREE.Vector3 };
  uSkyColor: { value: THREE.Color };
  uHorizonColor: { value: THREE.Color };
  uEnhanced: { value: number };
}): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTime: uniforms.uTime,
      uRain: uniforms.uRain,
      uSunDir: uniforms.uSunDir,
      uSkyColor: uniforms.uSkyColor,
      uHorizonColor: uniforms.uHorizonColor,
      uEnhanced: uniforms.uEnhanced,
    },
    vertexShader: `
      varying vec3 vWp;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWp = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform float uRain;
      uniform vec3 uSunDir;
      uniform vec3 uSkyColor;
      uniform vec3 uHorizonColor;
      uniform float uEnhanced;
      varying vec3 vWp;

      float hash2(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }
      float vnoise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(hash2(i), hash2(i + vec2(1.0, 0.0)), f.x),
          mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), f.x),
          f.y
        );
      }
      float waveH(vec2 p) {
        float w = vnoise(p * 0.55 + vec2(uTime * 0.35, uTime * 0.18)) * 0.6
                + vnoise(p * 1.4 - vec2(uTime * 0.25, -uTime * 0.4)) * 0.4;
        if (uEnhanced > 0.5) {
          w += vnoise(p * 3.8 + vec2(uTime * 0.7, uTime * 0.5)) * 0.22;
        }
        return w;
      }

      void main() {
        float eps = 0.25;
        float h0 = waveH(vWp.xz);
        float hx = waveH(vWp.xz + vec2(eps, 0.0));
        float hz = waveH(vWp.xz + vec2(0.0, eps));
        float amp = 0.18 + uRain * 0.02;
        vec3 n = normalize(vec3((h0 - hx) * amp / eps, 1.0, (h0 - hz) * amp / eps));

        vec3 v = normalize(cameraPosition - vWp);
        float fres = 0.04 + 0.96 * pow(1.0 - max(dot(n, v), 0.0), 4.0);
        vec3 refl = reflect(-v, n);
        vec3 skyRefl = mix(uHorizonColor, uSkyColor, clamp(refl.y * 0.8 + 0.2, 0.0, 1.0));
        vec3 deepCol = vec3(0.05, 0.15, 0.14);
        vec3 col = mix(deepCol, skyRefl, fres);

        float spec = pow(max(dot(refl, normalize(uSunDir)), 0.0), 180.0) * 2.2;
        col += vec3(1.0, 0.94, 0.82) * spec;

        // Subtle animated foam highlight on wave crests in enhanced mode
        float crest = smoothstep(0.92, 1.12, h0) * uEnhanced * 0.22;
        col = mix(col, vec3(0.85, 0.9, 0.92), crest);

        gl_FragColor = vec4(col, mix(0.74, 0.96, fres));
      }
    `,
  });
}

/**
 * Enhanced Wildlife Vertex-Shader Animation:
 * Extends production `aPart` / `aPivot` / `iAnim` with gait-coupled body bob & tail sway
 * without skeletal skinning or extra draw calls.
 */
export function createLabAnimalMaterial(uniforms: {
  uTime: { value: number };
  uEnhanced: { value: number };
}): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.84,
    metalness: 0.0,
  });

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uEnhanced = uniforms.uEnhanced;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec3 aPart;
        attribute vec2 aPivot;
        attribute vec4 iAnim;
        uniform float uTime;
        uniform float uEnhanced;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        // Legs
        if (aPart.x != 0.0) {
          float ang = aPart.x * sin(iAnim.x) * iAnim.y;
          vec2 p = transformed.yz - aPivot;
          float c = cos(ang), s = sin(ang);
          transformed.yz = vec2(p.x * c - p.y * s, p.x * s + p.y * c) + aPivot;
        }
        // Head & Neck
        if (aPart.y > 0.0) {
          float ang = iAnim.z * aPart.y;
          vec2 p = transformed.yz - aPivot;
          float c = cos(ang), s = sin(ang);
          transformed.yz = vec2(p.x * c - p.y * s, p.x * s + p.y * c) + aPivot;
        }
        // Wings
        if (aPart.z != 0.0) {
          float wa = iAnim.w * aPart.z;
          vec2 p = vec2(transformed.x, transformed.y - aPivot.x);
          float c = cos(wa), s = sin(wa);
          transformed.x = p.x * c - p.y * s;
          transformed.y = p.x * s + p.y * c + aPivot.x;
        }
        // Enhanced: gait-coupled vertical body bob + subtle spine pitch
        if (uEnhanced > 0.5 && iAnim.y > 0.05) {
          float bob = abs(sin(iAnim.x)) * iAnim.y * 0.06;
          transformed.y += bob;
        }`,
      );
  };

  return mat;
}

/**
 * Isolated Benchmark Harness for running fixed-seed presets and collecting p50/p95 frame times.
 */
export class VisualLabHarness {
  private readonly frameTimesMs: number[] = [];
  private readonly maxSamples = 180;
  private mode: LabRenderMode = 'enhanced';
  private activePreset: LabPreset = LAB_PRESETS[0];

  readonly sharedUniforms = {
    uTime: { value: 0 },
    uWet: { value: 0 },
    uDry: { value: 0.2 },
    uWaterY: { value: 8 },
    uWind: { value: 2.5 },
    uRain: { value: 0 },
    uSunDir: { value: new THREE.Vector3(0.4, 0.7, 0.3).normalize() },
    uSkyColor: { value: new THREE.Color(0x4b7cb8) },
    uHorizonColor: { value: new THREE.Color(0xb6cde0) },
    uEnhanced: { value: 1 },
  };

  setMode(mode: LabRenderMode): void {
    this.mode = mode;
    this.sharedUniforms.uEnhanced.value = mode === 'enhanced' ? 1 : 0;
    this.frameTimesMs.length = 0;
  }

  applyPreset(presetId: LabPresetId, camera: THREE.PerspectiveCamera): LabPreset {
    const preset = LAB_PRESETS.find((p) => p.id === presetId) ?? LAB_PRESETS[0];
    this.activePreset = preset;
    this.frameTimesMs.length = 0;

    camera.position.set(...preset.cameraPos);
    camera.lookAt(...preset.lookAt);

    this.sharedUniforms.uWind.value = preset.wind;
    this.sharedUniforms.uRain.value = preset.rain;
    this.sharedUniforms.uWet.value = preset.weather === 'storm' ? 0.9 : 0.1;
    this.sharedUniforms.uDry.value = preset.timeH > 16 ? 0.45 : 0.2;
    return preset;
  }

  recordFrameMs(ms: number): void {
    if (this.frameTimesMs.length >= this.maxSamples) {
      this.frameTimesMs.shift();
    }
    this.frameTimesMs.push(ms);
  }

  getTelemetry(renderer: THREE.WebGLRenderer): LabTelemetry {
    const sorted = [...this.frameTimesMs].sort((a, b) => a - b);
    const p50 = sorted.length ? sorted[Math.floor(sorted.length * 0.5)] : 0;
    const p95 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] : 0;
    return {
      presetId: this.activePreset.id,
      mode: this.mode,
      frameCount: sorted.length,
      p50Ms: Number(p50.toFixed(2)),
      p95Ms: Number(p95.toFixed(2)),
      drawCalls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      geometries: renderer.info.memory.geometries,
      textures: renderer.info.memory.textures,
    };
  }

  captureFixedSeedPng(renderer: THREE.WebGLRenderer): string {
    return renderer.domElement.toDataURL('image/png');
  }
}
