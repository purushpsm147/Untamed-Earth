import * as THREE from 'three';
import { angleDiff } from '@untamed/core';
import { Animal, SPECIES, Simulation, behaviorFamily, maturityDays } from '@untamed/ecology';
import { AnimalModel, buildAnimalModels } from './animalGeo';
import { blob } from './geo';
import { PoseState, newPose, stepPose } from './animalPose';

interface Batch {
  mesh: THREE.InstancedMesh;
  anim: THREE.InstancedBufferAttribute;
  /** x: lie (0 standing .. 1 lying, legs folded). */
  pose: THREE.InstancedBufferAttribute;
  model: AnimalModel;
  n: number;
}
interface Vis extends PoseState {
  phase: number;
  yaw: number;
  seen: number;
  /** Feet height above exact terrain at last draw (NaN when flying, swimming or lying). */
  off: number;
}

const MAX = 700;

/** An opt-in A/B experiment: baseline marks entire instance attributes dirty; active only uploads used slots. */
export type AnimalUploadMode = 'full' | 'active';
export interface AnimalUploadSample {
  mode: AnimalUploadMode;
  frames: number;
  averageVisible: number;
  averageRequestedBytes: number;
  totalDropped: number;
}

function animatedMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aPart; attribute vec2 aPivot; attribute float aFold; attribute vec4 iAnim; attribute vec4 iPose;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float ang = 0.0;
        // legs swing while walking and fold under the body when lying (front legs back, hind legs forward)
        if (aPart.x != 0.0) ang = aPart.x * sin(iAnim.x) * iAnim.y * (1.0 - iPose.x) + aFold * iPose.x * 1.45;
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

/** Renders every living animal (and carcasses) from simulation state with instanced, shader-animated meshes. */
export class AnimalView {
  readonly group = new THREE.Group();
  readonly marker: THREE.Mesh;
  private readonly batches: Record<string, Batch> = {};
  private readonly carcass: THREE.InstancedMesh;
  private readonly groupRings: THREE.InstancedMesh;
  private readonly vis = new Map<number, Vis>();
  private frame = 0;
  /** Estimated attribute bytes requested for the most recent frame, not measured GPU transfer traffic. */
  private lastUpload = { visible: 0, requestedBytes: 0, dropped: 0 };
  private uploadSample: { frames: number; visible: number; requestedBytes: number; dropped: number } | null = null;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  /** Interpolated world position of each rendered animal this frame (for picking and cameras). */
  readonly pos = new Map<number, THREE.Vector3>();

