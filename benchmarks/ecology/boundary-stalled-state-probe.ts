// @ts-nocheck -- targets the open-boundary build (feat/open-boundary ce83f68, PR #34); this branch lacks the boundary module.
// Read-only issue #29 transit-stall probe: run from a ce83f68 checkout: node --import tsx <file> <seed> <days>
import { Simulation, B, edgeSigned, insideRegion } from '@untamed/ecology';
const seed = +process.argv[2]!, days = +process.argv[3]!;
const sim = new Simulation(seed) as Simulation & { configureBoundary(o: object): void };
sim.configureBoundary({ open: true });
const NAMES = Object.fromEntries(Object.entries(B).map(([k, v]) => [v, k]));
const since = new Map<number, number>(); const h: Record<string, number> = {}; let ex: unknown = null;
for (let t = 0; t < days * 720; t++) {
  sim.step(2);
  for (const a0 of sim.animals) {
    const a = a0 as typeof a0 & { transit?: number };
    if (!a.alive || !a.transit) { since.delete(a.id); continue; }
    if (!since.has(a.id)) since.set(a.id, sim.tick);
    if ((sim.tick - since.get(a.id)!) * 2 < 3600) continue; // only animals in transit > 60 game hours
    const e = edgeSigned(a.x, a.z);
    const k = `transit=${a.transit} beh=${NAMES[a.beh]} edge=${e < -20 ? '<-20' : e < -10 ? '-20..-10' : e < 0 ? '-10..0' : '>=0'} targetInside=${insideRegion(a.tx, a.tz)} want=${a.want > 0 ? '>0' : '0'} speed=${a.speed > 0.05 ? 'moving' : 'still'} thirst=${a.thirst >= 0.99 ? 'max' : 'ok'}`;
    h[k] = (h[k] ?? 0) + 1;
    if (!ex && a.beh === B.Idle) ex = { id: a.id, sp: a.sp, x: +a.x.toFixed(1), z: +a.z.toFixed(1), tx: +a.tx.toFixed(1), tz: +a.tz.toFixed(1), edge: +e.toFixed(1), timer: a.timer, stuck: a.stuck, mode: a.mode, transit: a.transit, exitKind: (a as { exitKind?: string }).exitKind, health: a.health, hunger: a.hunger };
  }
}
console.log(JSON.stringify({ seed, days, stalledSamples: Object.entries(h).sort((x, y) => y[1] - x[1]).slice(0, 12), example: ex }, null, 1));
