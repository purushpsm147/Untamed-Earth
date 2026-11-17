/**
 * Open-boundary evaluation runner (issue #29). One JSON file per seed, resumable (existing files are skipped), so the
 * 60-seed configurations survive container restarts. Works on every configuration's code (A M2, B memory, C territories,
 * D open, E zero inflow, F no flee exit): features a build lacks are recorded as null.
 *   node --import tsx benchmarks/open-boundary-eval.ts --config D --seeds 1-60 --days 365 --dt 2 --outdir dir [--variant name]
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { SPECIES, Simulation, maturityDays } from '@untamed/ecology';
import { REGION_SIZE } from '@untamed/worlds';
import { EcoObserver } from './ecology/observer';
import { BoundaryAudit } from './ecology/boundary-audit';

const arg = (k: string, d: string): string => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1]! : d; };
const config = arg('config', 'X');
const [s0, s1] = arg('seeds', '1-3').split('-').map(Number);
const days = Number(arg('days', '365'));
const dt = Number(arg('dt', '2'));
const outdir = arg('outdir', 'ob-eval');
const variant = arg('variant', '');
mkdirSync(outdir, { recursive: true });
let commit = 'unknown';
try { commit = execSync('git rev-parse HEAD').toString().trim(); } catch { /* */ }
const R = REGION_SIZE;
const J = SPECIES.findIndex((s) => s.id === 'jackal');
type Terr = { sp: number; x: number; z: number; female: number; male: number };
type Sim = Simulation & { territories?: Map<number, Terr>; regional?: { sp: number; alive: boolean }[]; migration?: unknown; configureBoundary?: (o: Record<string, unknown>) => void; territoryStats?: unknown };
const ticksPerDay = Math.round((24 * 3600) / 60 / dt);
for (let seed = s0!; seed <= (s1 ?? s0!); seed++) {
  const file = `${outdir}/${config}-${seed}.json`;
  if (existsSync(file)) continue;
  const sim = new Simulation(seed) as Sim;
  if (variant && sim.configureBoundary) sim.configureBoundary(JSON.parse(variant));
  const obs = new EcoObserver(sim);
  const audit = new BoundaryAudit(sim);
  const t0 = performance.now();
  const daily: { pops: number[]; local: number[]; regional: number[] | null; terr: number[] | null; fullPairs: number | null }[] = [];
  for (let d = 0; d < days * ticksPerDay; d++) {
    sim.step(dt);
    obs.afterStep(dt);
    audit.afterStep(dt);
    if (d % ticksPerDay !== ticksPerDay - 1) continue;
    const pops = SPECIES.map((_, i) => sim.population(i));
    // resident lineage: founders and animals born in the valley to resident-lineage mothers (origin 0 / absent)
    const local = SPECIES.map(() => 0);
    for (const a of sim.animals) if (a.alive && !(a as { origin?: number }).origin) local[a.sp]!++;
    const regional = sim.regional ? SPECIES.map((_, i) => sim.regional!.filter((a) => a.alive && a.sp === i).length) : null;
    let terr: number[] | null = null;
    let fullPairs: number | null = null;
    if (sim.territories) {
      terr = [0, 0, 0]; // in-valley centre, straddling (disc overlaps the map), fully external
      fullPairs = 0;
      for (const t of sim.territories.values()) {
        if (t.sp !== J) continue;
        const r = ((SPECIES[J] as { territory?: { spacing: number } }).territory?.spacing ?? 960) / 2;
        const inside = t.x >= 0 && t.z >= 0 && t.x <= R && t.z <= R;
        const dOut = Math.hypot(Math.max(-t.x, t.x - R, 0), Math.max(-t.z, t.z - R, 0));
        terr[inside ? 0 : dOut < r ? 1 : 2]!++;
        if (inside && t.female && t.male) fullPairs++;
      }
    }
    daily.push({ pops, local, regional, terr, fullPairs });
  }
  obs.detach();
  audit.dispose();
  const end = SPECIES.map((_, i) => sim.population(i));
  writeFileSync(file, JSON.stringify({
    meta: { config, variant, seed, days, dt, commit, species: SPECIES.map((s) => s.id), wallS: +((performance.now() - t0) / 1000).toFixed(1), maturityDays: SPECIES.map((s) => maturityDays(s)) },
    endPops: end, extinct: SPECIES.filter((_, i) => end[i] === 0).map((s) => s.id), hash: sim.stateHash(),
    daily, summary: obs.summary(), boundary: audit.summary(), migration: sim.migration ?? null, territoryStats: sim.territoryStats ?? null,
  }));
  console.log(`${config} seed ${seed}: end ${end.join('/')} ${((performance.now() - t0) / 1000).toFixed(0)}s`);
}
