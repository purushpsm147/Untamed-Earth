import { describe, expect, it } from 'vitest';
import { SPECIES, Simulation, onAudioEvents, type EcoAudioEvent } from '@untamed/ecology';
import { airAbsorptionCutoff, azimuth, inverseGain, occlusion, type WorldSampler } from '../../apps/web/src/audio/eco/acoustics';
import { CallRouter } from '../../apps/web/src/audio/eco/callRouter';
import { PLANNER_DEFAULTS } from '../../apps/web/src/audio/eco/planner';
import { FrameBuilder, worldSampler } from '../../apps/web/src/audio/eco/observation';
import { SoundscapePlanner, chirpRate, dayPart, type AnimalObs, type SoundscapeFrame, type VoiceRequest } from '../../apps/web/src/audio/eco/planner';
import { CALL_PROFILES, SILENT, profileFor } from '../../apps/web/src/audio/eco/repertoire';
import { PresentationRng } from '../../apps/web/src/audio/eco/rng';
import { VoicePool } from '../../apps/web/src/audio/eco/voicePool';

const L = { x: 0, y: 2, z: 0 };
const ev = (p: Partial<EcoAudioEvent> = {}): EcoAudioEvent => ({ kind: 'alarm', species: 'chital', animalId: 1, x: 30, z: 0, timeH: 10, intensity: 0.8, ...p });
const ctx = (realTime: number, simRate = 1) => ({ listener: L, realTime, simRate, sourceY: 2 });

describe('CallRouter: only real events, with range, cooldown, merging and time-acceleration gates', () => {
  it('plays a chital alarm in range once, then drops repeats inside the cooldown', () => {
    const r = new CallRouter();
    expect(r.route(ev(), ctx(0))[0]!.action).toBe('play');
    const again = r.route(ev(), ctx(1))[0]!;
    expect(again).toMatchObject({ action: 'drop', reason: 'cooldown' });
    expect(r.route(ev(), ctx(4.1))[0]!.action).toBe('play');
  });
  it('drops out-of-range events using the species range', () => {
    const r = new CallRouter();
    const far = profileFor('chital', 'event:alarm')!.rangeM + 5;
    expect(r.route(ev({ x: far }), ctx(0))[0]).toMatchObject({ action: 'drop', reason: 'out-of-range' });
  });
  it('keeps unsupported vocalisations silent (hare alarm) and births/deaths silent', () => {
    const r = new CallRouter();
    expect(r.route(ev({ species: 'hare' }), ctx(0))[0]).toMatchObject({ action: 'drop', reason: 'unsupported' });
    expect(r.route(ev({ kind: 'birth' }), ctx(0))[0]).toMatchObject({ action: 'drop', reason: 'silent-kind' });
    expect(r.route(ev({ kind: 'death', cause: 'starvation' }), ctx(0))[0]).toMatchObject({ action: 'drop', reason: 'silent-kind' });
  });
  it('a jackal kill of a hare yields the scuffle and the hare scream; of a chital only the scuffle', () => {
    const r = new CallRouter();
    const hare = r.route(ev({ kind: 'kill', species: 'jackal', animalId: 5, preyId: 9, preySpecies: 'hare', x: 20 }), ctx(0));
    expect(hare.map((d) => (d.action === 'play' ? d.profile.id : d.reason))).toEqual(['kill-scuffle', 'hare-distress-scream']);
    const chital = r.route(ev({ kind: 'kill', species: 'jackal', animalId: 6, preyId: 10, preySpecies: 'chital', x: 20 }), ctx(10));
    expect(chital.map((d) => (d.action === 'play' ? d.profile.id : d.reason))).toEqual(['kill-scuffle', 'unsupported']);
  });
  it('merges simultaneous alarms from a herd within 0.3 s and 15 m', () => {
    const r = new CallRouter();
    expect(r.route(ev({ animalId: 1 }), ctx(0))[0]!.action).toBe('play');
    expect(r.route(ev({ animalId: 2, x: 35 }), ctx(0.1))[0]).toMatchObject({ reason: 'merged' });
    expect(r.route(ev({ animalId: 3, x: 80 }), ctx(0.15))[0]!.action).toBe('play'); // 50 m away: a separate caller
  });
  it('throttles above 10x and mutes above 100x', () => {
    const r = new CallRouter();
    expect(r.route(ev({ animalId: 1 }), ctx(0, 50))[0]!.action).toBe('play');
    expect(r.route(ev({ animalId: 2, x: 200 }), ctx(1, 50))[0]).toMatchObject({ reason: 'rate-gate' });
    expect(r.route(ev({ animalId: 3, x: 200 }), ctx(2.1, 50))[0]!.action).toBe('play');
    expect(r.route(ev({ animalId: 4 }), ctx(10, 1000))[0]).toMatchObject({ reason: 'rate-gate' });
  });
});

