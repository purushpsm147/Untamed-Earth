import * as THREE from 'three';
import { shared } from './shared';

/** Rain streaks in a camera-centred volume; positions wrap in the vertex shader so the buffer is static. */
export class WeatherFx {
  readonly rain: THREE.LineSegments;
  private readonly mat: THREE.ShaderMaterial;
  constructor(max: number) {
    const pos = new Float32Array(max * 6);
    const top = new Float32Array(max * 2);
    for (let i = 0; i < max; i++) {
      const x = Math.random() * 40 - 20;
      const y = Math.random() * 30;
      const z = Math.random() * 40 - 20;
      pos.set([x, y, z, x, y, z], i * 6);
      top[i * 2] = 0;
      top[i * 2 + 1] = 1;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aTop', new THREE.BufferAttribute(top, 1));
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uTime: shared.uTime, uCam: { value: new THREE.Vector3() }, uWindV: { value: new THREE.Vector2() }, uOpacity: { value: 0 }, uColor: { value: new THREE.Color(0.75, 0.8, 0.88) } },
      vertexShader: /* glsl */ `
        attribute float aTop; uniform float uTime; uniform vec3 uCam; uniform vec2 uWindV;
        void main() {
          vec3 p = position;
          p.y = mod(p.y - uTime * 26.0, 30.0);
          p.xz += uWindV * (30.0 - p.y) * 0.04;
          p.xz = mod(p.xz - uCam.xz + 20.0, 40.0) - 20.0;
          p += vec3(uCam.x, uCam.y - 12.0, uCam.z);
          p.y += aTop * 0.9; p.xz += uWindV * aTop * 0.035;
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */ `uniform float uOpacity; uniform vec3 uColor; void main() { gl_FragColor = vec4(uColor, uOpacity); }`,
    });
    this.rain = new THREE.LineSegments(g, this.mat);
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    this.rain.renderOrder = 6;
  }
  update(cam: THREE.Vector3, rain: number, wind: number, windDir: number, daylight: number): void {
    const u = this.mat.uniforms;
    this.rain.visible = rain > 0.15;
    (u.uCam!.value as THREE.Vector3).copy(cam);
    (u.uWindV!.value as THREE.Vector2).set(Math.cos(windDir) * wind, Math.sin(windDir) * wind);
    u.uOpacity!.value = Math.min(0.55, 0.12 + rain * 0.035) * (0.3 + 0.7 * daylight);
  }
  setDensity(n: number): void {
    this.rain.geometry.setDrawRange(0, n * 2);
  }
}
