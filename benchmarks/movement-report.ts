/**
 * Movement quality report over one simulated day at the 1x step (0.1 s), seeds given on the command line.
 * Usage: npm run movement -- [seeds...]
 * Measures what a viewer would notice, per ground species:
 *  - snaps: per-tick heading changes > 0.6 rad (an instant swivel in 0.1 s)
 *  - jolts: per-tick speed changes > 1.2 m/s (0 -> sprint in one frame, or a dead stop from a run)
 *  - steep: ticks spent moving up a grade steeper than 0.95 (~44 degrees)
 *  - wading: share of ticks a jackal spends in water deeper than 0.45 m
 *  - pinned: animals that wanted to move but covered < 0.5 m over 20 s
 *  - sideways: moves more than ~35 degrees off the body's facing (sliding)
 *  - overlap: chital standing within 0.5 m of another chital
 * and herd spread (mean distance of chital to their group centroid).
 */
import { SPECIES, Simulation } from '@untamed/ecology';

const seeds = process.argv.slice(2).map(Number).filter((n) => !Number.isNaN(n));
const TICKS = (24 * 3600) / 60 / 0.1; // one game day at 1x
const out: Record<string, number[]> = {};
const add = (k: string, v: number): void => void (out[k] ??= []).push(v);
for (const seed of seeds.length ? seeds : [1, 4, 9]) {
  const sim = new Simulation(seed);
  const snaps: number[] = SPECIES.map(() => 0);
  const jolts: number[] = SPECIES.map(() => 0);
  const steep: number[] = SPECIES.map(() => 0);
  const slide: number[] = SPECIES.map(() => 0);
  let overlapN = 0;
  let overlap = 0;
  const moveTicks: number[] = SPECIES.map(() => 0);
  let jackalTicks = 0;
  let jackalWet = 0;
  let pinned = 0;
  let spreadSum = 0;
  let spreadN = 0;
  const last = new Map<number, { h: number; s: number; x: number; z: number; wantT: number; ax: number; az: number }>();
  for (let t = 0; t < TICKS; t++) {
    sim.step(0.1);
    for (const a of sim.animals) {
      const sp = SPECIES[a.sp]!;
      if (sp.flies || a.controlled) continue;
      const p = last.get(a.id);
      const wants = ((a as { want?: number }).want ?? a.speed) > 0;
      if (p) {
        let dh = Math.abs(a.heading - p.h) % (Math.PI * 2);
        if (dh > Math.PI) dh = Math.PI * 2 - dh;
        if (dh > 0.6) snaps[a.sp]!++;
        if (Math.abs(a.speed - p.s) > 1.2) jolts[a.sp]!++;
        const d = Math.hypot(a.x - p.x, a.z - p.z);
        if (d > 0.01) {
          moveTicks[a.sp]!++;
          // moved more than ~35 degrees off the way the body faces (sliding sideways or backwards)
          const dirOff = Math.abs(Math.atan2(Math.sin(Math.atan2(a.x - p.x, a.z - p.z) - a.heading), Math.cos(Math.atan2(a.x - p.x, a.z - p.z) - a.heading)));
          if (dirOff > 0.6) slide[a.sp]!++;
          const grade = (sim.valley.heightFast(a.x, a.z) - sim.valley.heightFast(p.x, p.z)) / d;
          if (grade > 0.95) steep[a.sp]!++;
        }
        if (wants) {
          p.wantT += 0.1;
          if (p.wantT >= 20) {
            if (Math.hypot(a.x - p.ax, a.z - p.az) < 0.5) pinned++;
            p.wantT = 0;
            p.ax = a.x;
            p.az = a.z;
          }
        } else {
          p.wantT = 0;
          p.ax = a.x;
          p.az = a.z;
        }
        p.h = a.heading; p.s = a.speed; p.x = a.x; p.z = a.z;
      } else last.set(a.id, { h: a.heading, s: a.speed, x: a.x, z: a.z, wantT: 0, ax: a.x, az: a.z });
      if (sp.id === 'jackal') {
        jackalTicks++;
        if (sim.valley.waterDepth(a.x, a.z, sim.env.stage) > 0.45) jackalWet++;
      }
    }
    if (t % 50 === 0) {
      const deer = sim.animals.filter((a) => a.sp === 0 && a.alive);
      for (const a of deer) {
        overlapN++;
        if (deer.some((b) => b !== a && Math.hypot(a.x - b.x, a.z - b.z) < 0.5)) overlap++;
      }
    }
    if (t % 600 === 0) {
      const groups = new Map<number, { x: number; z: number; n: number; m: { x: number; z: number }[] }>();
      for (const a of sim.animals) {
        if (a.sp !== 0) continue;
        const g = groups.get(a.group) ?? { x: 0, z: 0, n: 0, m: [] };
        g.x += a.x; g.z += a.z; g.n++; g.m.push(a);
        groups.set(a.group, g);
      }
      for (const g of groups.values()) {
        if (g.n < 2) continue;
        const cx = g.x / g.n;
        const cz = g.z / g.n;
        for (const m of g.m) { spreadSum += Math.hypot(m.x - cx, m.z - cz); spreadN++; }
      }
    }
  }
  for (const i of [0, 1, 2, 3]) {
    const id = SPECIES[i]!.id;
    add(`${id} snaps per 1000 moving ticks`, (snaps[i]! / Math.max(1, moveTicks[i]!)) * 1000);
    add(`${id} jolts per 1000 moving ticks`, (jolts[i]! / Math.max(1, moveTicks[i]!)) * 1000);
    add(`${id} steep climbs per 1000 moving ticks`, (steep[i]! / Math.max(1, moveTicks[i]!)) * 1000);
    add(`${id} sideways/backward moves per 1000 moving ticks`, (slide[i]! / Math.max(1, moveTicks[i]!)) * 1000);
  }
  add('chital within 0.5 m of another chital %', (overlap / Math.max(1, overlapN)) * 100);
  add('jackal share of time in deep water %', (jackalWet / Math.max(1, jackalTicks)) * 100);
  add('pinned 20 s windows (all ground animals)', pinned);
  add('chital mean distance to herd centroid m', spreadSum / Math.max(1, spreadN));
  add('population at end', sim.animals.length);
}
for (const [k, v] of Object.entries(out)) console.log(`${k.padEnd(44)} ${v.map((x) => x.toFixed(2).padStart(8)).join('')}`);
