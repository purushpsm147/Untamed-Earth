// @ts-nocheck -- targets the open-boundary build (feat/open-boundary ce83f68, PR #34); this branch lacks the boundary module.
// Read-only issue #29 transit-stall probe: run from a ce83f68 checkout: node --import tsx <file> <seed> <days>
import { Simulation, SPECIES } from '@untamed/ecology';
const seed = +process.argv[2]!, days = +process.argv[3]!;
const sim = new Simulation(seed) as Simulation & { configureBoundary(o: object): void };
sim.configureBoundary({ open: true });
const J = SPECIES.findIndex((s) => s.id === 'jackal'), H = SPECIES.findIndex((s) => s.id === 'hare');
const acc = { jDays: 0, jTransit: 0, hDays: 0, hTransit: 0, hStall: 0, jStall: 0 }; const since = new Map<number, number>();
for (let d = 0; d < days; d++) {
  for (let t = 0; t < 720; t++) {
    sim.step(2);
    for (const id of [...since.keys()]) if (!sim.animals.some((a) => a.id === id)) since.delete(id); // probe fix 2026-11-25
    for (const a of sim.animals as (typeof sim.animals[0] & { transit?: number })[]) { if (a.alive && a.transit) { if (!since.has(a.id)) since.set(a.id, sim.tick); } else since.delete(a.id); }
  }
  for (const a of sim.animals as (typeof sim.animals[0] & { transit?: number })[]) {
    if (!a.alive) continue;
    const stalled = a.transit && (sim.tick - (since.get(a.id) ?? sim.tick)) * 2 > 600; // > 10 game hours in transit
    if (a.sp === J) { acc.jDays++; if (a.transit) acc.jTransit++; if (stalled) acc.jStall++; }
    if (a.sp === H) { acc.hDays++; if (a.transit) acc.hTransit++; if (stalled) acc.hStall++; }
  }
}
console.log(JSON.stringify({ seed, days, ...acc, hareShareInTransit: +(acc.hTransit / acc.hDays).toFixed(3), hareShareStalled10h: +(acc.hStall / acc.hDays).toFixed(3), jackalShareInTransit: +(acc.jTransit / acc.jDays).toFixed(3), jackalShareStalled10h: +(acc.jStall / acc.jDays).toFixed(3) }));
