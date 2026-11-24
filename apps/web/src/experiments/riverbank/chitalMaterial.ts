/**
 * Chital materials for the riverbank slice — EXPERIMENT.
 *
 * - Linear blend skinning in the vertex shader from a float bone texture (3 texels = one 3x4 matrix per bone,
 *   one texture row per instance), so every animal stays in one instanced draw call.
 * - Coat pattern computed per pixel from bind-pose position and normal, so spots and markings move with the skin
 *   and need no texture download. Colours follow field descriptions of Axis axis (rufous coat with persistent white
 *   spots, dark dorsal stripe, white throat patch, belly, rump patch and tail underside, dark muzzle band).
 * - A matching depth material so shadows follow the animated pose.
 */
import * as THREE from 'three';
import { BONE, BONE_COUNT, SKELETON } from './chitalRig';

const g3 = (v: { x: number; y: number; z: number }): string => `vec3(${v.x.toFixed(4)}, ${v.y.toFixed(4)}, ${v.z.toFixed(4)})`;
const EAR = SKELETON.pos[BONE.earL]!;

export interface BoneTexture {
  texture: THREE.DataTexture;
  data: Float32Array;
  rows: number;
}

export function createBoneTexture(rows: number): BoneTexture {
  const width = BONE_COUNT * 3;
  const data = new Float32Array(width * rows * 4);
  const texture = new THREE.DataTexture(data, width, rows, THREE.RGBAFormat, THREE.FloatType);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return { texture, data, rows };
}

/** Copy one animal's 3x4 bone matrices (BONE_COUNT * 12 floats) into texture row `row`. */
export function writeBoneRow(bt: BoneTexture, row: number, bones: Float32Array): void {
  bt.data.set(bones.subarray(0, BONE_COUNT * 12), row * BONE_COUNT * 12);
}

const SKIN_PARS = /* glsl */ `
uniform highp sampler2D uBones;
uniform float uRow0;
attribute vec2 aBone;
attribute float aWeight;
attribute float aRegion;
mat4 boneMat(float b) {
  int x = int(b + 0.5) * 3;
  int y = gl_InstanceID + int(uRow0 + 0.5);
  vec4 r0 = texelFetch(uBones, ivec2(x, y), 0);
  vec4 r1 = texelFetch(uBones, ivec2(x + 1, y), 0);
  vec4 r2 = texelFetch(uBones, ivec2(x + 2, y), 0);
  return mat4(r0.x, r1.x, r2.x, 0.0, r0.y, r1.y, r2.y, 0.0, r0.z, r1.z, r2.z, 0.0, r0.w, r1.w, r2.w, 1.0);
}
`;

