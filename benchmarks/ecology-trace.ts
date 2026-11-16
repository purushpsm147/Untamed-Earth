/**
 * Trace how animals of one species die of dehydration: records hourly-ish snapshots of every critically thirsty animal
 * (thirst >= 0.8) and prints the last 24 for each of the first N dehydration deaths.
 *   node --import tsx benchmarks/ecology-trace.ts <seed> <species> [maxDeaths=3] [--dt 2]
 * Read-only: it only subscribes to events and reads state.
 */
import { BEHAVIOR_NAMES, SPECIES_INDEX, Simulation, type SpeciesId } from '@untamed/ecology';

const [seedArg = '5', spArg = 'myna', maxArg = '3'] = process.argv.slice(2).filter((a, i, arr) => !a.startsWith('--') && !arr[i - 1]?.startsWith('--'));
const dtI = process.argv.indexOf('--dt');
const dt = dtI >= 0 ? Number(process.argv[dtI + 1]) : 2;
const spI = SPECIES_INDEX[spArg as SpeciesId];
if (spI === undefined) throw new Error(`unknown species ${spArg}`);
const maxDeaths = Number(maxArg);
const sim = new Simulation(Number(seedArg));
const hist = new Map<number, string[]>();
let shown = 0;
sim.events.on((e) => {
  if (e.type !== 'death' || e.cause !== 'dehydration' || e.sp !== spI || shown >= maxDeaths) return;
  shown++;
  console.log(`--- ${spArg} ${e.id} died day ${(sim.env.timeH / 24).toFixed(2)} at ${e.x.toFixed(0)},${e.z.toFixed(0)}`);
  console.log((hist.get(e.id) ?? []).slice(-24).join('\n'));
});
const ticksPerDay = Math.round((24 * 3600) / 60 / dt);
const every = Math.max(1, Math.round(ticksPerDay / 48)); // ~every 30 game minutes
for (let t = 0; t < 365 * ticksPerDay && shown < maxDeaths; t++) {
  sim.step(dt);
  if (t % every) continue;
  for (const a of sim.animals) {
    if (!a.alive || a.sp !== spI || a.thirst < 0.8) continue;
    const h = hist.get(a.id) ?? [];
    hist.set(a.id, h);
    const mem = Number.isNaN(a.waterX) ? '-' : `${a.waterX.toFixed(0)},${a.waterZ.toFixed(0)}`;
    h.push(`h${sim.env.hour.toFixed(1)} light ${sim.env.daylight().toFixed(2)} ${BEHAVIOR_NAMES[a.beh]} thirst ${a.thirst.toFixed(2)} health ${a.health.toFixed(2)} ` +
      `at ${a.x.toFixed(0)},${a.z.toFixed(0)} alt ${a.alt.toFixed(1)} target ${a.tx.toFixed(0)},${a.tz.toFixed(0)} (${Math.hypot(a.tx - a.x, a.tz - a.z).toFixed(0)} m, ` +
      `water ${sim.env.waterHere(a.tx, a.tz)}) memory ${mem} fear ${a.fear.toFixed(2)}`);
    if (h.length > 60) h.shift();
  }
}
