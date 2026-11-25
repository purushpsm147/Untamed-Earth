/**
 * Naturalistic environment layer for the riverbank slice — EXPERIMENT.
 *
 * Patches or swaps presentation only, on the production Engine's own views (no second renderer, no ecology access
 * beyond read-only valley/environment queries):
 * - terrain material: muted late-monsoon palette that keeps biome colours, wet silt banks, visible riverbed
 * - water: depth-aware colour/opacity from a baked local heightfield (shallows show the bed, shoreline fades out)
 * - grass: varied tufts with per-instance colour variation and translucency against the sun
 * - scatter foliage/rocks: palette harmonised, leaf-scale breakup
 * - softer shadows (PCF radius), and one optional post pass: height-falloff aerial perspective with in-scatter toward
 *   the sun and a restrained documentary grade, followed by production's own tone mapping and colour space
 *
 * Every object created here is released in dispose(); production views dispose their own (patched) materials.
 */
import * as THREE from 'three';
import { hash3f } from '@untamed/core';
import type { Simulation } from '@untamed/ecology';
import type { Engine } from '../../render/Engine';
import { shared } from '../../render/shared';

const WATER_GLSL = /* glsl */ `float waterLevel(float z) { return max(5.2 - 0.0028 * z, 2.26); }`;
const NOISE_GLSL = /* glsl */ `
float nh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float nn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(nh(i), nh(i+vec2(1,0)), f.x), mix(nh(i+vec2(0,1)), nh(i+vec2(1,1)), f.x), f.y); }`;

// ------------------------------------------------------------------------------------------------ terrain

