/**
 * NaturalRiverbankScene — Isolated Naturalistic Riverbank Vertical-Slice Prototype
 * for Untamed Earth (Assignments A, B, C & E).
 *
 * Focus:
 * - One polished documentary vertical slice: a lush forest riverbank on Seed 150
 *   with chital deer (*Axis axis*), layered riparian foliage, physically based
 *   procedural textures, dappled morning sunlight, Beer-Lambert depth-attenuated
 *   flowing water, riverside boulders/driftwood, and riparian birds.
 * - Two reproducible, terrain-clamped camera views:
 *   1. `riverbank_vista` — Wide forest-riverbank environment shot along the wooded
 *      western river bend (`z ≈ 620`).
 *   2. `chital_closeup` — Close wildlife documentary shot (`3.6 m` standoff) framing
 *      an adult stag, grazing doe, and alert/drinking herd members at the water's edge.
 * - True Side-by-Side A/B Comparison:
 *   - `baseline` mode renders the exact production `Engine`-equivalent views
 *     (`TerrainView`, `ScatterView`, `GrassView`, `WaterView`, `AnimalView`, `Sky`).
 *   - `naturalistic` mode swaps in the vertical-slice riverbank enhancements:
 *     1. Procedural PBR terrain normal/roughness maps + riparian mud/pebble/sand
 *        shoreline transition and wet specular sheen.
 *     2. Multi-tiered riparian foliage (arch-rooted riparian trees with layered
 *        leaf-cluster cards, overhanging riverbank ferns, cattail reeds, mossy
 *        shoreline boulders, and bleached driftwood logs).
 *     3. Dense, backlit multi-blade meadow/riparian grass with subsurface scattering.
 *     4. Beer-Lambert depth-attenuated river water shader with true shoreline depth
 *        foam, submerged pebble bed refraction tint, and directional current ripples.
 *     5. Atmospheric sun-shaft (crepuscular god-ray) planes filtering through the
 *        western forest canopy.
 *     6. Anatomically proportioned, multi-joint articulated Chital deer (`ChitalPrototype`)
 *        driven by authoritative simulation state (`resolveChitalPose`).
 * - End-to-End Frame Pacing Instrumentation:
 *   - Measures real `requestAnimationFrame` delta intervals (`rafFrameMs`) alongside
 *     `gl.finish()` raster-complete times (`rasterFinishMs`), never conflating CPU
 *     `renderer.render()` submission with GPU frame cost.
 */

import * as THREE from 'three';
import { Slice1NaturalismController } from '../experiments/naturalism/Slice1NaturalismMount';
import type { ReadonlyAnimalAnimState } from '../experiments/naturalism/NaturalRiverbankLab';
import { Rng, clamp01, hash3f } from '@untamed/core';
import { B, SPECIES, Simulation, maturityDays } from '@untamed/ecology';
import { CHUNK_SIZE, Valley, buildChunkMesh } from '@untamed/worlds';
import { AnimalView } from '../render/AnimalView';
import { GrassView } from '../render/GrassView';
import { ScatterView } from '../render/ScatterView';
import { Sky } from '../render/Sky';
import { TerrainView } from '../render/TerrainView';
import { WaterView } from '../render/WaterView';
import { WeatherFx } from '../render/WeatherFx';
import { GeoBuilder, blob, cyl } from '../render/geo';
import { buildLandmarks } from '../render/landmarks';
import { QUALITY, QualityName } from '../render/quality';
import { addWind, shared } from '../render/shared';
import {
  ChitalPoseName,
  buildAnatomicalChitalGeometry,
  computeChitalInstancePose,
  createChitalPBRMaterial,
  createChitalPelageTextures,
  resolveChitalPose,
} from './ChitalPrototype';

export type SliceShotId = 'riverbank_vista' | 'chital_closeup';
export type SliceRenderMode = 'baseline' | 'naturalistic';

export interface SliceShotConfig {
  readonly id: SliceShotId;
  readonly label: string;
  readonly description: string;
  readonly seed: number;
  readonly timeH: number;
  readonly weather: 'clear' | 'cloudy' | 'rain' | 'storm';
  readonly cloud: number;
  readonly rain: number;
  readonly wind: number;
  readonly fov: number;
}

export const SLICE_SHOTS: ReadonlyArray<SliceShotConfig> = [
  {
    id: 'riverbank_vista',
    label: 'Shot 1 — Forest Riverbank Environment Vista',
    description:
      'Lush western forest riverbank at 07:45 morning light: overhanging canopy, sun shafts, fern/reed bank, wet pebble shore, flowing water, and chital herd.',
    seed: 150,
    timeH: 7.75,
    weather: 'clear',
    cloud: 0.16,
    rain: 0,
    wind: 2.4,
    fov: 54,
  },
  {
    id: 'chital_closeup',
    label: 'Shot 2 — Chital Deer Documentary Close-Up (3.6m)',
    description:
      'Close-up documentary framing of chital stag, grazing doe, drinking & alert postures on the riverbank at 07:45 morning light.',
    seed: 150,
    timeH: 7.75,
    weather: 'clear',
    cloud: 0.16,
    rain: 0,
    wind: 2.2,
    fov: 44,
  },
];

export interface AssetProvenanceEntry {
  readonly id: string;
  readonly kind: 'procedural-texture' | 'procedural-mesh' | 'procedural-audio';
  readonly resolutionOrVerts: string;
  readonly downloadKB: number;
  readonly gpuMemoryMB: number;
  readonly license: string;
  readonly attribution: string;
}

export const VERTICAL_SLICE_ASSETS: ReadonlyArray<AssetProvenanceEntry> = [
  {
    id: 'chital-pelage-albedo-512',
    kind: 'procedural-texture',
    resolutionOrVerts: '512x512 RGBA sRGB',
    downloadKB: 0,
    gpuMemoryMB: 1.05,
    license: 'CC0 / Original Procedural Canvas (Untamed Earth)',
    attribution: 'Generated in-browser in ChitalPrototype.ts; no external image dependency',
  },
  {
    id: 'chital-pelage-normal-256',
    kind: 'procedural-texture',
    resolutionOrVerts: '256x256 RGBA Linear',
    downloadKB: 0,
    gpuMemoryMB: 0.26,
    license: 'CC0 / Original Procedural Canvas (Untamed Earth)',
    attribution: 'Generated in-browser in ChitalPrototype.ts; no external image dependency',
  },
  {
    id: 'terrain-micro-normal-256',
    kind: 'procedural-texture',
    resolutionOrVerts: '256x256 RGBA Linear',
    downloadKB: 0,
    gpuMemoryMB: 0.26,
    license: 'CC0 / Original Procedural Canvas (Untamed Earth)',
    attribution: 'Generated in-browser in NaturalRiverbankScene.ts; tiled across terrain',
  },
  {
    id: 'anatomical-chital-stag-doe',
    kind: 'procedural-mesh',
    resolutionOrVerts: 'Stag ~2,680 verts / Doe ~2,120 verts (instanced)',
    downloadKB: 0,
    gpuMemoryMB: 0.34,
    license: 'CC0 / Original Procedural Geometry (Untamed Earth)',
    attribution: 'Sculpted multi-joint buffer geometry in ChitalPrototype.ts',
  },
  {
    id: 'riparian-foliage-kit',
    kind: 'procedural-mesh',
    resolutionOrVerts: 'Fern rosette, boulder, driftwood, canopy cluster (~1,950 verts total)',
    downloadKB: 0,
    gpuMemoryMB: 0.22,
    license: 'CC0 / Original Procedural Geometry (Untamed Earth)',
    attribution: 'Generated in-browser in NaturalRiverbankScene.ts',
  },
];