const PELAGE = /* glsl */ `
varying vec3 vBind;
varying vec3 vBindN;
varying float vRegion;
vec3 lin(vec3 c) { return pow(c, vec3(2.2)); }
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);
}
// white spots in loose longitudinal rows on the flanks
float spots(vec3 p, vec3 n) {
  vec2 q = vec2(p.z / 0.056, (p.y + abs(p.x) * 0.35) / 0.041);
  vec2 c = floor(q);
  float best = 0.0;
  for (int dx = -1; dx <= 1; dx++) for (int dy = -1; dy <= 1; dy++) {
    vec2 cell = c + vec2(float(dx), float(dy));
    float keep = step(0.16, h21(cell + 3.1));
    vec2 ctr = cell + 0.5 + (vec2(h21(cell), h21(cell + 9.7)) - 0.5) * 0.55;
    float r = mix(0.21, 0.33, h21(cell + 5.3)) * (1.0 + 0.25 * smoothstep(-0.3, -0.5, p.z));
    vec2 d = (q - ctr) * vec2(1.0, 1.25);
    best = max(best, keep * (1.0 - smoothstep(r * 0.72, r, length(d))));
  }
  return best;
}
vec3 pelage(vec3 p, vec3 n, float region, out float rough) {
  vec3 rufous = lin(vec3(0.69, 0.42, 0.21));
  vec3 rufousDark = lin(vec3(0.48, 0.27, 0.13));
  vec3 stripe = lin(vec3(0.24, 0.13, 0.07));
  vec3 white = lin(vec3(0.9, 0.88, 0.83));
  vec3 fawn = lin(vec3(0.74, 0.58, 0.42));
  rough = 0.82;
  float side = sign(p.x + 1e-5);
  if (region > 5.5) { // tail: rufous-dark above, white beneath
    rough = 0.85;
    return mix(white, mix(rufousDark, stripe, 0.5), smoothstep(-0.25, 0.35, -n.z));
  }
  if (region > 4.5) { // ear: grey-fawn outside, pale inside, dark rim
    float inner = smoothstep(-0.1, 0.4, n.z);
    vec3 earPivot = vec3(side * ${EAR.x.toFixed(4)}, ${EAR.y.toFixed(4)}, ${EAR.z.toFixed(4)});
    float rim = smoothstep(0.105, 0.13, length(p - earPivot));
    vec3 c = mix(lin(vec3(0.56, 0.44, 0.34)), lin(vec3(0.82, 0.76, 0.68)), inner);
    return mix(c, stripe, rim * 0.85);
  }
  if (region > 3.5) { rough = 0.12; return lin(vec3(0.025, 0.02, 0.018)); } // eye
  if (region > 2.5) { // antler: bark-brown beam, polished ivory tips
    rough = 0.6;
    float tip = smoothstep(1.55, 1.7, p.y) + smoothstep(0.86, 0.92, p.z) * smoothstep(1.22, 1.28, p.y);
    float streak = vnoise(vec2(p.y * 90.0, p.x * 40.0));
    return mix(lin(vec3(0.38, 0.3, 0.22)) * (0.85 + 0.3 * streak), lin(vec3(0.86, 0.82, 0.72)), clamp(tip, 0.0, 1.0));
  }
  if (region > 1.5) { rough = 0.45; return lin(vec3(0.11, 0.095, 0.085)); } // hoof
  float grain = 0.93 + 0.12 * vnoise(vec2(p.z * 90.0, p.y * 28.0)) + 0.05 * vnoise(vec2(p.z * 6.0, p.y * 6.0));
  if (region > 0.5) { // legs: coat above, paler fawn below, whitish on the inner face
    float lower = smoothstep(0.42, 0.26, p.y);
    vec3 c = mix(rufous, fawn, lower);
    float inner = smoothstep(-0.1, -0.55, n.x * side);
    c = mix(c, white, inner * 0.55);
    c = mix(c, lin(vec3(0.36, 0.26, 0.18)), smoothstep(0.1, 0.07, p.y) * 0.5); // darker fetlocks
    return c * grain;
  }
  // ---- coat: head, neck and body
  vec3 poll = ${g3(SKELETON.poll)};
  vec3 tip = ${g3(SKELETON.muzzle)};
  vec3 ax = normalize(tip - poll);
  float s = dot(p - poll, ax) / length(tip - poll);
  float axd = length((p - poll) - ax * dot(p - poll, ax));
  bool head = s > -0.08 && axd < 0.11 && p.y > 0.92;
  if (head) {
    vec3 c = lin(vec3(0.62, 0.43, 0.28));
    c = mix(c, lin(vec3(0.42, 0.3, 0.21)), smoothstep(0.2, 0.7, n.y) * smoothstep(0.35, 0.65, s)); // dark muzzle band
    c = mix(c, lin(vec3(0.5, 0.36, 0.24)), smoothstep(0.5, 0.9, n.y) * (1.0 - smoothstep(0.0, 0.3, s))); // forehead
    c = mix(c, white, smoothstep(-0.25, -0.55, n.y) * smoothstep(0.55, 0.75, s)); // chin and lips
    vec3 eye = poll + (tip - poll) * 0.3 + vec3(side * 0.056, 0.012, 0.0);
    float de = length(p - eye);
    c = mix(c, lin(vec3(0.85, 0.8, 0.72)), smoothstep(0.024, 0.016, de) * 0.8); // pale eye ring
    vec3 gland = eye + vec3(-side * 0.004, -0.014, 0.022);
    c = mix(c, stripe, smoothstep(0.012, 0.007, length(p - gland))); // preorbital gland
    if (s > 0.93) { rough = 0.35; c = mix(c, lin(vec3(0.05, 0.04, 0.04)), smoothstep(0.93, 0.96, s)); } // rhinarium
    return c * (0.95 + 0.08 * vnoise(vec2(p.z * 60.0, p.y * 60.0)));
  }
  vec3 c = mix(rufous, rufousDark, smoothstep(0.3, 0.95, n.y) * 0.45);
  // neck: greyer, with a white throat patch high on the ventral side
  float neck = smoothstep(0.38, 0.48, p.z) * smoothstep(0.76, 0.84, p.y);
  c = mix(c, lin(vec3(0.6, 0.45, 0.32)), neck * 0.5);
  float throat = smoothstep(0.9, 0.97, p.y) * smoothstep(0.62, 0.68, p.z) * smoothstep(-0.1, -0.5, n.y) * (1.0 - smoothstep(1.02, 1.06, p.y));
  // dorsal stripe from nape to tail
  float dorsal = smoothstep(0.02, 0.008, abs(p.x)) * smoothstep(0.55, 0.85, n.y + neck * 0.3);
  c = mix(c, stripe, dorsal * 0.85);
  // spots: flanks only, a dense line along each side of the stripe, fading on neck and lower flank
  float spotZone = smoothstep(-0.35, -0.15, n.y) * (1.0 - smoothstep(0.88, 0.97, n.y)) * smoothstep(0.42, 0.34, p.z) * smoothstep(-0.66, -0.58, p.z);
  spotZone *= 1.0 - dorsal;
  c = mix(c, white, spots(p, n) * spotZone * 0.92);
  // white belly, inner thighs and rump patch (bordered by the dark stripe)
  float belly = smoothstep(-0.38, -0.62, n.y) * (1.0 - smoothstep(0.36, 0.44, p.z));
  c = mix(c, white, belly);
  float rump = smoothstep(-0.57, -0.63, p.z) * smoothstep(0.075, 0.04, abs(p.x)) * smoothstep(0.82, 0.7, p.y);
  c = mix(c, white, rump);
  c = mix(c, white, throat);
  return c * grain;
}
`;