function patchTerrain(mat: THREE.MeshStandardMaterial, uStage: { value: number }): void {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uDry = shared.uDry;
    sh.uniforms.uWet = shared.uWet;
    sh.uniforms.uStage = uStage;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWp;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWp; uniform float uDry; uniform float uWet; uniform float uStage;
        ${NOISE_GLSL}
        ${WATER_GLSL}
        float bankH;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float grassy = vColor.a;
        float dn = nn(vWp.xz * 0.9) * 0.6 + nn(vWp.xz * 4.3) * 0.4;
        float macro = nn(vWp.xz * 0.045) * 0.6 + nn(vWp.xz * 0.013) * 0.4;
        float lum = dot(diffuseColor.rgb, vec3(0.3, 0.55, 0.15));
        // production: seasonal curing from simulated moisture and biomass (kept)
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.62, 0.53, 0.3) * (lum * 2.2 + 0.15), grassy * uDry * 0.85);
        // muted palette: partial desaturation and a warm shift keep biome hues readable without tech-demo greens
        float l2 = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
        diffuseColor.rgb = mix(vec3(l2), diffuseColor.rgb, 0.84) * vec3(1.02, 1.0, 0.92);
        // patchy grassland: drier straw patches and darker lush patches at 20-80 m scale
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.14, 1.06, 0.84), grassy * smoothstep(0.6, 0.85, macro) * 0.5);
        diffuseColor.rgb *= 0.74 + dn * 0.32 + (macro - 0.5) * 0.22;
        diffuseColor.rgb *= 1.0 - uWet * 0.22;
        // ground cover: soil and litter showing between grass at 0.2-1 m, fading with distance (no shimmer far away)
        float camD = length(vWp - cameraPosition);
        float mott = nn(vWp.xz * 2.3) * 0.55 + nn(vWp.xz * 5.9) * 0.3 + nn(vWp.xz * 13.0) * 0.15;
        float near = 1.0 - smoothstep(25.0, 90.0, camD);
        vec3 soil = vec3(0.16, 0.13, 0.085);
        diffuseColor.rgb = mix(diffuseColor.rgb, soil, grassy * smoothstep(0.52, 0.8, mott) * 0.55 * near);
        diffuseColor.rgb *= mix(1.0, 0.82 + 0.3 * mott, near * grassy);
        // riverbank: wet silt above the waterline, darker damp band, then the riverbed below it
        bankH = vWp.y - (waterLevel(vWp.z) + uStage);
        float pebble = nn(vWp.xz * 7.0) * 0.5 + nn(vWp.xz * 19.0) * 0.5;
        vec3 silt = vec3(0.2, 0.16, 0.115) * (0.8 + 0.4 * pebble);
        float wetBand = 1.0 - smoothstep(0.05, 0.55 + 0.25 * dn, bankH);
        diffuseColor.rgb = mix(diffuseColor.rgb, silt, wetBand * 0.85);
        vec3 bed = vec3(0.17, 0.15, 0.12) * (0.7 + 0.6 * pebble);
        diffuseColor.rgb = mix(diffuseColor.rgb, bed, smoothstep(0.05, -0.15, bankH));
        diffuseColor.a = 1.0;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.55, uWet * 0.8);
        roughnessFactor = mix(roughnessFactor, 0.42, (1.0 - smoothstep(0.0, 0.3, bankH)) * step(-0.05, bankH));`);
  };
  mat.customProgramCacheKey = () => 'nat-terrain-v1';
  mat.needsUpdate = true;
}

// ------------------------------------------------------------------------------------------------ water

const WATER_VERT = /* glsl */ `
varying vec3 vWp;
#include <fog_pars_vertex>
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWp = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const WATER_FRAG = /* glsl */ `
precision highp float;
varying vec3 vWp;
uniform float uTime; uniform float uRain; uniform float uDetail; uniform float uStage;
uniform vec3 uSun; uniform vec3 uSunCol; uniform vec3 uSky; uniform vec3 uHorizon; uniform vec3 uTint;
uniform sampler2D uHeight; uniform vec2 uHOrigin; uniform float uHSize; uniform float uHReady;
#include <fog_pars_fragment>
${NOISE_GLSL}
${WATER_GLSL}
void main() {
  vec2 p = vWp.xz;
  float e = 0.3;
  vec2 f1 = vec2(0.0, -uTime * 0.45);
  vec2 f2 = vec2(uTime * 0.1, -uTime * 0.26);
  float amp = 0.08 + uRain * 0.25;
  float h0 = nn(p * 0.7 + f1) + 0.5 * nn(p * 2.1 + f2) + 0.25 * nn(p * 5.3 + f1 * 2.0);
  float hx = nn((p + vec2(e, 0.0)) * 0.7 + f1) + 0.5 * nn((p + vec2(e, 0.0)) * 2.1 + f2) + 0.25 * nn((p + vec2(e, 0.0)) * 5.3 + f1 * 2.0);
  float hz = nn((p + vec2(0.0, e)) * 0.7 + f1) + 0.5 * nn((p + vec2(0.0, e)) * 2.1 + f2) + 0.25 * nn((p + vec2(0.0, e)) * 5.3 + f1 * 2.0);
  vec3 n = normalize(vec3((h0 - hx) * amp / e, 1.0, (h0 - hz) * amp / e));
  vec3 v = normalize(cameraPosition - vWp);
  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
  vec3 refl = reflect(-v, n);
  vec3 sky = mix(uHorizon, uSky, pow(max(refl.y, 0.0), 0.5)) * 0.72;
  // low reflection angles mirror the far bank (trees, earth), not open sky
  vec3 bank = mix(vec3(0.035, 0.045, 0.025), uHorizon * 0.35, 0.3) * (0.4 + 0.6 * uTint.g / 0.11);
  sky = mix(bank, sky, smoothstep(0.02, 0.16, refl.y + (nn(p * 0.35) - 0.5) * 0.04));
  float sd = max(dot(refl, uSun), 0.0);
  // tight glint plus a soft sheen; capped so the sun path does not blow out
  float spec = min(pow(sd, 420.0) * 1.4 + pow(sd, 48.0) * 0.05, 1.6);
  // depth from a baked local heightfield (height relative to the water level)
  vec2 huv = (p - uHOrigin) / uHSize;
  float inside = uHReady * step(0.002, huv.x) * step(huv.x, 0.998) * step(0.002, huv.y) * step(huv.y, 0.998);
  float bedRel = texture2D(uHeight, huv).r;
  float depth = mix(2.5, max(uStage - bedRel, 0.0), inside);
  // monsoon river: suspended silt scatters olive-brown light and absorbs quickly
  vec3 scatterCol = uTint * vec3(2.6, 1.7, 1.15) + vec3(0.012, 0.011, 0.006);
  float turb = 1.0 - exp(-depth * 2.4);
  vec3 col = mix(scatterCol, sky, fres) + uSunCol * spec;
  float alpha = clamp(max(turb * 0.94, fres), 0.0, 0.97);
  // shoreline: water thins to nothing so the bank meets it without a hard edge; a faint lighter lap line
  float shore = 1.0 - smoothstep(0.0, 0.08, depth);
  alpha *= 1.0 - shore * 0.9;
  col += vec3(0.04, 0.04, 0.035) * shore * smoothstep(0.4, 0.8, nn(p * 3.0 + vec2(uTime * 0.3, 0.0)));
  // authored in display-referred terms like production's water; convert to linear HDR for the shared tone mapping
  gl_FragColor = vec4(pow(max(col, vec3(0.0)), vec3(2.2)) * 1.35, alpha);
  #include <fog_fragment>
}`;

