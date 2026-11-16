/**
 * Real-simulation population scaling (Mission 2). Usage:
 *   node --expose-gc --import tsx benchmarks/population-scaling.ts [--quick] [--out file.json] [--sizes 250,1000]
 *
 * For each population size it builds a deterministic stress fixture (benchmarks/fixtures/population.ts; supported
 * addAnimals API, NOT a sustainable ecosystem), then steps the unmodified Simulation at the game's four speeds with the
 * camera focus set as the game does. Plain passes (profiler off) give tick times; a separate profiled pass gives the
 * stage breakdown and spatial-query volume. Also measures heap, GC, birth/death churn and save/load.
 */
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import os from 'node:os';
import { PerformanceObserver } from 'node:perf_hooks';
import { PROFILE_STAGES, Simulation, StepProfiler } from '@untamed/ecology';
import { APRON, CHUNKS } from '@untamed/worlds';
import { checkFixture, stressFixture } from './fixtures/population';

const args = process.argv.slice(2);
const quick = args.includes('--quick');
const outArg = args.indexOf('--out');
const sizesArg = args.indexOf('--sizes');
const SIZES = sizesArg >= 0 ? args[sizesArg + 1]!.split(',').map(Number) : quick ? [0, 1000, 2500] : [0, 250, 1000, 2500, 5000, 10000];
const SPEEDS = [
  { speed: 1, dt: 0.1, ticksPerSec: 10 },
  { speed: 10, dt: 0.25, ticksPerSec: 40 },
  { speed: 100, dt: 1, ticksPerSec: 100 },
  { speed: 1000, dt: 2, ticksPerSec: 500 },
];
const ROUNDS = quick ? 2 : 3;
const WARMUP = 20;
const SEED = 3;
/** Game: simulation may use up to 9 ms per 60 Hz frame (Game.ts); "comfortable" = a quarter of one core. */
const GAME_CAP_MS_PER_S = 9 * 60;
const COMFORT_MS_PER_S = 250;

const gc = (globalThis as { gc?: () => void }).gc;
const heapMB = (): number => {
  gc?.();
  return process.memoryUsage().heapUsed / 1048576;
};
const pct = (v: number[], p: number): number => {
  const s = [...v].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))]!;
};
const r3 = (x: number): number => Math.round(x * 1000) / 1000;

let gcCount = 0;
let gcMs = 0;
new PerformanceObserver((list) => {
  for (const e of list.getEntries()) {
    gcCount++;
    gcMs += e.duration;
  }
}).observe({ entryTypes: ['gc'] });

const measuredTicks = (n: number, speed: number): number => {
  const base = n >= 5000 ? 80 : n >= 2500 ? 150 : 300;
  return Math.max(40, Math.round((quick ? base / 2 : base) * (speed === 1000 ? 0.7 : 1)));
};

