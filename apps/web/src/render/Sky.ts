import * as THREE from 'three';
import { clamp01, lerp, smoothstep } from '@untamed/core';
import { Environment } from '@untamed/environment';

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * p;
  gl_Position.z = gl_Position.w; // pin to the far plane
}`;
const FRAG = /* glsl */ `
precision highp float;
varying vec3 vDir;
uniform vec3 uSun; uniform vec3 uMoon;
uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uSunCol; uniform vec3 uCloudCol;
uniform float uCloud; uniform float uTime; uniform float uNight; uniform vec2 uDrift;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
float fbm(vec2 p){ float a = 0.5, s = 0.0; for(int i=0;i<5;i++){ s += a*noise(p); p = p*2.03 + 11.7; a *= 0.5; } return s; }
void main() {
  vec3 d = normalize(vDir);
  float up = max(d.y, 0.0);
  vec3 col = mix(uHorizon, uZenith, pow(up, 0.45));
  float sd = max(dot(d, uSun), 0.0);
  col += uSunCol * (pow(sd, 6.0) * 0.18 + pow(sd, 60.0) * 0.4) * (1.0 - uCloud * 0.7);
  col += uSunCol * smoothstep(0.9994, 0.9998, sd) * 12.0 * (1.0 - uCloud);
  // stars and moon
  if (uNight > 0.01) {
    vec2 sp = d.xz / (abs(d.y) + 0.35) * 90.0;
    float st = step(0.9975, hash(floor(sp))) * (0.5 + 0.5 * sin(uTime * 2.0 + hash(floor(sp)) * 40.0));
    col += vec3(0.8, 0.85, 1.0) * st * uNight * up * (1.0 - uCloud);
    float md = max(dot(d, uMoon), 0.0);
    col += vec3(0.75, 0.8, 0.95) * (smoothstep(0.9990, 0.9994, md) * 1.6 + pow(md, 80.0) * 0.12) * uNight * (1.0 - uCloud * 0.8);
  }
  // cloud deck projected on a plane
  if (d.y > 0.01) {
    vec2 cp = d.xz / (d.y + 0.12) * 1.6 + uDrift;
    float n = fbm(cp) ;
    float cov = smoothstep(1.0 - uCloud * 0.95 - 0.12, 1.0 - uCloud * 0.55 + 0.1, n + 0.28);
    float shade = fbm(cp * 2.3 + 4.0);
    vec3 cc = uCloudCol * (0.72 + 0.4 * shade) + uSunCol * pow(sd, 8.0) * 0.25;
    col = mix(col, cc, cov * smoothstep(0.01, 0.2, d.y));
  }
  gl_FragColor = vec4(col, 1.0);
}`;

/** Sky dome, sun/moon lighting, fog colour and exposure, all derived from the simulation's environment. */
export class Sky {
  readonly mesh: THREE.Mesh;
  readonly sun = new THREE.DirectionalLight(0xffffff, 2);
  readonly hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
  readonly sunDir = new THREE.Vector3(0, 1, 0);
  readonly fogColor = new THREE.Color();
  readonly horizon = new THREE.Color();
  readonly zenith = new THREE.Color();
  /**
   * Tone-mapping exposure for this frame: a gentle stand-in for eye/camera adaptation. Low-light scenes are
   * lifted a little and the midday scene is pulled down, instead of brightening everything.
   */
  exposure = 0.95;
  /** Brief additive flash from lightning. */
  flash = 0;
  private readonly mat: THREE.ShaderMaterial;
  private readonly tmp = { x: 0, y: 1, z: 0 };
  private readonly tmpC = new THREE.Color();

  constructor() {
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, side: THREE.BackSide, depthWrite: false, depthTest: true, fog: false,
      uniforms: {
        uSun: { value: new THREE.Vector3() }, uMoon: { value: new THREE.Vector3() }, uZenith: { value: this.zenith }, uHorizon: { value: this.horizon },
        uSunCol: { value: new THREE.Color() }, uCloudCol: { value: new THREE.Color() }, uCloud: { value: 0 }, uTime: { value: 0 }, uNight: { value: 0 },
        uDrift: { value: new THREE.Vector2() },
      },
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;
    this.sun.castShadow = true;
  }

  update(env: Environment, camera: THREE.Camera, time: number, shadowDist: number): void {
    env.sunDirection(this.tmp);
    this.sunDir.set(this.tmp.x, this.tmp.y, this.tmp.z);
    const el = this.tmp.y;
    const day = smoothstep(-0.12, 0.15, el);
    const golden = smoothstep(0.45, 0.0, el) * smoothstep(-0.2, 0.02, el);
    const cloud = env.cloud;
    const u = this.mat.uniforms;
    // palette
    this.zenith.setRGB(lerp(0.012, 0.12, day), lerp(0.02, 0.3, day), lerp(0.055, 0.66, day));
    this.horizon.setRGB(lerp(0.02, 0.56, day), lerp(0.03, 0.7, day), lerp(0.06, 0.86, day));
    this.horizon.lerp(new THREE.Color(0.95, 0.5, 0.25), golden * 0.55 * (1 - cloud * 0.6));
    const grey = (this.horizon.r + this.horizon.g + this.horizon.b) / 3;
    this.zenith.lerp(new THREE.Color(grey * 0.55, grey * 0.58, grey * 0.62), cloud * 0.8);
    this.horizon.lerp(new THREE.Color(grey * 0.85, grey * 0.87, grey * 0.9), cloud * 0.7);
    const sunCol = u.uSunCol!.value as THREE.Color;
    sunCol.setRGB(1, lerp(0.55, 0.96, smoothstep(0, 0.5, el)), lerp(0.3, 0.88, smoothstep(0, 0.5, el)));
    (u.uCloudCol!.value as THREE.Color).setRGB(lerp(0.035, 0.95, day), lerp(0.04, 0.95, day), lerp(0.06, 0.97, day)).multiplyScalar(1 - cloud * 0.42).lerp(sunCol, golden * 0.25);
    (u.uSun!.value as THREE.Vector3).copy(this.sunDir);
    const moon = (u.uMoon!.value as THREE.Vector3).set(-this.sunDir.x * 0.8 + 0.3, Math.max(0.25, -this.sunDir.y), -this.sunDir.z * 0.8).normalize();
    u.uCloud!.value = cloud;
    u.uTime!.value = time;
    u.uNight!.value = 1 - day;
    (u.uDrift!.value as THREE.Vector2).set(Math.cos(env.windDir), Math.sin(env.windDir)).multiplyScalar(time * 0.004 * (0.5 + env.wind * 0.2));
    // lights: sun by day, dim moonlight by night
    const lightDir = day > 0.05 ? this.sunDir : moon;
    const direct = day > 0.05 ? smoothstep(-0.02, 0.25, el) * 3.2 * (1 - cloud * 0.8) : 0.42 * (1 - cloud * 0.6);
    this.sun.color.copy(day > 0.05 ? sunCol : new THREE.Color(0.6, 0.7, 1));
    this.sun.intensity = direct;
    // Ambient (sky) light. Its hue comes from the sky, but its strength follows a twilight curve: the sky keeps
    // lighting the ground well through civil twilight (sun up to ~6 deg below the horizon) even though the sky
    // palette itself is dark there. Previously the dark palette was used directly, so dawn and dusk went murky.
    const twilight = smoothstep(-0.21, 0.03, el);
    const high = smoothstep(0.05, 0.6, el);
    // low sun warms the whole sky's light, not just the horizon band
    const hue = this.tmpC.copy(this.zenith).lerp(this.horizon, 0.5).lerp(sunCol, golden * 0.3 * (1 - cloud * 0.7));
    // normalise by luminance (not by the brightest channel), so `level` is the perceived brightness whatever the hue
    const lum = Math.max(0.2126 * hue.r + 0.7152 * hue.g + 0.0722 * hue.b, 1e-4);
    const level = lerp(0.03, 0.44, twilight) + 0.05 * high;
    this.hemi.color.setRGB(hue.r / lum, hue.g / lum, hue.b / lum).multiplyScalar(level);
    // light bounced off the ground: warm, and warmer when the sun is low
    this.hemi.groundColor.setRGB(0.3, 0.25, 0.17).lerp(new THREE.Color(0.42, 0.27, 0.15), golden * 0.6).multiplyScalar(0.18 + 0.62 * twilight);
    this.hemi.intensity = 1.25 + cloud * 0.3 * day + this.flash * 5;
    // adaptation: +12% around sunrise and sunset, -18% at midday (it was washing out), unchanged at night
    this.exposure = 0.95 * (1 + 0.12 * twilight * (1 - high) - 0.18 * high);
    this.flash *= 0.82;
    // fog: thicker in rain and at humid dawns
    this.fogColor.copy(this.horizon).lerp(this.zenith, 0.15);
    const cam = camera.position;
    this.mesh.position.copy(cam);
    const far = (camera as THREE.PerspectiveCamera).far;
    this.mesh.scale.setScalar(far * 0.9);
    const sd = Math.max(shadowDist, 30);
    const snap = sd / 64;
    const cx = Math.round(cam.x / snap) * snap;
    const cz = Math.round(cam.z / snap) * snap;
    this.sun.target.position.set(cx, cam.y - 5, cz);
    this.sun.position.set(cx + lightDir.x * 400, cam.y - 5 + Math.max(lightDir.y, 0.12) * 400, cz + lightDir.z * 400);
    this.sun.target.updateMatrixWorld();
  }

  /** Fog density for the current weather (exp2). */
  fogDensity(env: Environment, viewDist: number): number {
    const dawn = smoothstep(0.25, 0.0, Math.abs(env.sunElevation() - 0.05)) * clamp01(env.meanMoisture * 1.2 - 0.3);
    const wet = clamp01(env.rain / 10);
    return (1.1 / viewDist) * (1 + wet * 2.2 + dawn * 1.3 + env.cloud * 0.3);
  }

  /** Release this view's GPU objects when a world is replaced. */
  dispose(): void {
    this.mesh.geometry.dispose();
    this.mat.dispose();
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
  }
}
