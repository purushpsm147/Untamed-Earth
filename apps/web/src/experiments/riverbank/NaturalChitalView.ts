/**
 * Instanced, skinned chital for the riverbank slice — EXPERIMENT.
 *
 * Reads the simulation strictly through the same read-only fields production's AnimalView uses (interpolated
 * position, heading, measured movement, behaviour family, fear, growth). Nothing here writes to the simulation.
 * Two LODs (near/far) x two sexes = four instanced meshes sharing one bone texture.
 */
import * as THREE from 'three';
import { angleDiff } from '@untamed/core';
import { MODE, SPECIES, Simulation, behaviorFamily, maturityDays } from '@untamed/ecology';
import { buildChitalGeometry } from './chitalGeometry';
import { BoneTexture, ChitalMaterials, createBoneTexture, createChitalMaterials, writeBoneRow } from './chitalMaterial';
import { BONE_COUNT, RigOutput, RigState, newRigState, solveRig } from './chitalRig';

const MAX_NEAR = 48;
const MAX_FAR = 160;
/** Beyond this the far LOD is used. */
export const NEAR_DIST = 55;

interface Vis {
  rig: RigState;
  yaw: number;
  px: number;
  pz: number;
  seen: number;
}

interface Batch {
  mesh: THREE.InstancedMesh;
  mats: ChitalMaterials;
  row0: number;
  max: number;
  n: number;
}

export class NaturalChitalView {
  readonly group = new THREE.Group();
  private readonly bones: BoneTexture;
  private readonly batches: Batch[] = [];
  private readonly geos: THREE.BufferGeometry[] = [];
  private readonly vis = new Map<number, Vis>();
  private readonly tmp = new Float32Array(BONE_COUNT * 12);
  private frame = 0;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  /** Diagnostics for QA and the evidence report. */
  readonly stats = { drawn: 0, near: 0, far: 0, solveMs: 0, maxStanceToeErr: 0, stanceSamples: 0 };
  /** Last rig output per animal id (QA only; near animals). */
  readonly lastFeet = new Map<number, RigOutput['feet']>();

  constructor(private readonly sim: Simulation, shadows = true) {
    this.bones = createBoneTexture(MAX_NEAR * 2 + MAX_FAR * 2);
    const specs = [
      { antlers: false, detail: 1, max: MAX_NEAR },
      { antlers: true, detail: 1, max: MAX_NEAR },
      { antlers: false, detail: 0.45, max: MAX_FAR },
      { antlers: true, detail: 0.45, max: MAX_FAR },
    ];
    let row = 0;
    for (const sp of specs) {
      const geo = buildChitalGeometry({ antlers: sp.antlers, detail: sp.detail });
      this.geos.push(geo);
      const mats = createChitalMaterials(this.bones.texture, row);
      const mesh = new THREE.InstancedMesh(geo, mats.coat, sp.max);
      mesh.customDepthMaterial = mats.depth;
      mesh.castShadow = shadows;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.count = 0;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(mesh);
      this.batches.push({ mesh, mats, row0: row, max: sp.max, n: 0 });
      row += sp.max;
    }
  }

  set shadows(on: boolean) {
    for (const b of this.batches) b.mesh.castShadow = on;
  }

  update(cam: THREE.Vector3, alpha: number, dt: number, time: number, maxDist: number): void {
    const sim = this.sim;
    const valley = sim.valley;
    this.frame++;
    for (const b of this.batches) b.n = 0;
    const max2 = maxDist * maxDist;
    const t0 = performance.now();
    let toeErr = 0;
    let samples = 0;
    this.stats.near = 0;
    this.stats.far = 0;
    const exact = (x: number, z: number): number => valley.height(x, z);
    const fast = (x: number, z: number): number => valley.heightFast(x, z);
    for (const a of sim.animals) {
      if (!a.alive) continue;
      const sp = SPECIES[a.sp]!;
      if (sp.id !== 'chital') continue;
      const x = a.px + (a.x - a.px) * alpha;
      const z = a.pz + (a.z - a.pz) * alpha;
      const d2 = (x - cam.x) ** 2 + (z - cam.z) ** 2;
      if (d2 > max2) continue;
      const near = d2 < NEAR_DIST * NEAR_DIST;
      const adult = a.age > maturityDays(sp);
      const stag = adult && a.sex === 1;
      const b = this.batches[(near ? 0 : 2) + (stag ? 1 : 0)]!;
      if (b.n >= b.max) continue;
      let v = this.vis.get(a.id);
      if (!v) this.vis.set(a.id, (v = { rig: newRigState(), yaw: a.heading, px: x, pz: z, seen: 0 }));
      // measured ground speed from what is drawn: keeps the stance hoof fixed in the world
      const moved = v.seen === this.frame - 1 ? Math.hypot(x - v.px, z - v.pz) : 0;
      const speed = dt > 0 ? Math.min(moved / dt, 20) : 0;
      v.px = x;
      v.pz = z;
      v.seen = this.frame;
      v.yaw += angleDiff(v.yaw, a.heading) * Math.min(1, dt * 8);
      const g = sim.growth(a, sp);
      // same size rule as production (growth, stag factor, small per-animal variation)
      const sc = (0.42 + 0.58 * g) * (stag ? 1.12 : 1) * (0.94 + ((a.id * 37) % 13) / 100);
      const out = solveRig(v.rig, { x, z, heading: v.yaw, speed, family: behaviorFamily(a), fear: a.fear, scale: sc, dt, time, seed: a.id }, near ? exact : fast, this.tmp);
      writeBoneRow(this.bones, b.row0 + b.n, out.bones);
      if (near) {
        this.lastFeet.set(a.id, out.feet);
        for (const f of Object.values(out.feet)) {
          if (!f.stance) continue;
          samples++;
          toeErr = Math.max(toeErr, Math.abs(f.toe.y - f.terrainToe));
        }
      }
      // swimming: the simulation decides the mode; ride with head and back above the surface
      let y = out.groundY;
      if (a.mode === MODE.Swim) y = Math.max(y, valley.waterSurface(z) + sim.env.stage - 0.62 * sc);
      this.e.set(0, v.yaw, 0);
      this.m.compose(this.p.set(x, y, z), this.q.setFromEuler(this.e), this.s.setScalar(sc));
      this.m.toArray(b.mesh.instanceMatrix.array, b.n * 16);
      b.n++;
      if (near) this.stats.near++;
      else this.stats.far++;
    }
    for (const b of this.batches) {
      b.mesh.count = b.n;
      b.mesh.instanceMatrix.needsUpdate = true;
    }
    this.bones.texture.needsUpdate = true;
    this.stats.drawn = this.stats.near + this.stats.far;
    this.stats.solveMs = performance.now() - t0;
    this.stats.maxStanceToeErr = toeErr;
    this.stats.stanceSamples = samples;
    if (this.frame % 300 === 0) {
      for (const [id, v] of this.vis) if (this.frame - v.seen > 600) { this.vis.delete(id); this.lastFeet.delete(id); }
    }
  }

  /** Every GPU object this view created: geometries, materials (incl. shadow depth), bone texture, instance buffers. */
  dispose(): void {
    for (const b of this.batches) {
      b.mats.dispose();
      b.mesh.dispose();
    }
    for (const g of this.geos) g.dispose();
    this.bones.texture.dispose();
    this.vis.clear();
    this.lastFeet.clear();
    this.group.clear();
  }
}
