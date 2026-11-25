// Read-only: trace behaviour history of animals that stall in the boundary corridor.
import { Simulation, SPECIES } from '@untamed/ecology';
import { CORRIDOR } from '@untamed/worlds';
const seed = +(process.argv[2] ?? 1), days = +(process.argv[3] ?? 40), dt = 2, maxDump = +(process.argv[4] ?? 6);
const sim = new Simulation(seed) as any; sim.configureBoundary({ open: true });
console.log('open', sim.boundary?.open, 'CORRIDOR', CORRIDOR);
const hist = new Map<number, string[]>(); const still = new Map<number, number>(); const dumped = new Set<number>();
const last = new Map<number, string>();
const ticks = days * Math.round(86400 / 60 / dt);
for (let t = 0; t < ticks; t++) {
  sim.step(dt);
  for (const a of sim.animals) {
    if (!a.alive) continue;
    const key = `${a.beh}|${a.transit ?? 0}|${a.want > 0 ? 1 : 0}`;
    if (last.get(a.id) !== key) {
      last.set(a.id, key);
      const h = hist.get(a.id) ?? []; h.push(`t${t} beh=${a.beh} tr=${a.transit ?? 0} want=${a.want.toFixed(2)} spd=${a.speed.toFixed(2)} pos=(${a.x.toFixed(1)},${a.z.toFixed(1)}) tgt=(${a.tx.toFixed(1)},${a.tz.toFixed(1)}) timer=${a.timer.toFixed(2)} fear=${a.fear.toFixed(2)} kind=${a.exitKind}`);
      if (h.length > 12) h.shift(); hist.set(a.id, h);
    }
    if (a.transit) still.set(a.id, (still.get(a.id) ?? 0) + 1); else still.delete(a.id);
    if ((still.get(a.id) ?? 0) === 60 && !dumped.has(a.id) && dumped.size < maxDump) {
      dumped.add(a.id);
      console.log(`== stall id=${a.id} sp=${SPECIES[a.sp]!.id} at t${t} pos=(${a.x.toFixed(1)},${a.z.toFixed(1)}) tr=${a.transit} mother=${a.mother} age=${a.age.toFixed(1)} `); for (const l of hist.get(a.id)!) console.log('   ' + l);
    }
  }
}
console.log('stalled dumps', dumped.size);
