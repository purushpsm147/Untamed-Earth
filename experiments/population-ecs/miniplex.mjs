/**
 * Miniplex 2.0 versus plain object-array update parity; synthetic ONLY.
 *
 * The components are regular JS objects in both arms; this is a comparison
 * of Miniplex world/query ownership overhead, not typed-array layout nor a
 * demonstration of real ecological AI or sustainable population sizes.
 *
 * Run: node experiments/population-ecs/miniplex.mjs --quick
 */
import { World } from 'miniplex';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const QUICK = process.argv.includes('--quick');
const OUT = process.argv.find(s => s.startsWith('--out='))?.slice('--out='.length);
const COUNTS = QUICK ? [250, 1000, 5000] : [250, 1000, 5000, 10000, 25000];
const WARM = QUICK ? 20 : 50, MEASURE = QUICK ? 100 : 180;
const QX = 1024, QZ = 1024, R2 = 90000;
function rngOf(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
function makeRows(n) {
  const rand = rngOf(0x150c17 + n);
  return Array.from({ length: n }, (_, id) => ({ id,
    x: rand() * 2048, z: rand() * 2048, heading: rand() * Math.PI * 2,
    hunger: rand(), thirst: rand(), energy: rand(), species: Math.floor(rand() * 6),
  }));
}
function step(entities) {
  let hits = 0;
  for (const a of entities) {
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
function quantiles(samples) {
  const xs = [...samples].sort((a, b) => a - b);
  const q = f => xs[Math.floor((xs.length - 1) * f)];
  return { meanMs: samples.reduce((a, b) => a + b, 0) / samples.length,
    medianMs: q(0.5), p95Ms: q(0.95), p99Ms: q(0.99), minMs: xs[0], maxMs: xs.at(-1) };
}
function assertStateParity(rows, miniplexRows) {
  if (rows.length !== miniplexRows.length) throw Error(`Entity count mismatch ${rows.length} !== ${miniplexRows.length}`);
  const byId = new Map(miniplexRows.map(a => [a.id, a]));
  if (byId.size !== rows.length) throw Error('Duplicate IDs in Miniplex query');
  const fields = ['x','z','heading','hunger','thirst','energy','species'];
  for (const a of rows) {
    const b = byId.get(a.id);
    if (!b) throw Error(`Missing entity id=${a.id}`);
    for (const field of fields) {
      if (!Object.is(a[field], b[field])) throw Error(`State mismatch id=${a.id}, field=${field}: AoS ${a[field]} Miniplex ${b[field]}`);
    }
  }
}
/** Ensures the query updates after removals/reinsertions, preserving independent identities. */
function validateChurn(base) {
  const world = new World();
  const selected = world.with('id','x','z','heading','hunger','thirst','energy','species');
  const entries = base.slice(0, Math.min(200, base.length)).map(a => ({ ...a }));
  for (const a of entries) world.add(a);
  if (selected.entities.length !== entries.length) throw Error('Miniplex initial query count mismatch');
  const replaced = entries.filter((_, i) => i % 10 === 0);
  for (const a of replaced) world.remove(a);
  const expected = entries.filter((_, i) => i % 10 !== 0);
  const added = replaced.map((a, i) => ({ ...a, id: entries.length + i }));
  for (const a of added) world.add(a);
  expected.push(...added);
  assertStateParity(expected, selected.entities);
  const ids = new Set(selected.entities.map(x => x.id));
  if (ids.size !== entries.length) throw Error('Duplicate entity created during churn');
  return { initial: entries.length, removed: replaced.length, inserted: added.length,
    queryAfterChurn: selected.entities.length, uniqueIds: ids.size, parity: true };
}
function benchmark(n) {
  const source = makeRows(n);
  const rows = source.map(a => ({...a}));
  const start = performance.now();
  const world = new World();
  const query = world.with('id','x','z','heading','hunger','thirst','energy','species');
  for (const a of source) world.add({ ...a });
  const initMs = performance.now() - start;
  if (query.entities.length !== n) throw Error(`Miniplex world/query count is ${query.entities.length}, expected ${n}`);
  const rowTimes = [], miniplexTimes = [];
  for (let i = 0; i < WARM + MEASURE; i++) {
    let hitsAoS = 0, hitsECS = 0;
    const runRow = () => {
      const t0 = performance.now();
      hitsAoS = step(rows);
      const elapsed = performance.now() - t0;
      if (i >= WARM) rowTimes.push(elapsed);
    };
    const runMini = () => {
      const t0 = performance.now();
      // Live cached query; no filtering of all world entities each tick.
      hitsECS = step(query.entities);
      const elapsed = performance.now() - t0;
      if (i >= WARM) miniplexTimes.push(elapsed);
    };
    if (i % 2) { runMini(); runRow(); } else { runRow(); runMini(); }
    if (hitsAoS !== hitsECS) throw Error(`Radius-query mismatch at iteration ${i}`);
    if ((i + 1) % 25 === 0) assertStateParity(rows, query.entities);
  }
  assertStateParity(rows, query.entities);
  const a = quantiles(rowTimes), m = quantiles(miniplexTimes);
  return { syntheticEntities: n, initializationMs: initMs,
    bitExactStateParity: true, equalRadiusQueryHits: true, warmupPasses: WARM, measuredPasses: MEASURE,
    plainObjects: a, miniplexCachedQuery: m,
    medianMiniplexOverObjects: m.medianMs / Math.max(a.medianMs, 0.000001),
    churnValidation: validateChurn(source),
  };
}
const report = {
  experiment: 'Miniplex 2.0.0 cached query against plain JS object array — data parity microbenchmark',
  timestamp: new Date().toISOString(),
  environment: { node: process.version, v8: process.versions.v8, ci: !!process.env.GITHUB_ACTIONS },
  configuration: { quick: QUICK, warmups: WARM, measurements: MEASURE },
  results: COUNTS.map(benchmark),
  caveats: [
    'SYNTHETIC fixed arrays and cached query; NOT the real Simulation.step() or a realistic long-term population test.',
    'Same JS object layout on both sides: measures query/world lifecycle cost, NOT ECS vs SoA.',
    'Cannot directly compare this run to bitECS ratios from a different CI run or CPU.',
    'Churn parity is tested independently; iteration time excludes add/remove operations and serialization.',
    'No change to authoritative ecology, existing observe contracts or game dependencies.',
  ],
};
const json = JSON.stringify(report, null, 2);
if (OUT) { mkdirSync(dirname(OUT), { recursive: true }); writeFileSync(OUT, json + '\n'); }
console.log(json);
