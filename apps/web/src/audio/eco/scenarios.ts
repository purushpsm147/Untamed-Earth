/**
 * Listening scenarios for human review. Headless and deterministic: same build -> same world, same listener.
 *
 * Every scenario starts from a fresh world (fixed seed, tick 0) advanced by the ordinary simulation in fixed 1 s
 * steps to a fixed time of day. Nothing about animals, weather or environment is written. Only the LISTENER is
 * placed, from what the world contains at that moment (the documentary rule: the camera moves, the animals do not).
 * After that the simulation runs untouched at the scenario's rate.
 *
 * 'event-scan' scenarios look ahead on a CLONE restored from a snapshot to find where a real alarm or kill will
 * happen, place the listener near it, then run the original world from the same snapshot: the event is the
 * simulation's own and happens identically (same engine). No event is injected.
 */
import { SPECIES_INDEX, Simulation, onAudioEvents, type EcoAudioEvent, type SimSnapshot } from '@untamed/ecology';
import type { ListenerPose } from './acoustics';

export type Placement = 'river' | 'herd' | 'birds' | 'wetland' | 'event-scan' | 'forest';

export interface AudioScenario {
  readonly id: string;
  readonly title: string;
  readonly seed: number;
  /** Game hour to advance to (from 07:00 on day 0; values below 7 mean the next morning). */
  readonly hour: number;
  /** Optional: keep advancing (1 s steps, up to 3 game days) until the weather is one of these. */
  readonly weather?: readonly ('rain' | 'storm')[];
  readonly placement: Placement;
  /** Recording length, real seconds; simulation rate (1 = real time, 1 game minute per real second). */
  readonly seconds: number;
  readonly simRate: number;
  readonly listenFor: readonly string[];
}

export const AUDIO_SCENARIOS: readonly AudioScenario[] = [
  {
    id: 'dawn-riverbank', title: 'Dawn on the riverbank', seed: 2, hour: 6.1, placement: 'river', seconds: 45, simRate: 1,
    listenFor: ['River to one side, steady but not looped; level rises/falls with listener distance', 'Dawn: birds start calling only where real crows/mynas are near; crickets fading', 'Gaps of near-silence between calls (lulls)'],
  },
  {
    id: 'day-meadow-herd', title: 'Midday with the chital herd', seed: 2, hour: 13, placement: 'herd', seconds: 45, simRate: 1,
    listenFor: ['Footfalls only when deer actually walk; none from standing/grazing deer', 'Grass/leaf rustle following wind gusts', 'Hot-season cicada bed only if forest and temperature support it'],
  },
  {
    id: 'dusk-roost', title: 'Dusk at a bird roost', seed: 2, hour: 18.3, placement: 'birds', seconds: 45, simRate: 1,
    listenFor: ['Crow/myna roost chorus rising at twilight, from where the roosting birds are', 'Crickets entering as light fades', 'First jackal choruses (if a jackal group is awake within range)'],
  },
  {
    id: 'night-wetland', title: 'Night by the wetland', seed: 2, hour: 22, placement: 'wetland', seconds: 45, simRate: 1,
    listenFor: ['Cricket chorus with temperature-dependent chirp rate, not one tone', 'Frogs only in Monsoon/Post-monsoon', 'Distant jackal group chorus with joiners, direction stable'],
  },
  {
    id: 'predator-alarm', title: 'A real predator encounter', seed: 2, hour: 17, placement: 'event-scan', seconds: 60, simRate: 1,
    listenFor: ['Alarm calls only at the cue-sheet times (each is a real simulation event)', 'Caller direction matches the cue azimuth (+ = right)', 'Fleeing animals: running footfalls after the alarm; hare alarms silent'],
  },
  {
    id: 'rain-forest-edge', title: 'Rain at the forest edge', seed: 2, hour: 9, weather: ['rain', 'storm'], placement: 'forest', seconds: 45, simRate: 1,
    listenFor: ['Rain bed plus lower canopy patter under trees', 'Birds quieter in heavy rain', 'Thunder only if the simulated weather is a storm'],
  },
];

