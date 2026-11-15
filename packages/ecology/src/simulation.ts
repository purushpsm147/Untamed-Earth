import { EventBus, Rng, SpatialHash, angleDiff, clamp, clamp01, hash3, lerp } from '@untamed/core';
import { EnvSnapshot, Environment } from '@untamed/environment';
import { REGION_SIZE, Valley } from '@untamed/worlds';
import { SPECIES, SPECIES_INDEX, SpeciesDef, SpeciesId, gestationHours, intervalHours, lifeDays, maturityDays, weanDays } from './species';

/**
 * Kinematics run in "kinetic" seconds (what you see at 1x); physiology and the calendar run
 * TIME_SCALE times faster, so a full day passes in 24 real minutes at 1x.
 */
export const TIME_SCALE = 60;
export const SAVE_VERSION = 1;

export const B = {
  Idle: 0, Wander: 1, Forage: 2, SeekWater: 3, Drink: 4, Rest: 5, Flee: 6, SeekMate: 7,
  Stalk: 8, Chase: 9, SeekCarrion: 10, Feed: 11, Roost: 12, Follow: 13,
} as const;
export const BEHAVIOR_NAMES = ['Idle', 'Wandering', 'Foraging', 'Seeking water', 'Drinking', 'Resting', 'Fleeing', 'Seeking mate',
  'Stalking', 'Chasing', 'Approaching carrion', 'Feeding', 'Roosting', 'Following mother'];

export interface Animal {
  id: number;
  sp: number;
  x: number; z: number; alt: number;
  px: number; pz: number; palt: number;
  heading: number;
  speed: number;
  /** Age in game days. */
  age: number;
  sex: 0 | 1;
  health: number;
  hunger: number;
  thirst: number;
  energy: number;
  stamina: number;
  fear: number;
  beh: number;
  tx: number; tz: number; tAlt: number;
  targetId: number;
  threatX: number; threatZ: number;
  pregnantH: number;
  cooldownH: number;
  homeX: number; homeZ: number;
  group: number;
  mother: number;
  /** Remembered drinking site (NaN = none known). */
  waterX: number; waterZ: number;
  timer: number;
  crowd: number;
  alive: boolean;
  controlled: boolean;
}

export interface Carcass {
  id: number;
  x: number; z: number;
  kg: number;
  sp: number;
}

export type DeathCause = 'predation' | 'starvation' | 'dehydration' | 'age' | 'background' | 'poison' | 'experiment';
export const DEATH_CAUSES: DeathCause[] = ['predation', 'starvation', 'dehydration', 'age', 'background', 'poison', 'experiment'];

export type SimEvent =
  | { type: 'birth'; sp: number; x: number; z: number; n: number }
  | { type: 'death'; sp: number; id: number; cause: DeathCause; x: number; z: number }
  | { type: 'kill'; predator: number; prey: number; sp: number; x: number; z: number }
  | { type: 'alarm'; sp: number; x: number; z: number };

export interface StatSample {
  day: number;
  pops: number[];
  veg: number;
  moisture: number;
  stage: number;
  rain: number;
}

export interface ControlInput {
  /** World-space movement direction (unit or zero). */
  mx: number;
  mz: number;
  run: boolean;
  action: 'eat' | 'drink' | 'rest' | null;
}

export interface SimSnapshot {
  version: number;
  seed: number;
  tick: number;
  rng: number;
  nextId: number;
  env: EnvSnapshot;
  animals: Animal[];
  carcasses: Carcass[];
  fertility: number[];
  births: number[];
  deaths: number[][];
  history: StatSample[];
  statAcc: number;
  groupAcc: number;
  rainAcc: number;
  groups: [number, number, number, number][];
}

const NO_CONTROL: ControlInput = { mx: 0, mz: 0, run: false, action: null };

/**
 * The authoritative world state. Headless: no rendering, DOM or timing dependencies.
 * Deterministic for a given seed and sequence of step(dt) calls and inputs.
 */
export class Simulation {
  readonly valley: Valley;
  readonly env: Environment;
  readonly rng: Rng;
  readonly events = new EventBus<SimEvent>();
  animals: Animal[] = [];
  carcasses: Carcass[] = [];
  readonly byId = new Map<number, Animal>();
  private readonly hash = new SpatialHash<Animal>(REGION_SIZE, 48);
  private readonly groups = new Map<number, { x: number; z: number; n: number }>();
  tick = 0;
  nextId = 1;
  /** Experiment lever: per-species multiplier on conception probability and litter size. */
  fertility: number[] = SPECIES.map(() => 1);
  births: number[] = SPECIES.map(() => 0);
  deaths: number[][] = SPECIES.map(() => DEATH_CAUSES.map(() => 0));
  history: StatSample[] = [];
  /** Optional detail focus (camera). Animals far from it decide less often. null = uniform detail. */
  focus: { x: number; z: number } | null = null;
  control: ControlInput = NO_CONTROL;
  private statAcc = 0;
  private groupAcc = 0;
  private rainAcc = 0;
  private dead = false;

  constructor(readonly seed: number, snapshot?: SimSnapshot) {
    this.valley = new Valley(seed);
    this.env = new Environment(this.valley);
    this.rng = new Rng(hash3(seed, 99, 1));
    if (snapshot) this.restore(snapshot);
    else {
      this.populate();
      this.recordStats();
      this.rebuildGroups();
    }
  }

  // ------------------------------------------------------------------ setup
  private habitatScore(sp: SpeciesDef, x: number, z: number): number {
    const s = this.valley.sample(x, z);
    if (s.border > 0.05) return 0;
    const h = sp.habitat;
    return s.forest * h.forest + s.meadow * h.meadow + s.wetland * h.wetland + s.settlement * h.settlement + s.dump * h.dump;
  }

  private pickSite(sp: SpeciesDef): { x: number; z: number } {
    for (let i = 0; i < 400; i++) {
      const x = this.rng.range(70, REGION_SIZE - 70);
      const z = this.rng.range(70, REGION_SIZE - 70);
      if (this.valley.waterDepth(x, z, 0) > -0.3 || this.valley.blocked(x, z, 2)) continue;
      if (this.rng.next() < this.habitatScore(sp, x, z)) return { x, z };
    }
    return { x: REGION_SIZE / 2 + 200, z: REGION_SIZE / 2 };
  }

