/**
 * Untamed Earth — isolated, dependency-free population-scaling baseline.
 *
 * Run: npm run bench:scale
 *      npm run bench:scale -- --quick --out=docs/evidence/tech-experiments/population-baseline-ci.json
 *
 * Two DIFFERENT measurements are deliberately kept separate:
 *   (A) REAL Simulation.step() on organically spawned animals;
 *   (B) SYNTHETIC data-layout microbenchmarks (AoS vs SoA) at larger N.
 * (B) is NOT a simulation of 25,000 living animals and must never be advertised as one.
 *
 * Pure headless benchmark: no DOM, Three.js, renderer, physics engine, or new dependency.
 */
import { Simulation } from '@untamed/ecology';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { cpus, totalmem, platform, arch } from 'node:os';

interface AnimalRow {
  x: number; z: number; heading: number;
  hunger: number; thirst: number; energy: number; species: number;
}
interface ColumnState {
  x: Float64Array; z: Float64Array; heading: Float64Array;
  hunger: Float64Array; thirst: Float64Array; energy: Float64Array;
  species: Uint8Array;
}
type Quantiles = { meanMs: number; medianMs: number; p95Ms: number; p99Ms: number; minMs: number; maxMs: number };
const quick = process.argv.includes('--quick');
const args = process.argv.slice(2);
const outputFile = args.find(x => x.startsWith('--out='))?.slice('--out='.length) ?? null;
const entityCounts = quick ? [250, 1000, 5000] : [250, 1000, 5000, 10000, 25000];
const warmups = quick ? 16 : 40;
const measured = quick ? 60 : 160;
const actualTicks = quick ? 220 : 900;