describe('VoicePool: caps, stealing and audio-clock expiry', () => {
  it('never exceeds the category cap; steals only the quietest voice for a louder one', () => {
    const p = new VoicePool({ call: 3, 'ambient-call': 2, movement: 2, 'oneshot-env': 1 }, 6);
    for (let i = 0; i < 3; i++) expect(p.request('call', 0.5 + i * 0.1, 10, 0).admit).toBe(true);
    expect(p.request('call', 0.2, 10, 0).admit).toBe(false);
    const a = p.request('call', 0.9, 10, 0);
    expect(a.admit && a.steal).toBeTruthy();
    expect(p.count('call')).toBe(3);
  });
  it('enforces the total cap across categories and frees voices whose scheduled end has passed', () => {
    const p = new VoicePool({ call: 10, 'ambient-call': 10, movement: 10, 'oneshot-env': 10 }, 4);
    for (let i = 0; i < 4; i++) p.request('movement', 0.5, 1 + i, 0);
    expect(p.request('movement', 0.1, 9, 0).admit).toBe(false);
    expect(p.size).toBe(4);
    expect(p.request('call', 0.1, 9, 2.5).admit).toBe(true); // two voices ended by t = 2.5
    expect(p.size).toBe(3);
  });
});

describe('acoustics', () => {
  it('inverse gain matches the Web Audio inverse distance model', () => {
    expect(inverseGain(5, 10, 1.2)).toBe(1);
    expect(inverseGain(10 + 10 / 1.2, 10, 1.2)).toBeCloseTo(0.5, 6);
  });
  it('azimuth: right of the listener is positive in the game frame (forward +z, right -x)', () => {
    const l = { x: 0, y: 0, z: 0, yaw: 0 };
    expect(azimuth(l, { x: 0, y: 0, z: 10 })).toBeCloseTo(0);
    expect(azimuth(l, { x: -10, y: 0, z: 0 })).toBeCloseTo(Math.PI / 2);
    expect(azimuth(l, { x: 10, y: 0, z: 0 })).toBeCloseTo(-Math.PI / 2);
    expect(azimuth({ ...l, yaw: Math.PI / 2 }, { x: 0, y: 0, z: 10 })).toBeCloseTo(Math.PI / 2);
  });
  it('air absorption darkens distant sounds monotonically', () => {
    expect(airAbsorptionCutoff(10)).toBeGreaterThan(airAbsorptionCutoff(200));
    expect(airAbsorptionCutoff(5000)).toBeGreaterThanOrEqual(1800);
  });
  it('a ridge between source and listener attenuates and low-passes; open meadow does not', () => {
    const flat: WorldSampler = { height: () => 0, forest: () => 0 };
    const ridge: WorldSampler = { height: (x) => (Math.abs(x - 50) < 5 ? 12 : 0), forest: () => 0 };
    const forest: WorldSampler = { height: () => 0, forest: () => 1 };
    const s = { x: 100, y: 1.5, z: 0 };
    const l = { x: 0, y: 1.7, z: 0 };
    const open = occlusion(s, l, flat);
    const hidden = occlusion(s, l, ridge);
    const woods = occlusion(s, l, forest);
    expect(open.terrain).toBe(0);
    expect(open.gain).toBeCloseTo(1);
    expect(hidden.terrain).toBe(1);
    expect(hidden.gain).toBeLessThan(0.25);
    expect(hidden.cutoffHz).toBeLessThan(1000);
    expect(woods.foliageM).toBeGreaterThan(80);
    expect(woods.gain).toBeLessThan(open.gain);
    expect(woods.cutoffHz).toBeLessThan(open.cutoffHz);
  });
});