  constructor(private readonly sim: Simulation, readonly uploadMode: AnimalUploadMode = 'full') {
    const models = buildAnimalModels();
    const mat = animatedMaterial();
    for (const [name, model] of Object.entries(models)) {
      const anim = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4);
      anim.setUsage(THREE.DynamicDrawUsage);
      model.geo.setAttribute('iAnim', anim);
      const pose = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4);
      pose.setUsage(THREE.DynamicDrawUsage);
      model.geo.setAttribute('iPose', pose);
      const mesh = new THREE.InstancedMesh(model.geo, mat, MAX);
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      mesh.count = 0;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(mesh);
      this.batches[name] = { mesh, anim, pose, model, n: 0 };
    }
    this.carcass = new THREE.InstancedMesh(blob(0.5, 1, 3, 0.5), new THREE.MeshStandardMaterial({ color: 0x3a1f18, roughness: 1 }), 200);
    this.carcass.frustumCulled = false;
    this.carcass.count = 0;
    this.group.add(this.carcass);
    this.marker = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 40), new THREE.MeshBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.85, depthTest: false, side: THREE.DoubleSide }));
    const ring = new THREE.RingGeometry(0.8, 0.95, 24);
    ring.rotateX(-Math.PI / 2);
    this.groupRings = new THREE.InstancedMesh(ring, new THREE.MeshBasicMaterial({ color: 0x9fd0ff, transparent: true, opacity: 0.7, depthTest: false, side: THREE.DoubleSide }), 80);
    this.groupRings.frustumCulled = false;
    this.groupRings.count = 0;
    this.groupRings.renderOrder = 5;
    this.group.add(this.groupRings);
    this.marker.rotation.x = -Math.PI / 2;
    this.marker.visible = false;
    this.marker.renderOrder = 5;
    this.group.add(this.marker);
  }

  update(cam: THREE.Vector3, alpha: number, dt: number, time: number, maxDist: number, selected: number, highlightGroup = 0): void {
    let rings = 0;
    const sim = this.sim;
    const valley = sim.valley;
    this.frame++;
    let dropped = 0;
    for (const b of Object.values(this.batches)) b.n = 0;
    const max2 = maxDist * maxDist;
    this.marker.visible = false;
    for (const a of sim.animals) {
      if (!a.alive) continue;
      const x = a.px + (a.x - a.px) * alpha;
      const z = a.pz + (a.z - a.pz) * alpha;
      const d2 = (x - cam.x) ** 2 + (z - cam.z) ** 2;
      if (d2 > max2) continue;
      const sp = SPECIES[a.sp]!;
      const adult = a.age > maturityDays(sp);
      const b = this.batches[sp.id === 'chital' && adult && a.sex === 1 ? 'stag' : sp.id]!;
      if (b.n >= MAX) {
        dropped++; // Report overflow: this experiment must not silently imply extra animal capacity.
        continue;
      }
      let v = this.vis.get(a.id);
      if (!v) this.vis.set(a.id, (v = { ...newPose(), phase: (a.id * 1.7) % 6.28, yaw: a.heading, seen: 0, off: NaN }));
      v.seen = this.frame;
      const alt = a.palt + (a.alt - a.palt) * alpha;
      const ground = d2 < 300 * 300 ? valley.height(x, z) : valley.heightFast(x, z);
      const wd = valley.waterSurface(z) + sim.env.stage - ground;
      const moved = Math.hypot(a.x - a.px, a.z - a.pz);
      const moving = a.speed > 0.05 && moved > 1e-4;
      const flying = alt > 0.25;
      // smooth heading; advance gait with distance travelled so feet never skate
      v.yaw += angleDiff(v.yaw, a.heading) * Math.min(1, dt * 8);
      const stride = (sp.mass > 20 ? 3.2 : sp.mass > 4 ? 6 : 11) * (a.speed > sp.walk * 2 ? 0.55 : 1);
      if (moving && !flying) v.phase += a.speed * dt * stride;
      // pose from the read-only contract: behaviour family plus whether the animal is actually moving
      const run = a.speed > sp.walk * 2;
      const lie = stepPose(v, { family: behaviorFamily(a), moving, running: run, flying, flier: sp.flies, fear: a.fear, time, seed: a.id }, dt);
      const g = sim.growth(a, sp);
      const sc = (0.42 + 0.58 * g) * (sp.id === 'chital' && a.sex === 1 && adult ? 1.12 : 1) * (0.94 + ((a.id * 37) % 13) / 100);
      // swimming animals ride at the surface with only head and back showing
      let y = ground + alt - lie * b.model.lie * sc;
      if (!flying && wd > 0.45 * sc) y = ground + wd - b.model.height * sc * 0.72;
      v.off = flying || wd > 0.45 * sc || v.lie > 0.02 || d2 >= 300 * 300 ? NaN : y - ground;
      const pitch = flying ? -0.15 : run ? Math.sin(v.phase) * 0.05 : 0;
      this.e.set(pitch, v.yaw, 0);
      this.p.set(x, y + (run && !flying ? Math.abs(Math.sin(v.phase)) * 0.06 * sc : 0), z);
      this.m.compose(this.p, this.q.setFromEuler(this.e), this.s.setScalar(sc));
      this.m.toArray(b.mesh.instanceMatrix.array, b.n * 16);
      const an = b.anim.array as Float32Array;
      const o = b.n * 4;
      an[o] = v.phase;
      an[o + 1] = v.amp;
      an[o + 2] = v.head * (sp.id === 'boar' ? 0.35 : sp.id === 'hare' ? 0.5 : 1);
      (b.pose.array as Float32Array)[o] = lie;
      an[o + 3] = flying ? Math.sin(time * (sp.mass > 0.2 ? 15 : 22) + a.id) * 0.95 + 0.1 : -1.42;
      b.n++;
      let pv = this.pos.get(a.id);
      if (!pv) this.pos.set(a.id, (pv = new THREE.Vector3()));
      pv.set(x, y + b.model.height * sc * 0.6, z);
      if (highlightGroup && a.group === highlightGroup && a.id !== selected && rings < 80) {
        const r = sp.mass > 20 ? 0.8 : sp.mass > 4 ? 0.5 : 0.3;
        this.e.set(0, 0, 0);
        this.m.compose(this.p.set(x, y + 0.1 + lie * b.model.lie * sc, z), this.q.setFromEuler(this.e), this.s.setScalar(r));
        this.groupRings.setMatrixAt(rings++, this.m);
      }
      if (a.id === selected) {
        this.marker.visible = true;
        const r = Math.max(0.35, sp.mass > 20 ? 1 : sp.mass > 4 ? 0.6 : 0.35);
        this.marker.scale.setScalar(r * (1 + Math.sin(time * 4) * 0.06));
        this.marker.position.set(x, y + 0.08 + (flying ? -0.1 : lie * b.model.lie * sc), z);
      }
    }
    this.groupRings.count = rings;
    this.groupRings.instanceMatrix.needsUpdate = true;
    let visible = 0;
    let requestedBytes = 0;
    for (const b of Object.values(this.batches)) {
      b.mesh.count = b.n;
      visible += b.n;
      if (this.uploadMode === 'active') {
        // Three.js update ranges are measured in elements (floats), not bytes.
        // The three arrays are contiguous: 16 matrix + 4 animation + 4 pose floats per instance.
        b.mesh.instanceMatrix.clearUpdateRanges();
        b.anim.clearUpdateRanges();
        b.pose.clearUpdateRanges();
        if (b.n > 0) {
          b.mesh.instanceMatrix.addUpdateRange(0, b.n * 16);
          b.anim.addUpdateRange(0, b.n * 4);
          b.pose.addUpdateRange(0, b.n * 4);
          b.mesh.instanceMatrix.needsUpdate = true;
          b.anim.needsUpdate = true;
          b.pose.needsUpdate = true;
          requestedBytes += b.n * 24 * 4;
        }
      } else {
        // Exact baseline behavior, including dirtying empty batches.
        b.mesh.instanceMatrix.needsUpdate = true;
        b.anim.needsUpdate = true;
        b.pose.needsUpdate = true;
        if (b.n > 0) requestedBytes += MAX * 24 * 4;
      }
    }
    this.lastUpload = { visible, requestedBytes, dropped };
    if (this.uploadSample) {
      this.uploadSample.frames++;
      this.uploadSample.visible += visible;
      this.uploadSample.requestedBytes += requestedBytes;
      this.uploadSample.dropped += dropped;
    }
    // carcasses shrink as they are eaten and decompose
    let cn = 0;
    for (const c of sim.carcasses) {
      if (cn >= 200) break;
      const s = Math.min(1.1, 0.12 + Math.cbrt(c.kg) * 0.22);
      this.e.set(0, c.id, 0);
      this.m.compose(this.p.set(c.x, valley.heightFast(c.x, c.z) + s * 0.1, c.z), this.q.setFromEuler(this.e), this.s.set(s * 1.5, s * 0.45, s));
      this.carcass.setMatrixAt(cn++, this.m);
    }
    this.carcass.count = cn;
    this.carcass.instanceMatrix.needsUpdate = true;
    // forget render state of animals not drawn for a while (dead or far away)
    if (this.frame % 300 === 0) {
      for (const [id, v] of this.vis) {
        if (this.frame - v.seen > 600) {
          this.vis.delete(id);
          this.pos.delete(id);
        }
      }
    }
  }

  /** Inspect intended attribute update volume; Three.js/driver may optimize actual GPU transfers differently. */
  debugUpload(): { mode: AnimalUploadMode; visible: number; requestedBytes: number; dropped: number } {
    return { mode: this.uploadMode, ...this.lastUpload };
  }

  beginUploadSample(): void {
    this.uploadSample = { frames: 0, visible: 0, requestedBytes: 0, dropped: 0 };
  }

  endUploadSample(): AnimalUploadSample {
    const s = this.uploadSample;
    this.uploadSample = null;
    return {
      mode: this.uploadMode,
      frames: s?.frames ?? 0,
      averageVisible: s && s.frames ? Math.round(s.visible / s.frames * 10) / 10 : 0,
      averageRequestedBytes: s && s.frames ? Math.round(s.requestedBytes / s.frames) : 0,
      totalDropped: s?.dropped ?? 0,
    };
  }

  /** QA: the drawn pose of one animal this frame (presentation state only), or null if not drawn. */
  debugPose(id: number): { lie: number; head: number; amp: number; yaw: number } | null {
    const v = this.vis.get(id);
    return v && v.seen === this.frame ? { lie: v.lie, head: v.head, amp: v.amp, yaw: v.yaw } : null;
  }

  /** QA: largest gap between drawn feet and exact terrain among standing ground animals this frame. */
  maxGroundError(): { max: number; n: number } {
    let max = 0;
    let n = 0;
    for (const v of this.vis.values()) {
      if (v.seen !== this.frame || Number.isNaN(v.off)) continue;
      n++;
      max = Math.max(max, Math.abs(v.off));
    }
    return { max, n };
  }

  /** Nearest rendered animal to a ray, within an angular tolerance. */
  pick(ray: THREE.Ray, maxDist: number): Animal | null {
    let best: Animal | null = null;
    let bestScore = 1e9;
    const tmp = new THREE.Vector3();
    for (const a of this.sim.animals) {
      const p = this.pos.get(a.id);
      const v = this.vis.get(a.id);
      if (!p || !a.alive || !v || v.seen !== this.frame) continue;
      const t = tmp.copy(p).sub(ray.origin).dot(ray.direction);
      if (t < 0.5 || t > maxDist) continue;
      const d = Math.sqrt(ray.distanceSqToPoint(p));
      const tol = 0.5 + t * 0.03;
      if (d < tol && d / tol + t * 0.002 < bestScore) {
        bestScore = d / tol + t * 0.002;
        best = a;
      }
    }
    return best;
  }

  /**
   * The species batches share one material, but each model owns a geometry.
   * Instance matrices and colours live outside the geometry: only InstancedMesh.dispose() releases them,
   * and restarts reuse the same GL context, so skipping it leaks GPU buffers on every new world.
   */
  dispose(): void {
    const materials = new Set<THREE.Material>();
    const meshes: THREE.Mesh[] = [...Object.values(this.batches).map((b) => b.mesh), this.carcass, this.groupRings, this.marker];
    for (const mesh of meshes) {
      mesh.geometry.dispose();
      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of list) materials.add(material);
      if (mesh instanceof THREE.InstancedMesh) mesh.dispose();
    }
    for (const material of materials) material.dispose();
    this.pos.clear();
    this.vis.clear();
    this.group.clear();
  }
}
