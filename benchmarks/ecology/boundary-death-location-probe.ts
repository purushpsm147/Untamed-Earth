// @ts-nocheck -- targets the open-boundary build (feat/open-boundary ce83f68, PR #34); this branch lacks the boundary module.
// Read-only issue #29 transit-stall probe: run from a ce83f68 checkout: node --import tsx <file> <seed> <days>
import { Simulation, SPECIES } from '@untamed/ecology';
const seed = +process.argv[2]!, days = +process.argv[3]!;
const sim = new Simulation(seed) as Simulation & { configureBoundary(o: object): void; regional: { id: number }[] };
sim.configureBoundary({ open: true });
const J = SPECIES.findIndex((s) => s.id === 'jackal');
const tally: Record<string, number> = {};
sim.events.on((e) => {
  if (e.type !== 'death' || e.sp !== J) return;
  const a = sim.byId.get(e.id) as { off?: boolean; transit?: number; origin?: number; thirst: number; beh: number } | undefined;
  const inRegional = sim.regional.some((r) => r.id === e.id);
  const k = `${e.cause}|off=${!!a?.off}|inRegionalList=${inRegional}|transit=${a?.transit ?? 0}|origin=${a?.origin ?? 0}|inValley=${e.x >= 0 && e.z >= 0 && e.x <= 1440 && e.z <= 1440}`;
  tally[k] = (tally[k] ?? 0) + 1;
});
for (let t = 0; t < days * 720; t++) sim.step(2);
console.log(JSON.stringify({ seed, days, tally }, null, 1));