describe('repertoire: every simulated species has explicit decisions', () => {
  it('every species alarm is either voiced (documented) or explicitly silent', () => {
    for (const sp of SPECIES) {
      if (sp.predators.length === 0) continue; // never alarms
      const voiced = profileFor(sp.id, 'event:alarm');
      const silent = SILENT.find((s) => s.species === sp.id && s.trigger === 'event:alarm');
      expect(Boolean(voiced) !== Boolean(silent), sp.id).toBe(true);
    }
  });
  it('no synthesis is claimed authentic; every voiced call is documented behaviour', () => {
    for (const p of CALL_PROFILES) {
      expect(p.synthesis).toBe('procedural-unverified');
      expect(p.evidence).toBe('documented');
      expect(p.behaviourBasis.length).toBeGreaterThan(20);
    }
  });
});

function obs(p: Partial<AnimalObs>): AnimalObs {
  return {
    id: 1, species: 'crow', x: 10, z: 0, alt: 0, heading: 0, speed: 0, prevX: 10, prevZ: 0, prevAlt: 0, behavior: 'graze', gait: 'still', fear: 0,
    lifeStage: 'adult', sex: 'female', size: 1, speciesLength: 0.42, group: 1, mother: 0, controlledByPlayer: false, y: 1, waterDepth: -1, forest: 0, ...p,
  };
}
function frame(p: Partial<SoundscapeFrame> & { hour?: number; sunEl?: number; daylight?: number; temp?: number; season?: SoundscapeFrame['ambient']['season']; rain?: number } = {}): SoundscapeFrame {
  return {
    realDt: 1 / 30, realTime: 0, simRate: 1, listener: { x: 0, y: 1.7, z: 0, yaw: 0 },
    ambient: { hour: p.hour ?? 12, daylight: p.daylight ?? 1, sunElevation: p.sunEl ?? 1, season: p.season ?? 'Summer', weather: 'clear', rain: p.rain ?? 0, cloud: 0, wind: 3, windDir: 0, temperatureC: p.temp ?? 28, riverStage: 0 },
    habitat: { forest: 0.6, meadow: 0.4, wetland: 0.3, riverDistance: 20, waterDepth: -1, invertebrates: 1, smallFauna: 0.8 },
    river: { x: 20, y: 0, z: 0 }, animals: [], ...p,
  };
}
function run(pl: SoundscapePlanner, f: SoundscapeFrame, seconds: number): VoiceRequest[] {
  const all: VoiceRequest[] = [];
  const n = Math.round(seconds * 30);
  for (let i = 0; i < n; i++) all.push(...pl.plan({ ...f, realTime: i / 30 }).requests);
  return all;
}

