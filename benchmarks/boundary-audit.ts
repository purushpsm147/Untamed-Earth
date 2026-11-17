/**
 * Runs the read-only valley boundary audit (issue #29, step 1).
 *   npx tsx benchmarks/boundary-audit.ts [seeds=10] [days=365] [dt=2] [firstSeed=1] > out.json
 * One JSON line per seed, then nothing else; aggregate with benchmarks/boundary-audit-summary.py.
 */
import { Simulation } from '@untamed/ecology';
import { BoundaryAudit } from './ecology/boundary-audit';

const [seeds = 10, days = 365, dt = 2, first = 1] = process.argv.slice(2).map(Number);
const ticks = Math.round((days * 24 * 3600) / 60 / dt);
for (let seed = first; seed < first + seeds; seed++) {
  const sim = new Simulation(seed);
  const audit = new BoundaryAudit(sim);
  const t0 = performance.now();
  for (let i = 0; i < ticks; i++) {
    sim.step(dt);
    audit.afterStep(dt);
  }
  audit.dispose();
  process.stdout.write(JSON.stringify({ seed, dt, ms: Math.round(performance.now() - t0), ...audit.summary() }) + '\n');
}