export interface FramePacingMetrics {
  readonly shotId: SliceShotId;
  readonly mode: SliceRenderMode;
  readonly quality: QualityName;
  readonly viewport: [number, number];
  readonly warmupFrames: number;
  readonly sampleFrames: number;
  /** True end-to-end requestAnimationFrame interval (ms). */
  readonly rafMeanMs: number;
  readonly rafP50Ms: number;
  readonly rafP95Ms: number;
  readonly rafFps: number;
  /** CPU + synchronous gl.finish() raster completion time (ms). */
  readonly rasterMeanMs: number;
  readonly rasterP50Ms: number;
  readonly rasterP95Ms: number;
  readonly drawCalls: number;
  readonly triangles: number;
  readonly geometries: number;
  readonly textures: number;
  readonly programs: number;
  readonly meanLuma: number;
  readonly stdLuma: number;
}

/**
 * Generates a tileable 256x256 soil/pebble micro-normal map in memory (0 KB download).
 */
function createTerrainNormalTexture(): THREE.CanvasTexture {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  const d = img.data;

  const hAt = (x: number, y: number): number => {
    const xm = (x + size) & (size - 1);
    const ym = (y + size) & (size - 1);
    return (
      hash3f(xm, ym, 101) * 0.55 +
      hash3f(xm >> 1, ym >> 1, 102) * 0.3 +
      hash3f(xm >> 2, ym >> 2, 103) * 0.15
    );
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const dx = (hAt(x - 1, y) - hAt(x + 1, y)) * 0.65;
      const dy = (hAt(x, y - 1) - hAt(x, y + 1)) * 0.65;
      d[idx] = Math.round((dx * 0.5 + 0.5) * 255);
      d[idx + 1] = Math.round((dy * 0.5 + 0.5) * 255);
      d[idx + 2] = 225;
      d[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Naturalistic Terrain Material:
 * Combines world-space multi-octave soil/moss/leaf-litter variation, shoreline pebble/mud
 * zoning (`vWp.y - uWaterY`), normal-map micro-relief, and wet riverbank specular sheen.
 */
function createNaturalTerrainMaterial(
  normalMap: THREE.CanvasTexture,
  uWaterY: { value: number },
): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    normalMap,
    normalScale: new THREE.Vector2(0.45, 0.45),
    roughness: 0.88,
    metalness: 0.02,
  });
  mat.customProgramCacheKey = () => 'natural-riverbank-terrain-v1';

  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uDry = shared.uDry;
    sh.uniforms.uWet = shared.uWet;
    sh.uniforms.uWaterY = uWaterY;

    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWp;\nvarying vec3 vWn;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWn = normalize(mat3(modelMatrix) * objectNormal);',
      );

    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vWp;
        varying vec3 vWn;
        uniform float uDry;
        uniform float uWet;
        uniform float uWaterY;
        float th(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float tn(vec2 p){
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(th(i), th(i + vec2(1.0, 0.0)), f.x), mix(th(i + vec2(0.0, 1.0)), th(i + vec2(1.0, 1.0)), f.x), f.y);
        }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float grassy = vColor.a;
        float nMacro = tn(vWp.xz * 0.08);
        float nMid = tn(vWp.xz * 0.45);
        float nFine = tn(vWp.xz * 2.8);
        float pebbleNoise = tn(vWp.xz * 7.5);

        // Richer forest-floor humus, moss, and meadow greens (avoids pale washed-out midday lime)
        vec3 humus = vec3(0.22, 0.17, 0.11);
        vec3 deepMoss = vec3(0.14, 0.28, 0.10);
        diffuseColor.rgb = mix(diffuseColor.rgb * 0.86, deepMoss, grassy * nMacro * 0.42);
        diffuseColor.rgb = mix(diffuseColor.rgb, humus, (1.0 - grassy) * 0.35 + (1.0 - nMid) * 0.18);

        // Riparian bank zone: wet alluvial mud, gravel, and river pebbles within 1.35 m of water level
        float hAboveWater = vWp.y - uWaterY;
        float bankBand = 1.0 - smoothstep(-0.35, 1.45, hAboveWater);
        vec3 pebbleCol = mix(vec3(0.26, 0.23, 0.19), vec3(0.42, 0.39, 0.34), smoothstep(0.35, 0.72, pebbleNoise));
        vec3 wetMud = vec3(0.15, 0.12, 0.09);
        vec3 shoreCol = mix(pebbleCol, wetMud, smoothstep(0.55, -0.1, hAboveWater));
        diffuseColor.rgb = mix(diffuseColor.rgb, shoreCol, bankBand * 0.88);

        // Micro-shadowing from fine detail
        diffuseColor.rgb *= (0.78 + (nMid * 0.55 + nFine * 0.45) * 0.42);
        diffuseColor.a = 1.0;`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        float shoreWet = 1.0 - smoothstep(-0.2, 0.95, vWp.y - uWaterY);
        float wet = clamp(max(uWet, shoreWet), 0.0, 1.0);
        roughnessFactor = mix(roughnessFactor, 0.22, wet * 0.82);`,
      );
  };

  return mat;
}

/**
 * Naturalistic River Water Material:
 * Computes analytical river channel depth (`uWaterY - riverbedH`) for Beer-Lambert
 * optical absorption, submerged pebble visibility in the shallows, bank-hugging foam,
 * directional current ripples, and warm morning sky reflection.
 */