describe('SoundscapePlanner: environment-driven beds and day-part variation', () => {
  it('night has crickets and no cicadas; hot forest day has cicadas and no crickets', () => {
    const pl = new SoundscapePlanner(1);
    const night = pl.plan(frame({ hour: 23, sunEl: -0.8, daylight: 0 })).beds;
    const day = pl.plan(frame({ hour: 13, sunEl: 1.1, daylight: 1, temp: 33 })).beds;
    expect(night.dayPart).toBe('night');
    expect(night.insects).toBeGreaterThan(0.01);
    expect(night.cicadas).toBe(0);
    expect(day.dayPart).toBe('day');
    expect(day.cicadas).toBeGreaterThan(0);
    expect(day.insects).toBe(0);
  });
  it('dawn and dusk are recognised from sun elevation and hour', () => {
    expect(dayPart({ hour: 6.2, sunElevation: 0.02, daylight: 0.3 })).toBe('dawn');
    expect(dayPart({ hour: 18.4, sunElevation: 0.0, daylight: 0.2 })).toBe('dusk');
  });
  it('frogs only in the wet season; heavy rain suppresses crickets; chirp rate rises with temperature', () => {
    const pl = new SoundscapePlanner(2);
    const n = { hour: 23, sunEl: -0.8, daylight: 0 };
    expect(pl.plan(frame({ ...n, season: 'Winter' })).beds.frogs).toBe(0);
    expect(pl.plan(frame({ ...n, season: 'Monsoon', rain: 1 })).beds.frogs).toBeGreaterThan(0.005);
    expect(pl.plan(frame({ ...n, rain: 10 })).beds.insects).toBeLessThan(pl.plan(frame(n)).beds.insects * 0.3);
    expect(chirpRate(30)).toBeGreaterThan(chirpRate(18));
  });
  it('no animals, no calls and no movement: silence is allowed', () => {
    const reqs = run(new SoundscapePlanner(3), frame(), 60);
    expect(reqs.filter((r) => r.type !== 'thunder')).toHaveLength(0);
  });
  it('state-derived calls come only from real nearby animals in a matching state, and stop above 10x', () => {
    const crows = Array.from({ length: 6 }, (_, i) => obs({ id: i + 1, x: 20 + i, behavior: 'graze' }));
    const lab = { stateCalls: true };
    const day = run(new SoundscapePlanner(4, lab), frame({ animals: crows }), 120).filter((r) => r.type === 'call');
    expect(day.length).toBeGreaterThan(2);
    for (const r of day) expect(crows.some((c) => c.id === r.animalId)).toBe(true);
    const resting = crows.map((c) => ({ ...c, behavior: 'rest' as const }));
    expect(run(new SoundscapePlanner(4, lab), frame({ animals: resting }), 120).filter((r) => r.type === 'call')).toHaveLength(0);
    expect(run(new SoundscapePlanner(4, lab), frame({ animals: crows, simRate: 100 }), 120).filter((r) => r.type === 'call')).toHaveLength(0);
  });
  it('a jackal chorus is joined only by awake members of the same group', () => {
    const night = { hour: 21, sunEl: -0.4, daylight: 0 };
    const jackals = [obs({ id: 1, species: 'jackal', group: 7, behavior: 'wander', x: 200 }), obs({ id: 2, species: 'jackal', group: 7, behavior: 'wander', x: 210 }), obs({ id: 3, species: 'jackal', group: 8, behavior: 'rest', x: 205 })];
    const reqs = run(new SoundscapePlanner(5, { stateCalls: true }), frame({ ...night, animals: jackals }), 1800).filter((r) => r.call === 'jackal-chorus-howl');
    expect(reqs.length).toBeGreaterThan(0);
    expect(reqs.some((r) => r.animalId === 3)).toBe(false);
  });
  it('footfalls follow distance travelled: a running chital steps faster than a walking one; still animals are silent', () => {
    const steps = (gait: 'walk' | 'run' | 'still', speed: number) =>
      run(new SoundscapePlanner(6), frame({ animals: [obs({ id: 1, species: 'chital', speciesLength: 1.5, gait, speed, behavior: 'flee' })] }), 10).filter((r) => r.movement === 'footfall').length;
    const walk = steps('walk', 1.3);
    const sprint = steps('run', 12);
    expect(steps('still', 0)).toBe(0);
    expect(walk).toBeGreaterThan(5);
    expect(sprint).toBeGreaterThan(walk * 3);
  });
  it('a bird taking off makes one takeoff sound; planner memory stays bounded', () => {
    const pl = new SoundscapePlanner(7);
    const b = obs({ id: 9, species: 'myna', speciesLength: 0.25 });
    expect(pl.plan(frame({ animals: [b] })).requests.filter((r) => r.movement === 'takeoff')).toHaveLength(0);
    expect(pl.plan(frame({ animals: [{ ...b, alt: 1, gait: 'fly', speed: 4 }] })).requests.filter((r) => r.movement === 'takeoff')).toHaveLength(1);
    for (let i = 0; i < 700; i++) pl.plan(frame({ realTime: i, animals: [] }));
    expect(pl.memory().stepPhase + pl.memory().wasAirborne).toBe(0);
  });
  it('is reproducible for a seed (recordings depend on this)', () => {
    const f = frame({ animals: Array.from({ length: 6 }, (_, i) => obs({ id: i + 1, behavior: 'graze', x: 15 + i })) });
    const a = run(new SoundscapePlanner(11, { stateCalls: true }), f, 90).map((r) => `${r.animalId}:${r.call}`);
    const b = run(new SoundscapePlanner(11, { stateCalls: true }), f, 90).map((r) => `${r.animalId}:${r.call}`);
    expect(a).toEqual(b);
    expect(new PresentationRng(1).next()).not.toBe(new PresentationRng(2).next());
  });
});

