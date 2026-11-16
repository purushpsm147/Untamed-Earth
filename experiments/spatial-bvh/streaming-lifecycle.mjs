/**
 * Untamed Earth — experimental streamed-terrain BVH lifecycle trial.
 *
 * Uses the SAME Valley/buildChunkMesh geometry and same LOD + hysteresis
 * formulas as TerrainView.ts, but a smaller explicit view distance and
 * synchronous fixture loading for repeatability. NOT the production worker
 * scheduler and NOT a browser/WebGL resource lifetime test.
 *
 * From repository root after installing experiments/spatial-bvh:
 * npx tsx experiments/spatial-bvh/streaming-lifecycle.mjs --quick
 */
import * as THREE from 'three';
import { MeshBVH, acceleratedRaycast, estimateMemoryInBytes } from 'three-mesh-bvh';
import { APRON, CHUNKS, CHUNK_SIZE, Valley, buildChunkMesh } from '@untamed/worlds';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const quick = process.argv.includes('--quick');
const output = process.argv.find(a => a.startsWith('--out='))?.slice('--out='.length);
const seed = 2;
const valley = new Valley(seed);
const viewDistance = quick ? 110 : 170;
const maxRayDistance = 185;
const raysPerStop = quick ? 12 : 32;
const rounds = quick ? 5 : 12;
const warmups = quick ? 2 : 4;
const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
const nativeRaycast = THREE.Mesh.prototype.raycast;
const chunkMap = new Map();
const metrics = {
  geometriesCreated: 0, geometriesDisposed: 0, treesCreated: 0, treesDisposed: 0,
  lodReplacements: 0, distanceUnloads: 0, terrainGenerationMs: 0, bvhBuildMs: 0,
  maxLiveMeshes: 0, peakBvhTreeBytes: 0, peakRawGeometryBytes: 0, maxLiveTriangles: 0,
  totalParityComparisons: 0, maxFirstHitErrorMeters: 0, parityFailures: 0,
  maxMeshCountAccountingError: 0, bvhConstructionTimesMs: [],
};
let liveTreeBytes = 0, liveRawBytes = 0, liveTriangles = 0;
function percentile(values) {
  if (!values.length) throw Error('Empty performance samples');
  const sorted = [...values].sort((a, b) => a - b);
  const p = t => sorted[Math.floor((sorted.length - 1) * t)];
  return { medianMs: p(0.5), p95Ms: p(0.95), p99Ms: p(0.99),
    meanMs: sorted.reduce((a, b) => a + b, 0) / sorted.length,
    maxMs: sorted.at(-1) };
}
function keyOf(cx, cz) { return `${cx}:${cz}`; }
function chunkDistance(camera, cx, cz) {
  // Exact axis-aligned chunk-rectangle distance used by production TerrainView.
  const dx = Math.max(cx * CHUNK_SIZE - camera.x, 0, camera.x - (cx + 1) * CHUNK_SIZE);
  const dz = Math.max(cz * CHUNK_SIZE - camera.z, 0, camera.z - (cz + 1) * CHUNK_SIZE);
  return Math.hypot(dx, dz);
}
function lodFor(d) { return d < 170 ? 48 : d < 380 ? 24 : d < 760 ? 12 : 6; }
function account() {
  const meshes = chunkMap.size;
  const surplus = metrics.geometriesCreated - metrics.geometriesDisposed - meshes;
  metrics.maxMeshCountAccountingError = Math.max(metrics.maxMeshCountAccountingError, Math.abs(surplus));
  if (surplus !== 0 || metrics.treesCreated - metrics.treesDisposed !== meshes) {
    throw Error(`Resource owner mismatch geometries=${metrics.geometriesCreated}-${metrics.geometriesDisposed}, BVHs=${metrics.treesCreated}-${metrics.treesDisposed}, live=${meshes}`);
  }
  let raw = 0, trees = 0, triangles = 0;
  for (const c of chunkMap.values()) {
    raw += c.rawBytes; trees += c.treeBytes; triangles += c.triangles;
  }
  if (raw !== liveRawBytes || trees !== liveTreeBytes || triangles !== liveTriangles) {
    throw Error(`Live-memory accounting mismatch raw=${liveRawBytes}/${raw} BVH=${liveTreeBytes}/${trees} tris=${liveTriangles}/${triangles}`);
  }
  metrics.maxLiveMeshes = Math.max(meshes, metrics.maxLiveMeshes);
  metrics.peakBvhTreeBytes = Math.max(metrics.peakBvhTreeBytes, liveTreeBytes);
  metrics.peakRawGeometryBytes = Math.max(metrics.peakRawGeometryBytes, liveRawBytes);
  metrics.maxLiveTriangles = Math.max(metrics.maxLiveTriangles, liveTriangles);
}
function release(key, why) {
  const c = chunkMap.get(key);
  if (!c) return;
  if (!c.geometry.boundsTree) throw Error(`Missing owned BVH on ${key}`);
  // Clear the attached tree BEFORE disposing the geometry. BufferGeometry.dispose()
  // only releases renderer-side buffers; it does not free a JS-owned BVH for us.
  c.geometry.boundsTree = null;
  c.geometry.dispose();
  metrics.geometriesDisposed++;
  metrics.treesDisposed++;
  liveTreeBytes -= c.treeBytes;
  liveRawBytes -= c.rawBytes;
  liveTriangles -= c.triangles;
  chunkMap.delete(key);
  if (why === 'distance') metrics.distanceUnloads++;
}
function loadChunk(cx, cz, res) {
  const key = keyOf(cx, cz);
  const existing = chunkMap.get(key);
  if (existing?.res === res) return;
  if (existing) {
    release(key, 'replacement');
    metrics.lodReplacements++;
  }
  const begin = performance.now();
  const data = buildChunkMesh(valley, cx, cz, res);
  metrics.terrainGenerationMs += performance.now() - begin;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
  geometry.computeBoundingSphere();
  if (!geometry.boundingSphere || !Number.isFinite(geometry.boundingSphere.radius)) {
    geometry.dispose(); throw Error(`Non-finite terrain bounding sphere at ${key}`);
  }
  const startBvh = performance.now();
  geometry.boundsTree = new MeshBVH(geometry);
  const ms = performance.now() - startBvh;
  metrics.bvhConstructionTimesMs.push(ms);
  metrics.bvhBuildMs += ms;
  const treeBytes = estimateMemoryInBytes(geometry.boundsTree);
  if (!Number.isFinite(treeBytes) || treeBytes < 0) throw Error('Invalid BVH bytes');
  const rawBytes = data.positions.byteLength + data.indices.byteLength + data.normals.byteLength + data.colors.byteLength;
  const triangles = data.indices.length / 3;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.updateMatrixWorld(true);
  chunkMap.set(key, { cx, cz, res, mesh, geometry, rawBytes, treeBytes, triangles });
  metrics.geometriesCreated++;
  metrics.treesCreated++;
  liveTreeBytes += treeBytes;
  liveRawBytes += rawBytes;
  liveTriangles += triangles;
}
function visitCamera(cam) {
  // Two synchronous passes: first fills missing chunks at LOD 6 (matching the
  // fast first-paint strategy), second applies the desired LOD. Work is NOT
  // throttled or executed in Web Workers as in production.
  for (let pass = 0; pass < 2; pass++) {
    for (let cz = -APRON; cz < CHUNKS + APRON; cz++) {
      for (let cx = -APRON; cx < CHUNKS + APRON; cx++) {
        const key = keyOf(cx, cz);
        const d = chunkDistance(cam, cx, cz);
        if (d > viewDistance + CHUNK_SIZE) {
          if (d > viewDistance + CHUNK_SIZE * 2.5) release(key, 'distance');
          continue;
        }
        const old = chunkMap.get(key);
        loadChunk(cx, cz, old ? lodFor(d) : 6);
      }
    }
    account();
  }
}
function raysFor(cam, count) {
  let state = (Math.round(cam.x * 10) * 1664525 + Math.round(cam.z * 10) + 150) >>> 0;
  const rand = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  const rays = [];
  for (let i = 0; i < count; i++) {
    const x = cam.x + (rand() - 0.5) * 160;
    const z = cam.z + (rand() - 0.5) * 160;
    const tx = cam.x + (rand() - 0.5) * 160;
    const tz = cam.z + (rand() - 0.5) * 160;
    const from = new THREE.Vector3(x, valley.height(x, z) + 8 + rand() * 9, z);
    const to = i % 3 === 0
      ? new THREE.Vector3(x, valley.height(x, z) - 4, z)
      : new THREE.Vector3(tx, valley.height(tx, tz) + (i % 2 === 0 ? -1.5 : 0.45), tz);
    rays.push({ origin: from, direction: to.sub(from).normalize() });
  }
  return rays;
}
function measureRaycasts(cam, step) {
  const active = [...chunkMap.values()].map(c => c.mesh);
  const rays = raysFor(cam, raysPerStop);
  const caster = new THREE.Raycaster();
  caster.near = 0.01;
  caster.far = maxRayDistance;
  const nearest = (ray, implementation) => {
    for (const m of active) m.raycast = implementation;
    caster.set(ray.origin, ray.direction);
    const result = caster.intersectObjects(active, false);
    return result.length ? result[0].distance : null;
  };
  let confirmedHits = 0;
  for (const ray of rays) {
    const normal = nearest(ray, nativeRaycast);
    const accelerated = nearest(ray, acceleratedRaycast);
    metrics.totalParityComparisons++;
    const mismatch = (normal === null) !== (accelerated === null)
      || (normal !== null && accelerated !== null && Math.abs(normal - accelerated) > 0.0002);
    if (mismatch) {
      metrics.parityFailures++;
      throw Error(`Step ${step} parity mismatch native=${normal} bvh=${accelerated}`);
    }
    if (normal !== null && accelerated !== null) {
      confirmedHits++;
      metrics.maxFirstHitErrorMeters = Math.max(metrics.maxFirstHitErrorMeters, Math.abs(normal - accelerated));
    }
  }
  if (!confirmedHits) throw Error(`No terrain ray hits at step ${step}`);
  const native = [], accelerated = [];
  for (let r = 0; r < warmups + rounds; r++) {
    const trial = (impl, samples) => {
      for (const mesh of active) mesh.raycast = impl;
      const t0 = performance.now();
      let hits = 0;
      for (const ray of rays) {
        caster.set(ray.origin, ray.direction);
        if (caster.intersectObjects(active, false).length) hits++;
      }
      const elapsed = performance.now() - t0;
      if (hits !== confirmedHits) throw Error(`Ray intersection count changed at step ${step}`);
      if (r >= warmups) samples.push(elapsed);
    };
    if (r % 2 === 0) { trial(nativeRaycast, native); trial(acceleratedRaycast, accelerated); }
    else { trial(acceleratedRaycast, accelerated); trial(nativeRaycast, native); }
  }
  for (const m of active) m.raycast = nativeRaycast;
  return { checkedRays: rays.length, confirmedHits,
    nativeThreeMs: percentile(native), bvhMs: percentile(accelerated),
    medianSpeedup: percentile(native).medianMs / Math.max(0.000001, percentile(accelerated).medianMs) };
}
const startZ = 525, startX = valley.riverX(startZ);
const waypoints = [
  [startX, startZ], [startX + 75, startZ + 40], [startX + 160, startZ + 95],
  [startX + 250, startZ + 150], [startX + 320, startZ + 180],
  [startX + 160, startZ + 95], [startX, startZ],
];
const route = quick ? [...waypoints, ...waypoints.slice(1)] : [...waypoints, ...waypoints.slice(1), ...waypoints.slice(1)];
const records = [];
try {
  for (let step = 0; step < route.length; step++) {
    const [x, z] = route[step];
    const cam = { x, z };
    const before = { creations: metrics.geometriesCreated, disposals: metrics.geometriesDisposed,
      buildMs: metrics.bvhBuildMs, generationMs: metrics.terrainGenerationMs };
    visitCamera(cam);
    const query = measureRaycasts(cam, step);
    account();
    records.push({ step, x, z,
      createdThisStep: metrics.geometriesCreated - before.creations,
      disposedThisStep: metrics.geometriesDisposed - before.disposals,
      bvhBuildMsThisStep: metrics.bvhBuildMs - before.buildMs,
      terrainGenerationMsThisStep: metrics.terrainGenerationMs - before.generationMs,
      liveChunks: chunkMap.size, liveBvhBytes: liveTreeBytes,
      liveRawGeometryBytes: liveRawBytes, liveTriangles,
      lodSignature: [...chunkMap.values()].map(c => `${c.cx}:${c.cz}:${c.res}`).sort().join('|'),
      ...query });
  }
} finally {
  for (const key of [...chunkMap.keys()]) release(key, 'final');
  account();
  material.dispose();
}
if (metrics.geometriesCreated !== metrics.geometriesDisposed || metrics.treesCreated !== metrics.treesDisposed) {
  throw Error('Final geometry/BVH allocation imbalance');
}
// Repeating an out-and-back circuit must converge to the same owned chunk set
// and BVH bytes, rather than just releasing accumulated allocations at teardown.
const repeatOffset = waypoints.length - 1;
const earlier = records[records.length - 1 - repeatOffset];
const latest = records.at(-1);
const repeatedCameraStateStable = !!earlier && !!latest
  && earlier.x === latest.x && earlier.z === latest.z
  && earlier.lodSignature === latest.lodSignature
  && earlier.liveBvhBytes === latest.liveBvhBytes
  && earlier.liveRawGeometryBytes === latest.liveRawGeometryBytes;
