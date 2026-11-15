import * as THREE from 'three';
import { APRON, CHUNKS, CHUNK_SIZE, SCATTER_KINDS, SCATTER_STRIDE, Valley } from '@untamed/worlds';
import { ScatterModel, buildScatterModels } from './scatterGeo';
import { addWind } from './shared';

interface Batch {
  mesh: THREE.InstancedMesh;
  n: number;
}

/**
 * Draws all scattered vegetation and debris with a handful of instanced draw calls.
 * Instance buffers are refilled from the deterministic per-chunk scatter lists whenever
 * the camera has moved or turned enough; chunks outside the view cone are skipped.
 */
export class ScatterView {
  readonly group = new THREE.Group();
  private readonly models: ScatterModel[];
  private readonly hi: Batch[] = [];
  private readonly lo: (Batch | null)[] = [];
  private readonly last = new THREE.Vector3(1e9, 0, 0);
  private readonly lastDir = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  vegDist = 500;
  treeHiDist = 100;
  shadows = true;

  constructor(private readonly valley: Valley) {
    this.models = buildScatterModels();
    const mk = (geo: THREE.BufferGeometry, m: ScatterModel, far: boolean): Batch => {
      const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, flatShading: !m.foliage });
      if (m.foliage) addWind(mat, 1.2, 0.006);
      const mesh = new THREE.InstancedMesh(geo, mat, m.max);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = m.shadow && !far;
      mesh.receiveShadow = !m.foliage;
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(m.max * 3), 3);
      this.group.add(mesh);
      return { mesh, n: 0 };
    };
    for (let k = 0; k < SCATTER_KINDS; k++) {
      const m = this.models[k]!;
      this.hi[k] = mk(m.hi, m, false);
      this.lo[k] = m.lo ? mk(m.lo, m, true) : null;
    }
  }

  invalidate(): void {
    this.last.set(1e9, 0, 0);
  }

  update(camera: THREE.PerspectiveCamera): void {
    const cam = camera.position;
    camera.getWorldDirection(this.dir);
    if (cam.distanceToSquared(this.last) < 100 && this.dir.dot(this.lastDir) > 0.985) return;
    this.last.copy(cam);
    this.lastDir.copy(this.dir);
    for (let k = 0; k < SCATTER_KINDS; k++) {
      this.hi[k]!.n = 0;
      if (this.lo[k]) this.lo[k]!.n = 0;
    }
    const vd = this.vegDist;
    const hi2 = this.treeHiDist * this.treeHiDist;
    // generous horizontal cone test (camera fov plus margin); nearby chunks always pass so shadows stay stable
    const cosHalf = Math.cos(Math.min(Math.PI, ((camera.fov * camera.aspect) / 2 + 28) * (Math.PI / 180)));
    const fl = Math.hypot(this.dir.x, this.dir.z) || 1;
    const fx = this.dir.x / fl;
    const fz = this.dir.z / fl;
    const steep = Math.abs(this.dir.y) > 0.8;
    for (let cz = -APRON; cz < CHUNKS + APRON; cz++) {
      for (let cx = -APRON; cx < CHUNKS + APRON; cx++) {
        const mx = (cx + 0.5) * CHUNK_SIZE - cam.x;
        const mz = (cz + 0.5) * CHUNK_SIZE - cam.z;
        const cd = Math.hypot(mx, mz);
        if (cd > vd + CHUNK_SIZE * 0.75) continue;
        if (!steep && cd > CHUNK_SIZE * 1.6 && (mx * fx + mz * fz) / cd < cosHalf - (CHUNK_SIZE * 0.75) / cd) continue;
        const sc = this.valley.scatter(cx, cz);
        for (let i = 0; i < sc.length; i += SCATTER_STRIDE) {
          const k = sc[i]!;
          const x = sc[i + 1]!;
          const z = sc[i + 3]!;
          const dx = x - cam.x;
          const dz = z - cam.z;
          const d2 = dx * dx + dz * dz;
          const m = this.models[k]!;
          const lim = vd * m.range;
          if (d2 > lim * lim) continue;
          let b = this.hi[k]!;
          if (d2 > hi2 && this.lo[k]) b = this.lo[k]!;
          if (b.n >= m.max) continue;
          const rot = sc[i + 4]!;
          // small objects shrink into the distance instead of popping
          const fade = m.range < 1 ? Math.min(1, (1 - Math.sqrt(d2) / lim) * 5) : 1;
          const s = sc[i + 5]! * fade;
          const c = Math.cos(rot) * s;
          const sn = Math.sin(rot) * s;
          const a = b.mesh.instanceMatrix.array;
          const o = b.n * 16;
          a[o] = c; a[o + 1] = 0; a[o + 2] = -sn; a[o + 3] = 0;
          a[o + 4] = 0; a[o + 5] = s; a[o + 6] = 0; a[o + 7] = 0;
          a[o + 8] = sn; a[o + 9] = 0; a[o + 10] = c; a[o + 11] = 0;
          a[o + 12] = x; a[o + 13] = sc[i + 2]! - 0.08; a[o + 14] = z; a[o + 15] = 1;
          const tint = 0.78 + sc[i + 6]! * 0.44;
          const ca = b.mesh.instanceColor!.array;
          ca[b.n * 3] = tint * (0.95 + sc[i + 6]! * 0.15);
          ca[b.n * 3 + 1] = tint;
          ca[b.n * 3 + 2] = tint * 0.92;
          b.n++;
        }
      }
    }
    const flush = (b: Batch): void => {
      b.mesh.count = b.n;
      b.mesh.instanceMatrix.needsUpdate = true;
      b.mesh.instanceColor!.needsUpdate = true;
    };
    for (let k = 0; k < SCATTER_KINDS; k++) {
      flush(this.hi[k]!);
      if (this.lo[k]) flush(this.lo[k]!);
      this.hi[k]!.mesh.castShadow = this.shadows && this.models[k]!.shadow;
    }
  }

  dispose(): void {
    for (const b of [...this.hi, ...this.lo]) {
      if (!b) continue;
      b.mesh.geometry.dispose();
      (b.mesh.material as THREE.Material).dispose();
      b.mesh.dispose(); // per-instance matrix and colour buffers
    }
    this.group.clear();
  }
}