const results: unknown[] = [];
for (const target of SIZES) {
  const h0 = heapMB();
  const tb = performance.now();
  const fixture = target === 0 ? new Simulation(SEED) : stressFixture(SEED, target);
  const buildMs = performance.now() - tb;
  checkFixture(fixture);
  const n0 = fixture.animals.length;
  const heapAfter = heapMB();
  // save / load
  const ts = performance.now();
  const snap = fixture.snapshot();
  const snapMs = performance.now() - ts;
  const tj = performance.now();
  const json = JSON.stringify(snap);
  const jsonMs = performance.now() - tj;
  const tl = performance.now();
  const reloaded = new Simulation(SEED, JSON.parse(json));
  const loadMs = performance.now() - tl;
  if (reloaded.stateHash() !== fixture.stateHash()) throw new Error('save/load mismatch');
  // Valley scatter/perch caches are generated lazily, the first time a bird looks for a perch in a chunk (5-7 ms per
  // chunk, 361 chunks). That one-time warm-up is independent of population and is measured separately here; each
  // measured world is pre-warmed so tick times show the population-dependent cost.
  const warm = (s: Simulation): number => {
    const t = performance.now();
    for (let cz = -APRON; cz < CHUNKS + APRON; cz++) for (let cx = -APRON; cx < CHUNKS + APRON; cx++) s.valley.perches(cx, cz);
    return performance.now() - t;
  };
  let warmMs = 0;
  const fresh = (): Simulation => {
    const s = new Simulation(SEED, structuredClone(snap));
    s.focus = { x: s.valley.size / 2, z: s.valley.size / 2 };
    warmMs = warm(s);
    return s;
  };
  const speeds: unknown[] = [];
  for (const sp of SPEEDS) {
    const ticks = measuredTicks(n0, sp.speed);
    const rounds: { median: number; p95: number; p99: number; max: number; gcCount: number; gcMs: number; births: number; deaths: number; endAlive: number; hash: number }[] = [];
    let allTicks: number[] = [];
    for (let r = 0; r < ROUNDS; r++) {
      const sim = fresh();
      for (let i = 0; i < WARMUP; i++) sim.step(sp.dt);
      const b0 = sim.births.reduce((s, x) => s + x, 0);
      const d0 = sim.deaths.flat().reduce((s, x) => s + x, 0);
      gc?.();
      const g0 = gcCount;
      const gm0 = gcMs;
      const t: number[] = [];
      for (let i = 0; i < ticks; i++) {
        const a = performance.now();
        sim.step(sp.dt);
        t.push(performance.now() - a);
      }
      await new Promise((res) => setImmediate(res)); // let GC observer entries arrive
      allTicks = allTicks.concat(t);
      rounds.push({
        median: r3(pct(t, 0.5)), p95: r3(pct(t, 0.95)), p99: r3(pct(t, 0.99)), max: r3(Math.max(...t)),
        gcCount: gcCount - g0, gcMs: r3(gcMs - gm0),
        births: sim.births.reduce((s, x) => s + x, 0) - b0, deaths: sim.deaths.flat().reduce((s, x) => s + x, 0) - d0,
        endAlive: sim.animals.length, hash: sim.stateHash(),
      });
    }
    // same seed, same engine: every round must end in the same state
    const deterministic = rounds.every((r) => r.hash === rounds[0]!.hash);
    // profiled pass (breakdown only; adds timing overhead)
    const ps = fresh();
    for (let i = 0; i < WARMUP; i++) ps.step(sp.dt);
    const prof = new StepProfiler();
    ps.profiler = prof;
    for (let i = 0; i < ticks; i++) ps.step(sp.dt);
    const ex = prof.exclusive();
    const perTick = Object.fromEntries(PROFILE_STAGES.map((s) => [s, r3(ex[s] / prof.ticks)]));
    const median = pct(allTicks, 0.5);
    const msPerRealSecond = median * sp.ticksPerSec;
    speeds.push({
      speed: sp.speed, dt: sp.dt, ticksPerRealSecond: sp.ticksPerSec, ticksMeasured: ticks, rounds: ROUNDS,
      tickMs: { median: r3(median), p95: r3(pct(allTicks, 0.95)), p99: r3(pct(allTicks, 0.99)), max: r3(Math.max(...allTicks)) },
      perAnimalUs: r3((median * 1000) / n0),
      msPerRealSecond: r3(msPerRealSecond), withinGameCap: msPerRealSecond <= GAME_CAP_MS_PER_S, comfortable: msPerRealSecond <= COMFORT_MS_PER_S,
      deterministic, rounds_: rounds,
      profiled: {
        tickMsMedian: r3(pct(prof.tickMs, 0.5)), stageMsPerTick: perTick,
        queriesPerTick: Math.round(prof.query.queries / prof.ticks), visitedPerTick: Math.round(prof.query.visited / prof.ticks),
        visitedPerQuery: r3(prof.query.visited / Math.max(1, prof.query.queries)),
        decidesPerTick: r3(prof.calls.decide / prof.ticks), birthsCalls: prof.calls.births, deathCalls: prof.calls.deaths,
      },
    });
    console.log(`n=${String(n0).padStart(5)} ${String(sp.speed).padStart(4)}x  median ${median.toFixed(2)} ms  p99 ${pct(allTicks, 0.99).toFixed(2)}  ${msPerRealSecond.toFixed(0)} ms/s  det=${deterministic}  top: ${Object.entries(perTick).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  }
  results.push({
    target, animals: n0, natural: target === 0, buildMs: r3(buildMs), scatterWarmMs: r3(warmMs), heapMB: { before: r3(h0), afterFixture: r3(heapAfter), perAnimalKB: r3(((heapAfter - h0) * 1024) / n0) },
    save: { snapshotMs: r3(snapMs), jsonMs: r3(jsonMs), bytes: json.length, bytesPerAnimal: Math.round(json.length / n0), loadMs: r3(loadMs) },
    speeds,
  });
}

let commit = 'unknown';
try { commit = execSync('git rev-parse HEAD').toString().trim(); } catch { /* not a checkout */ }
const env = {
  label: process.env.BENCH_LABEL ?? (process.env.GITHUB_ACTIONS ? 'github-actions' : 'container'),
  commit, node: process.version, v8: process.versions.v8, platform: `${os.platform()} ${os.release()} ${os.arch()}`,
  cpu: os.cpus()[0]?.model ?? 'unknown', logicalCpus: os.cpus().length, totalMemGB: r3(os.totalmem() / 1073741824),
  gcExposed: Boolean(gc), date: new Date().toISOString(), seed: SEED, quick,
};
const out = outArg >= 0 ? args[outArg + 1]! : `docs/evidence/tech-experiments/population-scaling-${env.label}.json`;
writeFileSync(out, JSON.stringify({ env, budget: { gameCapMsPerRealSecond: GAME_CAP_MS_PER_S, comfortableMsPerRealSecond: COMFORT_MS_PER_S }, results }, null, 1));
console.log('wrote', out);