if (!repeatedCameraStateStable) {
  throw Error('Repeated camera traversal retained different chunk/LOD state or BVH bytes');
}
const oneBatchSavingsMs = records.reduce(
  (sum, row) => sum + row.nativeThreeMs.medianMs - row.bvhMs.medianMs, 0);
const batchesPerStopNeededToAmortizeBuild = oneBatchSavingsMs > 0
  ? metrics.bvhBuildMs / oneBatchSavingsMs : null;
const report = {
  experiment: 'Real valley chunk LOD rebuild/unload BVH feasibility — synchronous model of TerrainView lifecycle',
  timestamp: new Date().toISOString(), seed,
  environment: { node: process.version, v8: process.versions.v8, platform: process.platform,
    architecture: process.arch, githubActions: !!process.env.GITHUB_ACTIONS },
  versions: { three: '0.187.0', threeMeshBvh: '0.9.18' },
  settings: { quick, viewDistanceMeters: viewDistance, chunkSizeMeters: CHUNK_SIZE,
    sameLodThresholdsAsProduction: [170, 380, 760], unloadExtraMeters: CHUNK_SIZE * 2.5,
    routeStops: route.length, raysPerStop, warmups, measuredRounds: rounds },
  totals: { ...metrics, bvhBuildTimes: percentile(metrics.bvhConstructionTimesMs),
    finalLiveMeshes: chunkMap.size, finalLiveBvhBytes: liveTreeBytes, finalLiveRawBytes: liveRawBytes,
    repeatedCameraStateStable, oneEquivalentRayBatchPerStopSavedMs: oneBatchSavingsMs,
    batchesPerStopNeededToAmortizeBuild },
  steps: records,
  caveats: [
    'Uses authentic deterministic buildChunkMesh terrain, same LOD thresholds and distance hysteresis as TerrainView.',
    'Reduced fixed view distance, synchronous two-pass loading, no browser Worker scheduling, in-flight stale results or GPU buffers.',
    'Rebuild on LOD change; native and accelerated raycast use exact same post-build indexed geometry.',
    'Per-step ray workload measures camera-like static terrain queries, not full documentary camera or vegetation occlusion.',
    'Raw geometry bytes include positions/indices/normals/colors but do not include GPU copies, shaders or renderer state.',
    'A final zero owned-resource balance establishes benchmark bookkeeping only, not full browser leak freedom.',
    'Amortization compares BVH build cost with one post-warmup median ray batch saved per camera stop; excludes worker scheduling, GC, mesh generation and GPU costs.',
    'Repeated traversal at the same camera location must retain the same chunk/LOD signature and estimated memory.',
  ],
};
const json = JSON.stringify(report, null, 2);
if (output) { mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, json + '\n'); }
console.log(json);
