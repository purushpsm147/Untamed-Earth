import { describe, expect, it } from 'vitest';
import { Simulation, ambientConditions, animalsNear, localHabitat, motionView, onAudioEvents, type EcoAudioEvent } from '@untamed/ecology';

describe('read-only observation contracts', () => {
  it('never changes the simulation: same state hash with and without observers', () => {
    const a = new Simulation(7);
    const b = new Simulation(7);
    const heard: EcoAudioEvent[] = [];
    const off = onAudioEvents(b, (e) => heard.push(e));
    for (let i = 0; i < 3000; i++) {
      a.step(2);
      b.step(2);
      if (i % 50 === 0) {
        animalsNear(b, 760, 640, 300);
        localHabitat(b, 760, 640);
        ambientConditions(b);
      }
    }
    off();
    expect(b.stateHash()).toBe(a.stateHash());
    expect(heard.length).toBeGreaterThan(0);
  });

  it('audio events are exactly the simulation events, with valid ids, species and positions', () => {
    const sim = new Simulation(3);
    const raw: string[] = [];
    const adapted: EcoAudioEvent[] = [];
    sim.events.on((e) => raw.push(e.type));
    const off = onAudioEvents(sim, (e) => adapted.push(e));
    for (let i = 0; i < 4000; i++) sim.step(2);
    off();
    expect(adapted.map((e) => e.kind)).toEqual(raw);
    for (const e of adapted) {
      expect(e.animalId).toBeGreaterThan(0);
      expect(Number.isFinite(e.x + e.z + e.timeH)).toBe(true);
      expect(e.intensity).toBeGreaterThan(0);
      expect(e.intensity).toBeLessThanOrEqual(1);
      if (e.kind === 'kill') expect(e.preyId).toBeGreaterThan(0);
    }
  });

  it('motion views describe real animals; gait follows speed; prev position allows interpolation', () => {
    const sim = new Simulation(2);
    for (let i = 0; i < 200; i++) sim.step(0.1);
    const views = animalsNear(sim, 720, 720, 2000);
    expect(views.length).toBe(sim.animals.length);
    for (const v of views) {
      const a = sim.byId.get(v.id)!;
      expect([v.x, v.z, v.heading, v.speed]).toEqual([a.x, a.z, a.heading, a.speed]);
      if (v.speed <= 0.05 && v.alt <= 0.25) expect(v.gait).toBe('still');
      if (v.alt > 0.25) expect(v.gait).toBe('fly');
      expect(Math.hypot(v.x - v.prevX, v.z - v.prevZ)).toBeLessThan(2); // one tick of motion
    }
    const deer = sim.animals.find((a) => a.sp === 0)!;
    deer.speed = 12;
    expect(motionView(sim, deer).gait).toBe('run');
  });
});