  private populate(): void {
    for (let si = 0; si < SPECIES.length; si++) {
      const sp = SPECIES[si]!;
      let left = sp.initial;
      while (left > 0) {
        const site = this.pickSite(sp);
        const n = Math.min(left, sp.group > 0 ? Math.max(2, Math.round(sp.group * this.rng.range(0.6, 1.3))) : 1);
        const group = this.nextId;
        for (let k = 0; k < n; k++) {
          const mat = maturityDays(sp);
          const age = this.rng.chance(0.22) ? this.rng.range(mat * 0.35, mat) : this.rng.range(mat, lifeDays(sp) * 0.7);
          const a = this.spawn(si, site.x + this.rng.range(-14, 14), site.z + this.rng.range(-14, 14), age, group, 0, site.x, site.z);
          // jackal pairs: one of each sex
          if (sp.id === 'jackal') a.sex = (k % 2) as 0 | 1;
          if (a.sex === 0 && age > mat && this.rng.chance(0.3) && this.seasonOk(sp)) a.pregnantH = this.rng.range(0.1, 1) * gestationHours(sp);
          a.hunger = this.rng.range(0.1, 0.5);
          a.thirst = this.rng.range(0.05, 0.4);
          a.energy = this.rng.range(0.5, 1);
        }
        left -= n;
      }
    }
  }

  private spawn(sp: number, x: number, z: number, age: number, group: number, mother: number, homeX: number, homeZ: number): Animal {
    x = clamp(x, 8, REGION_SIZE - 8);
    z = clamp(z, 8, REGION_SIZE - 8);
    const a: Animal = {
      id: this.nextId++, sp, x, z, alt: 0, px: x, pz: z, palt: 0, heading: this.rng.range(0, 6.283), speed: 0, age,
      sex: this.rng.chance(0.5) ? 0 : 1, health: 1, hunger: 0.2, thirst: 0.2, energy: 0.8, stamina: 1, fear: 0, beh: B.Idle,
      tx: x, tz: z, tAlt: 0, targetId: 0, threatX: x, threatZ: z, pregnantH: 0, cooldownH: 0, homeX, homeZ, group, mother,
      waterX: NaN, waterZ: NaN, timer: this.rng.range(0, 3), crowd: 0, alive: true, controlled: false,
    };
    this.animals.push(a);
    this.byId.set(a.id, a);
    return a;
  }

  // ------------------------------------------------------------------ experiment API
  /** Introduce n new adults of a species at habitat-appropriate sites. Returns how many were added. */
  addAnimals(id: SpeciesId, n: number): number {
    const si = SPECIES_INDEX[id];
    const sp = SPECIES[si]!;
    let site = this.pickSite(sp);
    let group = this.nextId;
    for (let i = 0; i < n; i++) {
      if (sp.group <= 1 || i % Math.max(2, sp.group) === 0) {
        site = this.pickSite(sp);
        group = this.nextId;
      }
      const mat = maturityDays(sp);
      this.spawn(si, site.x + this.rng.range(-10, 10), site.z + this.rng.range(-10, 10), this.rng.range(mat, mat * 2.5), group, 0, site.x, site.z);
    }
    return n;
  }
  /** Remove up to n individuals of a species (recorded as experiment mortality; no carcasses are left). */
  cull(id: SpeciesId, n: number): number {
    const si = SPECIES_INDEX[id];
    const pool = this.animals.filter((a) => a.alive && a.sp === si && !a.controlled);
    let done = 0;
    while (done < n && pool.length > 0) {
      const a = pool.splice(this.rng.int(pool.length), 1)[0]!;
      this.kill(a, 'experiment', false);
      done++;
    }
    this.sweep();
    return done;
  }

  setControlled(id: number | null): void {
    for (const a of this.animals) a.controlled = false;
    this.control = NO_CONTROL;
    if (id !== null) {
      const a = this.byId.get(id);
      if (a && a.alive) {
        a.controlled = true;
        a.speed = 0;
        a.beh = B.Idle;
      }
    }
  }

  population(si: number): number {
    let n = 0;
    for (const a of this.animals) if (a.sp === si && a.alive) n++;
    return n;
  }

  // ------------------------------------------------------------------ main loop
  /** Advance by dt kinetic seconds (0.05 .. 2). */
  step(dt: number): void {
    const dtH = (dt * TIME_SCALE) / 3600;
    this.tick++;
    this.env.step(dtH, this.rng);
    this.rainAcc += this.env.rain * dtH;
    this.hash.clear();
    const list = this.animals;
    for (let i = 0; i < list.length; i++) this.hash.insert(list[i]!);
    this.groupAcc += dt;
    if (this.groupAcc >= 4) {
      this.groupAcc = 0;
      this.rebuildGroups();
    }
    const n = list.length; // newborns appended during the loop act from the next tick
    for (let i = 0; i < n; i++) {
      const a = list[i]!;
      if (!a.alive) continue;
      const sp = SPECIES[a.sp]!;
      this.physiology(a, sp, dt, dtH);
      if (!a.alive) continue;
      a.timer -= dt;
      if (a.timer <= 0) this.decide(a, sp);
      if (a.controlled) this.actControlled(a, sp, dt, dtH);
      else this.act(a, sp, dt, dtH);
      this.move(a, sp, dt);
    }
    this.stepCarcasses(dtH);
    if (this.dead) this.sweep();
    this.statAcc += dtH;
    if (this.statAcc >= 2) {
      this.statAcc -= 2;
      this.recordStats();
    }
  }

  private recordStats(): void {
    const pops = SPECIES.map(() => 0);
    for (const a of this.animals) if (a.alive) pops[a.sp] = pops[a.sp]! + 1;
    this.history.push({
      day: this.env.timeH / 24, pops, veg: this.env.totalVeg / this.env.totalCap, moisture: this.env.meanMoisture,
      stage: this.env.stage, rain: this.rainAcc,
    });
    this.rainAcc = 0;
    if (this.history.length > 2400) this.history = this.history.filter((_, i) => i % 2 === 0);
  }