function stats(xs: number[]): Quantiles {
  if (xs.length === 0) throw new Error('No benchmark samples');
  const sorted = [...xs].sort((a, b) => a - b);
  const pct = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))]!;
  const sum = sorted.reduce((a, b) => a + b, 0);
  return { meanMs: sum / sorted.length, medianMs: pct(0.50), p95Ms: pct(0.95), p99Ms: pct(0.99), minMs: sorted[0]!, maxMs: sorted.at(-1)! };
}
function rngOf(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
function makeRows(n: number, seed: number): AnimalRow[] {
  const rnd = rngOf(seed);
  return Array.from({ length: n }, () => ({
    x: rnd() * 2048, z: rnd() * 2048, heading: rnd() * Math.PI * 2,
    hunger: rnd(), thirst: rnd(), energy: rnd(), species: Math.floor(rnd() * 6),
  }));
}
function makeCols(rows: AnimalRow[]): ColumnState {
  const n = rows.length;
  const out: ColumnState = {
    x: new Float64Array(n), z: new Float64Array(n), heading: new Float64Array(n),
    hunger: new Float64Array(n), thirst: new Float64Array(n), energy: new Float64Array(n),
    species: new Uint8Array(n),
  };
  for (let i = 0; i < n; i++) {
    const a = rows[i]!;
    out.x[i] = a.x; out.z[i] = a.z; out.heading[i] = a.heading;
    out.hunger[i] = a.hunger; out.thirst[i] = a.thirst; out.energy[i] = a.energy;
    out.species[i] = a.species;
  }
  return out;
}
const queryX = 1024, queryZ = 1024, radiusSq = 300 * 300;
// Identical update and query semantics for both data layouts. No methods, extra allocations,
// or query library is mixed into either arm. This is a microbenchmark of layout only.
function tickRows(rows: AnimalRow[]): number {
  let hits = 0;
  for (let i = 0; i < rows.length; i++) {
    const a = rows[i]!;
    a.x += Math.sin(a.heading) * 0.05;
    a.z += Math.cos(a.heading) * 0.05;
    a.heading += 0.0001;
    a.hunger = Math.min(1, a.hunger + 0.00001 * (1 + a.species % 3));
    a.thirst = Math.min(1, a.thirst + 0.000015);
    a.energy = Math.max(0, a.energy - 0.000012);
    const dx = a.x - queryX, dz = a.z - queryZ;
    if (a.species === 0 && dx * dx + dz * dz < radiusSq) hits++;
  }
  return hits;
}
function tickCols(a: ColumnState): number {
  let hits = 0;
  for (let i = 0; i < a.x.length; i++) {
    a.x[i] += Math.sin(a.heading[i]!) * 0.05;
    a.z[i] += Math.cos(a.heading[i]!) * 0.05;
    a.heading[i] += 0.0001;
    a.hunger[i] = Math.min(1, a.hunger[i]! + 0.00001 * (1 + a.species[i]! % 3));
    a.thirst[i] = Math.min(1, a.thirst[i]! + 0.000015);
    a.energy[i] = Math.max(0, a.energy[i]! - 0.000012);
    const dx = a.x[i]! - queryX, dz = a.z[i]! - queryZ;
    if (a.species[i] === 0 && dx * dx + dz * dz < radiusSq) hits++;
  }
  return hits;
}
function validate(rows: AnimalRow[], a: ColumnState): void {
  if (rows.length !== a.x.length) throw new Error('State length mismatch');
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    for (const key of ['x', 'z', 'heading', 'hunger', 'thirst', 'energy'] as const) {
      // Float64 values MUST match exactly with identical operation order.
      if (!Object.is(r[key], a[key][i])) throw new Error(`AoS/SoA parity mismatch n=${rows.length}, i=${i}, key=${key}: ${r[key]} != ${a[key][i]}`);
    }
    if (r.species !== a.species[i]) throw new Error('Species mismatch');
  }
}
function oneSynthetic(n: number) {
  const seed = 0x150c17 + n;
  const rows = makeRows(n, seed);
  const cols = makeCols(rows);
  // Alternate arm measurement order to reduce warm-cache / thermal bias.
  const rowTimes: number[] = [], colTimes: number[] = [];
  let equalHits = true;
  const total = warmups + measured;
  for (let k = 0; k < total; k++) {
    let rowHits = 0, colHits = 0;
    const row = () => { const start = performance.now(); rowHits = tickRows(rows); const ms = performance.now() - start; if (k >= warmups) rowTimes.push(ms); };
    const col = () => { const start = performance.now(); colHits = tickCols(cols); const ms = performance.now() - start; if (k >= warmups) colTimes.push(ms); };
    if (k % 2 === 0) { row(); col(); } else { col(); row(); }
    if (rowHits !== colHits) equalHits = false;
  }
  validate(rows, cols);
  if (!equalHits) throw new Error('Query parity mismatch');
  const r = stats(rowTimes), c = stats(colTimes);
  return { kind: 'SYNTHETIC data-layout microbenchmark, not full ecology', entities: n,
    warmupIterations: warmups, measuredIterations: measured, queryParity: equalHits, bitExactStateParity: true,
    AoS: r, SoAFloat64: c, medianSpeedupSoAOverAoS: r.medianMs / Math.max(0.000001, c.medianMs),
    warning: 'Movement+needs+linear-radius-query only, NO decision AI, ecology births, environment or spatial hash. Results are CPU / JIT dependent.' };
}
function actualSimulation(seed: number, dt: number) {
  const sim = new Simulation(seed);
  const initial = sim.animals.filter(a => a.alive).length;
  const times: number[] = [];
  const warm = quick ? 40 : 100;
  for (let i = 0; i < warm + actualTicks; i++) {
    const t = performance.now();
    sim.step(dt);
    const ms = performance.now() - t;
    if (i >= warm) times.push(ms);
  }
  const alive = sim.animals.filter(a => a.alive).length;
  return { kind: 'REAL authoritative Simulation.step()', seed, dtSeconds: dt, warmupTicks: warm, measuredTicks: actualTicks,
    initialAlive: initial, finalAlive: alive, totalEverCreated: sim.animals.length, stateHash: sim.stateHash(),
    ticks: stats(times), warning: 'Actual ecosystem at its natural population size: not a 5k or 25k population load test.' };
}

const report = {
  experiment: 'Untamed Earth population scaling baseline (no ECS dependency)',
  isolation: 'No production files altered by running benchmark; no renderer or Browser GPU',
  time: new Date().toISOString(),
  environment: { node: process.version, v8: process.versions.v8, os: platform(), architecture: arch(),
    cpusReported: cpus().length, totalMemoryBytes: totalmem(), runner: process.env.GITHUB_ACTIONS ? 'GitHub Actions' : 'local' },
  configuration: { quick, warmups, measured, actualTicks, counts: entityCounts },
  realEcology: [actualSimulation(1, 0.1), actualSimulation(3, 0.1), actualSimulation(1, 2)],
  syntheticDataLayout: entityCounts.map(oneSynthetic),
  restrictions: [
    'Median ratios are descriptive, not a claim of ECS speed or a benefit to actual ecology.',
    'Run on the same device, with repeated rounds, and inspect variance before any architectural choice.',
    'Any future bitECS or Miniplex adapter must pass the same state/query parity checks.',
    'JS engine math differences can cause cross-engine ecology hashes to diverge; not compared here.',
  ],
};
const json = JSON.stringify(report, null, 2);
if (outputFile) { mkdirSync(dirname(outputFile), { recursive: true }); writeFileSync(outputFile, json + '\n'); }
console.log(json);