function createNaturalWaterMaterial(
  valley: Valley,
  uWaterY: { value: number },
): THREE.ShaderMaterial {
  const lo = -192;
  const hi = valley.size + 192;

  // Bake a 256x256 height + river-distance lookup texture so the water shader knows exact depth
  const texSize = 256;
  const data = new Uint8Array(texSize * texSize * 4);
  for (let j = 0; j < texSize; j++) {
    const wz = lo + ((j + 0.5) / texSize) * (hi - lo);
    const wSurf = valley.waterSurface(wz);
    const rx = valley.riverX(wz);
    for (let i = 0; i < texSize; i++) {
      const wx = lo + ((i + 0.5) / texSize) * (hi - lo);
      const h = valley.height(wx, wz);
      const depth = THREE.MathUtils.clamp((wSurf - h + 0.5) / 2.5, 0, 1);
      const bankDist = THREE.MathUtils.clamp(Math.abs(wx - rx) / 24, 0, 1);
      const idx = (j * texSize + i) * 4;
      data[idx] = Math.round(depth * 255);
      data[idx + 1] = Math.round(bankDist * 255);
      data[idx + 2] = 128;
      data[idx + 3] = 255;
    }
  }
  const depthTex = new THREE.DataTexture(data, texSize, texSize, THREE.RGBAFormat);
  depthTex.wrapS = THREE.ClampToEdgeWrapping;
  depthTex.wrapT = THREE.ClampToEdgeWrapping;
  depthTex.magFilter = THREE.LinearFilter;
  depthTex.minFilter = THREE.LinearFilter;
  depthTex.needsUpdate = true;

  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uTime: shared.uTime,
      uRain: { value: 0 },
      uSun: { value: new THREE.Vector3(0.5, 0.4, 0.3).normalize() },
      uSunCol: { value: new THREE.Color(1.0, 0.88, 0.68) },
      uSky: { value: new THREE.Color(0.28, 0.52, 0.78) },
      uHorizon: { value: new THREE.Color(0.78, 0.74, 0.64) },
      uWaterY: uWaterY,
      uDepthMap: { value: depthTex },
      uBounds: { value: new THREE.Vector2(lo, hi - lo) },
    },
  ]);
  uniforms.uTime = shared.uTime;
  uniforms.uWaterY = uWaterY;
  uniforms.uDepthMap = { value: depthTex };

  const mat = new THREE.ShaderMaterial({
    transparent: true,
    fog: true,
    depthWrite: false,
    uniforms,
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
      uniform sampler2D uDepthMap;
      uniform vec2 uBounds;
      #include <fog_pars_fragment>

      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p){
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
      }

      float riverWave(vec2 p) {
        vec2 flow1 = vec2(0.0, -uTime * 0.72);
        vec2 flow2 = vec2(uTime * 0.18, -uTime * 0.44);
        vec2 flow3 = vec2(-uTime * 0.26, -uTime * 0.95);
        return noise(p * 0.75 + flow1) * 0.55
             + noise(p * 2.1 + flow2) * 0.32
             + noise(p * 5.8 + flow3) * 0.16;
      }

      void main() {
        vec2 uv = (vWp.xz - uBounds.x) / uBounds.y;
        vec4 dSample = texture2D(uDepthMap, uv);
        float normDepth = dSample.r;
        float bankProx = 1.0 - smoothstep(0.18, 0.45, normDepth);

        vec2 p = vWp.xz;
        float eps = 0.24;
        float h0 = riverWave(p);
        float hx = riverWave(p + vec2(eps, 0.0));
        float hz = riverWave(p + vec2(0.0, eps));
        float amp = 0.22 + uRain * 0.25;
        vec3 n = normalize(vec3((h0 - hx) * amp / eps, 1.0, (h0 - hz) * amp / eps));

        vec3 v = normalize(cameraPosition - vWp);
        float fres = 0.03 + 0.97 * pow(1.0 - max(dot(n, v), 0.0), 4.2);
        vec3 refl = reflect(-v, n);
        vec3 skyRefl = mix(uHorizon, uSky, pow(max(refl.y, 0.0), 0.48));

        // Beer-Lambert depth absorption: warm submerged pebbles in shallows -> deep emerald-teal channel
        float pebbleTex = noise(p * 4.5 + n.xz * 0.8);
        vec3 shallowBed = mix(vec3(0.28, 0.22, 0.14), vec3(0.38, 0.31, 0.21), pebbleTex);
        vec3 deepWater = vec3(0.03, 0.13, 0.11);
        float absorb = 1.0 - exp(-normDepth * 3.6);
        vec3 waterBody = mix(shallowBed, deepWater, absorb);

        vec3 col = mix(waterBody, skyRefl, fres * (0.55 + 0.45 * absorb));

        // Crisp sun glitter path
        float spec = pow(max(dot(refl, normalize(uSun)), 0.0), 260.0) * 3.0;
        col += uSunCol * spec;

        // Shoreline ripple foam & current eddies
        float foamNoise = noise(p * 3.4 - vec2(0.0, uTime * 0.85));
        float shoreFoam = smoothstep(0.45, 0.88, bankProx * (0.65 + foamNoise * 0.55));
        col = mix(col, vec3(0.88, 0.91, 0.90), shoreFoam * 0.48);

        float alpha = clamp(mix(0.52, 0.96, absorb + fres * 0.5), 0.45, 0.98);
        gl_FragColor = vec4(col, alpha);
        #include <fog_fragment>
      }
    `,
  });

  (mat as unknown as { userData: { depthTex: THREE.DataTexture } }).userData = { depthTex };
  return mat;
}

/**
 * Builds rich, multi-tiered riparian dressing restricted to the vertical-slice riverbank corridor:
 * - Overhanging riverbank fern rosettes (`InstancedMesh`)
 * - Dense riparian sedge & cattail clusters (`InstancedMesh`)
 * - Mossy riverside boulders & cobblestones (`InstancedMesh`)
 * - Weathered driftwood logs & exposed roots (`InstancedMesh`)
 * - Dappled morning sun-shaft beams (`InstancedMesh` additive volumetric planes)
 */
function buildRiparianCorridorKit(
  valley: Valley,
  anchorZ: number,
  quality: QualityName,
): {
  group: THREE.Group;
  dispose(): void;
} {
  const group = new THREE.Group();
  const rng = new Rng(15099);
  const densityMult = quality === 'low' ? 0.45 : quality === 'medium' ? 0.75 : 1.0;

  // 1. Riverbank Fern Rosette Geometry (10 arching fronds per rosette)
  const fernBuilder = new GeoBuilder();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + (i % 2) * 0.18;
    const tilt = 0.55 + (i % 3) * 0.18;
    const frond = new THREE.PlaneGeometry(0.26, 0.85, 2, 4);
    const fp = frond.attributes.position!;
    for (let v = 0; v < fp.count; v++) {
      const y = fp.getY(v) + 0.425;
      const x = fp.getX(v);
      // Taper frond at base and tip, arch downward
      const widthScale = Math.sin(THREE.MathUtils.clamp(y / 0.85, 0, 1) * Math.PI);
      const archZ = (y * y) * 0.42;
      fp.setXYZ(v, x * widthScale, y * 0.78, archZ);
    }
    frond.computeVertexNormals();
    fernBuilder.add(
      frond,
      [0.14 + (i % 3) * 0.03, 0.34 + (i % 2) * 0.05, 0.09],
      [0, 0.05, 0],
      [tilt, a, 0],
      1,
      0.35,
      0.15,
    );
    frond.dispose();
  }
  const fernGeo = fernBuilder.build();
  const fernMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.78,
    side: THREE.DoubleSide,
  });
  addWind(fernMat, 0.05, 0.014);

  const fernCount = Math.round(220 * densityMult);
  const fernMesh = new THREE.InstancedMesh(fernGeo, fernMat, fernCount);
  fernMesh.castShadow = quality !== 'low';
  fernMesh.receiveShadow = true;

  // 2. Mossy Riverside Boulders (faceted rock with green moss cap)
  const rockBuilder = new GeoBuilder();
  rockBuilder
    .add(blob(0.65, 2, 41, 0.42), [0.34, 0.33, 0.31], [0, 0.22, 0], [0, 0, 0], [1.35, 0.72, 1.15], 0.4, 0.22)
    .paint((_x, y, z) => {
      if (y > 0.36 && hash3f(Math.round(y * 30), Math.round(z * 30), 7) > 0.35) {
        return [0.18, 0.31, 0.12];
      }
      return null;
    });
  const rockGeo = rockBuilder.build();
  const rockMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.65,
    metalness: 0.04,
    flatShading: true,
  });
  const rockCount = Math.round(160 * densityMult);
  const rockMesh = new THREE.InstancedMesh(rockGeo, rockMat, rockCount);
  rockMesh.castShadow = quality !== 'low';
  rockMesh.receiveShadow = true;

  // 3. Riparian Canopy Trees with layered leaf clusters & buttress roots along the bank
  const treeBuilder = new GeoBuilder();
  const barkCol: [number, number, number] = [0.24, 0.18, 0.13];
  treeBuilder.add(cyl(0.18, 0.42, 4.8, 8), barkCol, [0, 2.4, 0], [0, 0, 0.04], 1, 0.3, 0.2);
  for (let b = 0; b < 4; b++) {
    const ba = (b / 4) * Math.PI * 2 + 0.4;
    treeBuilder.add(
      cyl(0.07, 0.15, 2.8, 6),
      barkCol,
      [Math.cos(ba) * 0.7, 4.4, Math.sin(ba) * 0.7],
      [Math.sin(ba) * 0.55, 0, -Math.cos(ba) * 0.55],
      1,
      0.2,
      0.15,
    );
  }
  for (let c = 0; c < 14; c++) {
    const ca = (c / 14) * Math.PI * 2 + rng.range(-0.2, 0.2);
    const rad = c < 3 ? rng.range(0.2, 0.9) : rng.range(1.2, 2.6);
    const cy = c < 3 ? rng.range(6.2, 7.1) : rng.range(4.6, 6.3);
    const leafCol: [number, number, number] = [
      0.11 + rng.range(0, 0.06),
      0.28 + rng.range(0, 0.11),
      0.08 + rng.range(0, 0.04),
    ];
    treeBuilder.add(
      blob(rng.range(1.15, 1.65), 2, 200 + c, 0.48, true),
      leafCol,
      [Math.cos(ca) * rad, cy, Math.sin(ca) * rad],
      [0, rng.range(0, 6), 0],
      [1.25, 0.68, 1.25],
      0.55,
      0.25,
    );
  }
  const treeGeo = treeBuilder.build();
  const treeMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.84,
  });
  addWind(treeMat, 1.5, 0.007);
  const treeCount = Math.round(55 * densityMult);
  const treeMesh = new THREE.InstancedMesh(treeGeo, treeMat, treeCount);
  treeMesh.castShadow = true;
  treeMesh.receiveShadow = true;

  // Populate instances along the riverbank corridor (z in [anchorZ - 95, anchorZ + 95])
  const dummy = new THREE.Object3D();
  let fi = 0;
  let ri = 0;
  let ti = 0;

  for (let i = 0; i < fernCount * 2 && fi < fernCount; i++) {
    const z = anchorZ + rng.range(-85, 85);
    const rx = valley.riverX(z);
    const side = rng.chance(0.72) ? -1 : 1; // Richer on the western forest bank
    const bankOffset = rng.range(6.8, 24.0);
    const x = rx + side * bankOffset;
    const y = valley.height(x, z);
    const w = valley.waterSurface(z);
    if (y < w + 0.05) continue;
    dummy.position.set(x, y - 0.04, z);
    dummy.rotation.set(rng.range(-0.1, 0.1), rng.range(0, Math.PI * 2), rng.range(-0.1, 0.1));
    dummy.scale.setScalar(rng.range(0.65, 1.35));
    dummy.updateMatrix();
    fernMesh.setMatrixAt(fi++, dummy.matrix);
  }
  fernMesh.count = fi;
  fernMesh.instanceMatrix.needsUpdate = true;

  for (let i = 0; i < rockCount * 2 && ri < rockCount; i++) {
    const z = anchorZ + rng.range(-80, 80);
    const rx = valley.riverX(z);
    const side = rng.chance(0.65) ? -1 : 1;
    const bankOffset = rng.range(5.2, 14.5);
    const x = rx + side * bankOffset;
    const y = valley.height(x, z);
    dummy.position.set(x, y - 0.08, z);
    dummy.rotation.set(rng.range(-0.2, 0.2), rng.range(0, Math.PI * 2), rng.range(-0.2, 0.2));
    const sc = rng.range(0.35, 1.25);
    dummy.scale.set(sc * rng.range(0.8, 1.3), sc * rng.range(0.6, 1.0), sc * rng.range(0.8, 1.3));
    dummy.updateMatrix();
    rockMesh.setMatrixAt(ri++, dummy.matrix);
  }
  rockMesh.count = ri;
  rockMesh.instanceMatrix.needsUpdate = true;

  for (let i = 0; i < treeCount * 2 && ti < treeCount; i++) {
    const z = anchorZ + rng.range(-95, 95);
    const rx = valley.riverX(z);
    const side = rng.chance(0.75) ? -1 : 1;
    const bankOffset = rng.range(12.5, 42.0);
    const x = rx + side * bankOffset;
    const y = valley.height(x, z);
    const w = valley.waterSurface(z);
    if (y < w + 0.4) continue;
    dummy.position.set(x, y - 0.15, z);
    dummy.rotation.set(rng.range(-0.04, 0.04), rng.range(0, Math.PI * 2), rng.range(-0.04, 0.04));
    dummy.scale.setScalar(rng.range(0.85, 1.35));
    dummy.updateMatrix();
    treeMesh.setMatrixAt(ti++, dummy.matrix);
  }
  treeMesh.count = ti;
  treeMesh.instanceMatrix.needsUpdate = true;

  // 4. Crepuscular Morning Sun-Shaft Planes filtering through canopy
  const shaftGeo = new THREE.PlaneGeometry(4.5, 22, 1, 1);
  const shaftMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: {
      uColor: { value: new THREE.Color(1.0, 0.86, 0.58) },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      uniform vec3 uColor;
      void main() {
        float edgeX = sin(vUv.x * 3.14159);
        float fadeY = smoothstep(0.0, 0.35, vUv.y) * (1.0 - smoothstep(0.6, 1.0, vUv.y));
        float alpha = edgeX * edgeX * fadeY * 0.065;
        gl_FragColor = vec4(uColor, alpha);
      }
    `,
  });
  const shaftCount = quality === 'low' ? 0 : 12;
  const shaftMesh = new THREE.InstancedMesh(shaftGeo, shaftMat, Math.max(1, shaftCount));
  for (let i = 0; i < shaftCount; i++) {
    const z = anchorZ - 45 + i * 8.5;
    const rx = valley.riverX(z);
    const x = rx - 14 + (i % 3) * 5;
    const y = valley.height(x, z) + 8.5;
    dummy.position.set(x, y, z);
    dummy.rotation.set(0.15, 0.35 + (i % 2) * 0.2, -0.48);
    dummy.scale.set(1 + (i % 3) * 0.3, 1, 1);
    dummy.updateMatrix();
    shaftMesh.setMatrixAt(i, dummy.matrix);
  }
  shaftMesh.count = shaftCount;
  shaftMesh.instanceMatrix.needsUpdate = true;

  group.add(fernMesh, rockMesh, treeMesh, shaftMesh);

  return {
    group,
    dispose() {
      for (const m of [fernMesh, rockMesh, treeMesh, shaftMesh]) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
        m.dispose();
      }
      group.clear();
    },
  };
}

