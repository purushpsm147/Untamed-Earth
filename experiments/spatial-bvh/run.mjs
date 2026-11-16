/**
 * Isolated Three.js vs three-mesh-bvh correctness and throughput experiment.
 * This runner is intentionally OUTSIDE npm workspaces; no production dependency.
 *
 * npm install --prefix experiments/spatial-bvh --no-audit --no-fund
 * npm run bench --prefix experiments/spatial-bvh -- --quick
 */
import * as THREE from 'three';
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const QUICK = process.argv.includes('--quick');
const OUTPUT = process.argv.find(x => x.startsWith('--out='))?.slice('--out='.length);
const OBSTACLES = QUICK ? [60, 240] : [60, 240, 900];
const RAYS = QUICK ? 160 : 360;
const WARMUP = QUICK ? 4 : 6, ROUNDS = QUICK ? 12 : 24;
const FAR = 90;

function makeRng(seed) {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
}
function summary(xs) {
  if (!xs.length) throw Error('No samples');
  const sorted = [...xs].sort((a, b) => a - b);
  const p = x => sorted[Math.floor((sorted.length - 1) * x)];
  return { meanMs: xs.reduce((a, b) => a + b, 0) / xs.length, medianMs: p(0.5), p95Ms: p(0.95), p99Ms: p(0.99),
    minMs: sorted[0], maxMs: sorted.at(-1) };
}
function makeCase(n) {
  const rnd = makeRng(150 + n);
  const boxes = [];
  for (let i = 0; i < n; i++) {
    const x = (rnd() - 0.5) * 130, z = (rnd() - 0.5) * 130;
    const w = 1 + rnd() * 4, d = 1 + rnd() * 4, h = 0.9 + rnd() * 6;
    boxes.push({ x, z, w, d, h });
  }
  const rays = [];
  for (let i = 0; i < RAYS; i++) {
    const az = rnd() * 2 * Math.PI, elev = (rnd() - 0.5) * 0.38;
    rays.push({
      origin: new THREE.Vector3((rnd() - 0.5) * 72, 1.7 + rnd() * 0.7, (rnd() - 0.5) * 72),
      direction: new THREE.Vector3(Math.sin(az), elev, Math.cos(az)).normalize(),
    });
  }
  return { boxes, rays };
}
/** Merge every box into ONE indexed mesh so BVH and native raycast operate on identical triangles. */
function buildJoinedGeometry(boxes) {
  const template = new THREE.BoxGeometry(1, 1, 1);
  const p = template.getAttribute('position'), idx = template.index;
  const points = new Float32Array(boxes.length * p.count * 3);
  const indices = new Uint32Array(boxes.length * idx.count);
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    const vertexOffset = i * p.count;
    for (let v = 0; v < p.count; v++) {
      const k = (vertexOffset + v) * 3;
      points[k] = b.x + p.getX(v) * b.w;
      points[k + 1] = b.h * 0.5 + p.getY(v) * b.h;
      points[k + 2] = b.z + p.getZ(v) * b.d;
    }
    for (let j = 0; j < idx.count; j++) indices[i * idx.count + j] = vertexOffset + idx.getX(j);
  }
  template.dispose();
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(points, 3));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  geo.computeBoundingSphere();
  return geo;
}
function run(n) {
  const { boxes, rays } = makeCase(n);
  const geo = buildJoinedGeometry(boxes);
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, material);
  const caster = new THREE.Raycaster();
  caster.near = 0; caster.far = FAR;
  const nativeRaycast = THREE.Mesh.prototype.raycast;
  const evaluate = (ray, fn) => {
    mesh.raycast = fn;
    caster.set(ray.origin, ray.direction);
    const hits = caster.intersectObject(mesh, false);
    return hits.length ? hits[0].distance : null;
  };
  try {
    const startBuild = performance.now();
    const heapBefore = process.memoryUsage().heapUsed;
    geo.boundsTree = new MeshBVH(geo);
    const bvhBuildMs = performance.now() - startBuild;
    const approxHeapDeltaBytes = process.memoryUsage().heapUsed - heapBefore;

    let agreements = 0, hits = 0, maxError = 0;
    for (const ray of rays) {
      const a = evaluate(ray, nativeRaycast);
      const b = evaluate(ray, acceleratedRaycast);
      if (a === null || b === null) {
        if (a !== b) throw Error(`Hit/miss parity failed for ${n} boxes: native=${a} bvh=${b}`);
      } else {
        hits++;
        maxError = Math.max(maxError, Math.abs(a - b));
        if (Math.abs(a - b) > 1e-5) throw Error(`First-hit distance mismatch for ${n} boxes: ${a} != ${b}`);
      }
      agreements++;
    }
    if (hits === 0) throw Error('All rays miss; invalid fixture');
    const na = [], bv = [];
    for (let i = 0; i < WARMUP + ROUNDS; i++) {
      const measure = (fn, dest) => {
        mesh.raycast = fn;
        const begin = performance.now();
        let count = 0;
        for (const ray of rays) {
          caster.set(ray.origin, ray.direction);
          if (caster.intersectObject(mesh, false).length) count++;
        }
        const elapsed = performance.now() - begin;
        if (count !== hits) throw Error(`Query count changed: expected ${hits}, got ${count}`);
        if (i >= WARMUP) dest.push(elapsed);
      };
      // Alternate order, avoiding a spurious "second runner wins" effect.
      if (i % 2 === 0) { measure(nativeRaycast, na); measure(acceleratedRaycast, bv); }
      else { measure(acceleratedRaycast, bv); measure(nativeRaycast, na); }
    }
    const native = summary(na), bvh = summary(bv);
    return { boxes: n, triangles: geo.index.count / 3, rayCount: rays.length,
      fullRayParityCount: agreements, hitCount: hits, maxFirstHitDisagreementMeters: maxError,
      buildMs: bvhBuildMs, approxHeapDeltaBytes,
      nativeThreeTriangles: native, threeMeshBvh: bvh,
      medianNativeOverBvh: native.medianMs / Math.max(0.000001, bvh.medianMs),
      warning: 'ONE shared indexed triangle mesh; no animation, update/refit, swept collision, or real valley mesh.' };
  } finally {
    geo.dispose();
    material.dispose();
  }
}
const report = {
  experiment: 'three-mesh-bvh @ 0.9.18 vs THREE.Mesh.raycast in isolated subpackage',
  timestamp: new Date().toISOString(),
  packageVersions: { three: '0.187.0', threeMeshBvh: '0.9.18' },
  environment: { node: process.version, v8: process.versions.v8,
    platform: process.platform, arch: process.arch, githubActions: !!process.env.GITHUB_ACTIONS },
  configuration: { quick: QUICK, rays: RAYS, rounds: ROUNDS, warmupRounds: WARMUP, farMeters: FAR },
  cases: OBSTACLES.map(run),
  interpretation: [
    'A relative raycast speedup on a synthetic triangle mesh does not prove better wildlife navigation or camera quality.',
    'Build time and memory/asset costs matter if meshes are streamed; benchmark incremental geometry updates before adoption.',
    'Check real-world terrain, rotated ruins and scene camera paths before any renderer modification.',
    'This branch does not modify Untamed Earth renderer, authoritative ecology, or the production dependency tree.',
  ],
};
const json = JSON.stringify(report, null, 2);
if (OUTPUT) { mkdirSync(dirname(OUTPUT), { recursive: true }); writeFileSync(OUTPUT, json + '\n'); }
console.log(json);
