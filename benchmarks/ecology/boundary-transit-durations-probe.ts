// @ts-nocheck -- targets the open-boundary build (feat/open-boundary ce83f68, PR #34); this branch lacks the boundary module.
// Read-only issue #29 transit-stall probe: run from a ce83f68 checkout: node --import tsx <file> <seed> <days>
import { Simulation, SPECIES, B } from '@untamed/ecology';
// Read-only: time animals spend in transit, their behaviour and needs while in transit, and how transit ends.
const seed = +process.argv[2]!, days = +process.argv[3]!;
const sim = new Simulation(seed) as Simulation & { configureBoundary(o: object): void };
sim.configureBoundary({ open: true });
const NAMES = Object.fromEntries(Object.entries(B).map(([k, v]) => [v, k]));
const J = SPECIES.findIndex((s) => s.id === 'jackal'), H = SPECIES.findIndex((s) => s.id === 'hare');
const start = new Map<number, number>(); const dur: Record<string, number[]> = { jackal: [], hare: [] };
const beh: Record<string, Record<string, number>> = { jackal: {}, hare: {} }; const thirst: number[] = [];
let deathsInTransit = 0, deaths = 0; const endHow: Record<string, number> = {};
sim.events.on((e) => { if (e.type === 'death' && (e.sp === J || e.sp === H)) { deaths++; const a = sim.byId.get(e.id) as { transit?: number } | undefined; if (a?.transit) deathsInTransit++; } });
for (let t = 0; t < days * 720; t++) {
  sim.step(2);
  for (const a0 of sim.animals) {
    const a = a0 as typeof a0 & { transit?: number };
    if (a.sp !== J && a.sp !== H) continue;
    const k = a.sp === J ? 'jackal' : 'hare';
    if (a.alive && a.transit) {
      if (!start.has(a.id)) start.set(a.id, sim.tick);
      beh[k]![NAMES[a.beh]!] = (beh[k]![NAMES[a.beh]!] ?? 0) + 1;
      if (a.sp === J) thirst.push(a.thirst);
    } else if (start.has(a.id)) {
      dur[k]!.push((sim.tick - start.get(a.id)!) * 2); start.delete(a.id);
      endHow[`${k}:${a.alive ? 'ended' : 'died'}`] = (endHow[`${k}:${a.alive ? 'ended' : 'died'}`] ?? 0) + 1;
    }
  }
}
const q = (v: number[], p: number) => { const s = [...v].sort((x, y) => x - y); return s.length ? s[Math.floor(p * (s.length - 1))] : NaN; };
const open = [...start.values()].map((s) => (sim.tick - s) * 2);
console.log(JSON.stringify({ seed, days, transitSeconds: Object.fromEntries(Object.entries(dur).map(([k, v]) => [k, { n: v.length, p50: q(v, .5), p90: q(v, .9), p99: q(v, .99), max: q(v, 1) }])),
  stillInTransitAtEnd: { n: open.length, maxS: Math.max(0, ...open) }, behaviourWhileInTransit: beh, jackalThirstInTransit: { p50: q(thirst, .5), p90: q(thirst, .9) }, endHow, deaths, deathsInTransit }));