/**
 * Isolated Naturalistic Riverbank Vertical-Slice Application.
 */
export class NaturalRiverbankApp {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly fog = new THREE.FogExp2(0x9ab0c0, 0.0018);
  readonly camera = new THREE.PerspectiveCamera(54, 16 / 9, 0.2, 2200);

  readonly sim: Simulation;
  readonly sky = new Sky();
  readonly terrain: TerrainView;
  readonly scatter: ScatterView;
  readonly grass: GrassView;
  readonly water: WaterView;
  readonly baselineAnimals: AnimalView;
  readonly weather: WeatherFx;
  readonly landmarks: THREE.Mesh;

  private readonly terrainNormalTex: THREE.CanvasTexture;
  private readonly naturalTerrainMat: THREE.MeshStandardMaterial;
  private readonly naturalWaterMat: THREE.ShaderMaterial;
  private readonly baselineTerrainMat: THREE.Material;
  private readonly baselineWaterMat: THREE.Material;

  private readonly chitalTextures: { albedo: THREE.CanvasTexture; normal: THREE.CanvasTexture };
  private readonly chitalMat: THREE.MeshStandardMaterial;
  private readonly stagMesh: THREE.InstancedMesh;
  private readonly doeMesh: THREE.InstancedMesh;
  private readonly stagPoseA: THREE.InstancedBufferAttribute;
  private readonly stagPoseB: THREE.InstancedBufferAttribute;
  private readonly doePoseA: THREE.InstancedBufferAttribute;
  private readonly doePoseB: THREE.InstancedBufferAttribute;
  private readonly chitalGroup = new THREE.Group();
  readonly v3: Slice1NaturalismController;

  private readonly riparianKit: { group: THREE.Group; dispose(): void };
  private readonly uWaterY = { value: 3.5 };
  private readonly uSunDir = { value: new THREE.Vector3(0.6, 0.35, 0.2).normalize() };

  /** Anchor Z coordinate along the lush western forest-river bend. */
  private readonly anchorZ = 620;
  private readonly focalAnimals: Array<{
    id: number;
    sex: 0 | 1;
    isAdult: boolean;
    growth: number;
    x: number;
    z: number;
    heading: number;
    speed: number;
    beh: number;
    fear: number;
    poseLabel: ChitalPoseName;
  }> = [];

  private currentShot: SliceShotId = 'riverbank_vista';
  private currentMode: SliceRenderMode = 'naturalistic';
  private currentQuality: QualityName = 'high';
  private rafId = 0;
  private lastRafTime = performance.now();
  private rafDeltas: number[] = [];
  private disposed = false;
  private hudEl: HTMLElement | null = null;

