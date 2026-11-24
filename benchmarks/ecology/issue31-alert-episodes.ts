/**
 * Issue #31 investigation (read-only): jackal Alert episode lengths, hunger while alert, the watched animal's behaviour
 * and distance, and what ended each episode.  node --import tsx benchmarks/ecology/issue31-alert-episodes.ts <seed> <days> <dt>
 */
import { Simulation, SPECIES, B } from '@untamed/ecology';
const seed = +process.argv[2]!, days = +process.argv[3]!, dt = +process.argv[4]!;
const J = SPECIES.findIndex((s) => s.id === 'jackal');
// B.Alert exists only on builds with issue #31 (PR #35, 89d3a45); -1 elsewhere (no alert episodes are then recorded).
const ALERT = (B as Record<string, number>).Alert ?? -1;
const NAMES = Object.fromEntries(Object.entries(B).map(([k, v]) => [v, k]));
const sim = new Simulation(seed);
const start = new Map<number, number>(); const eps: number[] = []; const tgtBeh: Record<string, number> = {}; const dists: number[] = []; let hungryAlert = 0, alertTicks = 0, jackTicks = 0;
const ends: Record<string, number> = {};
const tpd = Math.round(86400 / 60 / dt);
for (let t = 0; t < days * tpd; t++) {
  sim.step(dt);
  for (const a of sim.animals) {
    if (!a.alive || a.sp !== J) continue; jackTicks++;
    if (a.beh === ALERT) {
      alertTicks++; if (a.hunger > 0.3) hungryAlert++;
      if (!start.has(a.id)) start.set(a.id, sim.tick);
      const o = sim.byId.get(a.targetId); if (o) { tgtBeh[NAMES[o.beh]!] = (tgtBeh[NAMES[o.beh]!] ?? 0) + 1; dists.push(Math.hypot(o.x - a.x, o.z - a.z)); }
    } else if (start.has(a.id)) { eps.push((sim.tick - start.get(a.id)!) * dt); start.delete(a.id); ends[NAMES[a.beh]!] = (ends[NAMES[a.beh]!] ?? 0) + 1; }
  }
}
const q = (v: number[], p: number) => { const s = [...v].sort((x, y) => x - y); return s.length ? +s[Math.floor(p * (s.length - 1))]!.toFixed(1) : NaN; };
console.log(JSON.stringify({ seed, days, dt, jackalAlertShare: +(alertTicks / jackTicks).toFixed(3), hungryShareOfAlert: +(hungryAlert / Math.max(1, alertTicks)).toFixed(3), episodes: eps.length, episodeS: { p50: q(eps, .5), p90: q(eps, .9), p99: q(eps, .99), max: q(eps, 1) }, gameMinPerRealS: 1, targetBeh: tgtBeh, targetDistM: { p10: q(dists, .1), p50: q(dists, .5), p90: q(dists, .9) }, endedBy: ends }));
