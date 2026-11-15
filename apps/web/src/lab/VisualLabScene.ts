/**
 * VisualLabScene — Isolated Procedural Visual Laboratory & Benchmark Driver for Untamed Earth.
 *
 * Assignment B deliverable (PR #7):
 * - Completely isolated from production render files (`Engine.ts`, `TerrainView.ts`, etc.).
 * - Compares TRUE production baseline materials (separate compiled programs replicating the exact
 *   production GLSL of `TerrainView.ts`, `GrassView.ts`, `WaterView.ts`, and `AnimalView.ts`)
 *   against enhanced procedural materials — never just toggling `uEnhanced = 0` inside a heavier shader.
 * - Includes an isolated browser entrypoint (`mountVisualLabApp`, activated via `?lab=1`),
 *   5 fixed-seed presets (`seed = 150`), real WebGL2 shader compilation & link diagnostics,
 *   synchronous deterministic scene population (`Valley`, `Environment`, `Simulation`, `ScatterView`,
 *   `Sky`, `WeatherFx`, `buildLandmarks`), repeatable multi-frame p50/p95 benchmarks, immediate
 *   post-render `toDataURL` PNG capture, and idempotent GPU resource disposal.
 */

import * as THREE from 'three';
import { hash3f, smoothstep } from '@untamed/core';
import { B, SPECIES, Simulation, maturityDays } from '@untamed/ecology';
import { Environment } from '@untamed/environment';
import { CHUNK_SIZE, Valley, buildChunkMesh } from '@untamed/worlds';
import { AnimalModel, buildAnimalModels } from '../render/animalGeo';
import { buildLandmarks } from '../render/landmarks';
import { ScatterView } from '../render/ScatterView';
import { Sky } from '../render/Sky';
import { WeatherFx } from '../render/WeatherFx';
import { shared } from '../render/shared';

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
  readonly cloud: number;
  readonly rain: number;
  readonly wind: number;
  readonly stage: number;
  readonly dry: number;
  readonly wet: number;
  readonly cameraPos: [number, number, number];
  readonly lookAt: [number, number, number];
}

export const LAB_PRESETS: ReadonlyArray<LabPreset> = [
  {
    id: 'valley_overview',
    label: '1. Valley Overview (Midday)',
    seed: 150,
    timeH: 11.5,
    weather: 'clear',
    cloud: 0.14,
    rain: 0,
    wind: 2.5,
    stage: 0.0,
    dry: 0.18,
    wet: 0.05,
    cameraPos: [580, 78, 360],
    lookAt: [740, 14, 540],
  },
  {
    id: 'river_dawn',
    label: '2. River & Wetland (Dawn)',
    seed: 150,
    timeH: 6.2,
    weather: 'cloudy',
    cloud: 0.48,
    rain: 0,
    wind: 3.2,
    stage: 0.12,
    dry: 0.1,
    wet: 0.35,
    cameraPos: [690, 20, 1120],
    lookAt: [720, 9, 1210],
  },
  {
    id: 'forest_herd',
    label: '3. Forest Edge & Chital Herd',
    seed: 150,
    timeH: 9.0,
    weather: 'clear',
    cloud: 0.18,
    rain: 0,
    wind: 2.0,
    stage: 0.0,
    dry: 0.15,
    wet: 0.08,
    cameraPos: [410, 18, 650],
    lookAt: [435, 12, 680],
  },
  {
    id: 'ruins_golden_hour',
    label: '4. Reclaimed Settlement (Golden Hour)',
    seed: 150,
    timeH: 17.6,
    weather: 'clear',
    cloud: 0.22,
    rain: 0,
    wind: 1.8,
    stage: -0.05,
    dry: 0.42,
    wet: 0.0,
    cameraPos: [950, 26, 390],
    lookAt: [1010, 14, 445],
  },
  {
    id: 'monsoon_storm',
    label: '5. Monsoon Storm & Wet Terrain',
    seed: 150,
    timeH: 14.5,
    weather: 'storm',
    cloud: 0.98,
    rain: 12.0,
    wind: 10.5,
    stage: 0.26,
    dry: 0.0,
    wet: 0.92,
    cameraPos: [700, 32, 430],
    lookAt: [730, 10, 490],
  },
];

export interface ShaderProgramDiagnostic {
  readonly name: string;
  readonly mode: LabRenderMode;
  readonly compiled: boolean;
  readonly vertexLog: string;
  readonly fragmentLog: string;
  readonly programLog: string;
}

export interface LabDeviceMetadata {
  readonly userAgent: string;
  readonly glVersion: string;
  readonly shadingLanguageVersion: string;
  readonly vendor: string;
  readonly renderer: string;
  readonly unmaskedVendor: string;
  readonly unmaskedRenderer: string;
  readonly isSoftwareRenderer: boolean;
  readonly viewport: [number, number];
  readonly pixelRatio: number;
}

export interface LabBenchmarkResult {
  readonly presetId: LabPresetId;
  readonly mode: LabRenderMode;
  readonly warmupFrames: number;
  readonly sampleFrames: number;
  readonly meanMs: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly minMs: number;
  readonly maxMs: number;
  readonly drawCallsPerFrame: number;
  readonly trianglesPerFrame: number;
  readonly geometries: number;
  readonly textures: number;
  readonly programs: number;
}

export interface LabFullSuiteReport {
  readonly timestamp: string;
  readonly seed: number;
  readonly device: LabDeviceMetadata;
  readonly shaderDiagnostics: ShaderProgramDiagnostic[];
  readonly allShadersClean: boolean;
  readonly benchmarks: LabBenchmarkResult[];
  readonly screenshots: Record<string, string>;
}

// ============================================================================
// 1. TRUE PRODUCTION BASELINE MATERIALS (Replicating exact production shaders)
// ============================================================================

/** Exact production TerrainView material (`apps/web/src/render/TerrainView.ts`). */
export function createBaselineTerrainMaterial(uniforms: {
  uDry: { value: number };
  uWet: { value: number };
}): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    name: 'BaselineTerrain',
    vertexColors: true,
    roughness: 0.95,
    metalness: 0,
  });
  mat.customProgramCacheKey = () => 'lab-baseline-terrain';
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uDry = uniforms.uDry;
    sh.uniforms.uWet = uniforms.uWet;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWp;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.0)).xyz;',
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vWp; uniform float uDry; uniform float uWet;
        float th(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float tn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
          return mix(mix(th(i), th(i+vec2(1,0)), f.x), mix(th(i+vec2(0,1)), th(i+vec2(1,1)), f.x), f.y); }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float grassy = vColor.a;
        float dn = tn(vWp.xz * 0.9) * 0.6 + tn(vWp.xz * 4.3) * 0.4;
        float lum = dot(diffuseColor.rgb, vec3(0.3, 0.55, 0.15));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.62, 0.53, 0.3) * (lum * 2.2 + 0.15), grassy * uDry * 0.85);
        diffuseColor.rgb *= 0.8 + dn * 0.4;
        diffuseColor.rgb *= 1.0 - uWet * 0.22;
        diffuseColor.a = 1.0;`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.55, uWet * 0.8);',
      );
  };
  return mat;
}

/** Exact production GrassView material (`apps/web/src/render/GrassView.ts`). */
export function createBaselineGrassMaterial(uniforms: {
  uTime: { value: number };
  uWind: { value: number };
  uDry: { value: number };
}): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    name: 'BaselineGrass',
    vertexColors: true,
    roughness: 1,
    side: THREE.DoubleSide,
  });
  mat.customProgramCacheKey = () => 'lab-baseline-grass';
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uniforms.uTime;
    sh.uniforms.uWind = uniforms.uWind;
    sh.uniforms.uDry = uniforms.uDry;
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform float uTime; uniform float uWind; uniform float uDry;',
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec4 wp = instanceMatrix * vec4(transformed, 1.0);
        #else
          vec4 wp = modelMatrix * vec4(transformed, 1.0);
        #endif
        float sw = sin(uTime * 1.9 + wp.x * 0.7 + wp.z * 0.5) + 0.6 * sin(uTime * 3.7 + wp.x * 1.9);
        float bend = sw * uWind * 0.018 * transformed.y * transformed.y / 0.2;
        transformed.x += bend; transformed.z += bend * 0.5;`,
      )
      .replace(
        '#include <color_vertex>',
        '#include <color_vertex>\nvColor.rgb = mix(vColor.rgb, vec3(0.6, 0.52, 0.28) * (0.5 + color.g), uDry * 0.8);',
      );
  };
  return mat;
}