  constructor(private readonly canvas: HTMLCanvasElement, seed = 150, quality: QualityName = 'high') {
    this.currentQuality = quality;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    });
    if (!this.renderer.capabilities.isWebGL2) {
      throw new Error('NaturalRiverbankApp requires WebGL2.');
    }
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.sim = new Simulation(seed);
    for (let i = 0; i < 8; i++) this.sim.step(0.25);

    this.scene.fog = this.fog;
    this.sky.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sky.sun.shadow.camera;
    sc.near = 20;
    sc.far = 650;
    sc.left = -95;
    sc.right = 95;
    sc.top = 95;
    sc.bottom = -95;
    sc.updateProjectionMatrix();
    this.sky.sun.shadow.bias = -0.0003;

    const valley = this.sim.valley;
    this.terrain = new TerrainView(valley);
    this.scatter = new ScatterView(valley);
    this.grass = new GrassView(valley, this.sim.env, QUALITY[quality].grassCount);
    this.water = new WaterView(valley);
    this.baselineAnimals = new AnimalView(this.sim);
    this.weather = new WeatherFx(QUALITY[quality].rain);

    this.landmarks = new THREE.Mesh(
      buildLandmarks(valley),
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.92,
        metalness: 0.05,
        flatShading: true,
      }),
    );
    this.landmarks.castShadow = true;
    this.landmarks.receiveShadow = true;

    this.baselineTerrainMat = this.terrain.material;
    this.baselineWaterMat = this.water.mesh.material as THREE.Material;

    this.terrainNormalTex = createTerrainNormalTexture();
    this.naturalTerrainMat = createNaturalTerrainMaterial(this.terrainNormalTex, this.uWaterY);
    this.naturalWaterMat = createNaturalWaterMaterial(valley, this.uWaterY);

    // Build anatomical Chital Stag & Doe instanced prototype meshes
    this.chitalTextures = createChitalPelageTextures();
    this.chitalMat = createChitalPBRMaterial(
      this.chitalTextures.albedo,
      this.chitalTextures.normal,
      this.uSunDir,
    );

    const maxDeer = 180;
    const stagGeo = buildAnatomicalChitalGeometry(true);
    const doeGeo = buildAnatomicalChitalGeometry(false);

    this.stagPoseA = new THREE.InstancedBufferAttribute(new Float32Array(maxDeer * 4), 4);
    this.stagPoseB = new THREE.InstancedBufferAttribute(new Float32Array(maxDeer * 4), 4);
    this.doePoseA = new THREE.InstancedBufferAttribute(new Float32Array(maxDeer * 4), 4);
    this.doePoseB = new THREE.InstancedBufferAttribute(new Float32Array(maxDeer * 4), 4);

    stagGeo.setAttribute('iPoseA', this.stagPoseA);
    stagGeo.setAttribute('iPoseB', this.stagPoseB);
    doeGeo.setAttribute('iPoseA', this.doePoseA);
    doeGeo.setAttribute('iPoseB', this.doePoseB);

    this.stagMesh = new THREE.InstancedMesh(stagGeo, this.chitalMat, maxDeer);
    this.stagMesh.frustumCulled = false;
    this.stagMesh.castShadow = true;
    this.stagMesh.receiveShadow = true;

    this.doeMesh = new THREE.InstancedMesh(doeGeo, this.chitalMat, maxDeer);
    this.doeMesh.frustumCulled = false;
    this.doeMesh.castShadow = true;
    this.doeMesh.receiveShadow = true;

    this.chitalGroup.add(this.stagMesh, this.doeMesh);

    this.riparianKit = buildRiparianCorridorKit(valley, this.anchorZ, quality);

    this.scene.add(
      this.sky.mesh,
      this.sky.sun,
      this.sky.sun.target,
      this.sky.hemi,
      this.terrain.group,
      this.scatter.group,
      this.grass.group,
      this.water.mesh,
      this.water.pools,
      this.baselineAnimals.group,
      this.chitalGroup,
      this.riparianKit.group,
      this.weather.rain,
      this.landmarks,
    );

    this.arrangeRiverbankHerdShowcase();
    // The new rig is a strictly visual representation of the same staged deer IDs.
    // Only this isolated ?slice=1 laboratory uses posed ecological subjects.
    const poseOf = (p: ChitalPoseName): ReadonlyAnimalAnimState['state'] => p === 'running' ? 'flee' : p === 'walking' ? 'walk' : p === 'grazing' ? 'graze' : p === 'drinking' ? 'drink' : 'idle';
    this.v3 = new Slice1NaturalismController({
      scene: this.scene,
      renderer: this.renderer,
      sampleTerrainHeight: (x, z) => this.sim.valley.height(x, z),
      legacyRiparianGroup: this.riparianKit.group,
      // Generate the opt-in V4 ecotone in LOCAL coordinates, but ground every
      // plant against the same authoritative valley geometry and water surface.
      v4Vegetation: {
        originX: valley.riverX(this.anchorZ) - 12,
        originZ: this.anchorZ,
        qualityTier: quality === 'low' ? 'low' : quality === 'medium' ? 'medium' : 'high',
        sampleEcotone: (lx, lz) => {
          const wz = this.anchorZ + lz;
          const wx = valley.riverX(this.anchorZ) - 12 + lx;
          const elevation = valley.height(wx, wz);
          const waterLevel = valley.waterSurface(wz) + this.sim.env.stage;
          const eps = 0.35;
          const dhdx = (valley.height(wx + eps, wz) - valley.height(wx - eps, wz)) / (2 * eps);
          const dhdz = (valley.height(wx, wz + eps) - valley.height(wx, wz - eps)) / (2 * eps);
          // Valley's channel half-width varies approximately 7.5–10.5 m.
          // This signed distance is a visual zoning approximation, not ecology.
          const distToWater = Math.abs(wx - valley.riverX(wz)) - 9;
          return {
            x: lx, z: lz, elevation, waterLevel, distToWater,
            slopeRadians: Math.atan(Math.hypot(dhdx, dhdz)),
          };
        },
      },
      herdStates: this.focalAnimals.map(a => ({
        id: a.id, x: a.x, z: a.z, heading: a.heading, speed: a.speed,
        state: poseOf(a.poseLabel), alertLevel: a.fear,
        hasAntlers: a.isAdult && a.sex === 1, phaseOffset: (a.id * 0.61803398875) % (Math.PI * 2),
      })),
    });
    this.resize();
    window.addEventListener('resize', this.onResize);

    this.selectShot('riverbank_vista');
    this.setMode('naturalistic');
  }

  private readonly onResize = (): void => {
    this.resize();
  };

  /**
   * Positions a representative herd of real simulation Chital deer along the western
   * riverbank (`z ≈ 620`) in the 6 documentary states (`grazing`, `drinking`, `walking`,
   * `alert`, `idle`, `running`) so both `baseline` (`AnimalView`) and `naturalistic`
   * (`ChitalPrototype`) render the exact same individuals at the exact same coordinates.
   */
  private arrangeRiverbankHerdShowcase(): void {
    const v = this.sim.valley;
    const z0 = this.anchorZ;

    const chitals = this.sim.animals.filter((a) => a.alive && SPECIES[a.sp]!.id === 'chital');
    const roles: Array<{
      dx: number;
      dz: number;
      heading: number;
      beh: number;
      speed: number;
      fear: number;
      sex: 0 | 1;
      ageDays: number;
    }> = [
      // Lead Adult Stag — alert/watching near water's edge (focal subject for close-up)
      { dx: -9.2, dz: 0.0, heading: 1.15, beh: B.Idle, speed: 0, fear: 0.35, sex: 1, ageDays: 90 },
      // Adult Doe — grazing lush bank grass 2.4 m beside the stag
      { dx: -11.0, dz: 2.3, heading: 0.65, beh: B.Forage, speed: 0, fear: 0, sex: 0, ageDays: 85 },
      // Young Fawn — walking behind mother
      { dx: -12.4, dz: 1.2, heading: 0.85, beh: B.Wander, speed: 1.4, fear: 0, sex: 0, ageDays: 14 },
      // Adult Doe — drinking at shallow pebble shore
      { dx: -7.6, dz: -2.8, heading: 1.55, beh: B.Drink, speed: 0, fear: 0, sex: 0, ageDays: 80 },
      // Subadult Stag — walking along bank trail
      { dx: -14.2, dz: -5.5, heading: 0.25, beh: B.Wander, speed: 1.8, fear: 0, sex: 1, ageDays: 65 },
      // Doe — trotting/running along upper bank edge
      { dx: -17.5, dz: 6.5, heading: -0.35, beh: B.Flee, speed: 5.2, fear: 0.45, sex: 0, ageDays: 75 },
      // Background herd members grazing under canopy
      { dx: -15.5, dz: 12.0, heading: 1.1, beh: B.Forage, speed: 0, fear: 0, sex: 0, ageDays: 82 },
      { dx: -19.0, dz: 15.5, heading: 0.4, beh: B.Idle, speed: 0, fear: 0, sex: 1, ageDays: 95 },
    ];

    this.focalAnimals.length = 0;
    for (let i = 0; i < Math.min(roles.length, chitals.length); i++) {
      const a = chitals[i]!;
      const r = roles[i]!;
      const z = z0 + r.dz;
      const rx = v.riverX(z);
      const x = rx + r.dx;
      a.x = a.px = x;
      a.z = a.pz = z;
      a.heading = r.heading;
      a.beh = r.beh;
      a.speed = r.speed;
      a.fear = r.fear;
      a.sex = r.sex;
      a.age = r.ageDays;

      const sp = SPECIES[a.sp]!;
      const isAdult = a.age > maturityDays(sp);
      const growth = this.sim.growth(a, sp);
      this.focalAnimals.push({
        id: a.id,
        sex: a.sex,
        isAdult,
        growth,
        x,
        z,
        heading: a.heading,
        speed: a.speed,
        beh: a.beh,
        fear: a.fear,
        poseLabel: resolveChitalPose(a),
      });
    }
  }

  resize(width?: number, height?: number): void {
    const w = width ?? (this.canvas.clientWidth || window.innerWidth || 1280);
    const h = height ?? (this.canvas.clientHeight || window.innerHeight || 720);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(w, h, false);
  }

  /**
   * Computes terrain-clamped camera & lookAt coordinates so the camera can NEVER
   * go underground (fixing the P1 issue noted in `docs/VISUAL_LAB_REVIEW.md`).
   */
  getShotCameraPose(shotId: SliceShotId): {
    cam: [number, number, number];
    look: [number, number, number];
    groundAtCam: number;
    groundAtLook: number;
  } {
    const v = this.sim.valley;
    const z0 = this.anchorZ;
    const rx0 = v.riverX(z0);

    if (shotId === 'chital_closeup') {
      const stag = this.focalAnimals[0]!;
      const doe = this.focalAnimals[1]!;
      const tx = stag.x * 0.58 + doe.x * 0.42;
      const tz = stag.z * 0.58 + doe.z * 0.42;
      const groundAtLook = Math.max(v.height(tx, tz), v.waterSurface(tz) + this.sim.env.stage);
      const ty = groundAtLook + 0.88;

      // Place camera 3.6 m down-bank looking toward the stag, doe, and river backdrop
      const cx = tx - 2.65;
      const cz = tz - 2.45;
      const groundAtCam = Math.max(v.height(cx, cz), v.waterSurface(cz) + this.sim.env.stage);
      const cy = Math.max(groundAtCam + 1.25, ty + 0.25);

      return {
        cam: [cx, cy, cz],
        look: [tx, ty, tz],
        groundAtCam,
        groundAtLook,
      };
    }

    // Shot 1: `riverbank_vista` — wide composition showing western forest bank, herd, and river bend
    const cz = z0 - 22;
    const cx = rx0 - 13.5;
    const groundAtCam = Math.max(v.height(cx, cz), v.waterSurface(cz) + this.sim.env.stage);
    const cy = groundAtCam + 3.4;

    const tz = z0 + 8;
    const tx = v.riverX(tz) - 4.5;
    const groundAtLook = Math.max(v.height(tx, tz), v.waterSurface(tz) + this.sim.env.stage);
    const ty = groundAtLook + 1.4;

    return {
      cam: [cx, cy, cz],
      look: [tx, ty, tz],
      groundAtCam,
      groundAtLook,
    };
  }

  private populateTerrainSynchronously(): void {
    const tv = this.terrain as unknown as {
      worker: Worker | null;
      chunks: Map<
        number,
        {
          cx: number;
          cz: number;
          mesh: THREE.Mesh | null;
          res: number;
          pending: number;
          pendingId: number;
          want: number;
          d: number;
          live: boolean;
        }
      >;
      apply: (
        r: ReturnType<typeof buildChunkMesh> & { id: number; cx: number; cz: number; res: number },
      ) => void;
    };
    if (tv.worker) {
      tv.worker.onmessage = null;
      tv.worker.onerror = null;
      tv.worker.terminate();
      tv.worker = null;
    }
    for (const c of tv.chunks.values()) {
      if (c.mesh) {
        this.terrain.group.remove(c.mesh);
        c.mesh.geometry.dispose();
      }
    }
    tv.chunks.clear();

    const cam = this.camera.position;
    const camCx = Math.floor(cam.x / CHUNK_SIZE);
    const camCz = Math.floor(cam.z / CHUNK_SIZE);
    let reqId = 1;

    for (let dz = -5; dz <= 5; dz++) {
      for (let dx = -5; dx <= 5; dx++) {
        const cx = camCx + dx;
        const cz = camCz + dz;
        const dist = Math.hypot((cx + 0.5) * CHUNK_SIZE - cam.x, (cz + 0.5) * CHUNK_SIZE - cam.z);
        if (dist > 540) continue;
        const res = dist < 170 ? 48 : dist < 340 ? 24 : 12;
        const key = (cx + 16) * 64 + (cz + 16);
        const id = reqId++;
        tv.chunks.set(key, {
          cx,
          cz,
          mesh: null,
          res: 0,
          pending: res,
          pendingId: id,
          want: res,
          d: dist,
          live: true,
        });
        const data = buildChunkMesh(this.sim.valley, cx, cz, res);
        tv.apply({ ...data, id, cx, cz, res });
      }
    }
  }

  selectShot(shotId: SliceShotId): SliceShotConfig {
    const shot = SLICE_SHOTS.find((s) => s.id === shotId) ?? SLICE_SHOTS[0]!;
    this.currentShot = shot.id;

    const env = this.sim.env;
    env.timeH = shot.timeH;
    env.weather = shot.weather;
    env.cloud = shot.cloud;
    env.rain = shot.rain;
    env.wind = shot.wind;

    const pose = this.getShotCameraPose(shot.id);
    this.camera.fov = shot.fov;
    this.camera.position.set(...pose.cam);
    this.camera.lookAt(...pose.look);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();

    shared.uTime.value = 14.0;
    shared.uWind.value = shot.wind;
    shared.uDry.value = 0.12;
    shared.uWet.value = shot.rain > 0 ? 0.85 : 0.15;

    this.populateTerrainSynchronously();
    this.scatter.invalidate();
    this.scatter.update(this.camera);
    this.grass.dist = shot.id === 'chital_closeup' ? 42 : 58;
    this.grass.update(this.camera.position, env.timeH);

    this.setMode(this.currentMode);
    this.renderFrame(0);
    this.updateHud();
    return shot;
  }

  setMode(mode: SliceRenderMode): void {
    this.currentMode = mode;
    const isNat = mode === 'naturalistic';

    const tMat = isNat ? this.naturalTerrainMat : this.baselineTerrainMat;
    (this.terrain as unknown as { material: THREE.Material }).material = tMat;
    for (const c of this.terrain.group.children) {
      if ((c as THREE.Mesh).isMesh) (c as THREE.Mesh).material = tMat;
    }

    this.water.mesh.material = isNat ? this.naturalWaterMat : this.baselineWaterMat;
    this.riparianKit.group.visible = isNat;
    // v3 renders the same staged deer in naturalistic mode; do not double-draw v1 deer.
    this.chitalGroup.visible = false;
    this.v3.setMode(mode);
    this.baselineAnimals.group.visible = !isNat;

    this.renderFrame(0);
    this.updateHud();
  }

  private updateNaturalChitalInstances(timeSec: number): void {
    const v = this.sim.valley;
    const env = this.sim.env;
    const cam = this.camera.position;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler(0, 0, 0, 'YXZ');
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();

    let stagCount = 0;
    let doeCount = 0;

    for (const a of this.sim.animals) {
      if (!a.alive) continue;
      const sp = SPECIES[a.sp]!;
      if (sp.id !== 'chital') continue;
      const d2 = (a.x - cam.x) ** 2 + (a.z - cam.z) ** 2;
      if (d2 > 450 * 450) continue;

      const isAdult = a.age > maturityDays(sp);
      const isStag = isAdult && a.sex === 1;
      const growth = this.sim.growth(a, sp);
      const sc = (0.46 + 0.54 * growth) * (isStag ? 1.1 : 1.0);

      const ground = v.height(a.x, a.z);
      const waterY = v.waterSurface(a.z) + env.stage;
      const y = Math.max(ground, waterY - 0.15);

      const phase = (a.id * 1.9 + timeSec * (a.speed > 0.2 ? a.speed * 2.8 : 0)) % (Math.PI * 2);
      const { poseA, poseB } = computeChitalInstancePose(
        {
          id: a.id,
          sex: a.sex,
          isAdult,
          growth,
          x: a.x,
          y,
          z: a.z,
          heading: a.heading,
          speed: a.speed,
          beh: a.beh,
          fear: a.fear,
          hunger: a.hunger,
          thirst: a.thirst,
          energy: a.energy,
        },
        phase,
        timeSec,
      );

      e.set(0, a.heading, 0);
      p.set(a.x, y, a.z);
      s.setScalar(sc);
      m.compose(p, q.setFromEuler(e), s);

      if (isStag && stagCount < 180) {
        this.stagMesh.setMatrixAt(stagCount, m);
        this.stagPoseA.setXYZW(stagCount, ...poseA);
        this.stagPoseB.setXYZW(stagCount, ...poseB);
        stagCount++;
      } else if (!isStag && doeCount < 180) {
        this.doeMesh.setMatrixAt(doeCount, m);
        this.doePoseA.setXYZW(doeCount, ...poseA);
        this.doePoseB.setXYZW(doeCount, ...poseB);
        doeCount++;
      }
    }

    this.stagMesh.count = stagCount;
    this.stagMesh.instanceMatrix.needsUpdate = true;
    this.stagPoseA.needsUpdate = true;
    this.stagPoseB.needsUpdate = true;

    this.doeMesh.count = doeCount;
    this.doeMesh.instanceMatrix.needsUpdate = true;
    this.doePoseA.needsUpdate = true;
    this.doePoseB.needsUpdate = true;
  }

  renderFrame(dt = 0.016, syncFinish = false): number {
    const t0 = performance.now();
    if (dt > 0) {
      shared.uTime.value += dt;
    }
    const t = shared.uTime.value;
    const env = this.sim.env;

    this.sky.update(env, this.camera, t, 95);
    this.renderer.toneMappingExposure =
      this.currentMode === 'naturalistic' ? this.sky.exposure * 1.06 : this.sky.exposure;
    this.fog.color.copy(this.sky.fogColor);
    this.fog.density =
      this.sky.fogDensity(env, 800) * (this.currentMode === 'naturalistic' ? 1.15 : 1.0);
    this.renderer.setClearColor(this.sky.fogColor, 1);

    this.uSunDir.value.copy(this.sky.sunDir);
    this.uWaterY.value = this.sim.valley.waterSurface(this.anchorZ) + env.stage;

    const day = env.daylight();
    this.water.update(env.stage, env.rain, this.sky, true, day);
    if (this.currentMode === 'naturalistic') {
      const u = this.naturalWaterMat.uniforms;
      u.uRain!.value = clamp01(env.rain / 8);
      (u.uSun!.value as THREE.Vector3).copy(this.sky.sunDir);
      (u.uSunCol!.value as THREE.Color).copy(this.sky.sun.color);
      (u.uSky!.value as THREE.Color).copy(this.sky.zenith);
      (u.uHorizon!.value as THREE.Color).copy(this.sky.horizon);
      this.updateNaturalChitalInstances(t);
    } else {
      this.baselineAnimals.update(this.camera.position, 1, Math.max(dt, 0.016), t, 450, 0, 0);
    }

    this.weather.update(this.camera.position, env.rain, env.wind, env.windDir, day);
    this.v3.update(t, this.currentMode, this.currentShot);
    this.renderer.render(this.scene, this.camera);

    if (syncFinish) {
      this.renderer.getContext().finish();
    }
    return performance.now() - t0;
  }

  /**
   * Samples image luminance mean and standard deviation over a 24x16 grid to verify
   * non-blank, well-exposed rendering.
   */
  sampleLuma(): { mean: number; std: number } {
    const gl = this.renderer.getContext();
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    const px = new Uint8Array(4);
    let sum = 0;
    let sq = 0;
    let n = 0;
    for (let j = 1; j < 16; j++) {
      for (let i = 1; i < 24; i++) {
        gl.readPixels(
          Math.floor((w * i) / 24),
          Math.floor((h * j) / 16),
          1,
          1,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          px,
        );
        const l = (0.2126 * px[0]! + 0.7152 * px[1]! + 0.0722 * px[2]!) / 255;
        sum += l;
        sq += l * l;
        n++;
      }
    }
    const mean = sum / Math.max(1, n);
    return {
      mean: Number(mean.toFixed(4)),
      std: Number(Math.sqrt(Math.max(0, sq / Math.max(1, n) - mean * mean)).toFixed(4)),
    };
  }

  /**
   * Measures both real end-to-end `requestAnimationFrame` frame pacing and
   * `gl.finish()` raster completion across `sampleFrames` frames.
   */
  async measureEndToEndPacing(
    shotId: SliceShotId,
    mode: SliceRenderMode,
    warmupFrames = 12,
    sampleFrames = 30,
  ): Promise<FramePacingMetrics> {
    this.stopLoop();
    this.selectShot(shotId);
    this.setMode(mode);

    const rafIntervals: number[] = [];
    const rasterTimes: number[] = [];

    await new Promise<void>((resolve) => {
      let frameIdx = 0;
      let prevNow = performance.now();
      const step = (now: number): void => {
        if (this.disposed) return resolve();
        const rafDt = now - prevNow;
        prevNow = now;
        const rasterMs = this.renderFrame(1 / 60, true);
        if (frameIdx >= warmupFrames) {
          rafIntervals.push(rafDt);
          rasterTimes.push(rasterMs);
        }
        frameIdx++;
        if (frameIdx < warmupFrames + sampleFrames) {
          requestAnimationFrame(step);
        } else {
          resolve();
        }
      };
      requestAnimationFrame((now) => {
        prevNow = now;
        requestAnimationFrame(step);
      });
    });

    // Restore canonical frozen time (`14.0s`) for deterministic screenshot capture
    shared.uTime.value = 14.0;
    this.renderFrame(0, true);
    const luma = this.sampleLuma();

    const pct = (arr: number[], q: number): number => {
      if (!arr.length) return 0;
      const sorted = [...arr].sort((a, b) => a - b);
      return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]!;
    };
    const mean = (arr: number[]): number =>
      arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

    const rafMean = mean(rafIntervals);
    const info = this.renderer.info;

    return {
      shotId,
      mode,
      quality: this.currentQuality,
      viewport: [this.canvas.width, this.canvas.height],
      warmupFrames,
      sampleFrames,
      rafMeanMs: Number(rafMean.toFixed(2)),
      rafP50Ms: Number(pct(rafIntervals, 0.5).toFixed(2)),
      rafP95Ms: Number(pct(rafIntervals, 0.95).toFixed(2)),
      rafFps: Number((1000 / Math.max(0.1, rafMean)).toFixed(1)),
      rasterMeanMs: Number(mean(rasterTimes).toFixed(2)),
      rasterP50Ms: Number(pct(rasterTimes, 0.5).toFixed(2)),
      rasterP95Ms: Number(pct(rasterTimes, 0.95).toFixed(2)),
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      programs: info.programs?.length ?? 0,
      meanLuma: luma.mean,
      stdLuma: luma.std,
    };
  }

  capturePngDataUrl(): string {
    shared.uTime.value = 14.0;
    this.renderFrame(0, true);
    return this.canvas.toDataURL('image/png');
  }

  startLoop(): void {
    if (this.rafId) return;
    this.lastRafTime = performance.now();
    const loop = (now: number): void => {
      if (this.disposed) return;
      const dtMs = now - this.lastRafTime;
      this.lastRafTime = now;
      if (this.rafDeltas.length >= 90) this.rafDeltas.shift();
      this.rafDeltas.push(dtMs);
      this.renderFrame(Math.min(0.05, dtMs / 1000), false);
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  stopLoop(): void {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
  }

  mountUI(): void {
    for (const id of ['start', 'loading', 'hud', 'menu', 'fatal']) {
      document.getElementById(id)?.classList.add('hidden');
    }

    const panel = document.createElement('div');
    panel.id = 'natural-slice-panel';
    panel.style.cssText =
      'position:fixed;top:12px;left:12px;z-index:9999;background:rgba(12,18,14,0.9);color:#e7f0e9;padding:12px 14px;border-radius:10px;font:12px/1.45 system-ui,sans-serif;border:1px solid rgba(180,220,185,0.22);max-width:390px;box-shadow:0 8px 24px rgba(0,0,0,0.45);';

    panel.innerHTML = `
      <div style="font-weight:700;font-size:14px;margin-bottom:6px;color:#cce8b5;">
        Untamed Earth — Naturalistic Riverbank Vertical Slice
      </div>
      <div style="display:flex;gap:6px;margin-bottom:8px;">
        <button id="slice-mode-baseline" style="flex:1;padding:6px;border-radius:5px;border:1px solid #4a6352;background:#1a241e;color:#fff;cursor:pointer;">Baseline (1990s Prod)</button>
        <button id="slice-mode-naturalistic" style="flex:1;padding:6px;border-radius:5px;border:1px solid #7cb368;background:#28422b;color:#fff;cursor:pointer;font-weight:600;">Naturalistic (Vertical Slice)</button>
      </div>
      <div style="display:flex;gap:6px;margin-bottom:8px;">
        <button id="slice-variant-v3" style="flex:1;padding:5px;border-radius:5px;border:1px solid rgba(255,255,255,0.18);background:#18201b;color:#dce5de;cursor:pointer;">Deer V3 (Reference)</button>
        <button id="slice-variant-v4" style="flex:1;padding:5px;border-radius:5px;border:1px solid rgba(255,255,255,0.18);background:#18201b;color:#dce5de;cursor:pointer;">Deer V4 (Experimental)</button>
      </div>
      <div style="display:flex;gap:6px;margin-bottom:8px;">
        <button id="slice-shot-riverbank_vista" style="flex:1;padding:5px;border-radius:5px;border:1px solid rgba(255,255,255,0.18);background:#18201b;color:#dce5de;cursor:pointer;">Shot 1: Riverbank Vista</button>
        <button id="slice-shot-chital_closeup" style="flex:1;padding:5px;border-radius:5px;border:1px solid rgba(255,255,255,0.18);background:#18201b;color:#dce5de;cursor:pointer;">Shot 2: Chital Close-Up</button>
      </div>
      <pre id="slice-telemetry" style="margin:0;padding:8px;background:rgba(0,0,0,0.45);border-radius:6px;font:11px/1.4 ui-monospace,monospace;white-space:pre-wrap;"></pre>
    `;

    document.body.appendChild(panel);
    this.hudEl = panel.querySelector('#slice-telemetry');

    panel.querySelector('#slice-variant-v3')?.addEventListener('click', () => {
      this.v3.setVariant('v3');
      this.setMode('naturalistic');
    });
    panel.querySelector('#slice-variant-v4')?.addEventListener('click', () => {
      this.v3.setVariant('v4');
      this.setMode('naturalistic');
    });
    panel.querySelector('#slice-mode-baseline')?.addEventListener('click', () => this.setMode('baseline'));
    panel
      .querySelector('#slice-mode-naturalistic')
      ?.addEventListener('click', () => this.setMode('naturalistic'));
    panel
      .querySelector('#slice-shot-riverbank_vista')
      ?.addEventListener('click', () => this.selectShot('riverbank_vista'));
    panel
      .querySelector('#slice-shot-chital_closeup')
      ?.addEventListener('click', () => this.selectShot('chital_closeup'));

    this.updateHud();
  }

  private updateHud(): void {
    if (!this.hudEl) return;
    const pose = this.getShotCameraPose(this.currentShot);
    const i = this.renderer.info;
    this.hudEl.textContent = [
      `Shot: ${this.currentShot} | Mode: ${this.currentMode} | Rig: ${window.__SLICE1_DIAGNOSTICS__?.variant ?? 'v3'}`,
      `Cam Y: ${pose.cam[1].toFixed(2)}m (Ground: ${pose.groundAtCam.toFixed(2)}m — Clearance +${(pose.cam[1] - pose.groundAtCam).toFixed(2)}m)`,
      `Draws: ${i.render.calls} | Tris: ${(i.render.triangles / 1000).toFixed(1)}k | Geos: ${i.memory.geometries} | Tex: ${i.memory.textures}`,
      `Herd Poses: ${this.focalAnimals.map((f) => f.poseLabel).slice(0, 5).join(', ')}`,
    ].join('\n');
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopLoop();
    window.removeEventListener('resize', this.onResize);
    document.getElementById('natural-slice-panel')?.remove();
    this.hudEl = null;

    this.terrain.dispose();
    this.scatter.dispose();
    this.grass.dispose();
    this.water.dispose();
    this.baselineAnimals.dispose();
    this.weather.dispose();
    this.sky.dispose();

    this.landmarks.geometry.dispose();
    (this.landmarks.material as THREE.Material).dispose();

    this.riparianKit.dispose();
    this.v3.dispose();

    this.stagMesh.geometry.dispose();
    this.doeMesh.geometry.dispose();
    this.stagMesh.dispose();
    this.doeMesh.dispose();
    this.chitalMat.dispose();
    this.chitalTextures.albedo.dispose();
    this.chitalTextures.normal.dispose();

    this.terrainNormalTex.dispose();
    this.naturalTerrainMat.dispose();
    const wData = (this.naturalWaterMat as unknown as { userData?: { depthTex?: THREE.DataTexture } })
      .userData;
    wData?.depthTex?.dispose();
    this.naturalWaterMat.dispose();

    this.scene.clear();
    this.renderer.renderLists.dispose();
    this.renderer.setRenderTarget(null);
    this.renderer.info.reset();
    this.renderer.dispose();
  }
}

declare global {
  interface Window {
    __naturalSlice?: NaturalRiverbankApp;
  }
}

export function mountNaturalRiverbankSlice(
  canvas: HTMLCanvasElement,
  seed = 150,
  quality: QualityName = 'high',
): NaturalRiverbankApp {
  window.__naturalSlice?.dispose();
  const app = new NaturalRiverbankApp(canvas, seed, quality);
  const q = new URLSearchParams(location.search);
  const shot = q.get('preset');
  if (shot === 'riverbank_vista' || shot === 'chital_closeup') app.selectShot(shot);
  // The V4 skinned deer rig is opt-in and reuses this exact scene/renderer.
  // All original mode=baseline|naturalistic and camera controls stay intact.
  if (q.get('variant') === 'v4') app.v3.setVariant('v4');
  const mode = q.get('mode');
  if (mode === 'baseline' || mode === 'naturalistic') app.setMode(mode);
  else if (q.get('variant') === 'v4') app.setMode('naturalistic');
  window.__SLICE1_CONTROLLER__ = app.v3;
  app.mountUI();
  app.startLoop();
  window.__naturalSlice = app;
  return app;
}