  private rebuildGroups(): void {
    const g = this.groups;
    g.clear();
    for (const a of this.animals) {
      if (!a.alive) continue;
      let e = g.get(a.group);
      if (!e) g.set(a.group, (e = { x: 0, z: 0, n: 0 }));
      e.x += a.x;
      e.z += a.z;
      e.n++;
    }
    for (const [id, e] of g) {
      e.x /= e.n;
      e.z /= e.n;
      // fission: oversized groups bud off a daughter group with a neighbouring home range
      const first = this.byId.get(id) ?? this.animals.find((a) => a.alive && a.group === id);
      if (!first) continue;
      const sp = SPECIES[first.sp]!;
      const limit = Math.max(4, sp.group * 2);
      if (e.n > limit) {
        const ng = this.nextId++;
        const ang = this.rng.range(0, 6.283);
        const hx = clamp(e.x + Math.cos(ang) * sp.homeRange * 0.9, 60, REGION_SIZE - 60);
        const hz = clamp(e.z + Math.sin(ang) * sp.homeRange * 0.9, 60, REGION_SIZE - 60);
        let k = 0;
        for (const a of this.animals) {
          if (a.alive && a.group === id && k++ % 2 === 1) {
            a.group = ng;
            a.homeX = hx;
            a.homeZ = hz;
          }
        }
      }
    }
  }

  // ------------------------------------------------------------------ physiology
  private physiology(a: Animal, sp: SpeciesDef, dt: number, dtH: number): void {
    const resting = a.beh === B.Rest || (a.beh === B.Roost && a.speed === 0);
    const sprinting = a.beh === B.Flee || a.beh === B.Chase;
    const prevAgeH = Math.floor(a.age * 24);
    a.age += dtH / 24;
    a.hunger += dtH * (0.5 / 24) * (sprinting ? 1.6 : resting ? 0.7 : 1) * (a.pregnantH > 0 ? 1.15 : 1);
    a.thirst += (dtH / 34) * (1 + Math.max(0, this.env.temperature - 24) / 18) * (sprinting ? 1.5 : 1);
    a.energy = clamp01(a.energy + (resting ? 0.13 : -0.045) * dtH);
    if (!sprinting) a.stamina = Math.min(1, a.stamina + dt / 45);
    a.fear *= Math.exp(-dt / 14);
    if (a.cooldownH > 0) a.cooldownH -= dtH;

    // dependent young are provisioned by the mother while she lives
    if (a.mother !== 0 && a.age < weanDays(sp)) {
      const m = this.byId.get(a.mother);
      if (m && m.alive) {
        a.hunger = Math.min(a.hunger, m.hunger + 0.05);
        a.thirst = Math.min(a.thirst, m.thirst + 0.05);
      }
    }
    if (a.hunger >= 1) {
      a.hunger = 1;
      a.health -= dtH * 0.012;
      if (a.health <= 0) return this.kill(a, 'starvation');
    }
    if (a.thirst >= 1) {
      a.thirst = 1;
      a.health -= dtH * 0.02;
      if (a.health <= 0) return this.kill(a, 'dehydration');
    }
    const life = lifeDays(sp);
    const old = a.age / life;
    if (old > 0.8) {
      a.health -= dtH * 0.006 * ((old - 0.8) / 0.2);
      if (a.health <= 0 || old > 1.2) return this.kill(a, 'age');
    } else if (a.hunger < 0.7 && a.thirst < 0.7 && a.health < 1) {
      a.health = Math.min(1, a.health + dtH * 0.006);
    }
    if (a.health <= 0) return this.kill(a, 'poison');

    // hourly background hazard (density dependent: crowding spreads disease and draws unmodelled predators)
    if (Math.floor(a.age * 24) !== prevAgeH && !a.controlled) {
      const juvenile = a.age < maturityDays(sp) * 0.5;
      let hz = juvenile ? sp.juvHazard : sp.adultHazard;
      hz *= 1 + a.crowd / Math.max(6, sp.group * 2.5);
      if (a.health < 0.5) hz *= 2.5;
      if (juvenile && a.mother !== 0 && !this.byId.get(a.mother)?.alive && a.age < weanDays(sp)) hz *= 6;
      if (this.rng.next() < hz / 24) return this.kill(a, 'background');
    }
    if (a.pregnantH > 0) {
      a.pregnantH -= dtH;
      if (a.pregnantH <= 0) this.giveBirth(a, sp);
    }
  }

  private seasonOk(sp: SpeciesDef): boolean {
    return sp.breedSeasons === null || sp.breedSeasons.includes(this.env.season);
  }
  private receptive(a: Animal, sp: SpeciesDef): boolean {
    if (sp.pairBreeding && a.sex === 0) {
      // only the dominant (oldest) female of a jackal family breeds; her daughters are helpers until they disperse
      for (const o of this.animals) if (o.alive && o.sp === a.sp && o.group === a.group && o.sex === 0 && o.age > a.age) return false;
    }
    return a.sex === 0 && a.pregnantH <= 0 && a.cooldownH <= 0 && a.hunger < 0.6 && a.health > 0.55 && a.age > maturityDays(sp) && this.seasonOk(sp);
  }

  private giveBirth(m: Animal, sp: SpeciesDef): void {
    m.pregnantH = 0;
    m.cooldownH = intervalHours(sp) - gestationHours(sp);
    const f = this.fertility[m.sp]!;
    const base = sp.litter[0] + this.rng.int(sp.litter[1] - sp.litter[0] + 1);
    // poor maternal condition reduces the litter
    const cond = m.hunger > 0.75 ? 0.5 : 1;
    const n = Math.floor(base * Math.min(f, 2) * cond + this.rng.next() * 0.999 * (f > 1 || cond < 1 ? 1 : 0));
    for (let i = 0; i < n; i++) {
      const c = this.spawn(m.sp, m.x + this.rng.range(-1.5, 1.5), m.z + this.rng.range(-1.5, 1.5), 0, m.group, m.id, m.homeX, m.homeZ);
      c.waterX = m.waterX;
      c.waterZ = m.waterZ;
      c.alt = m.alt;
    }
    if (n > 0) {
      this.births[m.sp] = this.births[m.sp]! + n;
      this.events.emit({ type: 'birth', sp: m.sp, x: m.x, z: m.z, n });
    }
  }