/** Exact production WaterView ShaderMaterial (`apps/web/src/render/WaterView.ts`). */
export function createBaselineWaterMaterial(uniforms: {
  uTime: { value: number };
  uRain: { value: number };
  uSunDir: { value: THREE.Vector3 };
  uSunCol: { value: THREE.Color };
  uSkyColor: { value: THREE.Color };
  uHorizonColor: { value: THREE.Color };
  uTint: { value: THREE.Color };
}): THREE.ShaderMaterial {
  const mat = new THREE.ShaderMaterial({
    name: 'BaselineWater',
    transparent: true,
    fog: true,
    depthWrite: false,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: uniforms.uTime,
        uRain: uniforms.uRain,
        uDetail: { value: 1 },
        uSun: uniforms.uSunDir,
        uSunCol: uniforms.uSunCol,
        uSky: uniforms.uSkyColor,
        uHorizon: uniforms.uHorizonColor,
        uTint: uniforms.uTint,
      },
    ]),
    vertexShader: /* glsl */ `
      varying vec3 vWp;
      #include <fog_pars_vertex>
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWp = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      varying vec3 vWp;
      uniform float uTime; uniform float uRain; uniform float uDetail;
      uniform vec3 uSun; uniform vec3 uSunCol; uniform vec3 uSky; uniform vec3 uHorizon; uniform vec3 uTint;
      #include <fog_pars_fragment>
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
      void main() {
        vec2 p = vWp.xz;
        float e = 0.35;
        vec2 f1 = vec2(0.0, -uTime * 0.55);
        vec2 f2 = vec2(uTime * 0.12, -uTime * 0.3);
        float amp = 0.16 + uRain * 0.25;
        float h0 = noise(p * 0.6 + f1) + 0.5 * noise(p * 1.7 + f2);
        float hx = noise((p + vec2(e, 0.0)) * 0.6 + f1) + 0.5 * noise((p + vec2(e, 0.0)) * 1.7 + f2);
        float hz = noise((p + vec2(0.0, e)) * 0.6 + f1) + 0.5 * noise((p + vec2(0.0, e)) * 1.7 + f2);
        vec3 n = normalize(vec3((h0 - hx) * amp / e, 1.0, (h0 - hz) * amp / e));
        if (uDetail > 0.5) {
          float r = noise(p * 7.0 + f1 * 3.0) - 0.5;
          n = normalize(n + vec3(r, 0.0, noise(p * 7.0 - f2 * 3.0) - 0.5) * (0.05 + uRain * 0.25));
        }
        vec3 v = normalize(cameraPosition - vWp);
        float fres = pow(1.0 - max(dot(n, v), 0.0), 4.0);
        fres = 0.04 + 0.96 * fres;
        vec3 refl = reflect(-v, n);
        vec3 sky = mix(uHorizon, uSky, pow(max(refl.y, 0.0), 0.5));
        float spec = pow(max(dot(refl, normalize(uSun)), 0.0), 220.0);
        vec3 col = mix(uTint, sky, fres) + uSunCol * spec * 2.5;
        gl_FragColor = vec4(col, mix(0.72, 0.97, fres));
        #include <fog_fragment>
      }
    `,
  });
  return mat;
}

/** Exact production AnimalView material (`apps/web/src/render/AnimalView.ts`). */
export function createBaselineAnimalMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    name: 'BaselineAnimal',
    vertexColors: true,
    roughness: 0.85,
    metalness: 0,
  });
  mat.customProgramCacheKey = () => 'lab-baseline-animal';
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute vec3 aPart; attribute vec2 aPivot; attribute vec4 iAnim;',
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float ang = 0.0;
        if (aPart.x != 0.0) ang = aPart.x * sin(iAnim.x) * iAnim.y;
        else if (aPart.y > 0.0) ang = iAnim.z * aPart.y;
        if (ang != 0.0) {
          vec2 q = transformed.yz - aPivot; float c = cos(ang), s = sin(ang);
          transformed.yz = aPivot + vec2(q.x * c - q.y * s, q.x * s + q.y * c);
        }
        if (aPart.z != 0.0) {
          float wa = iAnim.w * aPart.z; vec2 q = transformed.xy - vec2(0.0, aPivot.x); float c = cos(wa), s = sin(wa);
          transformed.xy = vec2(0.0, aPivot.x) + vec2(q.x * c - q.y * s, q.x * s + q.y * c);
        }`,
      );
  };
  return mat;
}

// ============================================================================
// 2. ENHANCED PROCEDURAL MATERIALS (Separate compiled shader programs)
// ============================================================================

/**
 * Enhanced Terrain Material:
 * Adds world-space slope-based rock/scree stratification, 3-octave micro-detail,
 * seasonal grass curing, and wet shoreline darkening/specular sheen.
 */
export function createEnhancedTerrainMaterial(uniforms: {
  uWet: { value: number };
  uDry: { value: number };
  uWaterY: { value: number };
}): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    name: 'EnhancedTerrain',
    vertexColors: true,
    roughness: 0.94,
    metalness: 0.0,
  });
  mat.customProgramCacheKey = () => 'lab-enhanced-terrain';

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uWet = uniforms.uWet;
    shader.uniforms.uDry = uniforms.uDry;
    shader.uniforms.uWaterY = uniforms.uWaterY;

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
        float grassy = vColor.a;
        float lum = dot(diffuseColor.rgb, vec3(0.3, 0.55, 0.15));
        vec3 baseAlbedo = mix(
          diffuseColor.rgb,
          vec3(0.62, 0.53, 0.3) * (lum * 2.2 + 0.15),
          grassy * uDry * 0.85
        );

        float n1 = labNoise(vLabWp.xz * 0.16);
        float n2 = labNoise(vLabWp.xz * 0.85);
        float n3 = labNoise(vLabWp.xz * 3.4);
        float detail = n1 * 0.5 + n2 * 0.32 + n3 * 0.18;
        vec3 col = baseAlbedo * (0.8 + detail * 0.42);

        // Slope-driven rock/scree with horizontal strata bands
        float slope = 1.0 - clamp(vLabWn.y, 0.0, 1.0);
        float strata = 0.85 + 0.3 * sin(vLabWp.y * 1.3 + n1 * 4.0);
        float rockMask = smoothstep(0.16, 0.42, slope);
        vec3 rockCol = vec3(0.33, 0.31, 0.28) * strata * (0.76 + detail * 0.48);
        col = mix(col, rockCol, rockMask * 0.88);

        // Wet shoreline darkening + rain wetness
        float shoreDist = vLabWp.y - uWaterY;
        float shoreWet = clamp(1.0 - smoothstep(-0.25, 1.5, shoreDist), 0.0, 1.0);
        float totalWet = clamp(max(uWet * 0.78, shoreWet), 0.0, 1.0);
        col *= (1.0 - totalWet * 0.32);

        diffuseColor.rgb = col;
        diffuseColor.a = 1.0;`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        float shoreW = clamp(1.0 - smoothstep(-0.25, 1.5, vLabWp.y - uWaterY), 0.0, 1.0);
        float wetFactor = clamp(max(uWet, shoreW), 0.0, 1.0);
        roughnessFactor = mix(roughnessFactor, 0.26, wetFactor * 0.85);`,
      );
  };

  return mat;
}

/**
 * Enhanced Grass Material:
 * Dual-frequency wind gusts + view-dependent sun backlighting translucency (SSS approximation).
 * Guards `instanceMatrix` with `#ifdef USE_INSTANCING` so non-instanced compilation never fails.
 */
