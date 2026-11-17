/**
 * Geometry check for the regional jackal landscape (issue #29 revised design, docs/OPEN_BOUNDARY_DESIGN.md §3).
 *   npx tsx benchmarks/regional-geometry.ts [seeds=60]
 * For each seed: the in-valley territory centres the #28 rules create at world start, then random sequential packing
 * (the same "claim only at full spacing" rule) of regional centres in the ring outside the map. Reports how many
 * regional territories fit, split into straddling (exclusive disc overlaps the map) and fully external, for ring widths
 * and spacings under consideration. Deterministic (own LCG per seed); reads the simulation, never steps it.
 */
import { SPECIES_INDEX, SPECIES, Simulation } from '@untamed/ecology';
import { REGION_SIZE } from '@untamed/worlds';

const R = REGION_SIZE;
const seeds = Number(process.argv[2] ?? 60);
const lcg = (s: number): (() => number) => { let x = (s * 2654435761) >>> 0 || 1; return () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 2 ** 32); };
const edge = (x: number, z: number): number => { // signed distance to the map edge: + inside, - outside
  const dx = Math.max(-x, x - R, 0), dz = Math.max(-z, z - R, 0);
  return dx > 0 || dz > 0 ? -Math.hypot(dx, dz) : Math.min(x, z, R - x, R - z);
};
type Row = { ring: number; spacing: number; inside: number; straddle: number; external: number };
const rows: Row[] = [];
for (let seed = 1; seed <= seeds; seed++) {
  const sim = new Simulation(seed);
  const inner = [...sim.territories.values()].filter((t) => t.sp === SPECIES_INDEX.jackal).map((t) => [t.x, t.z] as [number, number]);
  for (const ring of [960, 1440]) {
    for (const spacing of [720, 960, 1200]) {
      const r = spacing / 2;
      const rnd = lcg(seed * 1000 + ring + spacing);
      const held: [number, number][] = [...inner];
      let straddle = 0, external = 0;
      for (let k = 0; k < 40000; k++) {
        const x = -ring + rnd() * (R + 2 * ring), z = -ring + rnd() * (R + 2 * ring);
        const c = edge(x, z);
        if (c >= 0 || c < -(ring - r)) continue; // outside the map, and its exclusive disc inside the landscape
        if (held.some(([hx, hz]) => Math.hypot(hx - x, hz - z) < spacing)) continue;
        held.push([x, z]);
        if (c > -r) straddle++; else external++;
      }
      rows.push({ ring, spacing, inside: inner.length, straddle, external });
    }
  }
}
const q = (v: number[]): string => { const s = [...v].sort((a, b) => a - b); return `${s[Math.floor(s.length * 0.5)]} [${s[Math.floor(s.length * 0.1)]}-${s[Math.floor(s.length * 0.9)]}]`; };
console.log(`in-valley territories at world start (#28 rules, spacing ${SPECIES[SPECIES_INDEX.jackal]!.territory!.spacing} m): median [10-90%] ${q(rows.filter((r) => r.ring === 960 && r.spacing === 960).map((r) => r.inside))}`);
for (const ring of [960, 1440]) for (const spacing of [720, 960, 1200]) {
  const rs = rows.filter((r) => r.ring === ring && r.spacing === spacing);
  console.log(`ring ${ring} m, spacing ${spacing} m: straddling ${q(rs.map((r) => r.straddle))}, fully external ${q(rs.map((r) => r.external))}, total regional ${q(rs.map((r) => r.straddle + r.external))}`);
}
