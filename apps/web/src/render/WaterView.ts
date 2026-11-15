import * as THREE from 'three';
import { Valley } from '@untamed/worlds';
import { shared } from './shared';
import { Sky } from './Sky';

const VERT = /* glsl */ `
varying vec3 vWp;
#include <fog_pars_vertex>
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWp = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const FRAG = /* glsl */ `
precision highp float;
varying vec3 vWp;
uniform float uTime; uniform float uRain; uniform float uDetail;
uniform vec3 uSun; uniform vec3 uSunCol; uniform vec3 uSky; uniform vec3 uHorizon; uniform vec3 uTint;
#include <fog_pars_fragment>
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
void main() {
  // flow runs downstream (+z); two scrolling noise layers give a moving, non-repeating surface
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
  float spec = pow(max(dot(refl, uSun), 0.0), 220.0);
  vec3 col = mix(uTint, sky, fres) + uSunCol * spec * 2.5;
  gl_FragColor = vec4(col, mix(0.72, 0.97, fres));
  #include <fog_fragment>
}`;

/** River and wetland surface: one sloped sheet at the analytic water level, raised and lowered by the simulated stage. */
export class WaterView {
  readonly mesh: THREE.Mesh;
  readonly pools = new THREE.Group();
  private readonly mat: THREE.ShaderMaterial;

  constructor(valley: Valley) {
    const lo = -192;
    const hi = valley.size + 192;
    const geo = new THREE.PlaneGeometry(hi - lo, hi - lo, 1, 64);
    geo.rotateX(-Math.PI / 2);
    geo.translate((lo + hi) / 2, 0, (lo + hi) / 2);
    const p = geo.attributes.position!;
    for (let i = 0; i < p.count; i++) p.setY(i, valley.waterSurface(p.getZ(i)));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, fog: true, depthWrite: false,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        { uRain: { value: 0 }, uDetail: { value: 1 }, uSun: { value: new THREE.Vector3() }, uSunCol: { value: new THREE.Color() },
          uSky: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uTint: { value: new THREE.Color(0.06, 0.12, 0.1) } },
      ]),
    });
    this.mat.uniforms.uTime = shared.uTime;
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    // leachate pools: opaque, oily, faintly iridescent brown-green
    const pm = new THREE.MeshStandardMaterial({ color: 0x2b2410, roughness: 0.12, metalness: 0.5 });
    for (const pool of valley.pools) {
      const m = new THREE.Mesh(new THREE.CircleGeometry(pool.r * 1.25, 20), pm);
      m.rotation.x = -Math.PI / 2;
      m.position.set(pool.x, valley.height(pool.x, pool.z) + 0.75, pool.z);
      this.pools.add(m);
    }
  }

  update(stage: number, rain: number, sky: Sky, detail: boolean, daylight: number): void {
    this.mesh.position.y = stage;
    const u = this.mat.uniforms;
    u.uRain!.value = Math.min(1, rain / 8);
    u.uDetail!.value = detail ? 1 : 0;
    (u.uSun!.value as THREE.Vector3).copy(sky.sunDir);
    (u.uSunCol!.value as THREE.Color).copy(sky.sun.color).multiplyScalar(Math.min(1, sky.sun.intensity));
    (u.uSky!.value as THREE.Color).copy(sky.zenith);
    (u.uHorizon!.value as THREE.Color).copy(sky.horizon);
    (u.uTint!.value as THREE.Color).setRGB(0.05, 0.11, 0.09).multiplyScalar(0.15 + 0.85 * daylight);
  }
}