export interface PreparedScenario {
  readonly sim: Simulation;
  readonly listener: ListenerPose;
  readonly snapshot: SimSnapshot;
  readonly conditions: { tick: number; timeH: number; hour: number; weather: string; season: number; temperatureC: number };
  /** For event-scan: the events the look-ahead saw within range (time from start, kind, species, distance). */
  readonly expected: { t: number; kind: string; species: string; d: number }[];
  readonly note: string;
}

function advanceTo(sim: Simulation, sc: AudioScenario): void {
  const day0 = Math.floor(sim.env.timeH / 24) * 24;
  const target = day0 + (sc.hour < 7 ? 24 + sc.hour : sc.hour);
  while (sim.env.timeH < target - 1e-9) sim.step(1);
  if (sc.weather) {
    const limit = sim.env.timeH + 72;
    while (!sc.weather.includes(sim.env.weather as 'rain' | 'storm') && sim.env.timeH < limit) sim.step(1);
  }
}

function groundPose(sim: Simulation, x: number, z: number, yaw: number): ListenerPose {
  return { x, z, y: sim.valley.heightFast(x, z) + 1.7, yaw };
}

/**
 * Yaw that puts (tx, tz) at `azimuthRad` (+ = listener's right, acoustics.azimuth) of a listener at (x, z).
 * Turning the listener by +a (toward +x from +z) moves a target that was ahead to azimuth +a.
 */
export function yawToward(x: number, z: number, tx: number, tz: number, azimuthRad = 0): number {
  return Math.atan2(tx - x, tz - z) + azimuthRad;
}

/** A dry standing spot `dist` metres from (tx, tz), trying directions in a fixed order. */
function standNear(sim: Simulation, tx: number, tz: number, dist: number): { x: number; z: number } {
  for (let k = 0; k < 16; k++) {
    const a = (k * Math.PI * 2) / 16 + 0.4;
    const x = tx + Math.sin(a) * dist;
    const z = tz + Math.cos(a) * dist;
    if (sim.valley.inBounds(x, z, 30) && sim.valley.waterDepth(x, z, sim.env.stage) < 0) return { x, z };
  }
  return { x: tx, z: tz };
}

function centroid(sim: Simulation, filter: (sp: number, beh: number) => boolean): { x: number; z: number; n: number } | null {
  // densest 120 m neighbourhood of matching animals (deterministic: animals in array order)
  let best: { x: number; z: number; n: number } | null = null;
  const pts = sim.animals.filter((a) => a.alive && filter(a.sp, a.beh));
  for (const p of pts) {
    let n = 0, sx = 0, sz = 0;
    for (const q of pts) if ((q.x - p.x) ** 2 + (q.z - p.z) ** 2 < 120 * 120) ((n += 1), (sx += q.x), (sz += q.z));
    if (!best || n > best.n) best = { x: sx / n, z: sz / n, n };
  }
  return best;
}

