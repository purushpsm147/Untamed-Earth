/**
 * Same animal-state update as ../.. / benchmarks/population-scaling-baseline.ts,
 * with a third arm: bitECS 0.4.0 queried typed-array components.
 *
 * NO production ECS migration. All entities are synthetic and have identical
 * initial states. We verify exact per-entity state and query parity after each
 * full workload before reporting timings.
 */
import { createWorld, addEntity, addComponent, query } from 'bitecs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const QUICK = process.argv.includes('--quick');
const OUT = process.argv.find(a => a.startsWith('--out='))?.slice('--out='.length);
const COUNTS = QUICK ? [250, 1000, 5000] : [250, 1000, 5000, 10000, 25000];
const WARM = QUICK ? 16 : 40, MEASURE = QUICK ? 60 : 160;
const QX = 1024, QZ = 1024, R2 = 90000;
const rng = seed => {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
};
function makeRows(n) {
  const rnd = rng(0x150c17 + n);
  return Array.from({ length: n }, () => ({
    x: rnd() * 2048, z: rnd() * 2048, heading: rnd() * 2 * Math.PI,
    hunger: rnd(), thirst: rnd(), energy: rnd(), species: Math.floor(rnd() * 6),
  }));
}
function makeCols(rows) {
  const n = rows.length;
  const a = { x: new Float64Array(n), z: new Float64Array(n), heading: new Float64Array(n),
    hunger: new Float64Array(n), thirst: new Float64Array(n), energy: new Float64Array(n),
    species: new Uint8Array(n) };
  rows.forEach((r, i) => { for (const key of ['x', 'z', 'heading', 'hunger', 'thirst', 'energy', 'species']) a[key][i] = r[key]; });
  return a;
}
function makeBitEcs(rows) {
  const start = performance.now(), n = rows.length;
  const world = createWorld();
  // bitECS components are plain objects; storage is deliberately Float64/Uint8
  // to match the standalone SoA arm (not Float32 / silently reduced precision).
  const Pos = { x: new Float64Array(n + 8), z: new Float64Array(n + 8), heading: new Float64Array(n + 8) };
  const Needs = { hunger: new Float64Array(n + 8), thirst: new Float64Array(n + 8), energy: new Float64Array(n + 8) };
  const Species = { species: new Uint8Array(n + 8) };
  const eids = [];
  for (let i = 0; i < n; i++) {
    const id = addEntity(world), a = rows[i];
    if (id >= n + 8) throw Error(`Unexpected bitECS eid ${id} exceeds allocated component arrays`);
    addComponent(world, id, Pos);
    addComponent(world, id, Needs);
    addComponent(world, id, Species);
    Pos.x[id] = a.x; Pos.z[id] = a.z; Pos.heading[id] = a.heading;
    Needs.hunger[id] = a.hunger; Needs.thirst[id] = a.thirst; Needs.energy[id] = a.energy;
    Species.species[id] = a.species;
    eids.push(id);
  }
  const selected = query(world, [Pos, Needs, Species]);
  if (selected.length !== n) throw Error(`bitECS query expected ${n}, received ${selected.length}`);
  return { world, Pos, Needs, Species, eids, initMs: performance.now() - start };
}
function updateRow(rows) {
  let hits = 0;
  for (const a of rows) {
    a.x += Math.sin(a.heading) * 0.05;
    a.z += Math.cos(a.heading) * 0.05;
    a.heading += 0.0001;
    a.hunger = Math.min(1, a.hunger + 0.00001 * (1 + a.species % 3));
    a.thirst = Math.min(1, a.thirst + 0.000015);
    a.energy = Math.max(0, a.energy - 0.000012);
    const dx = a.x - QX, dz = a.z - QZ;
    if (a.species === 0 && dx * dx + dz * dz < R2) hits++;
  }
  return hits;
}
function updateCols(a) {
  let hits = 0;
  for (let i = 0; i < a.x.length; i++) {
    a.x[i] += Math.sin(a.heading[i]) * 0.05;
    a.z[i] += Math.cos(a.heading[i]) * 0.05;
    a.heading[i] += 0.0001;
    a.hunger[i] = Math.min(1, a.hunger[i] + 0.00001 * (1 + a.species[i] % 3));
    a.thirst[i] = Math.min(1, a.thirst[i] + 0.000015);
    a.energy[i] = Math.max(0, a.energy[i] - 0.000012);
    const dx = a.x[i] - QX, dz = a.z[i] - QZ;
    if (a.species[i] === 0 && dx * dx + dz * dz < R2) hits++;
  }
  return hits;
}
function updateEcs(w) {
  let hits = 0;
  const { Pos, Needs, Species, world } = w;
  for (const id of query(world, [Pos, Needs, Species])) {
    Pos.x[id] += Math.sin(Pos.heading[id]) * 0.05;
    Pos.z[id] += Math.cos(Pos.heading[id]) * 0.05;
    Pos.heading[id] += 0.0001;
    Needs.hunger[id] = Math.min(1, Needs.hunger[id] + 0.00001 * (1 + Species.species[id] % 3));
    Needs.thirst[id] = Math.min(1, Needs.thirst[id] + 0.000015);
    Needs.energy[id] = Math.max(0, Needs.energy[id] - 0.000012);
    const dx = Pos.x[id] - QX, dz = Pos.z[id] - QZ;
    if (Species.species[id] === 0 && dx * dx + dz * dz < R2) hits++;
  }
  return hits;
}
function verify(rows, cols, w) {
  const keys = ['x', 'z', 'heading', 'hunger', 'thirst', 'energy', 'species'];
  for (let i = 0; i < rows.length; i++) {
    const id = w.eids[i];
    for (const key of keys) {
      const ecs = key === 'species' ? w.Species[key][id]
        : ['x', 'z', 'heading'].includes(key) ? w.Pos[key][id] : w.Needs[key][id];
      if (!Object.is(rows[i][key], cols[key][i]) || !Object.is(rows[i][key], ecs)) {
        throw Error(`bitECS state parity failure i=${i}, eid=${id}, key=${key}: row=${rows[i][key]} SoA=${cols[key][i]} ECS=${ecs}`);
      }
    }
  }
}
function q(values) {
  const a = [...values].sort((x, y) => x - y);
  const p = v => a[Math.floor((a.length - 1) * v)];
  return { medianMs: p(0.5), meanMs: a.reduce((x, y) => x + y, 0) / a.length, p95Ms: p(0.95), p99Ms: p(0.99) };
}
function bench(n) {
  const initial = makeRows(n), rows = initial.map(x => ({ ...x })), cols = makeCols(initial), w = makeBitEcs(initial);
  const times = { rows: [], cols: [], ecs: [] };
  const steps = { rows: () => updateRow(rows), cols: () => updateCols(cols), ecs: () => updateEcs(w) };
  let verifiedQueries = true;
  for (let k = 0; k < WARM + MEASURE; k++) {
    const hits = [];
    for (const key of [[...Object.keys(steps)][k % 3], [...Object.keys(steps)][(k + 1) % 3], [...Object.keys(steps)][(k + 2) % 3]]) {
      const t0 = performance.now(), count = steps[key](), delta = performance.now() - t0;
      if (k >= WARM) times[key].push(delta);
      hits.push(count);
    }
    if (hits.some(x => x !== hits[0])) verifiedQueries = false;
  }
  if (!verifiedQueries) throw Error('Radius query parity mismatch');
  verify(rows, cols, w);
  const aos = q(times.rows), soa = q(times.cols), ecs = q(times.ecs);
  return { entities: n, warmups: WARM, measuredIterations: MEASURE, initBitEcsMs: w.initMs,
    queryAndBitExactStateParity: true, AoS: aos, pureTypedSoA: soa, bitECS_TypedArray: ecs,
    medianEcsOverPureSoA: ecs.medianMs / Math.max(0.000001, soa.medianMs),
    note: 'ECS includes query(world, components) each tick; pure SoA iterates a fixed dense range. This is synthetically simplified; neither represents real ecology.' };
}
const result = {
  experiment: 'bitECS 0.4.0 vs pure SoA and object arrays — synthetic workload only',
  timestamp: new Date().toISOString(),
  engine: { node: process.version, v8: process.versions.v8, ci: !!process.env.GITHUB_ACTIONS },
  options: { quick: QUICK, warmups: WARM, measured: MEASURE },
  cases: COUNTS.map(bench),
  caveats: [
    'Does not migrate ecology or test the native simulation with thousands of animals.',
    'Uses identical Float64 storage and bit-exact state parity; bitECS query overhead is measured.',
    'ECS population lifecycles, relations, serialization, a spatial hash, and CPU contention need separate validation.',
    'bitECS v0.4.0 is MPL-2.0: perform licensing review before integrating any code.',
    'Single GitHub Actions runner is not device-specific performance evidence. Repeat on target CPUs.',
  ],
};
const json = JSON.stringify(result, null, 2);
if (OUT) { mkdirSync(dirname(OUT), { recursive: true }); writeFileSync(OUT, json + '\n'); }
console.log(json);