// ------------------------------------------------------------------------------------------------ grass

function tuftGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  const blades = 15;
  const segs = 4;
  for (let i = 0; i < blades; i++) {
    const r = (k: number): number => hash3f(i, k, 77);
    const a = r(1) * Math.PI * 2;
    const rad = 0.03 + r(2) * 0.17;
    const ox = Math.cos(a) * rad;
    const oz = Math.sin(a) * rad;
    const h = 0.28 + r(3) * 0.5;
    const w = 0.012 + r(4) * 0.018;
    const lean = 0.15 + r(5) * 0.35;
    const face = a + (r(6) - 0.5) * 1.2;
    const fx = -Math.sin(face);
    const fz = Math.cos(face);
    const dry = r(7) < 0.22;
    const base = pos.length / 3;
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      const bend = lean * t * t;
      const cx = ox + Math.cos(a) * bend * h;
      const cz = oz + Math.sin(a) * bend * h;
      const y = h * t * (1 - 0.15 * t * lean);
      const ww = w * (1 - t * 0.92);
      for (const sd of [-1, 1]) {
        pos.push(cx + fx * ww * sd, y, cz + fz * ww * sd);
        // normals lean outward from the tuft centre: blades shade like a rounded clump, never black
        const nx = Math.cos(a) * 0.45;
        const nz = Math.sin(a) * 0.45;
        const l = Math.hypot(nx, 1, nz);
        nor.push(nx / l, 1 / l, nz / l);
        const g = t;
        const green: [number, number, number] = [0.07 + g * 0.2, 0.1 + g * 0.22, 0.035 + g * 0.06];
        const straw: [number, number, number] = [0.12 + g * 0.42, 0.11 + g * 0.34, 0.05 + g * 0.16];
        const c = dry ? straw : green;
        col.push(c[0], c[1], c[2], t);
      }
      if (s < segs) {
        const k = base + s * 2;
        idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

function grassMaterial(uSunView: { value: THREE.Vector3 }): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = shared.uTime;
    sh.uniforms.uWind = shared.uWind;
    sh.uniforms.uDry = shared.uDry;
    sh.uniforms.uSunView = uSunView;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\nuniform float uTime; uniform float uWind; uniform float uDry; varying float vTip;\n${NOISE_GLSL}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec4 wp = instanceMatrix * vec4(transformed, 1.0);
        float gust = 0.55 + 0.45 * sin(uTime * 0.35 + wp.x * 0.05 + wp.z * 0.04);
        float sw = sin(uTime * 1.9 + wp.x * 0.7 + wp.z * 0.5) + 0.6 * sin(uTime * 3.7 + wp.x * 1.9);
        float bend = sw * uWind * gust * 0.02 * transformed.y * transformed.y / 0.2;
        transformed.x += bend; transformed.z += bend * 0.5;
        vTip = color.a;`)
      .replace('#include <color_vertex>', `#include <color_vertex>
        vec2 ip = instanceMatrix[3].xz;
        float hv = nh(floor(ip * 1.7));
        float patchv = nn(ip * 0.07);
        vColor.rgb *= mix(vec3(0.82, 0.92, 0.78), vec3(1.2, 1.08, 0.8), hv * 0.7 + patchv * 0.3);
        vColor.rgb = mix(vColor.rgb, vec3(0.6, 0.52, 0.28) * (0.35 + color.a * 0.75), uDry * 0.8);
        vColor.a = 1.0;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vTip; uniform vec3 uSunView;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        // light through the blades when looking toward the sun (thin-leaf translucency)
        float back = pow(max(dot(normalize(-vViewPosition), uSunView), 0.0), 3.0);
        totalEmissiveRadiance += diffuseColor.rgb * back * vTip * 0.55;`);
  };
  mat.customProgramCacheKey = () => 'nat-grass-v1';
  return mat;
}

// ------------------------------------------------------------------------------------------------ scatter (trees, shrubs, rocks)

function patchScatter(mat: THREE.MeshStandardMaterial): void {
  const prev = mat.onBeforeCompile;
  const foliage = prev.toString().includes('uWind');
  mat.onBeforeCompile = (sh, r) => {
    prev.call(mat, sh, r);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWpS;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vWpS = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
        #else
          vWpS = (modelMatrix * vec4(transformed, 1.0)).xyz;
        #endif`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWpS;\n${NOISE_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float l2 = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
        diffuseColor.rgb = mix(vec3(l2), diffuseColor.rgb, ${foliage ? '0.74' : '0.8'}) * vec3(1.04, 1.0, 0.88);
        ${foliage ? `// leaf-scale breakup: clumps of lit and shaded leaves instead of a smooth blob
        float lv = nn(vWpS.xz * 3.1 + vWpS.y * 2.3) * 0.6 + nn(vWpS.xy * 7.7) * 0.4;
        diffuseColor.rgb *= 0.72 + lv * 0.5;
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.15, 1.1, 0.75), smoothstep(0.72, 0.9, lv) * 0.5);` : ''}`);
  };
  mat.customProgramCacheKey = () => `nat-scatter-${foliage ? 'f' : 's'}-${mat.flatShading ? 1 : 0}`;
  mat.needsUpdate = true;
}

// ------------------------------------------------------------------------------------------------ post pass

const POST_VERT = /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const POST_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tColor; uniform sampler2D tDepth;
uniform mat4 uProjInv; uniform mat4 uViewInv; uniform vec3 uCam;
uniform vec3 uSunDir; uniform vec3 uSunCol; uniform vec3 uFogCol; uniform float uDensity; uniform float uDay;
void main() {
  vec3 col = texture2D(tColor, vUv).rgb;
  float d = texture2D(tDepth, vUv).r;
  vec4 vp = uProjInv * vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  vp /= vp.w;
  vec3 wp = (uViewInv * vec4(vp.xyz, 1.0)).xyz;
  vec3 ray = wp - uCam;
  float dist = length(ray);
  vec3 dir = ray / max(dist, 1e-4);
  bool sky = d > 0.99999;
  // aerial perspective: exponential haze thinning with height (valley air is densest near the river)
  float hMid = max(0.5 * (uCam.y + (sky ? uCam.y + 200.0 : wp.y)) - 3.0, 0.0);
  float dens = uDensity * exp(-hMid * 0.025);
  float fogAmt = sky ? 0.0 : 1.0 - exp(-dist * dens);
  float sunAmt = pow(max(dot(dir, uSunDir), 0.0), 6.0);
  vec3 inscatter = mix(uFogCol, uFogCol * 0.6 + uSunCol * 0.55, sunAmt * uDay);
  col = mix(col, inscatter, fogAmt);
  vec3 rawSky = col;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  // restrained documentary grade (display-referred, after production tone mapping)
  vec3 c = gl_FragColor.rgb;
  float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(luma), c, 0.95);
  c += vec3(0.018, 0.008, -0.012) * smoothstep(0.35, 0.9, luma) * uDay;
  c = mix(c, c * vec3(0.97, 1.0, 1.02), smoothstep(0.3, 0.0, luma));
  vec2 q = vUv - 0.5;
  c *= 1.0 - 0.22 * pow(clamp(length(q) * 1.35, 0.0, 1.0), 2.4);
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
  if (sky) {
    // production draws the sky dome without tone mapping or colour-space conversion: keep that, apply only the grade
    vec3 sc = rawSky;
    float sl = dot(sc, vec3(0.2126, 0.7152, 0.0722));
    sc = mix(vec3(sl), sc, 0.95) * (1.0 - 0.22 * pow(clamp(length(q) * 1.35, 0.0, 1.0), 2.4));
    gl_FragColor = vec4(sc, 1.0);
  }
}`;

class PostPass {
  readonly rt: THREE.WebGLRenderTarget;
  readonly mat: THREE.ShaderMaterial;
  private readonly quad: THREE.Mesh;
  private readonly scene = new THREE.Scene();
  private readonly cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  constructor(samples: number) {
    this.rt = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, samples, depthTexture: new THREE.DepthTexture(2, 2) });
    this.mat = new THREE.ShaderMaterial({
      vertexShader: POST_VERT, fragmentShader: POST_FRAG, depthTest: false, depthWrite: false,
      uniforms: {
        tColor: { value: this.rt.texture }, tDepth: { value: this.rt.depthTexture }, uProjInv: { value: new THREE.Matrix4() }, uViewInv: { value: new THREE.Matrix4() },
        uCam: { value: new THREE.Vector3() }, uSunDir: { value: new THREE.Vector3() }, uSunCol: { value: new THREE.Color() }, uFogCol: { value: new THREE.Color() },
        uDensity: { value: 0 }, uDay: { value: 1 },
      },
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  setSize(w: number, h: number): void {
    this.rt.setSize(Math.max(1, w), Math.max(1, h));
  }

  render(renderer: THREE.WebGLRenderer): void {
    renderer.setRenderTarget(null);
    renderer.render(this.scene, this.cam);
  }

  dispose(): void {
    this.rt.depthTexture?.dispose();
    this.rt.dispose();
    this.mat.dispose();
    this.quad.geometry.dispose();
  }
}

// ------------------------------------------------------------------------------------------------ environment

/** Natural mode draws more (richer) tufts than the preset; recorded in stats for the performance comparison. */
export const GRASS_FACTOR = 1.5;
const HSIZE = 160;
const HRES = 192;

export class NaturalEnvironment {
  private readonly uStage = { value: 0 };
  private readonly uSunView = { value: new THREE.Vector3(0, 1, 0) };
  private readonly waterMat: THREE.ShaderMaterial;
  private readonly heightTex: THREE.DataTexture;
  private readonly heightData: Uint16Array;
  private readonly hOrigin = new THREE.Vector2();
  private bakeRow = HRES;
  private bakeCentre = new THREE.Vector2(1e9, 1e9);
  private hReady = false;
  private readonly post: PostPass | null;
  private readonly grassGeo: THREE.BufferGeometry;
  private readonly grassMat: THREE.MeshStandardMaterial;
  private readonly prevShadowRadius: number;
  private postMs = 0;
  private grassCount = 0;

  constructor(private readonly engine: Engine, private readonly sim: Simulation) {
    patchTerrain(engine.terrain.material, this.uStage);
    // water: new material sharing production's uniform objects, so WaterView.update keeps driving sun/sky/tint
    const wm = engine.water.mesh.material as THREE.ShaderMaterial;
    this.heightData = new Uint16Array(HRES * HRES);
    this.heightTex = new THREE.DataTexture(this.heightData, HRES, HRES, THREE.RedFormat, THREE.HalfFloatType);
    this.heightTex.magFilter = THREE.LinearFilter;
    this.heightTex.minFilter = THREE.LinearFilter;
    this.heightTex.wrapS = this.heightTex.wrapT = THREE.ClampToEdgeWrapping;
    this.waterMat = new THREE.ShaderMaterial({
      vertexShader: WATER_VERT, fragmentShader: WATER_FRAG, transparent: true, fog: true, depthWrite: false,
      uniforms: {
        ...wm.uniforms,
        uStage: this.uStage, uHeight: { value: this.heightTex }, uHOrigin: { value: this.hOrigin }, uHSize: { value: HSIZE }, uHReady: { value: 0 },
      },
    });
    engine.water.mesh.material = this.waterMat; // production keeps (and disposes) its own original material
    // grass: replace tuft geometry and material; dispose the originals now (GrassView disposes whatever it holds)
    const gm = engine.grass.mesh;
    const oldGeo = gm.geometry;
    const oldMat = gm.material as THREE.Material;
    this.grassGeo = tuftGeometry();
    this.grassMat = grassMaterial(this.uSunView);
    gm.geometry = this.grassGeo;
    gm.material = this.grassMat;
    oldGeo.dispose();
    oldMat.dispose();
    this.grassCount = Math.round(engine.quality.grassCount * GRASS_FACTOR);
    engine.grass.setMax(this.grassCount);
    // scatter: harmonise palette (materials are owned and disposed by ScatterView)
    engine.scatter.group.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (m instanceof THREE.MeshStandardMaterial) patchScatter(m);
    });
    engine.scatter.group.userData.natPatched = true;
    // landmarks (ruins) use flat vertex colours; leave them: they are not part of the riverbank composition
    this.prevShadowRadius = engine.sky.sun.shadow.radius;
    engine.sky.sun.shadow.radius = 3.5;
    engine.sky.sun.shadow.blurSamples = 12;
    this.post = engine.quality.name === 'low' ? null : new PostPass(4);
    // production sets fog density per frame; the post pass carries most of the haze, so thin material fog here
    engine.scene.onBeforeRender = () => {
      const fog = engine.scene.fog as THREE.FogExp2;
      if (this.post) fog.density *= 0.45;
    };
  }

  hideProductionChital(): void {
    const batches = (this.engine.animals as unknown as { batches: Record<string, { mesh: THREE.InstancedMesh }> }).batches;
    for (const k of ['chital', 'stag']) if (batches[k]) batches[k].mesh.visible = false;
  }

  ready(): boolean {
    return this.hReady;
  }

  resize(): void {
    if (!this.post) return;
    const v = this.engine.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.post.setSize(v.x, v.y);
  }

  /** Called before Engine.frame: bake water depth progressively; route rendering into the post target. */
  beforeFrame(_dt: number, _time: number): void {
    const cam = this.engine.camera.position;
    const env = this.sim.env;
    this.uStage.value = env.stage;
    // re-centre the depth bake when the camera has moved far
    if (Math.hypot(cam.x - this.bakeCentre.x, cam.z - this.bakeCentre.y) > HSIZE * 0.3 && this.bakeRow >= HRES) {
      this.bakeCentre.set(cam.x, cam.z);
      this.bakeRow = 0;
    }
    if (this.bakeRow < HRES) {
      const v = this.sim.valley;
      const x0 = this.bakeCentre.x - HSIZE / 2;
      const z0 = this.bakeCentre.y - HSIZE / 2;
      const rows = Math.min(HRES, this.bakeRow + 24);
      for (let j = this.bakeRow; j < rows; j++) {
        for (let i = 0; i < HRES; i++) {
          const x = x0 + ((i + 0.5) / HRES) * HSIZE;
          const z = z0 + ((j + 0.5) / HRES) * HSIZE;
          const rel = v.height(x, z) - v.waterSurface(z);
          this.heightData[j * HRES + i] = THREE.DataUtils.toHalfFloat(Math.max(-20, Math.min(20, rel)));
        }
      }
      this.bakeRow = rows;
      if (this.bakeRow >= HRES) {
        this.hOrigin.set(x0, z0);
        this.heightTex.needsUpdate = true;
        this.waterMat.uniforms.uHReady!.value = 1;
        this.hReady = true;
      }
    }
    // sun direction in view space for grass translucency
    this.uSunView.value.copy(this.engine.sky.sunDir).transformDirection(this.engine.camera.matrixWorldInverse);
    if (this.post) this.engine.renderer.setRenderTarget(this.post.rt);
  }

  /** Called after Engine.frame: composite the post pass to the canvas. */
  afterFrame(): void {
    if (!this.post) return;
    const t0 = performance.now();
    const e = this.engine;
    const u = this.post.mat.uniforms;
    e.camera.updateMatrixWorld();
    (u.uProjInv!.value as THREE.Matrix4).copy(e.camera.projectionMatrixInverse);
    (u.uViewInv!.value as THREE.Matrix4).copy(e.camera.matrixWorld);
    (u.uCam!.value as THREE.Vector3).copy(e.camera.position);
    (u.uSunDir!.value as THREE.Vector3).copy(e.sky.sunDir);
    (u.uSunCol!.value as THREE.Color).copy(e.sky.sun.color).multiplyScalar(Math.min(1.2, e.sky.sun.intensity / 3));
    (u.uFogCol!.value as THREE.Color).copy(e.sky.fogColor);
    // haze: production's fog density scaled for the share moved into the post pass, a little extra in the valley air
    u.uDensity!.value = e.sky.fogDensity(this.sim.env, e.quality.viewDist) * 0.5;
    u.uDay!.value = this.sim.env.daylight();
    this.post.render(e.renderer);
    this.postMs = performance.now() - t0;
  }

  stats(): Record<string, unknown> {
    return { depthBakeReady: this.hReady, post: !!this.post, postSubmitMs: this.postMs, grassTris: (this.grassGeo.index?.count ?? 0) / 3, grassInstancesMax: this.grassCount, grassFactor: GRASS_FACTOR };
  }

  dispose(): void {
    this.engine.scene.onBeforeRender = () => {};
    this.engine.sky.sun.shadow.radius = this.prevShadowRadius;
    this.engine.renderer.setRenderTarget(null);
    this.post?.dispose();
    this.waterMat.dispose();
    this.heightTex.dispose();
    // grass geometry/material are now held (and disposed) by GrassView
  }
}