  private kill(a: Animal, cause: DeathCause, leaveCarcass = true): void {
    if (!a.alive) return;
    a.alive = false;
    this.dead = true;
    const sp = SPECIES[a.sp]!;
    const row = this.deaths[a.sp]!;
    const ci = DEATH_CAUSES.indexOf(cause);
    row[ci] = row[ci]! + 1;
    if (leaveCarcass) {
      const kg = sp.mass * this.growth(a, sp) * 0.6 * (0.6 + 0.4 * (1 - a.hunger));
      this.carcasses.push({ id: this.nextId++, x: a.x, z: a.z, kg, sp: a.sp });
    }
    this.events.emit({ type: 'death', sp: a.sp, id: a.id, cause, x: a.x, z: a.z });
  }

  private sweep(): void {
    this.dead = false;
    const keep: Animal[] = [];
    for (const a of this.animals) {
      if (a.alive) keep.push(a);
      else this.byId.delete(a.id);
    }
    this.animals = keep;
  }

  /** Body-size fraction of adult mass (0.12 at birth .. 1 at maturity). */
  growth(a: Animal, sp: SpeciesDef): number {
    return Math.min(1, 0.12 + 0.88 * (a.age / maturityDays(sp)));
  }

  private stepCarcasses(dtH: number): void {
    const list = this.carcasses;
    for (let i = list.length - 1; i >= 0; i--) {
      const c = list[i]!;
      // decomposition returns mass to the detritus pool (and from there to soil nutrients)
      const rot = c.kg * Math.min(1, dtH * 0.035) + dtH * 0.002;
      c.kg -= rot;
      this.env.addDetritus(c.x, c.z, Math.max(0, rot) * 0.3);
      if (c.kg <= 0.02) list.splice(i, 1);
    }
  }

  // ------------------------------------------------------------------ perception & decisions
  private activity(sp: SpeciesDef): number {
    const light = this.env.daylight();
    if (sp.activity === 'diurnal') return light;
    if (sp.activity === 'nocturnal') return 1 - light * 0.85;
    // crepuscular: most active in low sun, a midday lull, moderately active at night
    const el = this.env.sunElevation();
    return el > 0.7 ? 0.45 : el > -0.15 ? 1 : 0.55;
  }

  private foodScore(sp: SpeciesDef, x: number, z: number): number {
    const env = this.env;
    const c = env.cellIndex(x, z);
    const d = sp.diet;
    let s = 0;
    if (d.veg > 0) {
      const vf = Math.max(0, env.vegFrac(c) - 0.04);
      s += d.veg * (vf / (vf + 0.3)) * Math.min(1, env.cap[c]! / 20);
    }
    if (d.invert > 0) s += d.invert * (env.invert[c]! / (env.invert[c]! + 1.2));
    if (d.fauna > 0) s += d.fauna * (env.fauna[c]! / (env.fauna[c]! + 1));
    return s;
  }

