/**
 * Untamed Earth: CONTROLLED spatial-query baseline, not a production physics engine.
 *
 * Usage:
 *   npm run bench:spatial
 *   npm run bench:spatial -- --quick --out=docs/evidence/tech-experiments/spatial-baseline-ci.json
 *
 * Static axis-aligned boxes only. Identical rays compared against THREE.Raycaster
 * triangle hits (DoubleSide) and an independently implemented ray/AABB slab test.
 * Real terrain, rotated ruins, sloped surfaces, moving animals and swept-body
 * collision are NOT tested here. This establishes a portable correctness fixture
 * for future three-mesh-bvh and Rapier candidate experiments.
 */
import * as THREE from 'three';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { cpus, platform, arch } from 'node:os';

interface Obstacle { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number }
interface Ray { origin: THREE.Vector3; direction: THREE.Vector3 }
const quick = process.argv.includes('--quick');
const out = process.argv.find(s => s.startsWith('--out='))?.slice('--out='.length);
const counts = quick ? [60, 240] : [60, 240, 900];
const samples = quick ? 160 : 360;
const rounds = quick ? 8 : 18;
const warmup = quick ? 2 : 5;
const FAR = 90;
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
}
function quantiles(values: number[]) {
  const a = [...values].sort((x, y) => x - y);
  if (!a.length) throw new Error('No timing samples');
  const p = (v: number) => a[Math.floor((a.length - 1) * v)]!;
  return { meanMs: values.reduce((x, y) => x + y, 0) / values.length, medianMs: p(0.5), p95Ms: p(0.95), p99Ms: p(0.99), minMs: a[0], maxMs: a.at(-1) };
}
function makeCase(count: number) {
  const next = rng(150 + count);
  const obstacles: Obstacle[] = [];
  for (let i = 0; i < count; i++) {
    const x = (next() - 0.5) * 130;
    const z = (next() - 0.5) * 130;
    const w = 1 + next() * 4;
    const d = 1 + next() * 4;
    const h = 0.9 + next() * 6;
    obstacles.push({ minX: x - w / 2, maxX: x + w / 2,
      minY: 0, maxY: h, minZ: z - d / 2, maxZ: z + d / 2 });
  }
  const rays: Ray[] = [];
  for (let i = 0; i < samples; i++) {
    const az = next() * Math.PI * 2;
    const elevation = (next() - 0.5) * 0.38;
    rays.push({
      origin: new THREE.Vector3((next() - 0.5) * 72, 1.7 + next() * 0.7, (next() - 0.5) * 72),
      direction: new THREE.Vector3(Math.sin(az), elevation, Math.cos(az)).normalize(),
    });
  }
  return { obstacles, rays };
}
function slabDistance(ray: Ray, box: Obstacle, maxDistance: number): number | null {
  let near = -Infinity, far = Infinity;
  for (let axis = 0; axis < 3; axis++) {
    const v = axis === 0 ? ray.origin.x : axis === 1 ? ray.origin.y : ray.origin.z;
    const d = axis === 0 ? ray.direction.x : axis === 1 ? ray.direction.y : ray.direction.z;
    const lo = axis === 0 ? box.minX : axis === 1 ? box.minY : box.minZ;
    const hi = axis === 0 ? box.maxX : axis === 1 ? box.maxY : box.maxZ;
    if (Math.abs(d) < 1e-12) {
      if (v < lo || v > hi) return null;
      continue;
    }
    let t0 = (lo - v) / d, t1 = (hi - v) / d;
    if (t0 > t1) { const tmp = t0; t0 = t1; t1 = tmp; }
    near = Math.max(near, t0);
    far = Math.min(far, t1);
    if (near > far) return null;
  }
  const t = near >= 0 ? near : far;
  return t >= 0 && t <= maxDistance ? t : null;
}
function analyticNearest(ray: Ray, obstacles: Obstacle[]): number | null {
  let min = FAR + 1;
  for (let i = 0; i < obstacles.length; i++) {
    const distance = slabDistance(ray, obstacles[i]!, FAR);
    if (distance !== null && distance < min) min = distance;
  }
  return min <= FAR ? min : null;
}
function sceneFor(obstacles: Obstacle[]) {
  const sharedGeo = new THREE.BoxGeometry(1, 1, 1);
  const sharedMaterial = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const meshes = obstacles.map(b => {
    const mesh = new THREE.Mesh(sharedGeo, sharedMaterial);
    mesh.position.set((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2);
    mesh.scale.set(b.maxX - b.minX, b.maxY - b.minY, b.maxZ - b.minZ);
    mesh.updateMatrixWorld(true);
    return mesh;
  });
  return { meshes, dispose: () => { sharedGeo.dispose(); sharedMaterial.dispose(); } };
}
function runCase(n: number) {
  const { obstacles, rays } = makeCase(n);
  const { meshes, dispose } = sceneFor(obstacles);
  const caster = new THREE.Raycaster();
  caster.near = 0;
  caster.far = FAR;
  const triangleNearest = (ray: Ray) => {
    caster.set(ray.origin, ray.direction);
    const hits = caster.intersectObjects(meshes, false);
    return hits.length ? hits[0]!.distance : null;
  };
  try {
    let hitCount = 0;
    let maxDistanceDisagreementMeters = 0;
    let disagreementCount = 0;
    // Verify parity on EVERY deterministic ray, not just aggregate hit counts.
    for (const ray of rays) {
      const a = analyticNearest(ray, obstacles);
      const b = triangleNearest(ray);
      if (a === null || b === null) {
        if (a !== b) disagreementCount++;
      } else {
        hitCount++;
        maxDistanceDisagreementMeters = Math.max(maxDistanceDisagreementMeters, Math.abs(a - b));
        if (Math.abs(a - b) > 0.002) disagreementCount++;
      }
    }
    if (disagreementCount) throw new Error(`Static AABB/triangle ray mismatch count=${disagreementCount}/${samples}; maxDistanceError=${maxDistanceDisagreementMeters}`);
    if (hitCount === 0) throw new Error('Degenerate fixture: no ray hit any obstacle');

    const triangleTimes: number[] = [], slabTimes: number[] = [];
    let nativeHits = 0, slabHits = 0;
    for (let r = 0; r < warmup + rounds; r++) {
      // Alternate order to reduce CPU turbo and cache bias.
      const native = () => {
        let hits = 0;
        const t0 = performance.now();
        for (const ray of rays) if (triangleNearest(ray) !== null) hits++;
        const ms = performance.now() - t0;
        if (r >= warmup) triangleTimes.push(ms);
        nativeHits = hits;
      };
      const analytic = () => {
        let hits = 0;
        const t0 = performance.now();
        for (const ray of rays) if (analyticNearest(ray, obstacles) !== null) hits++;
        const ms = performance.now() - t0;
        if (r >= warmup) slabTimes.push(ms);
        slabHits = hits;
      };
      if (r % 2 === 0) { native(); analytic(); } else { analytic(); native(); }
      if (nativeHits !== slabHits || nativeHits !== hitCount) throw new Error('Timed query parity failure');
    }
    const native = quantiles(triangleTimes), analytic = quantiles(slabTimes);
    return { obstacles: n, raysPerRound: samples, measuredRounds: rounds, warmupRounds: warmup,
      comparedHits: hitCount, totalParityMismatches: disagreementCount, maxDistanceDisagreementMeters,
      THREE_Raycaster_triangleQueries: native, analytic_AABB: analytic,
      nativeVsAnalyticMedianRatio: native.medianMs / Math.max(0.000001, analytic.medianMs),
      note: 'Analytic AABB and triangle raycasts have different workloads; their ratio is NOT a BVH or Rapier speedup.' };
  } finally {
    dispose();
  }
}
const report = {
  experiment: 'Static scene raycast/box baseline for BVH/Rapier feasibility',
  timestamp: new Date().toISOString(),
  environment: { node: process.version, v8: process.versions.v8, platform: platform(), architecture: arch(), cpuCount: cpus().length,
    ci: !!process.env.GITHUB_ACTIONS },
  settings: { quick, maxRayDistanceMeters: FAR, counts, raysPerRound: samples, warmupRounds: warmup, measuredRounds: rounds },
  results: counts.map(runCase),
  limitations: [
    'Axis-aligned static boxes only: no rotated buildings, actual terrain triangles or dynamic bodies.',
    'Three.js triangle raycasting and analytic slab queries are not identical general-purpose APIs.',
    'Headless CPU timings cannot validate realistic physics, animal IK or GPU frame performance.',
    'Future experiments must add the same fixtures to three-mesh-bvh 0.9.18 and Rapier 0.21.0 with pinned dependencies.',
  ],
};
const json = JSON.stringify(report, null, 2);
if (out) { mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, json + '\n'); }
console.log(json);
