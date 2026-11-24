/**
 * Issue #31 read-only probe. Observes, never mutates. Runs against any build exporting Simulation/SPECIES/B/weanDays/maturityDays.
 *   node --import tsx issue31-probe.ts <seeds a-b> <days> <dt>
 * A: jackal encounters with chital within 25 m, by chital class (healthy adult / vulnerable) and jackal hunger.
 * B: dependent fawn rest synchrony with a resting mother (within 12 m), and latency.
 */
import { Simulation, SPECIES, B, weanDays, maturityDays } from '@untamed/ecology';
const [s0, s1] = process.argv[2]!.split('-').map(Number); const days = +process.argv[3]!; const dt = +process.argv[4]!;
const J = SPECIES.findIndex((s) => s.id === 'jackal'), CH = SPECIES.findIndex((s) => s.id === 'chital');
const NAMES = Object.fromEntries(Object.entries(B).map(([k, v]) => [v, k]));
const enc: Record<string, Record<string, number>> = {}; const add = (k: string, b: string) => { (enc[k] ??= {})[b] = (enc[k]![b] ?? 0) + 1; };
let approachN = 0, approachReact = 0;
let syncN = 0, syncRest = 0, momRestFar = 0, fawnRestMomActive = 0, fawnSamples = 0;
const lat: number[] = [], wake: number[] = []; const momRestStart = new Map<number, number>(), momWakeStart = new Map<number, number>();
const kills = { chitalYoung: 0, chitalAdult: 0, hare: 0 };
const ticksPerDay = Math.round(86400 / 60 / dt);
for (let seed = s0!; seed <= s1!; seed++) {
  const sim = new Simulation(seed);
  sim.events.on((e) => { if (e.type !== 'kill') return; const p = sim.byId.get(e.prey); if (e.sp === CH) { if (p && p.age < 0.45 * maturityDays(SPECIES[CH]!)) kills.chitalYoung++; else kills.chitalAdult++; } else if (e.sp === SPECIES.findIndex((s) => s.id === 'hare')) kills.hare++; });
  for (let t = 0; t < days * ticksPerDay; t++) {
    sim.step(dt);
    const tm = sim.tick;
    for (const a of sim.animals) {
      if (!a.alive || (a as { off?: boolean }).off) continue;
      if (a.sp === J && a.age >= maturityDays(SPECIES[J]!)) {
        let best = null as null | typeof a, bd = 25;
        for (const o of sim.animals) { if (!o.alive || o.sp !== CH || (o as { off?: boolean }).off) continue; const d = Math.hypot(o.x - a.x, o.z - a.z); if (d < bd) { bd = d; best = o; } }
        if (!best) continue;
        const adult = best.age >= 0.45 * maturityDays(SPECIES[CH]!) && best.health >= 0.45;
        const k = `${adult ? 'healthyAdult' : 'vulnerable'}|${a.hunger > 0.3 ? 'hungry' : 'sated'}`;
        add(k, NAMES[a.beh] ?? String(a.beh));
        // chital approaching (closing speed > 0.5 m/s): does the jackal orient toward it (|bearing - heading| < 45 deg)?
        const ux = (a.x - best.x) / bd, uz = (a.z - best.z) / bd;
        const close = best.speed * (Math.cos(best.heading) * ux + Math.sin(best.heading) * uz);
        if (adult && close > 0.5) {
          approachN++;
          const bearing = Math.atan2(best.z - a.z, best.x - a.x); let dh = Math.abs(bearing - a.heading) % (2 * Math.PI); if (dh > Math.PI) dh = 2 * Math.PI - dh;
          if (dh < Math.PI / 4) approachReact++;
        }
      }
      if (a.sp === CH && a.mother !== 0 && a.age < weanDays(SPECIES[CH]!)) {
        const m = sim.byId.get(a.mother); if (!m || !m.alive) continue;
        fawnSamples++;
        const d = Math.hypot(m.x - a.x, m.z - a.z);
        if (m.beh === B.Rest) {
          if (!momRestStart.has(m.id)) momRestStart.set(m.id, tm);
          momWakeStart.delete(m.id);
          if (d < 12 && a.beh !== B.Flee) { syncN++; if (a.beh === B.Rest) { syncRest++; const s = momRestStart.get(m.id)!; if (s >= 0) { lat.push((tm - s) * dt / 60 * 60); momRestStart.set(m.id, -1); } } }
          else momRestFar++;
        } else {
          if (momRestStart.has(m.id)) { momRestStart.delete(m.id); momWakeStart.set(m.id, tm); }
          if (a.beh === B.Rest) fawnRestMomActive++;
          else if (momWakeStart.has(m.id)) { wake.push((tm - momWakeStart.get(m.id)!) * dt); momWakeStart.delete(m.id); }
        }
      }
    }
  }
}
const q = (v: number[], p: number) => { const s = [...v].sort((x, y) => x - y); return s.length ? s[Math.floor(p * (s.length - 1))] : NaN; };
console.log(JSON.stringify({ seeds: `${s0}-${s1}`, days, dt,
  encounters: Object.fromEntries(Object.entries(enc).map(([k, v]) => { const n = Object.values(v).reduce((x, y) => x + y, 0); return [k, { n, beh: Object.fromEntries(Object.entries(v).sort((x, y) => y[1] - x[1]).map(([b, c]) => [b, +(c / n).toFixed(3)])) }]; })),
  approachingHealthyAdult: { samples: approachN, jackalFacingWithin45deg: +(approachReact / Math.max(1, approachN)).toFixed(3) },
  fawnSync: { fawnSamples, momRestingNear: syncN, fawnRestingWhenMomRestsNear: +(syncRest / Math.max(1, syncN)).toFixed(3), momRestingFar: momRestFar, fawnRestWhileMomActive: fawnRestMomActive,
    restLatencyS_median: q(lat, 0.5), restLatencyS_p90: q(lat, 0.9), episodes: lat.length, wakeLatencyS_median: q(wake, 0.5), wakeLatencyS_p90: q(wake, 0.9) },
  kills }, null, 1));