  private decide(a: Animal, sp: SpeciesDef): void {
    const env = this.env;
    const rng = this.rng;
    const cell = env.cellIndex(a.x, a.z);
    const light = env.daylight();
    const nightVis = sp.activity === 'diurnal' ? 0.3 : 0.85;
    const vis = sp.vision * lerp(nightVis, 1, light) * (1 - 0.4 * env.forest[cell]!) * (env.rain > 1 ? 0.8 : 1) * (a.alt > 2 ? 1.3 : 1);
    const R = Math.max(vis, sp.hearing);
    const adult = a.age > maturityDays(sp);
    const fearful = sp.predators.length > 0 && !(sp.adultFearless && a.age > maturityDays(sp) * 0.4);
    const hunter = sp.prey.length > 0 && adult && a.hunger > 0.3 && !a.controlled;
    let threat: Animal | null = null;
    let threatD2 = 1e18;
    let mate: Animal | null = null;
    let mateD2 = vis * vis;
    let prey: Animal | null = null;
    let preyD2 = vis * vis;
    let alarm: Animal | null = null;
    let crowd = 0;
    this.hash.query(a.x, a.z, R, (o, d2) => {
      if (o === a || !o.alive) return;
      const osp = SPECIES[o.sp]!;
      if (o.sp === a.sp) {
        if (d2 < 3600) crowd++;
        if (a.sex === 1 && adult && d2 < mateD2 && this.receptive(o, osp)) {
          mate = o;
          mateD2 = d2;
        }
        if (o.beh === B.Flee && o.fear > 0.75 && d2 < sp.hearing * sp.hearing) alarm = o;
        return;
      }
      if (fearful && sp.predators.includes(osp.id) && o.alt < 2 && o.age > maturityDays(osp) * 0.5) {
        const d = Math.sqrt(d2);
        let p = d < sp.hearing * 0.3 ? 1 : d < vis ? 1 - (d / vis) * (d / vis) : 0;
        if (o.beh === B.Stalk) p *= 0.4;
        if (a.beh === B.Rest) p *= 0.5;
        if (p > 0 && d2 < threatD2 && rng.next() < p) {
          threat = o;
          threatD2 = d2;
        }
      } else if (hunter && d2 < preyD2 && o.alt < 1 && sp.prey.includes(osp.id) && this.suitablePrey(o, osp)) {
        prey = o;
        preyD2 = d2;
      }
    });
    a.crowd = crowd;
    // narrowing helpers (closures above defeat control-flow analysis)
    const th = threat as Animal | null;
    const al = alarm as Animal | null;
    const mt = mate as Animal | null;
    const pr = prey as Animal | null;

    if (th) {
      const d = Math.sqrt(threatD2);
      const urgency = clamp01(1.4 - d / sp.fleeDist) * (th.beh === B.Chase || th.beh === B.Stalk ? 1.3 : 0.8);
      if (urgency > a.fear) {
        if (a.fear < 0.4 && urgency >= 0.4) this.events.emit({ type: 'alarm', sp: a.sp, x: a.x, z: a.z });
        a.fear = Math.min(1, urgency);
      }
      a.threatX = th.x;
      a.threatZ = th.z;
    } else if (al && a.fear < 0.5 && fearful) {
      // alarm contagion: second-hand fear stays below the threshold that would relay it again
      a.fear = 0.5;
      a.threatX = al.threatX;
      a.threatZ = al.threatZ;
    }
    const far = this.focus !== null && (a.x - this.focus.x) ** 2 + (a.z - this.focus.z) ** 2 > 300 * 300;
    a.timer = rng.range(2, 4) * (far ? 2.5 : 1);
    if (a.controlled) return;

    // ---- flee overrides everything ----
    if (a.fear > 0.4) {
      a.timer = 1;
      this.startFlee(a, sp);
      return;
    }
    // committed actions are not interrupted by the periodic re-evaluation
    if (a.beh === B.Chase || a.beh === B.Drink) return;
    if (a.beh === B.Feed && a.hunger > 0.05) return;

    // dependent young shadow the mother
    if (a.mother !== 0 && a.age < weanDays(sp)) {
      const m = this.byId.get(a.mother);
      if (m && m.alive) {
        a.beh = B.Follow;
        a.targetId = m.id;
        return;
      }
    }

    // ---- utilities ----
    const act = this.activity(sp);
    let best: number = B.Wander;
    let bestU = 0.12 + (a.beh === B.Wander ? 0.05 : 0);
    const consider = (b: number, u: number): void => {
      if (b === a.beh) u += 0.12; // hysteresis
      if (u > bestU) {
        bestU = u;
        best = b;
      }
    };
    if (a.thirst > 0.3) consider(B.SeekWater, Math.pow(a.thirst, 1.4) * 1.25);
    if (a.hunger > 0.22) consider(B.Forage, Math.pow(a.hunger, 1.15) * (0.55 + 0.45 * act));
    consider(sp.flies ? B.Roost : B.Rest, Math.pow(1 - a.energy, 1.4) * 1.1 + (1 - act) * 0.42);
    if (mt) consider(B.SeekMate, 0.5);
    let carc: Carcass | null = null;
    if (sp.diet.carrion > 0 && a.hunger > 0.25 && this.carcasses.length > 0) {
      const reach = sp.smell * (a.alt > 2 || !sp.flies ? 1 : 0.5);
      let bd = reach * reach;
      for (const c of this.carcasses) {
        const d2 = (c.x - a.x) ** 2 + (c.z - a.z) ** 2;
        if (d2 < bd && c.kg > 0.05) {
          bd = d2;
          carc = c;
        }
      }
      if (carc) consider(B.SeekCarrion, a.hunger * 1.3 * sp.diet.carrion + 0.15);
    }
    if (pr) consider(B.Stalk, a.hunger * 1.35 * (0.6 + 0.4 * act));

    if (best === a.beh && (best === B.Forage || best === B.Rest || best === B.Roost || best === B.SeekWater || best === B.Stalk)) {
      if (best === B.Stalk && pr) a.targetId = pr.id;
      return;
    }
    switch (best) {
      case B.SeekWater: {
        let wx = a.waterX;
        let wz = a.waterZ;
        if (Number.isNaN(wx) || rng.chance(0.15)) {
          // look for water within sensory range; otherwise fall back on the group's traditional knowledge
          const site = env.findWater(a.x, a.z, Math.max(vis * 1.5, 140)) ?? (a.thirst > 0.55 ? env.findWater(a.x, a.z, sp.homeRange * 2.5 + 250) : null);
          if (site) {
            wx = a.waterX = site.x;
            wz = a.waterZ = site.z;
          }
        }
        if (Number.isNaN(wx)) {
          // no idea where water is: range further afield
          this.startWander(a, sp, 2.5);
        } else {
          a.beh = B.SeekWater;
          a.tx = wx;
          a.tz = wz;
          a.tAlt = 0;
        }
        break;
      }
      case B.Forage: {
        // compare a handful of patches within sensory range; no global knowledge of the map
        const g = this.groups.get(a.group);
        const reach = Math.min(Math.max(vis, 25), 70);
        let bs = this.foodScore(sp, a.x, a.z) * 1.1;
        let bx = a.x;
        let bz = a.z;
        for (let i = 0; i < 5; i++) {
          let x = a.x + rng.range(-reach, reach);
          let z = a.z + rng.range(-reach, reach);
          if (g && sp.group > 1 && i < 3) {
            x = lerp(x, g.x, 0.5);
            z = lerp(z, g.z, 0.5);
          }
          if (!this.valley.inBounds(x, z, 12) || this.valley.waterDepth(x, z, env.stage) > 0.15) continue;
          const homePull = Math.hypot(x - a.homeX, z - a.homeZ) / (sp.homeRange * 3);
          const s = this.foodScore(sp, x, z) - Math.hypot(x - a.x, z - a.z) * 0.0015 - homePull * homePull * 0.4;
          if (s > bs) {
            bs = s;
            bx = x;
            bz = z;
          }
        }
        a.beh = B.Forage;
        a.tx = bx;
        a.tz = bz;
        a.tAlt = 0;
        break;
      }
      case B.Rest:
        a.beh = B.Rest;
        a.speed = 0;
        a.tx = a.x;
        a.tz = a.z;
        break;
      case B.Roost: {
        const p = this.valley.findPerch(a.x, a.z, rng.next());
        a.beh = B.Roost;
        if (p) {
          a.tx = p.x;
          a.tz = p.z;
          a.tAlt = p.h;
        } else {
          a.tx = a.x;
          a.tz = a.z;
          a.tAlt = 0;
        }
        break;
      }
      case B.SeekMate:
        a.beh = B.SeekMate;
        a.targetId = mt!.id;
        break;
      case B.SeekCarrion:
        a.beh = B.SeekCarrion;
        a.targetId = carc!.id;
        a.tx = carc!.x;
        a.tz = carc!.z;
        a.tAlt = 0;
        break;
      case B.Stalk:
        a.beh = B.Stalk;
        a.targetId = pr!.id;
        break;
      default:
        if (a.beh !== B.Wander || Math.hypot(a.tx - a.x, a.tz - a.z) < 2) this.startWander(a, sp, 1);
    }
  }

  private suitablePrey(o: Animal, osp: SpeciesDef): boolean {
    if (o.controlled && osp.id !== 'chital') return false;
    if (osp.id === 'hare') return true;
    const mat = maturityDays(osp);
    if (osp.id === 'chital') return o.age < mat * 0.45 || o.health < 0.45;
    return o.age < mat * 0.3;
  }