export function prepareScenario(sc: AudioScenario): PreparedScenario {
  const sim = new Simulation(sc.seed);
  advanceTo(sim, sc);
  const v = sim.valley;
  let listener: ListenerPose;
  let note = '';
  const expected: PreparedScenario['expected'] = [];
  let snapshot = sim.snapshot();
  switch (sc.placement) {
    case 'river': {
      const z = 640;
      const s = standNear(sim, v.riverX(z), z, 12);
      listener = groundPose(sim, s.x, s.z, yawToward(s.x, s.z, v.riverX(s.z), s.z, Math.PI / 2)); // river on the right
      note = `listener ~12 m from the river channel, river to the right (azimuth +90)`;
      break;
    }
    case 'herd': {
      const c = centroid(sim, (sp) => sp === SPECIES_INDEX.chital) ?? { x: 700, z: 700, n: 0 };
      const s = standNear(sim, c.x, c.z, 18);
      listener = groundPose(sim, s.x, s.z, yawToward(s.x, s.z, c.x, c.z));
      note = `listener 18 m from the densest chital cluster (${c.n} deer within 120 m), facing it`;
      break;
    }
    case 'birds': {
      const c = centroid(sim, (sp) => sp === SPECIES_INDEX.crow || sp === SPECIES_INDEX.myna) ?? { x: 700, z: 700, n: 0 };
      const s = standNear(sim, c.x, c.z, 25);
      listener = groundPose(sim, s.x, s.z, yawToward(s.x, s.z, c.x, c.z));
      note = `listener 25 m from the densest crow/myna cluster (${c.n} birds within 120 m), facing it`;
      break;
    }
    case 'wetland': {
      const s = standNear(sim, 700, 1190, 60);
      listener = groundPose(sim, s.x, s.z, yawToward(s.x, s.z, 700, 1190));
      note = 'listener at the wetland edge, facing its centre';
      break;
    }
    case 'forest': {
      // the west bank is forested (valley.ts): stand 90 m west of the river at mid-valley
      const z = 560;
      const s = standNear(sim, v.riverX(z) - 90, z, 0.1);
      listener = groundPose(sim, s.x, s.z, yawToward(s.x, s.z, v.riverX(z), z));
      note = 'listener inside the west-bank forest edge, facing the river';
      break;
    }
    case 'event-scan': {
      // Look ahead on a clone for a VOICED alarm or a kill in the recording window. If the window has none, the
      // original world is advanced ten game minutes (10 x 1 s steps; 1 s at 1x = 1 game minute) and the look-ahead
      // repeats, up to 60 times (10 game hours). The listener and snapshot are taken at the start of the window that has the event.
      const voiced = new Set(['chital', 'crow', 'myna', 'boar']);
      let seen: (EcoAudioEvent & { t: number })[] = [];
      let pick: (EcoAudioEvent & { t: number }) | undefined;
      let tries = 0;
      for (; tries < 60 && !pick; tries++) {
        if (tries > 0) for (let i = 0; i < 10; i++) sim.step(1);
        const start = sim.tick;
        const clone = new Simulation(sc.seed, sim.snapshot());
        seen = [];
        const off = onAudioEvents(clone, (e) => {
          if (e.kind === 'alarm' || e.kind === 'kill') seen.push({ ...e, t: (clone.tick - start) * 0.1 });
        });
        // the look-ahead covers the whole recording (so the cue sheet lists every real event in it); the target event
        // must start at least 15 s before the end
        const ticks = Math.round(sc.seconds * sc.simRate * 10);
        for (let i = 0; i < ticks; i++) clone.step(0.1);
        off();
        pick = seen.find((e) => e.t > 5 && e.t < sc.seconds - 15 && (e.kind === 'kill' || voiced.has(e.species)));
      }
      snapshot = sim.snapshot();
      if (pick) {
        const s = standNear(sim, pick.x, pick.z, 45);
        // put the event 45 degrees to the listener's right
        listener = groundPose(sim, s.x, s.z, yawToward(s.x, s.z, pick.x, pick.z, Math.PI / 4));
        for (const e of seen) {
          const d = Math.hypot(e.x - listener.x, e.z - listener.z);
          if (d < 400) expected.push({ t: Math.round(e.t * 10) / 10, kind: e.kind, species: e.species, d: Math.round(d) });
        }
        note = `look-ahead (${tries} window(s)) found ${seen.length} alarm/kill events; listener 45 m from the ${pick.kind} by ${pick.species} at t=${pick.t.toFixed(1)} s, which should be ~45 degrees to the right`;
      } else {
        listener = groundPose(sim, 700, 700, 0);
        note = 'look-ahead found no voiced alarm or kill in 60 windows: this recording contains no event calls';
      }
      break;
    }
  }
  return {
    sim, listener, snapshot, expected, note,
    conditions: { tick: sim.tick, timeH: sim.env.timeH, hour: sim.env.hour, weather: sim.env.weather, season: sim.env.season, temperatureC: Math.round(sim.env.temperature * 10) / 10 },
  };
}
