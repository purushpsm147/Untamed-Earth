/**
 * Read-only transit bounds probe (amendment 3b). Per seed: completed transit episode durations (game hours), the longest,
 * animals in transit at the end, and deaths in the corridor/edge strip by cause. 1 s of simulation = 1 game minute.
 *   node --import tsx benchmarks/ecology/transit-bounds-probe.ts <seed> <days> [dt=2]
 */
import { Simulation, SPECIES } from '@untamed/ecology';
import { REGION_SIZE } from '@untamed/worlds';
const seed = +process.argv[2]!, days = +process.argv[3]!, dt = +(process.argv[4] ?? 2);
const sim = new Simulation(seed) as any; sim.configureBoundary({ open: true });
const kill = sim.kill.bind(sim); const deaths: Record<string, number> = {};
const out = (a: any) => a.x < 6 || a.z < 6 || a.x > REGION_SIZE - 6 || a.z > REGION_SIZE - 6;
sim.kill = (a: any, cause: string, ...r: unknown[]) => { if (a.transit || out(a)) { const k = `${SPECIES[a.sp]!.id}:${cause}`; deaths[k] = (deaths[k] ?? 0) + 1; } return kill(a, cause, ...r); };
const since = new Map<number, number>(); const eps: number[] = [];
const ticks = Math.round((days * 86400) / 60 / dt);
for (let t = 0; t < ticks; t++) {
  sim.step(dt);
  const hNow = (t * dt) / 60;
  const seen = new Set<number>();
  for (const a of sim.animals) {
    if (!a.alive || a.off || !a.transit) continue;
    seen.add(a.id); if (!since.has(a.id)) since.set(a.id, hNow);
  }
  for (const [id, h0] of since) if (!seen.has(id)) { eps.push(hNow - h0); since.delete(id); }
}
const hEnd = (ticks * dt) / 60; const open = [...since.values()].map((h0) => hEnd - h0);
eps.sort((x, y) => x - y); const q = (p: number) => eps.length ? eps[Math.min(eps.length - 1, Math.floor(p * eps.length))]!.toFixed(2) : '-';
console.log(JSON.stringify({ seed, days, dt, episodes: eps.length, p50h: q(0.5), p99h: q(0.99), maxH: Math.max(0, ...eps).toFixed(2), inTransitAtEnd: open.length, openMaxH: Math.max(0, ...open).toFixed(2), corridorDeaths: deaths, hash: sim.stateHash?.() }));
