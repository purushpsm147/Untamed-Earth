/**
 * Read-only transit gate probe (amendment 3b, ECO-05). Configuration D at one tick. Reports:
 * - every run of consecutive ticks an animal spends Idle while in transit (count, longest run in game s, context);
 * - every death of an animal in transit or in the edge strip, by cause;
 * - the conservation ledger: on-map + off-map = founders + initial regional + births − deaths − departures;
 * - the longest transit episode.
 *   node --import tsx benchmarks/ecology/transit-gates-probe.ts <seed> <days> <dt>
 */
import { B, SPECIES, Simulation } from '@untamed/ecology';
import { REGION_SIZE } from '@untamed/worlds';
const seed = +process.argv[2]!, days = +process.argv[3]!, dt = +process.argv[4]!;
const sim = new Simulation(seed) as any; sim.configureBoundary({ open: true });
const sum = (r: number[]): number => r.reduce((a, b) => a + b, 0);
const strip = (a: any) => a.x < 6 || a.z < 6 || a.x > REGION_SIZE - 6 || a.z > REGION_SIZE - 6;
const deaths: Record<string, number> = {};
const kill = sim.kill.bind(sim);
sim.kill = (a: any, cause: string, ...r: unknown[]) => { if (a.alive && (a.transit || strip(a))) { const k = `${SPECIES[a.sp]!.id}:${cause}:${a.transit ? 'transit' + a.transit : 'strip'}`; deaths[k] = (deaths[k] ?? 0) + 1; } return kill(a, cause, ...r); };
const idleRun = new Map<number, number>(); const runs: number[] = []; const ctx: Record<string, number> = {};
let idleTicks = 0, transitTicks = 0;
const since = new Map<number, number>(); let longest = 0;
const ticks = Math.round((days * 86400) / 60 / dt);
for (let t = 0; t < ticks; t++) {
  sim.step(dt);
  const seen = new Set<number>();
  for (const a of sim.animals) {
    if (!a.alive || a.off || !a.transit) { if (idleRun.has(a.id)) { runs.push(idleRun.get(a.id)!); idleRun.delete(a.id); } continue; }
    transitTicks++; seen.add(a.id); if (!since.has(a.id)) since.set(a.id, t);
    if (a.beh === B.Idle) {
      idleTicks++; idleRun.set(a.id, (idleRun.get(a.id) ?? 0) + 1);
      const k = `tr${a.transit}:${a.transit === 1 ? (strip(a) ? 'outsideWall' : 'insideWall') : 'out'}:want${a.want > 0 ? 1 : 0}`; ctx[k] = (ctx[k] ?? 0) + 1;
    } else if (idleRun.has(a.id)) { runs.push(idleRun.get(a.id)!); idleRun.delete(a.id); }
  }
  for (const [id, t0] of since) if (!seen.has(id)) { longest = Math.max(longest, t - t0); since.delete(id); }
}
for (const t0 of since.values()) longest = Math.max(longest, ticks - t0);
for (const r of idleRun.values()) runs.push(r);
const m = sim.migration;
const live = sim.animals.filter((a: any) => a.alive).length + sim.regional.filter((a: any) => a.alive).length;
const expected = sim.founders + sum(m.initialRegional) + sum(sim.births) + sum(m.offBirths) - sum(sim.deaths.map(sum)) - sum(m.offDeathsBackground) - sum(m.offDeathsAge) - sum(m.offDeathsPredation) - sum(m.departed);
runs.sort((x, y) => x - y);
console.log(JSON.stringify({ seed, days, dt, transitTicks, idleTicks, idleRuns: runs.length, idleRunMaxS: (runs.at(-1) ?? 0) * dt, idleRunP99S: (runs[Math.floor(runs.length * 0.99)] ?? 0) * dt, idleContext: ctx, longestTransitS: longest * dt, deathsInTransitOrStrip: deaths, ledger: { live, expected, ok: live === expected }, hash: sim.stateHash() }));
