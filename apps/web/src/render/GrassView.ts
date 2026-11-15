import * as THREE from 'three';
import { hash3f, smoothstep } from '@untamed/core';
import { Environment } from '@untamed/environment';
import { Valley } from '@untamed/worlds';
import { shared } from './shared';

function tuftGeometry(): THREE.BufferGeometry {
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
    // tapered blade: two quads narrowing to a tip, leaning outward
    const p = [
      [ox - dx, 0, oz - dz], [ox + dx, 0, oz + dz],
      [ox - dx * 0.7 + lx * 0.4, h * 0.55, oz - dz * 0.7 + lz * 0.4], [ox + dx * 0.7 + lx * 0.4, h * 0.55, oz + dz * 0.7 + lz * 0.4],
      [ox + lx, h, oz + lz],
    ];
    const tri = [0, 1, 2, 1, 3, 2, 2, 3, 4];
    for (const t of tri) {
      const v = p[t]!;
      pos.push(v[0]!, v[1]!, v[2]!);
      const k = v[1]! / h;
      col.push(0.16 + k * 0.2, 0.3 + k * 0.26, 0.08 + k * 0.06);
      nor.push(0, 1, 0); // upward normals: blades take the ground's lighting and never go black
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return g;
}

/**
 * Near-field grass. Tuft size follows the simulation's per-cell forage biomass, so
 * heavily grazed or drought-stricken ground is visibly cropped.
 */
export class GrassView {
  /** Holds the grass mesh; the mesh is replaced when its capacity changes with the quality preset. */
  readonly group = new THREE.Group();
  mesh: THREE.InstancedMesh;
  private readonly last = new THREE.Vector3(1e9, 0, 0);
  private count: number;
  dist = 50;
  private stamp = -1;

  constructor(private readonly valley: Valley, private readonly env: Environment, max: number) {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = shared.uTime;
      sh.uniforms.uWind = shared.uWind;
      sh.uniforms.uDry = shared.uDry;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime; uniform float uWind; uniform float uDry;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          vec4 wp = instanceMatrix * vec4(transformed, 1.0);
          float sw = sin(uTime * 1.9 + wp.x * 0.7 + wp.z * 0.5) + 0.6 * sin(uTime * 3.7 + wp.x * 1.9);
          float bend = sw * uWind * 0.018 * transformed.y * transformed.y / 0.2;
          transformed.x += bend; transformed.z += bend * 0.5;`,
        )
        .replace('#include <color_vertex>', '#include <color_vertex>\nvColor.rgb = mix(vColor.rgb, vec3(0.6, 0.52, 0.28) * (0.5 + color.g), uDry * 0.8);');
    };
    this.count = max;
    this.mesh = this.build(tuftGeometry(), mat, max);
  }

  private build(geo: THREE.BufferGeometry, mat: THREE.Material, capacity: number): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geo, mat, capacity);
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    mesh.count = 0;
    this.group.add(mesh);
    return mesh;
  }

  /** Sized to the preset (it used to be allocated at the Ultra count on every preset). */
  setMax(n: number): void {
    if (n !== this.mesh.instanceMatrix.count) {
      const old = this.mesh;
      this.group.remove(old);
      this.mesh = this.build(old.geometry, old.material as THREE.Material, n);
      old.dispose(); // instance buffer only; geometry and material are reused
    }
    this.count = n;
    this.last.set(1e9, 0, 0);
  }

  update(cam: THREE.Vector3, simHour: number): void {
    // refresh when the camera moves, or every few game hours so grazing shows up in place
    const st = Math.floor(simHour / 3);
    if (cam.distanceToSquared(this.last) < (this.dist * 0.18) ** 2 && st === this.stamp) return;
    this.stamp = st;
    this.last.copy(cam);
    const R = this.dist;
    const cell = Math.max(0.55, (2 * R) / Math.sqrt(this.count * 1.25));
    const env = this.env;
    const v = this.valley;
    const a = this.mesh.instanceMatrix.array;
    const i0 = Math.floor((cam.x - R) / cell);
    const j0 = Math.floor((cam.z - R) / cell);
    const n = Math.ceil((2 * R) / cell);
    let k = 0;
    for (let j = 0; j < n && k < this.count; j++) {
      for (let i = 0; i < n && k < this.count; i++) {
        const gi = i0 + i;
        const gj = j0 + j;
        const x = (gi + hash3f(gi, gj, 1)) * cell;
        const z = (gj + hash3f(gi, gj, 2)) * cell;
        const d = Math.hypot(x - cam.x, z - cam.z);
        if (d > R || !v.inBounds(x, z)) continue;
        const c = env.cellIndex(x, z);
        const cover = (1 - env.forest[c]! * 0.6) * (1 - env.dump[c]! * 0.85);
        if (hash3f(gi, gj, 3) > cover) continue;
        const y = v.heightFast(x, z);
        if (v.waterSurface(z) + env.stage - y > -0.03) continue;
        if (v.roadDist(x, z) < 2.4 && hash3f(gi, gj, 4) < 0.85) continue;
        if (env.settlement[c]! > 0.05 && v.blocked(x, z, 0.1)) continue;
        const vf = Math.min(1, env.vegFrac(c) * 1.25);
        const fade = 1 - smoothstep(0.72, 1, d / R);
        const s = (0.22 + 0.62 * vf) * (0.7 + hash3f(gi, gj, 5) * 0.7) * fade * (1 + env.wetland[c]! * 0.6);
        if (s < 0.08) continue;
        const rot = hash3f(gi, gj, 6) * 6.283;
        const cs = Math.cos(rot) * s;
        const sn = Math.sin(rot) * s;
        const o = k * 16;
        a[o] = cs; a[o + 1] = 0; a[o + 2] = -sn; a[o + 3] = 0;
        a[o + 4] = 0; a[o + 5] = s; a[o + 6] = 0; a[o + 7] = 0;
        a[o + 8] = sn; a[o + 9] = 0; a[o + 10] = cs; a[o + 11] = 0;
        a[o + 12] = x; a[o + 13] = y - 0.04; a[o + 14] = z; a[o + 15] = 1;
        k++;
      }
    }
    this.mesh.count = k;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.dispose(); // per-instance matrix buffer
  }
}