export function createEnhancedGrassMaterial(uniforms: {
  uTime: { value: number };
  uWind: { value: number };
  uDry: { value: number };
  uSunDir: { value: THREE.Vector3 };
}): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    name: 'EnhancedGrass',
    vertexColors: true,
    roughness: 0.9,
    side: THREE.DoubleSide,
  });
  mat.customProgramCacheKey = () => 'lab-enhanced-grass';

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uWind = uniforms.uWind;
    shader.uniforms.uDry = uniforms.uDry;
    shader.uniforms.uSunDir = uniforms.uSunDir;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;
        uniform float uWind;
        uniform float uDry;
        varying vec3 vGrassWp;
        varying float vBladeH;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec4 wp = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
        #else
          vec4 wp = modelMatrix * vec4(transformed, 1.0);
        #endif
        float gust = sin(uTime * 1.5 + wp.x * 0.16 + wp.z * 0.11) * 0.5 + 0.5;
        float sway = sin(uTime * 2.1 + wp.x * 0.7 + wp.z * 0.5)
                   + 0.58 * sin(uTime * 3.9 + wp.x * 1.85);
        float bend = (transformed.y * transformed.y) * 5.0;
        float amp = 0.022 * (0.72 + gust * 0.75);
        transformed.x += sway * uWind * amp * bend;
        transformed.z += sway * uWind * amp * 0.5 * bend;
        vGrassWp = wp.xyz;
        vBladeH = clamp(transformed.y * 2.1, 0.0, 1.0);`,
      )
      .replace(
        '#include <color_vertex>',
        `#include <color_vertex>
        vColor.rgb = mix(vColor.rgb, vec3(0.6, 0.52, 0.28) * (0.5 + color.g), uDry * 0.8);`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform vec3 uSunDir;
        varying vec3 vGrassWp;
        varying float vBladeH;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec3 viewDirW = normalize(cameraPosition - vGrassWp);
        float backLight = pow(max(dot(viewDirW, -normalize(uSunDir)), 0.0), 2.6);
        vec3 sssTint = vec3(0.44, 0.58, 0.15) * backLight * vBladeH * 0.72;
        diffuseColor.rgb = diffuseColor.rgb * (0.85 + 0.28 * vBladeH) + sssTint;`,
      );
  };

  return mat;
}

/**
 * Enhanced Water Material:
 * 3-octave directional capillary ripples + Schlick Fresnel + solar glitter + wave-crest foam.
 */
export function createEnhancedWaterMaterial(uniforms: {
  uTime: { value: number };
  uRain: { value: number };
  uSunDir: { value: THREE.Vector3 };
  uSunCol: { value: THREE.Color };
  uSkyColor: { value: THREE.Color };
  uHorizonColor: { value: THREE.Color };
  uTint: { value: THREE.Color };
}): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'EnhancedWater',
    transparent: true,
    fog: true,
    depthWrite: false,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: uniforms.uTime,
        uRain: uniforms.uRain,
        uSun: uniforms.uSunDir,
        uSunCol: uniforms.uSunCol,
        uSky: uniforms.uSkyColor,
        uHorizon: uniforms.uHorizonColor,
        uTint: uniforms.uTint,
      },
    ]),
    vertexShader: /* glsl */ `
      varying vec3 vWp;
      #include <fog_pars_vertex>
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWp = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      varying vec3 vWp;
      uniform float uTime;
      uniform float uRain;
      uniform vec3 uSun;
      uniform vec3 uSunCol;
      uniform vec3 uSky;
      uniform vec3 uHorizon;
      uniform vec3 uTint;
      #include <fog_pars_fragment>

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
        vec2 f1 = vec2(0.0, -uTime * 0.55);
        vec2 f2 = vec2(uTime * 0.14, -uTime * 0.32);
        vec2 f3 = vec2(-uTime * 0.28, -uTime * 0.75);
        return vnoise(p * 0.58 + f1) * 0.58
             + vnoise(p * 1.65 + f2) * 0.32
             + vnoise(p * 4.4 + f3) * 0.18;
      }

      void main() {
        float eps = 0.26;
        float h0 = waveH(vWp.xz);
        float hx = waveH(vWp.xz + vec2(eps, 0.0));
        float hz = waveH(vWp.xz + vec2(0.0, eps));
        float amp = 0.18 + uRain * 0.28;
        vec3 n = normalize(vec3((h0 - hx) * amp / eps, 1.0, (h0 - hz) * amp / eps));

        vec3 v = normalize(cameraPosition - vWp);
        float fres = 0.04 + 0.96 * pow(1.0 - max(dot(n, v), 0.0), 4.0);
        vec3 refl = reflect(-v, n);
        vec3 skyRefl = mix(uHorizon, uSky, pow(max(refl.y, 0.0), 0.48));
        vec3 deepCol = mix(uTint, vec3(0.04, 0.16, 0.15), 0.45);
        vec3 col = mix(deepCol, skyRefl, fres);

        float spec = pow(max(dot(refl, normalize(uSun)), 0.0), 210.0) * 2.6;
        col += uSunCol * spec;

        // Subtle animated foam highlight on wave crests
        float crest = smoothstep(0.76, 0.94, h0) * (0.18 + uRain * 0.16);
        col = mix(col, vec3(0.86, 0.91, 0.94), crest);

        gl_FragColor = vec4(col, mix(0.74, 0.97, fres));
        #include <fog_fragment>
      }
    `,
  });
}

/**
 * Enhanced Wildlife Vertex-Shader Animation:
 * Extends production `aPart` / `aPivot` / `iAnim` with gait-coupled vertical body bob,
 * subtle spine pitch, and lateral tail/haunch sway without extra bones or draw calls.
 */