describe('audio observes, never influences: simulation hash unchanged with the soundscape pipeline attached', () => {
  it('same state hash at a fixed tick with router + planner + frame builder running every step', () => {
    const a = new Simulation(4);
    const b = new Simulation(4);
    const fb = new FrameBuilder(b);
    const planner = new SoundscapePlanner(1);
    const router = new CallRouter();
    const sampler = worldSampler(b);
    const queue: EcoAudioEvent[] = [];
    const off = onAudioEvents(b, (e) => queue.push(e));
    const listener = { x: 760, y: 0, z: 640, yaw: 0.3 };
    listener.y = sampler.height(listener.x, listener.z) + 1.7;
    let plays = 0;
    for (let i = 0; i < 1500; i++) {
      a.step(1);
      b.step(1);
      const f = fb.build(listener, 1 / 30, i / 30, 1);
      planner.plan(f);
      for (const e of queue) for (const d of router.route(e, { listener, realTime: i / 30, simRate: 1, sourceY: sampler.height(e.x, e.z) + 1 })) if (d.action === 'play') plays++;
      queue.length = 0;
      if (i % 100 === 0) occlusion({ x: 700, y: 10, z: 600 }, listener, sampler);
    }
    off();
    expect(b.stateHash()).toBe(a.stateHash());
    expect(b.focus).toBeNull();
    expect(plays).toBeGreaterThanOrEqual(0);
  });
});

describe('AUD-02: state-derived calls are lab-only and off by default; every sound carries provenance', () => {
  it('production default: no state-derived calls even with many active birds and a jackal group at night', () => {
    expect(PLANNER_DEFAULTS.stateCalls).toBe(false);
    const birds = Array.from({ length: 8 }, (_, i) => obs({ id: i + 1, x: 15 + i, behavior: 'graze' }));
    expect(run(new SoundscapePlanner(21), frame({ animals: birds }), 300).filter((r) => r.type === 'call')).toHaveLength(0);
    const jackals = [obs({ id: 50, species: 'jackal', group: 3, behavior: 'wander', x: 100 }), obs({ id: 51, species: 'jackal', group: 3, behavior: 'wander', x: 110 })];
    expect(run(new SoundscapePlanner(21), frame({ hour: 21, sunEl: -0.4, daylight: 0, animals: jackals }), 1800).filter((r) => r.type === 'call')).toHaveLength(0);
  });
  it('state-derived calls (lab) and movement carry animal-state provenance that says no vocal event was simulated', () => {
    const birds = Array.from({ length: 8 }, (_, i) => obs({ id: i + 1, x: 15 + i, behavior: 'graze' }));
    const calls = run(new SoundscapePlanner(22, { stateCalls: true }), frame({ animals: birds }), 300).filter((r) => r.type === 'call');
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect(c.provenance).toMatchObject({ source: 'animal-state', animalId: c.animalId, vocalEventSimulated: false });
      expect(c.why).toContain('not a simulated vocal event');
    }
    const steps = run(new SoundscapePlanner(23), frame({ animals: [obs({ id: 9, species: 'chital', speciesLength: 1.5, gait: 'run', speed: 10, behavior: 'flee' })] }), 3).filter((r) => r.type === 'movement');
    expect(steps.length).toBeGreaterThan(0);
    for (const m of steps) expect(m.provenance).toMatchObject({ source: 'animal-state', animalId: 9, gait: 'run' });
  });
});