  private startWander(a: Animal, sp: SpeciesDef, scale: number): void {
    const g = this.groups.get(a.group);
    // anchor between the group's current centroid and the home range centre
    let ax = a.homeX;
    let az = a.homeZ;
    if (g && g.n > 1) {
      const pull = clamp01(Math.hypot(g.x - a.homeX, g.z - a.homeZ) / (sp.homeRange * 1.5));
      ax = lerp(g.x, a.homeX, pull * 0.6);
      az = lerp(g.z, a.homeZ, pull * 0.6);
    }
    const r = (sp.group > 1 ? 28 : sp.homeRange * 0.6) * scale * (sp.flies ? 2.2 : 1);
    a.beh = B.Wander;
    a.tx = clamp(ax + this.rng.range(-r, r), 10, REGION_SIZE - 10);
    a.tz = clamp(az + this.rng.range(-r, r), 10, REGION_SIZE - 10);
    a.tAlt = 0;
  }

  private startFlee(a: Animal, sp: SpeciesDef): void {
    let dx = a.x - a.threatX;
    let dz = a.z - a.threatZ;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    // hares jink; everything else runs straight
    const j = sp.id === 'hare' ? this.rng.range(-0.9, 0.9) : this.rng.range(-0.25, 0.25);
    const c = Math.cos(j);
    const s = Math.sin(j);
    const fx = dx * c - dz * s;
    const fz = dx * s + dz * c;
    a.beh = B.Flee;
    a.tx = clamp(a.x + fx * 70, 8, REGION_SIZE - 8);
    a.tz = clamp(a.z + fz * 70, 8, REGION_SIZE - 8);
    if (sp.flies) {
      const p = this.valley.findPerch(a.tx, a.tz, this.rng.next());
      if (p) {
        a.tx = p.x;
        a.tz = p.z;
        a.tAlt = p.h;
      } else a.tAlt = 9;
    }
  }

  // ------------------------------------------------------------------ actions
  private forageAt(a: Animal, sp: SpeciesDef, dtH: number): number {
    const env = this.env;
    const c = env.cellIndex(a.x, a.z);
    const d = sp.diet;
    const vf = Math.max(0, env.vegFrac(c) - 0.04);
    const wV = d.veg * (vf / (vf + 0.3));
    const wI = d.invert * (env.invert[c]! / (env.invert[c]! + 1.2));
    const wF = d.fauna * (env.fauna[c]! / (env.fauna[c]! + 1));
    const sum = wV + wI + wF;
    if (sum <= 0.001) return 0;
    const g = this.growth(a, sp);
    const want = (sp.intake / sp.feedHours) * dtH * Math.min(1, sum * 1.6) * (0.35 + 0.65 * g);
    let got = 0;
    if (wV > 0) got += env.consume(env.veg, c, (want * wV) / sum, env.cap[c]! * 0.04);
    if (wI > 0) got += env.consume(env.invert, c, (want * wI) / sum, 0.02);
    if (wF > 0) got += env.consume(env.fauna, c, (want * wF) / sum, 0.02);
    a.hunger = Math.max(0, a.hunger - got / (sp.intake * 2 * (0.35 + 0.65 * g)));
    // succulent forage supplies part of the water budget (most of it for hares)
    a.thirst = Math.max(0, a.thirst - (got / (sp.intake * 2)) * sp.foodWater * env.moisture[c]! * 1.5);
    env.addDetritus(a.x, a.z, got * 0.35); // dung
    return sum;
  }

  private drink(a: Animal, kind: 1 | 2, dtH: number): void {
    a.thirst = Math.max(0, a.thirst - 5 * dtH);
    if (kind === 2) a.health -= 0.09 * dtH; // leachate
    a.waterX = a.x;
    a.waterZ = a.z;
  }

