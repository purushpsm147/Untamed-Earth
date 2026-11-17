import { describe, expect, it } from 'vitest';
import { B, MODE, SPECIES, SPECIES_INDEX, Simulation, maturityDays, swimDepth, type Animal } from '@untamed/ecology';
import { PlausibilityAudit } from '../../benchmarks/ecology/plausibility';

// Mission 2: species capabilities, movement modes, water rules, bounded swept movement and flight arrival
// (docs/BEHAVIOUR_AUDIT.md). Each case is deterministic.

function adult(sim: Simulation, id: string): Animal {
  return sim.animals.find((a) => SPECIES[a.sp]!.id === id && a.alive && a.mother === 0 && a.age > maturityDays(SPECIES[a.sp]!))!;
}
const noon = (sim: Simulation): void => {
  sim.env.timeH = (Math.floor(sim.env.timeH / 24) + 1) * 24 + 12;
};
/** A point in the river channel and a dry point on the bank, both at the same z. */
function riverAndBank(sim: Simulation, z: number): { cx: number; bankX: number } {
  const cx = sim.valley.riverX(z);
  let bankX = cx;
  while (sim.valley.waterDepth(bankX, z, sim.env.stage) > -0.3) bankX += 1;
  return { cx, bankX };
}

describe('species capability table', () => {
  it('every species declares its water capabilities and the evidence behind them', () => {
    for (const sp of SPECIES) {
      expect(sp.locomotion.wadeDepth).toBeGreaterThan(0);
      expect(['none', 'escape', 'capable', 'strong']).toContain(sp.locomotion.swim);
      expect(sp.locomotion.evidence.length).toBeGreaterThan(10);
      if (sp.flies) expect(sp.locomotion.swim).toBe('none');
    }
  });
});

describe('water rules', () => {
  it('a bird walking on the ground stops at its wade depth', () => {
    const sim = new Simulation(5);
    noon(sim);
    const z = 465;
    const { cx, bankX } = riverAndBank(sim, z);
    const crow = adult(sim, 'crow');
    Object.assign(crow, { x: bankX, z, alt: 0, tAlt: 0, fear: 0, hunger: 0, thirst: 0, energy: 1, beh: B.Wander, tx: cx, tz: z, timer: 999 });
    let maxDepth = -Infinity;
    for (let i = 0; i < 300; i++) {
      sim.step(0.1);
      crow.timer = 999;
      crow.tAlt = 0;
      if (crow.alt < 0.3) maxDepth = Math.max(maxDepth, sim.valley.waterDepth(crow.x, crow.z, sim.env.stage));
    }
    expect(maxDepth).toBeLessThanOrEqual(SPECIES[SPECIES_INDEX.crow]!.locomotion.wadeDepth + 1e-6);
  });

  it('a thirsty bird drinks at the water edge, not standing in the channel', () => {
    const sim = new Simulation(5);
    noon(sim);
    const crow = adult(sim, 'crow');
    Object.assign(crow, { thirst: 0.7, hunger: 0.1, fear: 0, energy: 1, beh: B.Idle, timer: 0, waterX: NaN, waterZ: NaN });
    let drinkDepth = NaN;
    for (let i = 0; i < 2000 && Number.isNaN(drinkDepth); i++) {
      sim.step(0.25);
      if (crow.beh === B.Drink) drinkDepth = sim.valley.waterDepth(crow.x, crow.z, sim.env.stage);
    }
    expect(Number.isNaN(drinkDepth)).toBe(false);
    expect(drinkDepth).toBeLessThanOrEqual(SPECIES[SPECIES_INDEX.crow]!.locomotion.wadeDepth + 0.05);
  });

  it('a hare will not enter deep water unless fleeing', () => {
    const sim = new Simulation(5);
    const z = 465;
    const { cx, bankX } = riverAndBank(sim, z);
    const hare = adult(sim, 'hare');
    Object.assign(hare, { x: bankX, z, fear: 0, hunger: 0, thirst: 0, energy: 1, beh: B.Wander, tx: cx, tz: z, timer: 999 });
    let maxDepth = -Infinity;
    for (let i = 0; i < 300; i++) {
      sim.step(0.1);
      hare.timer = 999;
      maxDepth = Math.max(maxDepth, sim.valley.waterDepth(hare.x, hare.z, sim.env.stage));
    }
    expect(maxDepth).toBeLessThanOrEqual(SPECIES[SPECIES_INDEX.hare]!.locomotion.wadeDepth + 1e-6);
  });

  it('an animal standing in deep water does not choose to graze there', () => {
    const sim = new Simulation(5);
    noon(sim);
    const z = 465;
    const cx = sim.valley.riverX(z);
    const chital = adult(sim, 'chital');
    Object.assign(chital, { x: cx, z, px: cx, pz: z, hunger: 0.8, thirst: 0, fear: 0, energy: 1, beh: B.Idle, timer: 0 });
    sim.step(0.1);
    if (chital.beh === B.Forage) expect(sim.valley.waterDepth(chital.tx, chital.tz, sim.env.stage)).toBeLessThanOrEqual(0.15);
  });

  it('an animal choosing to rest in the river heads for dry ground; a wallowing boar may rest in shallows', () => {
    const sim = new Simulation(5);
    const z = 465;
    const cx = sim.valley.riverX(z);
    const chital = adult(sim, 'chital');
    Object.assign(chital, { x: cx, z, hunger: 0, thirst: 0, fear: 0, energy: 0, beh: B.Idle, timer: 0 });
    sim.env.timeH = (Math.floor(sim.env.timeH / 24) + 1) * 24 + 13; // midday lull: crepuscular chital rest
    sim.step(0.1);
    if (chital.beh === B.Rest) {
      expect(sim.valley.waterDepth(chital.tx, chital.tz, sim.env.stage)).toBeLessThan(sim.valley.waterDepth(cx, z, sim.env.stage));
    }
    // boar in water shallower than its wade depth rests where it is
    const { bankX } = riverAndBank(sim, z);
    let x = bankX;
    while (sim.valley.waterDepth(x, z, sim.env.stage) < 0.1) x -= 0.25;
    const boar = adult(sim, 'boar');
    Object.assign(boar, { x, z, hunger: 0, thirst: 0, fear: 0, energy: 0, beh: B.Idle, timer: 0 });
    sim.env.timeH = (Math.floor(sim.env.timeH / 24) + 1) * 24 + 13; // midday: nocturnal boar rest
    sim.step(0.1);
    if (boar.beh === B.Rest) expect(Math.hypot(boar.tx - x, boar.tz - z)).toBeLessThan(0.01);
  });
});