function patchVertex(sh: THREE.WebGLProgramParametersWithUniforms, normals: boolean): void {
  sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>\n${SKIN_PARS}\nvarying vec3 vBind;\nvarying vec3 vBindN;\nvarying float vRegion;`);
  if (normals) {
    sh.vertexShader = sh.vertexShader.replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
      mat4 skinM = boneMat(aBone.x) * aWeight + boneMat(aBone.y) * (1.0 - aWeight);
      objectNormal = normalize(mat3(skinM) * objectNormal);`);
    sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      vBind = position; vBindN = normal; vRegion = aRegion;
      transformed = (skinM * vec4(transformed, 1.0)).xyz;`);
  } else {
    sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      mat4 skinM = boneMat(aBone.x) * aWeight + boneMat(aBone.y) * (1.0 - aWeight);
      vBind = position; vBindN = vec3(0.0, 1.0, 0.0); vRegion = aRegion;
      transformed = (skinM * vec4(transformed, 1.0)).xyz;`);
  }
}

export interface ChitalMaterials {
  coat: THREE.MeshPhysicalMaterial;
  depth: THREE.MeshDepthMaterial;
  uniforms: { uBones: { value: THREE.Texture }; uRow0: { value: number } };
  dispose(): void;
}

/** One material pair per instanced mesh (uRow0 differs per mesh); the bone texture is shared. */
export function createChitalMaterials(bones: THREE.Texture, row0: number): ChitalMaterials {
  const uniforms = { uBones: { value: bones }, uRow0: { value: row0 } };
  const coat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, roughness: 0.82, metalness: 0, sheen: 0.55, sheenRoughness: 0.55, sheenColor: new THREE.Color(0.85, 0.62, 0.42),
  });
  coat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    patchVertex(sh, true);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${PELAGE}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n  float coatRough = 0.82;\n  diffuseColor.rgb *= pelage(vBind, normalize(vBindN), vRegion, coatRough);`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = coatRough;');
  };
  coat.customProgramCacheKey = () => 'chital-coat-v1';
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  depth.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    patchVertex(sh, false);
  };
  depth.customProgramCacheKey = () => 'chital-depth-v1';
  return {
    coat, depth, uniforms,
    dispose(): void {
      coat.dispose();
      depth.dispose();
    },
  };
}