/** Headless audio decision log for a world: every routed event decision and every planner request, in order. */
function decisionLog(sim: Simulation, ticks: number, planner: SoundscapePlanner, router: CallRouter, frame0 = 0): string[] {
  const fb = new FrameBuilder(sim);
  const sampler = worldSampler(sim);
  const listener = { x: 640, y: 0, z: 640, yaw: 1 };
  listener.y = sampler.height(listener.x, listener.z) + 1.7;
  const queue: EcoAudioEvent[] = [];
  const off = onAudioEvents(sim, (e) => queue.push(e));
  const log: string[] = [];
  for (let i = 0; i < ticks; i++) {
    sim.step(0.1);
    const t = (frame0 + i) / 10; // integer frame index: identical floats however the run is split
    for (const e of queue) for (const d of router.route(e, { listener, realTime: t, simRate: 1, sourceY: sampler.height(e.x, e.z) + 1 })) log.push(`${sim.tick} ${e.kind}:${e.species}#${e.animalId} -> ${d.action === 'play' ? d.profile.id : d.reason}`);
    queue.length = 0;
    for (const r of planner.plan(fb.build(listener, 0.1, t, 1)).requests) log.push(`${sim.tick} ${r.type}:${r.call ?? r.movement}#${r.animalId} ${r.provenance.source}`);
  }
  off();
  return log;
}

describe('AUD-02: deterministic replay of audio decisions', () => {
  it('two runs from the same snapshot produce the identical decision log (events, calls, movement, provenance)', () => {
    const base = new Simulation(5);
    for (let i = 0; i < 600; i++) base.step(1); // advance to a busier hour
    const snap = base.snapshot();
    const a = decisionLog(new Simulation(5, snap), 3000, new SoundscapePlanner(9, { stateCalls: true }), new CallRouter());
    const b = decisionLog(new Simulation(5, structuredClone(snap)), 3000, new SoundscapePlanner(9, { stateCalls: true }), new CallRouter());
    expect(a.length).toBeGreaterThan(20);
    expect(b).toEqual(a);
  });
  it('a save/restore in the middle of a run does not change what the soundscape decides', () => {
    const snap = (() => {
      const s = new Simulation(6);
      for (let i = 0; i < 600; i++) s.step(1);
      return s.snapshot();
    })();
    const whole = decisionLog(new Simulation(6, snap), 2000, new SoundscapePlanner(4, { stateCalls: true }), new CallRouter());
    const planner = new SoundscapePlanner(4, { stateCalls: true });
    const router = new CallRouter();
    const first = new Simulation(6, structuredClone(snap));
    const part1 = decisionLog(first, 1000, planner, router);
    const restored = new Simulation(6, first.snapshot()); // save + load mid-run; presentation state continues
    const part2 = decisionLog(restored, 1000, planner, router, 1000);
    expect([...part1, ...part2]).toEqual(whole);
  });
});