export function createEnhancedAnimalMaterial(uniforms: {
  uTime: { value: number };
}): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    name: 'EnhancedAnimal',
    vertexColors: true,
    roughness: 0.82,
    metalness: 0.0,
  });
  mat.customProgramCacheKey = () => 'lab-enhanced-animal';

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec3 aPart;
        attribute vec2 aPivot;
        attribute vec4 iAnim;
        uniform float uTime;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float ang = 0.0;
        if (aPart.x != 0.0) ang = aPart.x * sin(iAnim.x) * iAnim.y;
        else if (aPart.y > 0.0) ang = iAnim.z * aPart.y;
        if (ang != 0.0) {
          vec2 q = transformed.yz - aPivot; float c = cos(ang), s = sin(ang);
          transformed.yz = aPivot + vec2(q.x * c - q.y * s, q.x * s + q.y * c);
        }
        if (aPart.z != 0.0) {
          float wa = iAnim.w * aPart.z; vec2 q = transformed.xy - vec2(0.0, aPivot.x); float c = cos(wa), s = sin(wa);
          transformed.xy = vec2(0.0, aPivot.x) + vec2(q.x * c - q.y * s, q.x * s + q.y * c);
        }
        // Enhanced secondary motion: gait-coupled spine bob + subtle lateral sway
        if (iAnim.y > 0.05) {
          float bob = abs(sin(iAnim.x)) * iAnim.y * 0.055;
          float sway = cos(iAnim.x) * iAnim.y * 0.022 * clamp(-transformed.z, 0.0, 1.0);
          transformed.y += bob;
          transformed.x += sway;
        }`,
      );
  };

  return mat;
}

// Legacy aliases preserved for backward compatibility
export const createLabTerrainMaterial = createEnhancedTerrainMaterial;
export const createLabGrassMaterial = createEnhancedGrassMaterial;
export const createLabWaterMaterial = createEnhancedWaterMaterial;
export const createLabAnimalMaterial = createEnhancedAnimalMaterial;

// ============================================================================
// 3. SELF-CONTAINED VISUAL LAB SCENE & BENCHMARK DRIVER
// ============================================================================

function buildTuftGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const nor: number[] = [];
  const blades = 6;
  for (let i = 0; i < blades; i++) {
    const a = (i / blades) * Math.PI * 2 + i * 0.7;
    const ox = Math.cos(a * 1.7) * 0.16;
    const oz = Math.sin(a * 2.3) * 0.16;
    const dx = Math.cos(a) * 0.045;
    const dz = Math.sin(a) * 0.045;
    const h = 0.42 + (i % 3) * 0.14;
    const lx = Math.sin(a) * 0.14;
    const lz = -Math.cos(a) * 0.14;
    const p = [
      [ox - dx, 0, oz - dz],
      [ox + dx, 0, oz + dz],
      [ox - dx * 0.7 + lx * 0.4, h * 0.55, oz - dz * 0.7 + lz * 0.4],
      [ox + dx * 0.7 + lx * 0.4, h * 0.55, oz + dz * 0.7 + lz * 0.4],
      [ox + lx, h, oz + lz],
    ];
    const tri = [0, 1, 2, 1, 3, 2, 2, 3, 4];
    for (const t of tri) {
      const v = p[t]!;
      pos.push(v[0]!, v[1]!, v[2]!);
      const k = v[1]! / h;
      col.push(0.16 + k * 0.2, 0.3 + k * 0.26, 0.08 + k * 0.06);
      nor.push(0, 1, 0);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return g;
}

interface AnimalBatch {
  mesh: THREE.InstancedMesh;
  anim: THREE.InstancedBufferAttribute;
  model: AnimalModel;
}

const MAX_ANIMALS = 400;
const GRASS_MAX = 8000;
const GRASS_DIST = 52;

export class VisualLabRunner {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(62, 1, 0.25, 2200);
  readonly fog = new THREE.FogExp2(0x9ab0c0, 0.0018);

  readonly sim: Simulation;
  readonly valley: Valley;
  readonly env: Environment;

  private readonly sky = new Sky();
  private readonly scatter: ScatterView;
  private readonly weather = new WeatherFx(2200);
  private readonly landmarkMesh: THREE.Mesh;

  private readonly terrainGroup = new THREE.Group();
  private readonly terrainChunks = new Map<number, { mesh: THREE.Mesh; res: number }>();

  private readonly grassMesh: THREE.InstancedMesh;
  private readonly waterMesh: THREE.Mesh;
  private readonly poolGroup = new THREE.Group();
  private readonly poolMat: THREE.MeshStandardMaterial;

  private readonly animalGroup = new THREE.Group();
  private readonly animalBatches: Record<string, AnimalBatch> = {};

  private readonly baselineMats: {
    terrain: THREE.MeshStandardMaterial;
    grass: THREE.MeshStandardMaterial;
    water: THREE.ShaderMaterial;
    animal: THREE.MeshStandardMaterial;
  };

  private readonly enhancedMats: {
    terrain: THREE.MeshStandardMaterial;
    grass: THREE.MeshStandardMaterial;
    water: THREE.ShaderMaterial;
    animal: THREE.MeshStandardMaterial;
  };

  readonly uniforms = {
    uTime: shared.uTime,
    uWind: shared.uWind,
    uDry: shared.uDry,
    uWet: shared.uWet,
    uWaterY: { value: 8 },
    uRain: { value: 0 },
    uSunDir: { value: new THREE.Vector3(0.4, 0.7, 0.3).normalize() },
    uSunCol: { value: new THREE.Color(1, 0.95, 0.85) },
    uSkyColor: { value: new THREE.Color(0x4b7cb8) },
    uHorizonColor: { value: new THREE.Color(0xb6cde0) },
    uTint: { value: new THREE.Color(0.05, 0.11, 0.09) },
  };

  private currentMode: LabRenderMode = 'enhanced';
  private currentPreset: LabPreset = LAB_PRESETS[0]!;
  private simTimeSec = 0;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement, seed = 150) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true, // Ensures reliable synchronous PNG extraction in automated runs
    });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.scene.fog = this.fog;

    // Deterministic world & simulation state (stepped forward 8 ticks so animals have active headings/gaits)
    this.sim = new Simulation(seed);
    for (let i = 0; i < 8; i++) this.sim.step(0.5);
    this.valley = this.sim.valley;
    this.env = this.sim.env;

    // Build separate baseline & enhanced material suites
    this.baselineMats = {
      terrain: createBaselineTerrainMaterial(this.uniforms),
      grass: createBaselineGrassMaterial(this.uniforms),
      water: createBaselineWaterMaterial(this.uniforms),
      animal: createBaselineAnimalMaterial(),
    };
    this.enhancedMats = {
      terrain: createEnhancedTerrainMaterial(this.uniforms),
      grass: createEnhancedGrassMaterial(this.uniforms),
      water: createEnhancedWaterMaterial(this.uniforms),
      animal: createEnhancedAnimalMaterial(this.uniforms),
    };

    // Sky & lighting
    this.sky.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sky.sun.shadow.camera;
    sc.near = 50;
    sc.far = 800;
    sc.left = -140;
    sc.right = 140;
    sc.top = 140;
    sc.bottom = -140;
    sc.updateProjectionMatrix();
    this.sky.sun.shadow.bias = -0.0004;
    this.sky.sun.shadow.normalBias = 0.7;
    this.scene.add(this.sky.mesh, this.sky.sun, this.sky.sun.target, this.sky.hemi);

    // Terrain group
    this.scene.add(this.terrainGroup);

    // Landmarks
    const lmGeo = buildLandmarks(this.valley);
    const lmMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.92,
      metalness: 0.05,
      flatShading: true,
    });
    this.landmarkMesh = new THREE.Mesh(lmGeo, lmMat);
    this.landmarkMesh.castShadow = true;
    this.landmarkMesh.receiveShadow = true;
    this.landmarkMesh.matrixAutoUpdate = false;
    this.scene.add(this.landmarkMesh);

    // Scatter (trees, bushes, rocks, debris)
    this.scatter = new ScatterView(this.valley);
    this.scatter.vegDist = 560;
    this.scatter.treeHiDist = 110;
    this.scene.add(this.scatter.group);

    // Grass
    this.grassMesh = new THREE.InstancedMesh(
      buildTuftGeometry(),
      this.enhancedMats.grass,
      GRASS_MAX,
    );
    this.grassMesh.frustumCulled = false;
    this.grassMesh.receiveShadow = true;
    this.scene.add(this.grassMesh);

    // Water & pools
    const lo = -192;
    const hi = this.valley.size + 192;
    const waterGeo = new THREE.PlaneGeometry(hi - lo, hi - lo, 1, 64);
    waterGeo.rotateX(-Math.PI / 2);
    waterGeo.translate((lo + hi) / 2, 0, (lo + hi) / 2);
    const wp = waterGeo.attributes.position!;
    for (let i = 0; i < wp.count; i++) {
      wp.setY(i, this.valley.waterSurface(wp.getZ(i)));
    }
    this.waterMesh = new THREE.Mesh(waterGeo, this.enhancedMats.water);
    this.waterMesh.frustumCulled = false;
    this.waterMesh.renderOrder = 2;
    this.scene.add(this.waterMesh);

    this.poolMat = new THREE.MeshStandardMaterial({
      color: 0x2b2410,
      roughness: 0.12,
      metalness: 0.5,
    });
    for (const pool of this.valley.pools) {
      const m = new THREE.Mesh(new THREE.CircleGeometry(pool.r * 1.25, 20), this.poolMat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(pool.x, this.valley.height(pool.x, pool.z) + 0.75, pool.z);
      this.poolGroup.add(m);
    }
    this.scene.add(this.poolGroup);

    // Animals
    const models = buildAnimalModels();
    for (const [name, model] of Object.entries(models)) {
      const anim = new THREE.InstancedBufferAttribute(new Float32Array(MAX_ANIMALS * 4), 4);
      anim.setUsage(THREE.DynamicDrawUsage);
      model.geo.setAttribute('iAnim', anim);
      const mesh = new THREE.InstancedMesh(model.geo, this.enhancedMats.animal, MAX_ANIMALS);
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      mesh.count = 0;
      this.animalGroup.add(mesh);
      this.animalBatches[name] = { mesh, anim, model };
    }
    this.scene.add(this.animalGroup);

    // Weather particles
    this.scene.add(this.weather.rain);

    this.resize(canvas.clientWidth || 1280, canvas.clientHeight || 720);
    this.applyPreset(LAB_PRESETS[0]!.id);
    this.setMode('enhanced');
  }

  resize(width: number, height: number, pixelRatio = 1): void {
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  getMode(): LabRenderMode {
    return this.currentMode;
  }

  getPreset(): LabPreset {
    return this.currentPreset;
  }

  /**
   * Switches between true production baseline materials and enhanced procedural materials.
   */
  setMode(mode: LabRenderMode): void {
    this.currentMode = mode;
    const suite = mode === 'enhanced' ? this.enhancedMats : this.baselineMats;

    for (const c of this.terrainChunks.values()) {
      c.mesh.material = suite.terrain;
    }
    this.grassMesh.material = suite.grass;
    this.waterMesh.material = suite.water;
    for (const b of Object.values(this.animalBatches)) {
      b.mesh.material = suite.animal;
    }
  }

  /**
   * Deterministically configures environment, camera, synchronous terrain chunks,
   * grass tufts, scatter, and wildlife instances for one of the 5 presets.
   */
  applyPreset(presetId: LabPresetId): LabPreset {
    const preset = LAB_PRESETS.find((p) => p.id === presetId) ?? LAB_PRESETS[0]!;
    this.currentPreset = preset;

    this.env.timeH = preset.timeH;
    this.env.weather = preset.weather;
    this.env.cloud = preset.cloud;
    this.env.rain = preset.rain;
    this.env.wind = preset.wind;
    this.env.stage = preset.stage;

    this.uniforms.uWind.value = preset.wind;
    this.uniforms.uDry.value = preset.dry;
    this.uniforms.uWet.value = preset.wet;
    this.uniforms.uRain.value = Math.min(1, preset.rain / 8);

    this.camera.position.set(...preset.cameraPos);
    this.camera.lookAt(...preset.lookAt);
    this.camera.updateMatrixWorld();

    const waterAtLook = this.valley.waterSurface(preset.lookAt[2]) + preset.stage;
    this.uniforms.uWaterY.value = waterAtLook;

    this.rebuildTerrainAroundCamera(this.camera.position);
    this.scatter.invalidate();
    this.scatter.update(this.camera);
    this.rebuildGrassAroundCamera(this.camera.position);
    this.rebuildAnimals(this.camera.position, preset);

    this.renderFrame(0.016);
    return preset;
  }

  private rebuildTerrainAroundCamera(cam: THREE.Vector3): void {
    const viewDist = 780;
    const minCx = Math.max(-2, Math.floor((cam.x - viewDist) / CHUNK_SIZE));
    const maxCx = Math.min(16, Math.ceil((cam.x + viewDist) / CHUNK_SIZE));
    const minCz = Math.max(-2, Math.floor((cam.z - viewDist) / CHUNK_SIZE));
    const maxCz = Math.min(16, Math.ceil((cam.z + viewDist) / CHUNK_SIZE));

    const activeMat =
      this.currentMode === 'enhanced' ? this.enhancedMats.terrain : this.baselineMats.terrain;
    const keepKeys = new Set<number>();

    for (let cz = minCz; cz <= maxCz; cz++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        const dx = Math.max(cx * CHUNK_SIZE - cam.x, 0, cam.x - (cx + 1) * CHUNK_SIZE);
        const dz = Math.max(cz * CHUNK_SIZE - cam.z, 0, cam.z - (cz + 1) * CHUNK_SIZE);
        const d = Math.hypot(dx, dz);
        if (d > viewDist) continue;
        const res = d < 170 ? 48 : d < 380 ? 24 : d < 650 ? 12 : 6;
        const key = (cx + 16) * 64 + (cz + 16);
        keepKeys.add(key);

        const existing = this.terrainChunks.get(key);
        if (existing && existing.res === res) {
          existing.mesh.material = activeMat;
          continue;
        }
        if (existing) {
          this.terrainGroup.remove(existing.mesh);
          existing.mesh.geometry.dispose();
        }

        const data = buildChunkMesh(this.valley, cx, cz, res);
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
        g.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
        g.setAttribute('color', new THREE.BufferAttribute(data.colors, 4));
        g.setIndex(new THREE.BufferAttribute(data.indices, 1));
        g.computeBoundingSphere();

        const mesh = new THREE.Mesh(g, activeMat);
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        this.terrainGroup.add(mesh);
        this.terrainChunks.set(key, { mesh, res });
      }
    }

    for (const [key, entry] of this.terrainChunks.entries()) {
      if (!keepKeys.has(key)) {
        this.terrainGroup.remove(entry.mesh);
        entry.mesh.geometry.dispose();
        this.terrainChunks.delete(key);
      }
    }
  }

  private rebuildGrassAroundCamera(cam: THREE.Vector3): void {
    const R = GRASS_DIST;
    const cell = Math.max(0.55, (2 * R) / Math.sqrt(GRASS_MAX * 1.25));
    const a = this.grassMesh.instanceMatrix.array;
    const i0 = Math.floor((cam.x - R) / cell);
    const j0 = Math.floor((cam.z - R) / cell);
    const n = Math.ceil((2 * R) / cell);
    let k = 0;

    for (let j = 0; j < n && k < GRASS_MAX; j++) {
      for (let i = 0; i < n && k < GRASS_MAX; i++) {
        const gi = i0 + i;
        const gj = j0 + j;
        const x = (gi + hash3f(gi, gj, 1)) * cell;
        const z = (gj + hash3f(gi, gj, 2)) * cell;
        const d = Math.hypot(x - cam.x, z - cam.z);
        if (d > R || !this.valley.inBounds(x, z)) continue;
        const c = this.env.cellIndex(x, z);
        const cover = (1 - this.env.forest[c]! * 0.6) * (1 - this.env.dump[c]! * 0.85);
        if (hash3f(gi, gj, 3) > cover) continue;
        const y = this.valley.heightFast(x, z);
        if (this.valley.waterSurface(z) + this.env.stage - y > -0.03) continue;
        if (this.valley.roadDist(x, z) < 2.4 && hash3f(gi, gj, 4) < 0.85) continue;
        if (this.env.settlement[c]! > 0.05 && this.valley.blocked(x, z, 0.1)) continue;
        const vf = Math.min(1, this.env.vegFrac(c) * 1.25);
        const fade = 1 - smoothstep(0.72, 1, d / R);
        const s =
          (0.24 + 0.62 * vf) *
          (0.7 + hash3f(gi, gj, 5) * 0.7) *
          fade *
          (1 + this.env.wetland[c]! * 0.6);
        if (s < 0.08) continue;
        const rot = hash3f(gi, gj, 6) * 6.283;
        const cs = Math.cos(rot) * s;
        const sn = Math.sin(rot) * s;
        const o = k * 16;
        a[o] = cs;
        a[o + 1] = 0;
        a[o + 2] = -sn;
        a[o + 3] = 0;
        a[o + 4] = 0;
        a[o + 5] = s;
        a[o + 6] = 0;
        a[o + 7] = 0;
        a[o + 8] = sn;
        a[o + 9] = 0;
        a[o + 10] = cs;
        a[o + 11] = 0;
        a[o + 12] = x;
        a[o + 13] = y - 0.04;
        a[o + 14] = z;
        a[o + 15] = 1;
        k++;
      }
    }
    this.grassMesh.count = k;
    this.grassMesh.instanceMatrix.needsUpdate = true;
  }

  private rebuildAnimals(cam: THREE.Vector3, preset: LabPreset): void {
    const counts: Record<string, number> = {};
    for (const k of Object.keys(this.animalBatches)) counts[k] = 0;

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler(0, 0, 0, 'YXZ');
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();

    const putInstance = (
      batchKey: string,
      x: number,
      z: number,
      alt: number,
      yaw: number,
      scale: number,
      phase: number,
      legAmp: number,
      headPitch: number,
      wingAng: number,
    ) => {
      const b = this.animalBatches[batchKey];
      if (!b) return;
      const idx = counts[batchKey] ?? 0;
      if (idx >= MAX_ANIMALS) return;
      const y = this.valley.height(x, z) + alt;
      e.set(0, yaw, 0);
      p.set(x, y, z);
      m.compose(p, q.setFromEuler(e), s.setScalar(scale));
      m.toArray(b.mesh.instanceMatrix.array, idx * 16);
      const an = b.anim.array as Float32Array;
      const o = idx * 4;
      an[o] = phase;
      an[o + 1] = legAmp;
      an[o + 2] = headPitch;
      an[o + 3] = wingAng;
      counts[batchKey] = idx + 1;
    };

    // Place deterministic focal showcase group near lookAt so wildlife silhouettes are always visible
    const lx = preset.lookAt[0];
    const lz = preset.lookAt[2];
    const showcaseOffsets: ReadonlyArray<[string, number, number, number, number, number, number]> = [
      ['stag', -4, -3, 0.7, 1.08, 1.2, 0.55],
      ['chital', 2, -2, 1.1, 0.96, 2.4, 0.45],
      ['chital', -1, 4, 0.4, 0.92, 3.8, 0.0],
      ['chital', 5, 3, -0.6, 0.88, 0.7, 0.42],
      ['boar', -8, 5, 0.9, 1.0, 1.9, 0.48],
      ['jackal', 9, -5, -1.2, 0.98, 4.1, 0.68],
      ['hare', 3, -6, 0.2, 0.95, 2.9, 0.65],
    ];
    for (const [kind, dx, dz, yaw, sc, ph, amp] of showcaseOffsets) {
      const wx = lx + dx;
      const wz = lz + dz;
      if (this.valley.height(wx, wz) > this.valley.waterSurface(wz) + preset.stage + 0.1) {
        putInstance(kind, wx, wz, 0, yaw, sc, ph, amp, amp === 0 ? 1.1 : 0.2, -1.42);
      }
    }
    putInstance('crow', lx - 3, lz + 2, 4.5, 0.8, 1.0, 1.0, 0, 0, 0.65);
    putInstance('myna', lx + 4, lz - 1, 3.8, -0.5, 1.0, 2.1, 0, 0, -0.45);

    // Also include all simulated animals within 600 m
    for (const a of this.sim.animals) {
      if (!a.alive) continue;
      if ((a.x - cam.x) ** 2 + (a.z - cam.z) ** 2 > 600 * 600) continue;
      const sp = SPECIES[a.sp]!;
      const adult = a.age > maturityDays(sp);
      const key = sp.id === 'chital' && adult && a.sex === 1 ? 'stag' : sp.id;
      const flying = a.alt > 0.25;
      const moving = a.speed > 0.05 && !flying;
      const run = a.speed > sp.walk * 2;
      const eating = a.beh === B.Forage || a.beh === B.Drink || a.beh === B.Feed;
      const phase = ((a.id * 1.7 + this.simTimeSec * 4.2) % 6.28);
      const legAmp = moving ? (run ? 0.75 : 0.42) : 0;
      const head = eating && !moving ? 1.35 : run ? 0.35 : 0.08;
      const wing = flying ? Math.sin(this.simTimeSec * 16 + a.id) * 0.95 + 0.1 : -1.42;
      const sc = 0.42 + 0.58 * this.sim.growth(a, sp);
      putInstance(key, a.x, a.z, a.alt, a.heading, sc, phase, legAmp, head, wing);
    }

    for (const [k, b] of Object.entries(this.animalBatches)) {
      b.mesh.count = counts[k] ?? 0;
      b.mesh.instanceMatrix.needsUpdate = true;
      b.anim.needsUpdate = true;
    }
  }

  /**
   * Renders one complete frame, updating time-varying shader uniforms, sky, water, and rain.
   */
  renderFrame(dt = 0.016): void {
    if (this.disposed) return;
    this.simTimeSec += dt;
    this.uniforms.uTime.value = this.simTimeSec;

    this.sky.update(this.env, this.camera, this.simTimeSec, 140);
    this.fog.color.copy(this.sky.fogColor);
    this.renderer.setClearColor(this.sky.fogColor, 1);

    const baseFog = this.sky.fogDensity(this.env, 1100);
    this.fog.density = this.currentMode === 'enhanced' ? baseFog * 1.08 : baseFog;

    const daylight = this.env.daylight();
    this.uniforms.uSunDir.value.copy(this.sky.sunDir);
    this.uniforms.uSunCol.value
      .copy(this.sky.sun.color)
      .multiplyScalar(Math.min(1, this.sky.sun.intensity));
    this.uniforms.uSkyColor.value.copy(this.sky.zenith);
    this.uniforms.uHorizonColor.value.copy(this.sky.horizon);
    this.uniforms.uTint.value
      .setRGB(0.05, 0.11, 0.09)
      .multiplyScalar(0.15 + 0.85 * daylight);

    this.waterMesh.position.y = this.env.stage;

    // Advance animal procedural phase slightly so locomotion shaders are exercised every frame
    for (const b of Object.values(this.animalBatches)) {
      const arr = b.anim.array as Float32Array;
      for (let i = 0; i < b.mesh.count; i++) {
        const o = i * 4;
        if (arr[o + 1]! > 0) {
          arr[o] = (arr[o]! + dt * 5.2) % 6.28318;
        }
      }
      b.anim.needsUpdate = true;
    }

    this.weather.update(this.camera.position, this.env.rain, this.env.wind, this.env.windDir, daylight);
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Immediately captures a PNG data URL right after rendering a frame.
   */
  capturePng(): string {
    this.renderFrame(0.016);
    return this.renderer.domElement.toDataURL('image/png');
  }

  /**
   * Collects WebGLRenderer & GPU driver metadata, explicitly flagging SwiftShader / software rasterizers.
   */
  getDeviceMetadata(): LabDeviceMetadata {
    const gl = this.renderer.getContext();
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const vendor = String(gl.getParameter(gl.VENDOR) ?? '');
    const renderer = String(gl.getParameter(gl.RENDERER) ?? '');
    const unmaskedVendor = dbg ? String(gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) ?? '') : vendor;
    const unmaskedRenderer = dbg
      ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) ?? '')
      : renderer;
    const combined = `${vendor} ${renderer} ${unmaskedVendor} ${unmaskedRenderer}`.toLowerCase();
    const isSoftwareRenderer =
      combined.includes('swiftshader') ||
      combined.includes('llvmpipe') ||
      combined.includes('softpipe') ||
      combined.includes('microsoft basic render');

    const size = new THREE.Vector2();
    this.renderer.getSize(size);
    return {
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
      glVersion: String(gl.getParameter(gl.VERSION) ?? ''),
      shadingLanguageVersion: String(gl.getParameter(gl.SHADING_LANGUAGE_VERSION) ?? ''),
      vendor,
      renderer,
      unmaskedVendor,
      unmaskedRenderer,
      isSoftwareRenderer,
      viewport: [size.x, size.y],
      pixelRatio: this.renderer.getPixelRatio(),
    };
  }

  /**
   * Compiles both baseline and enhanced shader programs in WebGL2 and inspects raw GLSL
   * shader/program info logs to catch any compilation warnings or link errors.
   */
  collectShaderDiagnostics(): ShaderProgramDiagnostic[] {
    const gl = this.renderer.getContext();
    const results: ShaderProgramDiagnostic[] = [];

    for (const mode of ['baseline', 'enhanced'] as const) {
      this.setMode(mode);
      this.renderFrame(0.016);

      const programs = (this.renderer.info as unknown as {
        programs?: Array<{
          name?: string;
          program?: WebGLProgram;
          vertexShader?: WebGLShader;
          fragmentShader?: WebGLShader;
        }>;
      }).programs ?? [];

      for (const prog of programs) {
        const glProg = prog.program;
        const vs = prog.vertexShader;
        const fs = prog.fragmentShader;
        const linked = glProg ? Boolean(gl.getProgramParameter(glProg, gl.LINK_STATUS)) : true;
        const vsOk = vs ? Boolean(gl.getShaderParameter(vs, gl.COMPILE_STATUS)) : true;
        const fsOk = fs ? Boolean(gl.getShaderParameter(fs, gl.COMPILE_STATUS)) : true;
        const vertexLog = vs ? (gl.getShaderInfoLog(vs) ?? '').trim() : '';
        const fragmentLog = fs ? (gl.getShaderInfoLog(fs) ?? '').trim() : '';
        const programLog = glProg ? (gl.getProgramInfoLog(glProg) ?? '').trim() : '';

        results.push({
          name: prog.name ?? 'ShaderProgram',
          mode,
          compiled: linked && vsOk && fsOk,
          vertexLog,
          fragmentLog,
          programLog,
        });
      }
    }

    return results;
  }

  /**
   * Runs a multi-frame warmup + measurement pass for a preset and mode, returning
   * repeatable p50/p95 frame-time percentiles and per-frame draw-call / triangle counts.
   */
  runBenchmark(
    presetId: LabPresetId,
    mode: LabRenderMode,
    warmupFrames = 15,
    sampleFrames = 60,
  ): LabBenchmarkResult {
    // Same animation phase for baseline and enhanced A/B captures.
    this.simTimeSec = 0;
    this.setMode(mode);
    this.applyPreset(presetId);

    const gl = this.renderer.getContext();
    for (let i = 0; i < warmupFrames; i++) {
      this.renderFrame(0.016);
    }
    gl.finish();

    const samples: number[] = [];
    for (let i = 0; i < sampleFrames; i++) {
      const t0 = performance.now();
      this.renderFrame(0.016);
      gl.finish();
      const t1 = performance.now();
      samples.push(t1 - t0);
    }

    const sorted = [...samples].sort((a, b) => a - b);
    const sum = sorted.reduce((acc, v) => acc + v, 0);
    const mean = sorted.length ? sum / sorted.length : 0;
    const p50 = sorted.length ? sorted[Math.floor(sorted.length * 0.5)]! : 0;
    const p95 = sorted.length
      ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]!
      : 0;
    const min = sorted[0] ?? 0;
    const max = sorted[sorted.length - 1] ?? 0;

    const programsCount =
      ((this.renderer.info as unknown as { programs?: unknown[] }).programs ?? []).length;

    return {
      presetId,
      mode,
      warmupFrames,
      sampleFrames,
      meanMs: Number(mean.toFixed(2)),
      p50Ms: Number(p50.toFixed(2)),
      p95Ms: Number(p95.toFixed(2)),
      minMs: Number(min.toFixed(2)),
      maxMs: Number(max.toFixed(2)),
      drawCallsPerFrame: this.renderer.info.render.calls,
      trianglesPerFrame: this.renderer.info.render.triangles,
      geometries: this.renderer.info.memory.geometries,
      textures: this.renderer.info.memory.textures,
      programs: programsCount,
    };
  }

  /**
   * Executes the full 5-preset × 2-mode suite (shader diagnostics, benchmarks, and PNG captures).
   */
  runFullSuite(warmupFrames = 10, sampleFrames = 40): LabFullSuiteReport {
    const shaderDiagnostics = this.collectShaderDiagnostics();
    const allShadersClean = shaderDiagnostics.every(
      (d) => d.compiled && d.vertexLog === '' && d.fragmentLog === '' && d.programLog === '',
    );

    const benchmarks: LabBenchmarkResult[] = [];
    const screenshots: Record<string, string> = {};

    for (const preset of LAB_PRESETS) {
      for (const mode of ['baseline', 'enhanced'] as const) {
        const res = this.runBenchmark(preset.id, mode, warmupFrames, sampleFrames);
        benchmarks.push(res);
        screenshots[`${preset.id}_${mode}`] = this.capturePng();
      }
    }

    return {
      timestamp: new Date().toISOString(),
      seed: this.valley.seed,
      device: this.getDeviceMetadata(),
      shaderDiagnostics,
      allShadersClean,
      benchmarks,
      screenshots,
    };
  }

  /**
   * Idempotent cleanup of all lab-owned geometries, materials, workers, and renderer state.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    for (const c of this.terrainChunks.values()) {
      c.mesh.geometry.dispose();
    }
    this.terrainChunks.clear();

    this.landmarkMesh.geometry.dispose();
    (this.landmarkMesh.material as THREE.Material).dispose();

    this.scatter.dispose();

    this.grassMesh.geometry.dispose();
    this.waterMesh.geometry.dispose();
    for (const child of this.poolGroup.children) {
      if (child instanceof THREE.Mesh) child.geometry.dispose();
    }
    this.poolMat.dispose();

    for (const b of Object.values(this.animalBatches)) {
      b.mesh.geometry.dispose();
    }

    this.sky.mesh.geometry.dispose();
    (this.sky.mesh.material as THREE.Material).dispose();
    this.sky.sun.shadow.map?.dispose();
    this.sky.sun.shadow.map = null;

    this.weather.rain.geometry.dispose();
    (this.weather.rain.material as THREE.Material).dispose();

    this.baselineMats.terrain.dispose();
    this.baselineMats.grass.dispose();
    this.baselineMats.water.dispose();
    this.baselineMats.animal.dispose();

    this.enhancedMats.terrain.dispose();
    this.enhancedMats.grass.dispose();
    this.enhancedMats.water.dispose();
    this.enhancedMats.animal.dispose();

    this.renderer.dispose();
  }
}

// ============================================================================
// 4. BROWSER ENTRYPOINT (`?lab=1`) & INTERACTIVE HARNESS UI
// ============================================================================

declare global {
  interface Window {
    __visualLab?: VisualLabRunner;
  }
}

export function mountVisualLabApp(canvas: HTMLCanvasElement): VisualLabRunner {
  // Hide default game overlays if present
  for (const id of ['start', 'loading', 'fatal', 'hud', 'menu']) {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  }

  const runner = new VisualLabRunner(canvas, 150);
  window.__visualLab = runner;

  const panel = document.createElement('div');
  panel.id = 'visual-lab-panel';
  panel.style.cssText = [
    'position:fixed',
    'top:12px',
    'left:12px',
    'z-index:9999',
    'background:rgba(12,18,16,0.88)',
    'color:#e8f0ec',
    'padding:14px 16px',
    'border-radius:10px',
    'border:1px solid rgba(180,210,190,0.25)',
    'font:13px/1.45 system-ui, -apple-system, sans-serif',
    'max-width:410px',
    'backdrop-filter:blur(6px)',
  ].join(';');

  const presetOptions = LAB_PRESETS.map(
    (p) => `<option value="${p.id}">${p.label}</option>`,
  ).join('');

  panel.innerHTML = `
    <div style="font-weight:700;font-size:15px;margin-bottom:8px;">
      Untamed Earth — Procedural Visual Lab (Seed 150)
    </div>
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;">
      <label for="labPreset" style="min-width:52px;">Scene:</label>
      <select id="labPreset" style="flex:1;padding:4px 6px;background:#182420;color:#fff;border:1px solid #3a5248;border-radius:4px;">
        ${presetOptions}
      </select>
    </div>
    <div style="display:flex;gap:8px;margin-bottom:10px;">
      <button id="labModeBaseline" style="flex:1;padding:6px 8px;cursor:pointer;border-radius:4px;border:1px solid #3a5248;background:#1a2622;color:#cfe0d8;">
        Production Baseline
      </button>
      <button id="labModeEnhanced" style="flex:1;padding:6px 8px;cursor:pointer;border-radius:4px;border:1px solid #5fa882;background:#254737;color:#fff;font-weight:600;">
        Enhanced Lab
      </button>
    </div>
    <div style="display:flex;gap:8px;margin-bottom:10px;">
      <button id="labRunBench" style="flex:1;padding:6px 8px;cursor:pointer;border-radius:4px;border:1px solid #4a6b5d;background:#20332c;color:#e8f0ec;">
        Benchmark Current
      </button>
      <button id="labDownloadPng" style="flex:1;padding:6px 8px;cursor:pointer;border-radius:4px;border:1px solid #4a6b5d;background:#20332c;color:#e8f0ec;">
        Capture PNG
      </button>
    </div>
    <pre id="labTelemetry" style="margin:0;padding:8px;background:rgba(0,0,0,0.45);border-radius:6px;font:11.5px/1.4 ui-monospace,monospace;white-space:pre-wrap;max-height:220px;overflow:auto;">Ready.</pre>
  `;
  document.body.appendChild(panel);

  const selectEl = panel.querySelector<HTMLSelectElement>('#labPreset')!;
  const btnBase = panel.querySelector<HTMLButtonElement>('#labModeBaseline')!;
  const btnEnh = panel.querySelector<HTMLButtonElement>('#labModeEnhanced')!;
  const btnBench = panel.querySelector<HTMLButtonElement>('#labRunBench')!;
  const btnPng = panel.querySelector<HTMLButtonElement>('#labDownloadPng')!;
  const telemetryEl = panel.querySelector<HTMLPreElement>('#labTelemetry')!;

  const updateButtons = () => {
    const isEnh = runner.getMode() === 'enhanced';
    btnEnh.style.background = isEnh ? '#254737' : '#1a2622';
    btnEnh.style.borderColor = isEnh ? '#5fa882' : '#3a5248';
    btnEnh.style.fontWeight = isEnh ? '600' : '400';
    btnBase.style.background = !isEnh ? '#254737' : '#1a2622';
    btnBase.style.borderColor = !isEnh ? '#5fa882' : '#3a5248';
    btnBase.style.fontWeight = !isEnh ? '600' : '400';
  };

  const refreshStatus = () => {
    const dev = runner.getDeviceMetadata();
    telemetryEl.textContent = [
      `Preset: ${runner.getPreset().id} | Mode: ${runner.getMode()}`,
      `Renderer: ${dev.unmaskedRenderer || dev.renderer}`,
      `Software Rasterizer: ${dev.isSoftwareRenderer ? 'YES (SwiftShader/LLVMpipe)' : 'NO (Hardware GPU)'}`,
      `Draw calls: ${runner.renderer.info.render.calls} | Tris: ${runner.renderer.info.render.triangles}`,
      `Geometries: ${runner.renderer.info.memory.geometries} | Textures: ${runner.renderer.info.memory.textures}`,
    ].join('\n');
  };

  selectEl.addEventListener('change', () => {
    runner.applyPreset(selectEl.value as LabPresetId);
    refreshStatus();
  });

  btnBase.addEventListener('click', () => {
    runner.setMode('baseline');
    runner.renderFrame(0.016);
    updateButtons();
    refreshStatus();
  });

  btnEnh.addEventListener('click', () => {
    runner.setMode('enhanced');
    runner.renderFrame(0.016);
    updateButtons();
    refreshStatus();
  });

  btnBench.addEventListener('click', () => {
    const res = runner.runBenchmark(runner.getPreset().id, runner.getMode(), 15, 60);
    telemetryEl.textContent = JSON.stringify(res, null, 2);
  });

  btnPng.addEventListener('click', () => {
    const url = runner.capturePng();
    const a = document.createElement('a');
    a.href = url;
    a.download = `${runner.getPreset().id}_${runner.getMode()}.png`;
    a.click();
  });

  window.addEventListener('resize', () => {
    runner.resize(window.innerWidth, window.innerHeight);
    runner.renderFrame(0.016);
  });

  refreshStatus();
  return runner;
}