  private act(a: Animal, sp: SpeciesDef, dt: number, dtH: number): void {
    const dx = a.tx - a.x;
    const dz = a.tz - a.z;
    const dist = Math.hypot(dx, dz);
    switch (a.beh) {
      case B.Forage: {
        if (dist > 2.5) a.speed = sp.flies && dist > 12 ? sp.run : sp.walk;
        else {
          a.speed = 0;
          if (a.alt < 0.3) {
            const richness = this.forageAt(a, sp, dtH);
            if (a.hunger <= 0.03) {
              a.beh = B.Idle;
              a.timer = 0;
            } else if (richness < 0.18) a.timer = Math.min(a.timer, 0.5), (a.beh = B.Idle);
          }
        }
        break;
      }
      case B.SeekWater: {
        a.speed = sp.flies && dist > 12 ? sp.run : sp.walk * 1.35;
        if (a.alt < 0.3) {
          // probe the ground ahead metre by metre so animals stop and drink at the water's edge
          const reach = Math.min(dist, a.speed * dt) + 1.2;
          const ux = dist > 0.01 ? dx / dist : 0;
          const uz = dist > 0.01 ? dz / dist : 0;
          for (let s = 0; s <= reach; s += 1) {
            const wx = a.x + ux * s;
            const wz = a.z + uz * s;
            if (this.env.waterHere(wx, wz)) {
              const back = Math.max(0, s - 0.6);
              a.x += ux * back;
              a.z += uz * back;
              a.beh = B.Drink;
              a.speed = 0;
              a.tx = wx;
              a.tz = wz;
              break;
            }
          }
          if (a.beh === B.SeekWater && dist < 1.5) {
            // the remembered pool has dried up
            a.waterX = NaN;
            a.waterZ = NaN;
            a.beh = B.Idle;
            a.timer = 0;
          }
        }
        break;
      }
      case B.Drink: {
        a.speed = 0;
        const w = this.env.waterHere(a.tx, a.tz);
        if (!w) {
          a.beh = B.Idle;
          a.timer = 0;
        } else {
          this.drink(a, w, dtH);
          if (a.thirst <= 0.02) {
            a.beh = B.Idle;
            a.timer = 0;
          }
        }
        break;
      }
      case B.Rest:
        a.speed = 0;
        break;
      case B.Roost:
        a.speed = dist > 1 ? sp.run * 0.8 : 0;
        break;
      case B.Flee: {
        a.speed = sp.run * (a.stamina > 0.03 ? 1 : 0.5);
        a.stamina = Math.max(0, a.stamina - dt / sp.sprintS);
        if (dist < 3) {
          if (a.fear > 0.3 && !sp.flies) this.startFlee(a, sp);
          else {
            a.beh = sp.flies ? B.Roost : B.Idle;
            a.speed = 0;
            a.timer = sp.flies ? this.rng.range(4, 10) : 0;
          }
        }
        break;
      }
      case B.Follow: {
        const m = this.byId.get(a.targetId);
        if (!m || !m.alive) {
          a.beh = B.Idle;
          a.timer = 0;
          break;
        }
        a.tx = m.x;
        a.tz = m.z;
        a.tAlt = m.alt > 1 ? m.tAlt : 0;
        const d = Math.hypot(m.x - a.x, m.z - a.z);
        a.speed = d > 25 ? sp.run * 0.8 : d > 3.5 ? Math.max(sp.walk * 1.2, m.speed) : 0;
        break;
      }
      case B.SeekMate: {
        const m = this.byId.get(a.targetId);
        const msp = sp;
        if (!m || !m.alive || !this.receptive(m, msp)) {
          a.beh = B.Idle;
          a.timer = 0;
          break;
        }
        a.tx = m.x;
        a.tz = m.z;
        a.tAlt = m.alt;
        a.speed = sp.flies ? sp.run * 0.7 : sp.walk * 1.5;
        if (Math.hypot(m.x - a.x, m.z - a.z) < 3 + a.speed * dt) {
          if (this.rng.next() < 0.6 * Math.min(1.6, this.fertility[a.sp]!)) m.pregnantH = gestationHours(sp);
          else m.cooldownH = 6;
          a.cooldownH = 4;
          a.beh = B.Idle;
          a.timer = 0;
        }
        break;
      }
      case B.Stalk:
      case B.Chase: {
        const p = this.byId.get(a.targetId);
        if (!p || !p.alive || p.alt > 1) {
          a.beh = B.Idle;
          a.timer = 0;
          break;
        }
        a.tx = p.x;
        a.tz = p.z;
        const d = Math.hypot(p.x - a.x, p.z - a.z);
        if (a.beh === B.Stalk) {
          a.speed = sp.walk * 1.15;
          if (d < 24 || p.beh === B.Flee) a.beh = B.Chase;
          else if (d > sp.vision * 1.3) (a.beh = B.Idle), (a.timer = 0);
        } else {
          a.speed = sp.run;
          a.stamina = Math.max(0, a.stamina - dt / sp.sprintS);
          if (d < 1.8 + a.speed * dt * 0.6) this.attack(a, p);
          else if (a.stamina < 0.04 || d > 95) {
            a.beh = B.Rest;
            a.timer = this.rng.range(15, 30);
            a.speed = 0;
          }
        }
        break;
      }
      case B.SeekCarrion: {
        const c = this.carcasses.find((k) => k.id === a.targetId);
        if (!c) {
          a.beh = B.Idle;
          a.timer = 0;
          break;
        }
        a.speed = sp.flies && dist > 10 ? sp.run : sp.walk * 1.6;
        if (dist < 2.2 && a.alt < 0.4) {
          a.beh = B.Feed;
          a.speed = 0;
        }
        break;
      }
      case B.Feed: {
        a.speed = 0;
        const c = this.carcasses.find((k) => k.id === a.targetId);
        if (!c || c.kg <= 0.02) {
          a.beh = B.Idle;
          a.timer = 0;
          break;
        }
        const g = this.growth(a, sp);
        const bite = Math.min(c.kg, (sp.intake / 1.5) * dtH * (0.35 + 0.65 * g));
        c.kg -= bite;
        // meat is energy dense relative to the mixed diet `intake` is expressed in
        a.hunger = Math.max(0, a.hunger - (bite * 1.6) / (sp.intake * 2 * (0.35 + 0.65 * g)));
        if (a.hunger <= 0.02) {
          a.beh = B.Idle;
          a.timer = 0;
        }
        break;
      }
      default: {
        // Idle / Wander
        a.speed = a.beh === B.Wander && dist > 1.5 ? (sp.flies && dist > 14 ? sp.run * 0.8 : sp.walk * 0.85) : 0;
        if (a.beh === B.Wander && dist <= 1.5) a.beh = B.Idle;
      }
    }
  }

  private attack(pred: Animal, prey: Animal): void {
    const psp = SPECIES[prey.sp]!;
    const mat = maturityDays(psp);
    let p = psp.id === 'hare' ? 0.5 : prey.age < mat * 0.45 ? 0.6 : 0.28;
    // defended young: a nearby adult of the prey species can drive the jackal off
    if (psp.id !== 'hare') {
      let guard = false;
      this.hash.query(prey.x, prey.z, 12, (o) => {
        if (o.sp === prey.sp && o.alive && o.age > mat) guard = true;
      });
      if (guard) {
        p *= psp.id === 'boar' ? 0.25 : 0.6;
        if (psp.id === 'boar' && this.rng.chance(0.3)) pred.health -= 0.15;
      }
    }
    if (this.rng.next() < p) {
      this.kill(prey, 'predation');
      const c = this.carcasses[this.carcasses.length - 1]!;
      pred.beh = B.Feed;
      pred.targetId = c.id;
      pred.speed = 0;
      this.events.emit({ type: 'kill', predator: pred.id, prey: prey.id, sp: prey.sp, x: prey.x, z: prey.z });
    } else {
      prey.fear = 1;
      prey.threatX = pred.x;
      prey.threatZ = pred.z;
      prey.health -= 0.08;
      pred.stamina = 0;
      pred.beh = B.Rest;
      pred.speed = 0;
      pred.timer = this.rng.range(20, 40);
    }
  }