describe('movement modes', () => {
  it('the simulation reports swimming, flying and walking, and the mode survives save/load', () => {
    const sim = new Simulation(5);
    const z = 465;
    const cx = sim.valley.riverX(z);
    const chital = adult(sim, 'chital');
    Object.assign(chital, { x: cx, z, fear: 0, beh: B.Wander, tx: cx, tz: z + 3, timer: 999 });
    expect(sim.valley.waterDepth(cx, z, sim.env.stage)).toBeGreaterThan(swimDepth(SPECIES[SPECIES_INDEX.chital]!));
    const crow = adult(sim, 'crow');
    Object.assign(crow, { alt: 8, tAlt: 8, beh: B.Wander, tx: crow.x + 50, tz: crow.z, timer: 999, speed: 8, want: 8 });
    const energy0 = chital.energy;
    for (let i = 0; i < 20; i++) {
      sim.step(0.1);
      chital.timer = 999;
      crow.timer = 999;
    }
    expect(chital.mode).toBe(MODE.Swim);
    expect(chital.energy).toBeLessThan(energy0); // swimming is effortful
    expect(crow.mode).toBe(MODE.Fly);
    const copy = new Simulation(5, sim.snapshot());
    expect(copy.animals.find((a) => a.id === chital.id)!.mode).toBe(MODE.Swim);
  });
});

describe('flight arrival', () => {
  it('a flying bird reaches a nearby perch instead of orbiting it (1x tick)', () => {
    const sim = new Simulation(5);
    noon(sim);
    const crow = adult(sim, 'crow');
    const tx = crow.x + 6;
    const tz = crow.z;
    Object.assign(crow, { alt: 6, tAlt: 6, heading: Math.PI, speed: 8, want: 8, beh: B.Roost, tx, tz, timer: 999, fear: 0, energy: 0.1 });
    let reached = -1;
    for (let i = 0; i < 100 && reached < 0; i++) {
      sim.step(0.1);
      crow.timer = 999;
      crow.tx = tx;
      crow.tz = tz;
      if (Math.hypot(crow.x - tx, crow.z - tz) < 1) reached = i;
    }
    expect(reached).toBeGreaterThanOrEqual(0);
  });
});

describe('bounded swept movement at high speed', () => {
  it('no shoreline skipping at 1000x and no passing through buildings at 100x (audit over 10 days, seed 1)', () => {
    for (const dt of [2, 1]) {
      const sim = new Simulation(1);
      const audit = new PlausibilityAudit(sim);
      const ticks = Math.round((10 * 24 * 3600) / 60 / dt);
      for (let i = 0; i < ticks; i++) {
        sim.step(dt);
        audit.afterStep(dt);
      }
      const cats = (audit.summary() as { categories: Record<string, Record<string, { episodes: number; shareOfTime: number }>> }).categories;
      const total = (c: string): number => Object.values(cats[c] ?? {}).reduce((t, x) => t + x.episodes, 0);
      expect(total('shorelineSkip')).toBe(0);
      expect(total('passThroughBuilding')).toBe(0);
      // birds standing in water: 1.1-2.7% of their time before Mission 2; what remains is reaction latency to rising
      // water (decisions every few seconds), so the bound is on time share, not episode count
      for (const x of Object.values(cats.birdInWater ?? {})) expect(x.shareOfTime).toBeLessThan(0.0002);
    }
  });

  it('the residual 1000x river crossings are closed: no animal crosses water faster than it can move through it (seed 3 replay)', () => {
    // seed 3 at 1000x is where the 8-sub-step build still let fleeing chital, hares and chasing jackals enter or leave
    // the river faster than their wading/swimming speed allows (36 cases in these 10 days); the 1 m continuous sweep
    // checks every sample and applies the depth-dependent speed at each, so the count is zero
    const sim = new Simulation(3);
    const audit = new PlausibilityAudit(sim);
    for (let i = 0; i < 10 * 720; i++) {
      sim.step(2);
      audit.afterStep(2);
    }
    const cats = (audit.summary() as { categories: Record<string, Record<string, { episodes: number }>> }).categories;
    expect(Object.values(cats.shorelineSkip ?? {}).reduce((t, x) => t + x.episodes, 0)).toBe(0);
  });
});
