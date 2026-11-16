/**
 * Real Untamed Earth terrain — native Three.js versus three-mesh-bvh.
 *
 * Reuses @untamed/worlds buildChunkMesh(), the SAME pure geometry function
 * used by the production TerrainView worker. No synthetic replacement terrain.
 * No WebGL context is constructed; this is a CPU first-hit raycast trial.
 *
 * Run at repository root after installing this subpackage:
 *   npm install --prefix experiments/spatial-bvh --no-audit --no-fund --package-lock=false
 *   npx tsx experiments/spatial-bvh/valley-bvh.mjs --quick
 *
 * VISIBLE LIMITS: This only accelerates existing TRIANGLE geometry. It does not
 * solve terrain steering, pathfinding, deer foot-grounding, vegetation instance
 * occlusion, or geometric correctness of terrain LOD.
 */
import * as THREE from 'three';
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';
import { Valley, CHUNK_SIZE, buildChunkMesh } from '@untamed/worlds';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const quick = process.argv.includes('--quick');
const output = process.argv.find(s => s.startsWith('--out='))?.slice('--out='.length);
const seed = 2;
const valley = new Valley(seed);
const RAYS = quick ? 84 : 240;
const WARMUPS = quick ? 3 : 8;
const ROUNDS = quick ? 12 : 36;
const RAY_FAR = 165;
const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
const nativeRaycast = THREE.Mesh.prototype.raycast;
const percentile = (values) => {
  const xs = [...values].sort((a, b) => a - b);
  const p = x => xs[Math.floor((xs.length - 1) * x)];
  return { medianMs: p(0.5), p95Ms: p(0.95), p99Ms: p(0.99),
    meanMs: xs.reduce((a, b) => a + b, 0) / xs.length, minMs: xs[0], maxMs: xs.at(-1) };
};
function rngFor(s) {
  let v = s >>> 0;
  return () => { v = (Math.imul(v, 1664525) + 1013904223) >>> 0; return v / 4294967296; };
}
const cases = [
  { name: 'actual-riverbank', x: valley.riverX(525), z: 525 },
  { name: 'actual-settlement', x: 1010, z: 440 },
  ...(!quick ? [{ name: 'actual-wetland', x: 700, z: 1190 }] : []),
];
function terrainMeshes(centerX, centerZ) {
  const cx = Math.floor(centerX / CHUNK_SIZE);
  const cz = Math.floor(centerZ / CHUNK_SIZE);
  const meshes = [], owned = [];
  let generatingMs = 0, cpuGeometryBytes = 0, triangles = 0;
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    // Approximate actual streaming LOD bands for close, medium, distant chunks.
    const distance = Math.hypot(dx * CHUNK_SIZE, dz * CHUNK_SIZE);
    const resolution = distance < 96 ? 48 : distance < 139 ? 24 : 12;
    const before = performance.now();
    const data = buildChunkMesh(valley, cx + dx, cz + dz, resolution);
    generatingMs += performance.now() - before;
    cpuGeometryBytes += data.positions.byteLength + data.indices.byteLength;
    triangles += data.indices.length / 3;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    geo.setIndex(new THREE.BufferAttribute(data.indices, 1));
    geo.computeBoundingSphere();
    if (!Number.isFinite(geo.boundingSphere.radius)) throw Error('NaN terrain bounding sphere');
    const mesh = new THREE.Mesh(geo, material);
    mesh.name = `actual-valley-chunk-${cx+dx}-${cz+dz}-res${resolution}`;
    mesh.updateMatrixWorld(true);
    owned.push(geo); meshes.push(mesh);
  }
  return { meshes, owned, chunks: meshes.length, generatingMs, cpuGeometryBytes, triangles };
}
function cameraRays(c, n) {
  const rand = rngFor(Math.round(c.x * 100) ^ Math.round(c.z * 100) ^ 150);
  const rays = [];
  for (let i = 0; i < n; i++) {
    const x = c.x + (rand() - 0.5) * 130;
    const z = c.z + (rand() - 0.5) * 130;
    // Ray targets are on the ACTUAL analytic terrain; the rendered mesh
    // differs slightly through triangle interpolation and distant LOD.
    const tx = c.x + (rand() - 0.5) * 110;
    const tz = c.z + (rand() - 0.5) * 110;
    const from = new THREE.Vector3(x, valley.height(x, z) + 3 + rand() * 12, z);
    const to = i % 4 === 0
      ? new THREE.Vector3(x, valley.height(x, z) - 5, z)
      : new THREE.Vector3(tx, valley.height(tx, tz) + (i % 2 ? 0.25 : 1.6), tz);
    const dir = to.clone().sub(from).normalize();
    rays.push({ origin: from, dir });
  }
  return rays;
}
function sceneNearest(raycaster, ray, meshes, impl) {
  for (const mesh of meshes) mesh.raycast = impl;
  raycaster.set(ray.origin, ray.dir);
  const hits = raycaster.intersectObjects(meshes, false);
  return hits.length ? hits[0].distance : null;
}
function oneCase(c) {
  const geoState = terrainMeshes(c.x, c.z);
  const { meshes, owned } = geoState;
  const caster = new THREE.Raycaster();
  caster.near = 0.01;
  caster.far = RAY_FAR;
  const rays = cameraRays(c, RAYS);
  let buildMs = 0, bvhBytes = 0, hitCount = 0, maxError = 0;
  try {
    const start = performance.now();
    for (const geo of owned) {
      geo.boundsTree = new MeshBVH(geo);
      bvhBytes += geo.boundsTree.getSize();
    }
    buildMs = performance.now() - start;
    // The BVH may reorder geometry indices, so both implementations are
    // compared on the SAME post-build indexed triangles.
    for (const ray of rays) {
      const a = sceneNearest(caster, ray, meshes, nativeRaycast);
      const b = sceneNearest(caster, ray, meshes, acceleratedRaycast);
      if ((a === null) !== (b === null)) throw Error(`Ray miss/hit disagreement in ${c.name}: ${a} vs ${b}`);
      if (a !== null && b !== null) {
        hitCount++;
        maxError = Math.max(maxError, Math.abs(a - b));
        if (Math.abs(a - b) > 0.0002) throw Error(`First-hit parity failed ${c.name}: native=${a} bvh=${b}`);
      }
    }
    if (hitCount < 10) throw Error(`Fixture insufficiently grounded, hits=${hitCount}`);
    const native = [], accelerated = [];
    for (let round = 0; round < WARMUPS + ROUNDS; round++) {
      const test = (fn, arr) => {
        for (const mesh of meshes) mesh.raycast = fn;
        let nHits = 0;
        const t0 = performance.now();
        for (const ray of rays) {
          caster.set(ray.origin, ray.dir);
          if (caster.intersectObjects(meshes, false).length > 0) nHits++;
        }
        const elapsed = performance.now() - t0;
        if (nHits !== hitCount) throw Error(`Query count mismatch: ${nHits} vs ${hitCount}`);
        if (round >= WARMUPS) arr.push(elapsed);
      };
      if (round % 2) { test(acceleratedRaycast, accelerated); test(nativeRaycast, native); }
      else { test(nativeRaycast, native); test(acceleratedRaycast, accelerated); }
    }
    const n = percentile(native), a = percentile(accelerated);
    return { caseName: c.name, seed, centerX: c.x, centerZ: c.z, chunks: geoState.chunks,
      totalTriangles: geoState.triangles, rayCount: RAYS, matchedHitCount: hitCount,
      maxFirstHitDisagreementMeters: maxError, terrainGenerationMs: geoState.generatingMs,
      bvhBuildMs: buildMs, rawIndexAndPositionBytes: geoState.cpuGeometryBytes, bvhTreeBytes: bvhBytes,
      nativeThreeRaycast: n, threeMeshBvhRaycast: a,
      medianSpeedupNativeOverBvh: n.medianMs / Math.max(a.medianMs, 0.000001),
      breakEvenBatchesIgnoringMemoryAndGC: buildMs / Math.max(0.000001, n.medianMs - a.medianMs),
    };
  } finally {
    for (const mesh of meshes) mesh.raycast = nativeRaycast;
    for (const geo of owned) {
      geo.boundsTree = null;
      geo.dispose();
    }
  }
}
try {
  const report = {
    experiment: 'REAL buildChunkMesh valley-chunk raycast comparison (not a rendered frame)',
    referenceSeed: seed,
    timestamp: new Date().toISOString(),
    environment: { node: process.version, v8: process.versions.v8, cpu: process.platform,
      githubActions: !!process.env.GITHUB_ACTIONS },
    versions: { three: '0.187.0', threeMeshBvh: '0.9.18' },
    measurement: { quick, rounds: ROUNDS, warmupRounds: WARMUPS, raysPerBatch: RAYS, maxRayDistanceMeters: RAY_FAR },
    cases: cases.map(oneCase),
    boundaries: [
      'Uses ACTUAL terrain worker geometry and deterministic seed 2; but runs in Node and never measures real GPU FPS.',
      'BVH is built on every terrain chunk as a new tree. A production streamed-terrain integration must measure LOD rebuild, disposal and memory over multiple camera paths.',
      'Only terrain triangles; instanced trees, rocks, landmark architecture, animated animals and water are excluded.',
      'This measures first hits from all-intersections THREE.Raycaster, not a specialized occlusion boolean fast-path.',
      'Building the BVH may reorder indices; comparisons explicitly use shared post-build geometry and 0.2 mm intersection tolerance.',
    ],
  };
  const json = JSON.stringify(report, null, 2);
  if (output) { mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, json + '\n'); }
  console.log(json);
} finally {
  material.dispose();
}