  /** Player-driven animal: intent comes from input, but physiology, perception and food-web effects are unchanged. */
  private actControlled(a: Animal, sp: SpeciesDef, dt: number, dtH: number): void {
    const c = this.control;
    if (c.mx !== 0 || c.mz !== 0) {
      const sprint = c.run && a.stamina > 0.03;
      a.speed = sprint ? sp.run : c.run ? sp.run * 0.5 : sp.walk * 1.6;
      if (sprint) a.stamina = Math.max(0, a.stamina - dt / sp.sprintS);
      a.beh = sprint ? B.Flee : B.Wander;
      a.tx = clamp(a.x + c.mx * 20, 8, REGION_SIZE - 8);
      a.tz = clamp(a.z + c.mz * 20, 8, REGION_SIZE - 8);
      return;
    }
    a.speed = 0;
    a.tx = a.x;
    a.tz = a.z;
    if (c.action === 'eat') {
      a.beh = B.Forage;
      this.forageAt(a, sp, dtH);
    } else if (c.action === 'drink') {
      const w = this.waterNear(a);
      if (w) {
        a.beh = B.Drink;
        this.drink(a, w, dtH);
      } else a.beh = B.Idle;
    } else if (c.action === 'rest') a.beh = B.Rest;
    else if (a.beh !== B.Rest) a.beh = B.Idle;
  }

  /** Water underfoot or within a neck's reach ahead (used for player-controlled drinking and UI prompts). */
  waterNear(a: Animal): 0 | 1 | 2 {
    return this.env.waterHere(a.x, a.z) || this.env.waterHere(a.x + Math.sin(a.heading) * 1.3, a.z + Math.cos(a.heading) * 1.3);
  }

  // ------------------------------------------------------------------ movement
  private passable(sp: SpeciesDef, x: number, z: number): boolean {
    if (x < 6 || z < 6 || x > REGION_SIZE - 6 || z > REGION_SIZE - 6) return false;
    const c = this.env.cellIndex(x, z);
    if ((this.env.settlement[c]! > 0.02 || this.env.dump[c]! > 0.02) && this.valley.blocked(x, z)) return false;
    if (sp.mass < 5 && this.valley.waterDepth(x, z, this.env.stage) > 0.3) return false;
    return true;
  }

  private move(a: Animal, sp: SpeciesDef, dt: number): void {
    a.px = a.x;
    a.pz = a.z;
    a.palt = a.alt;
    const dx = a.tx - a.x;
    const dz = a.tz - a.z;
    const dist = Math.hypot(dx, dz);
    if (sp.flies) {
      // climb when travelling, descend on approach
      const want = a.speed > sp.walk * 1.5 && dist > 9 ? Math.max(a.tAlt, 7 + (a.id % 9)) : dist < 9 ? a.tAlt : a.alt;
      a.alt += clamp(want - a.alt, -6 * dt, 5 * dt);
      if (a.alt < 0.05) a.alt = 0;
    }
    if (a.speed <= 0 || dist < 0.05) return;
    const want = Math.atan2(dx, dz);
    const turn = angleDiff(a.heading, want);
    const maxTurn = (a.alt > 1 ? 2.2 : 4.5) * dt;
    a.heading += clamp(turn, -maxTurn, maxTurn);
    let step = Math.min(a.speed * dt, dist);
    if (a.alt > 1) {
      a.x = clamp(a.x + Math.sin(a.heading) * step, 4, REGION_SIZE - 4);
      a.z = clamp(a.z + Math.cos(a.heading) * step, 4, REGION_SIZE - 4);
      return;
    }
    if (this.valley.waterDepth(a.x, a.z, this.env.stage) > 0.45) step *= 0.4; // wading / swimming
    const tries = [0, 0.7, -0.7, 1.5, -1.5];
    for (let i = 0; i < tries.length; i++) {
      const h = a.heading + tries[i]!;
      const nx = a.x + Math.sin(h) * step;
      const nz = a.z + Math.cos(h) * step;
      if (this.passable(sp, nx, nz)) {
        a.x = nx;
        a.z = nz;
        if (i > 0) a.heading = h;
        return;
      }
    }
    // boxed in: give up on this destination
    if (!a.controlled) {
      a.heading += Math.PI;
      a.timer = 0;
      if (a.beh === B.Wander || a.beh === B.Forage) a.beh = B.Idle;
    }
  }

  // ------------------------------------------------------------------ persistence & verification
  snapshot(): SimSnapshot {
    return {
      version: SAVE_VERSION, seed: this.seed, tick: this.tick, rng: this.rng.state, nextId: this.nextId, env: this.env.snapshot(),
      animals: this.animals.filter((a) => a.alive).map((a) => ({ ...a })), carcasses: this.carcasses.map((c) => ({ ...c })),
      fertility: [...this.fertility], births: [...this.births], deaths: this.deaths.map((r) => [...r]),
      history: this.history.map((h) => ({ ...h, pops: [...h.pops] })), statAcc: this.statAcc, groupAcc: this.groupAcc, rainAcc: this.rainAcc,
      groups: [...this.groups].map(([id, g]) => [id, g.x, g.z, g.n]),
    };
  }

  private restore(s: SimSnapshot): void {
    this.tick = s.tick;
    this.rng.state = s.rng;
    this.nextId = s.nextId;
    this.env.restore(s.env);
    this.animals = s.animals.map((a) => ({ ...a }));
    this.byId.clear();
    for (const a of this.animals) this.byId.set(a.id, a);
    this.carcasses = s.carcasses.map((c) => ({ ...c }));
    this.fertility = [...s.fertility];
    this.births = [...s.births];
    this.deaths = s.deaths.map((r) => [...r]);
    this.history = s.history.map((h) => ({ ...h, pops: [...h.pops] }));
    this.statAcc = s.statAcc;
    this.groupAcc = s.groupAcc;
    this.rainAcc = s.rainAcc;
    this.groups.clear();
    for (const [id, x, z, n] of s.groups) this.groups.set(id, { x, z, n });
  }

  /** Order-sensitive digest of the dynamic state, for reproducibility tests. */
  stateHash(): number {
    const f = new Float32Array(1);
    const u = new Uint32Array(f.buffer);
    let h = 2166136261 >>> 0;
    const mix = (v: number): void => {
      f[0] = v;
      h = Math.imul(h ^ u[0]!, 16777619) >>> 0;
    };
    for (const a of this.animals) {
      mix(a.id); mix(a.x); mix(a.z); mix(a.hunger); mix(a.health); mix(a.beh);
    }
    for (let c = 0; c < this.env.veg.length; c += 7) mix(this.env.veg[c]!);
    mix(this.env.stage);
    mix(this.rng.state);
    return h;
  }
}
