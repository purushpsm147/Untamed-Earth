import { EventBus, Rng, SpatialHash, angleDiff, clamp, clamp01, hash3, lerp } from '@untamed/core';
import { EnvSnapshot, Environment } from '@untamed/environment';
import { CORRIDOR, REGION_SIZE, Valley } from '@untamed/worlds';
import { CLOSED_BOUNDARY, HARE_SETTLE_H, HARE_STRIP, MIGRANT_SPECIES, SECTORS, edgeSigned, emptyMigrationStats, entryPoint, insideLandscape, insideRegion, outwardNormal, sectorOf, type BoundaryConfig, type ExitKind, type MigrationStats } from './boundary';
import { LIFE_COMPRESSION, SPECIES, SPECIES_INDEX, SpeciesDef, SpeciesId, gestationHours, intervalHours, lifeDays, maturityDays, weanDays } from './species';

/**
 * Kinematics run in "kinetic" seconds (what you see at 1x); physiology and the calendar run
 * TIME_SCALE times faster, so a full day passes in 24 real minutes at 1x.
 */
export const TIME_SCALE = 60;
export const SAVE_VERSION = 1;

export const B = {
  Idle: 0, Wander: 1, Forage: 2, SeekWater: 3, Drink: 4, Rest: 5, Flee: 6, SeekMate: 7,
  Stalk: 8, Chase: 9, SeekCarrion: 10, Feed: 11, Roost: 12, Follow: 13, Regroup: 14,
  /** Issue #31: watching an approaching animal; a mother protecting her young; a newborn lying hidden. */
  Alert: 15, Defend: 16, Hide: 17,
} as const;
export const BEHAVIOR_NAMES = ['Idle', 'Wandering', 'Foraging', 'Seeking water', 'Drinking', 'Resting', 'Fleeing', 'Seeking mate',
  'Stalking', 'Chasing', 'Approaching carrion', 'Feeding', 'Roosting', 'Following mother', 'Rejoining the herd',
  'Alert', 'Defending young', 'Hiding'];

export interface Animal {
  id: number;
  /** Boundary transit (issue #29): +1 walking in through the corridor, -1 walking out, 0/absent none. */
  transit?: number;
  /** Lineage (issue #29): 0/absent = valley resident lineage (founders and young of resident-lineage mothers born in the valley); 1 = regional lineage. */
  origin?: number;
  /** Why the current exit started (issue #29 counters). */
  exitKind?: ExitKind;
  /** Game hours on-map since the last entry (newcomer settlement). */
  onH?: number;
  /** A regional-lineage animal that has established residence in the valley (counted once). */
  settled?: boolean;
  /** Off-map (in the regional landscape, coarse simulation). */
  off?: boolean;
  /** Issue #31: id of this mother's most recent offspring (0/absent none). */
  young?: number;
  sp: number;
  x: number; z: number; alt: number;
  px: number; pz: number; palt: number;
  /** Movement mode computed by the simulation each tick (MODE): walk, wade, swim, fly or perched. Renderers read it. */
  mode: number;
  /**
   * Failed-target memory: the last four destinations the animal gave up on as unreachable, and the game hour until
   * which each is avoided (NaN = empty). Bounded (four slots), decays, saved with the animal.
   */
  fail1X: number; fail1Z: number; fail1Until: number;
  fail2X: number; fail2Z: number; fail2Until: number;
  fail3X: number; fail3Z: number; fail3Until: number;
  fail4X: number; fail4Z: number; fail4Until: number;
  heading: number;
  /** Actual speed, m/s (changes within acceleration limits). */
  speed: number;
  /** Speed the current behaviour asks for, m/s. */
  want: number;
  /** Steering memory: last chosen avoidance offset (radians), for hysteresis. */
  steer: number;
  /** Progress check: kinetic seconds since the last check, distance to target at it, consecutive failures. */
  chkT: number;
  chkD: number;
  stuck: number;
  /** Own position and target position at the last progress check. */
  cx: number;
  cz: number;
  ctx: number;
  ctz: number;
  /** Closest the animal has come to its current destination. */
  bestD: number;
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
  | { type: 'birth'; sp: number; id: number; x: number; z: number; n: number }
  | { type: 'death'; sp: number; id: number; cause: DeathCause; x: number; z: number }
  | { type: 'kill'; predator: number; prey: number; sp: number; x: number; z: number }
  | { type: 'alarm'; sp: number; id: number; x: number; z: number };

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
  action: 'eat' | 'drink' | 'rest' | 'defend' | null;
}

/** A held territory: the group that holds it, its centre, and the resident breeders (0 = slot vacant). */
export interface Territory { group: number; sp: number; x: number; z: number; female: number; male: number; sinceH: number }
/** Cumulative territory and dispersal events (diagnostic; saved). */
export interface TerritoryStats { dispersed: number; claimed: number; joined: number; inherited: number; vacated: number }

/** Issue #31: counts of maternal and predator decisions (evidence, not used by the simulation). */
export interface InteractionStats {
  /** A mother started defending her young (chital: reposition and display; boar: charge). */
  defends: number;
  /** A defending sow's charge reached the jackal. */
  chargeContacts: number;
  /** Jackal injuries from charges. */
  jackalInjuries: number;
  /** Hunts a jackal abandoned because a defending mother confronted it. */
  huntsAbandoned: number;
  /** A jackal stopped to watch an approaching large animal; withdrew from an adult boar. */
  alerts: number;
  withdrawals: number;
  /** A hidden newborn bolted (predator too close) instead of staying frozen. */
  hiderBolts: number;
}
export const emptyInteractions = (): InteractionStats => ({ defends: 0, chargeContacts: 0, jackalInjuries: 0, huntsAbandoned: 0, alerts: 0, withdrawals: 0, hiderBolts: 0 });
/**
 * Days a newborn chital lies hidden (a "hider" species) before following its mother: about 10 real days compressed by
 * LIFE_COMPRESSION. Assumed (docs/MATERNAL_BEHAVIOUR.md); the hider strategy itself is documented for chital.
 */
export const CHITAL_HIDE_DAYS = (10 * 48) / 365;
/** A predator takes prey up to this multiple of its own mass when the prey is healthy. */
export const PREY_MASS_RATIO = 2.5;

export interface SimSnapshot {
  version: number;
  seed: number;
  tick: number;
  rng: number;
  /** Weather's own random stream (absent in saves made before it existed). */
  envRng?: number;
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
  eaten?: number[];
  territories?: Territory[];
  territoryStats?: TerritoryStats;
  interactions?: InteractionStats;
  terrAccH?: number;
  boundary?: BoundaryConfig;
  regional?: Animal[];
  migRng?: number;
  migration?: MigrationStats;
  sectorSuit?: number[];
  regAccH?: number;
  founders?: number;
}

const NO_CONTROL: ControlInput = { mx: 0, mz: 0, run: false, action: null };

/** Candidate steering offsets from the goal direction (radians), in tie-break order: straight first, then alternating. */
const STEER_OFFSETS = [0, 0.35, -0.35, 0.8, -0.8, 1.35, -1.35, 2.0, -2.0, 2.7, -2.7];
/** Grades (rise/run) a ground animal will not climb or descend. */
const MAX_UP_GRADE = 0.95;
const MAX_DOWN_GRADE = 1.3;
/** Thirst above which the emergency layer sends an animal to water (thirst saturates ~5 h later, then health drains). */
export const CRITICAL_THIRST = 0.85;

/** Movement modes (Animal.mode). */
export const MODE = { Walk: 0, Wade: 1, Swim: 2, Fly: 3, Perch: 4 } as const;
export const MODE_NAMES = ['walking', 'wading', 'swimming', 'flying', 'perched'];
/** Depth above which an animal must swim: about shoulder height, twice the wade (belly) depth. */
export const swimDepth = (sp: SpeciesDef): number => sp.locomotion.wadeDepth * 2;
/** May this animal be in water deeper than its wade depth right now? */
const maySwim = (sp: SpeciesDef, fleeing: boolean): boolean =>
  sp.locomotion.swim === 'capable' || sp.locomotion.swim === 'strong' || (sp.locomotion.swim === 'escape' && fleeing);
/**
 * Bounded continuous sweep: a ground step is walked in samples of at most SWEEP_M metres, at most SWEEP_SAMPLES_MAX per
 * tick. The longest ground step at any current speed is ~25 m (12.5 m/s at the 2 s tick), so every step is checked at
 * 1 m resolution; only a step longer than 32 m (none today) would be sampled more coarsely. Work per animal is bounded.
 */
const SWEEP_M = 1;
/**
 * The region edge is a wall this far inside the map for every movement mode. Flight used to clamp at 4 m while ground
 * movement refused anything closer than 6 m, so a bird that landed in the 4-6 m strip could not take a single ground
 * step and died there of thirst or hunger (docs/OPEN_BOUNDARY_AUDIT.md, finding B1).
 */
export const EDGE_WALL = 6;
const outsideWall = (x: number, z: number): boolean => x < EDGE_WALL || z < EDGE_WALL || x > REGION_SIZE - EDGE_WALL || z > REGION_SIZE - EDGE_WALL;
/** Inside the transit corridor's outer line (the region plus CORRIDOR m on every side). */
const inCorridor = (x: number, z: number): boolean => x >= -CORRIDOR && z >= -CORRIDOR && x <= REGION_SIZE + CORRIDOR && z <= REGION_SIZE + CORRIDOR;
/** The edge refuses this position for this animal: everyone stops at the wall; only animals in transit may use the corridor. */
const edgeBlocks = (a: Animal | null, x: number, z: number): boolean => outsideWall(x, z) && !(a?.transit && inCorridor(x, z));
const SWEEP_SAMPLES_MAX = 32;
/** A destination given up as unreachable is avoided for this many game hours, within this radius (m). */
export const FAILED_TARGET_HOURS = 6;
export const FAILED_TARGET_RADIUS = 6;
/** Daylight below which a diurnal animal settled on its roost/rest site waits for first light before going to water. */
const DARK = 0.1;

/** Ground locomotion limits from body size: heavier animals accelerate and turn less sharply. */
function locomotion(sp: SpeciesDef): { accel: number; decel: number; agility: number } {
  if (sp.flies) return { accel: 14, decel: 14, agility: 1 };
  const lm = Math.log2(sp.mass);
  const accel = clamp(9 - lm * 0.8, 3.5, 9);
  return { accel, decel: accel * 1.4, agility: clamp(1.6 - Math.log10(sp.mass) * 0.35, 0.8, 1.6) };
}

/**
 * The authoritative world state. Headless: no rendering, DOM or timing dependencies.
 * Deterministic for a given seed and sequence of step(dt) calls and inputs.
 */
export class Simulation {
  readonly valley: Valley;
  readonly env: Environment;
  readonly rng: Rng;
  /**
   * Weather has its own random stream, so the weather of a seed depends only on the seed and time, never on what the
   * animals happened to do (a change to animal behaviour must not turn a clear afternoon into a storm).
   */
  readonly envRng: Rng;
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
  /** Cumulative food eaten per species, kg (forage + pools + carrion): evidence that needs drive consumption. */
  eaten: number[] = SPECIES.map(() => 0);
  history: StatSample[] = [];
  /** Optional detail focus (camera). Animals far from it decide less often. null = uniform detail. */
  focus: { x: number; z: number } | null = null;
  control: ControlInput = NO_CONTROL;
  private statAcc = 0;
  private groupAcc = 0;
  private rainAcc = 0;
  /** Held territories by group id (territorial species only). */
  readonly territories = new Map<number, Territory>();
  territoryStats: TerritoryStats = { dispersed: 0, claimed: 0, joined: 0, inherited: 0, vacated: 0 };
  /** Issue #31 counters: maternal defence and predator decisions. */
  interactions: InteractionStats = emptyInteractions();
  private terrAccH = 0;
  /** Open-boundary configuration (closed unless configureBoundary is called before the first step). */
  boundary: BoundaryConfig = { ...CLOSED_BOUNDARY };
  /** Off-map regional individuals (issue #29): full records, coarse hourly simulation, not rendered, not perceivable. */
  regional: Animal[] = [];
  /** Off-map random stream; exists only when the boundary is open, so the closed valley draws nothing from it. */
  migRng: Rng | null = null;
  migration: MigrationStats | null = null;
  /** Off-map habitat suitability per edge sector (drawn once). */
  sectorSuit: number[] = [];
  /** On-map animals at world creation (conservation bookkeeping). */
  founders = 0;
  private regAccH = 0;
  private readonly exiting: Animal[] = [];
  private dead = false;
  /** 1 for environment cells that touch a building footprint (cheap pre-filter for collision tests). */
  private readonly bldCell: Uint8Array;

  constructor(readonly seed: number, snapshot?: SimSnapshot) {
    this.valley = new Valley(seed);
    this.env = new Environment(this.valley);
    this.rng = new Rng(hash3(seed, 99, 1));
    this.envRng = new Rng(hash3(seed, 99, 2));
    this.bldCell = new Uint8Array(this.env.veg.length);
    for (const b of this.valley.buildings) {
      const r = (b.w + b.d) * 0.5 + 2;
      for (let z = b.z - r; z <= b.z + r; z += 6) for (let x = b.x - r; x <= b.x + r; x += 6) this.bldCell[this.env.cellIndex(x, z)] = 1;
    }
    if (snapshot) this.restore(snapshot);
    else {
      this.populate();
      this.founders = this.animals.length;
      this.updateTerritories();
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
    // never materialise inside a wall: fall back toward the (already validated) home point
    for (let i = 0; i < 4 && this.insideBuilding(x, z); i++) {
      x = lerp(x, homeX, 0.5);
      z = lerp(z, homeZ, 0.5);
    }
    const a: Animal = {
      id: this.nextId++, sp, x, z, alt: 0, px: x, pz: z, palt: 0, mode: MODE.Walk, fail1X: NaN, fail1Z: NaN, fail1Until: NaN, fail2X: NaN, fail2Z: NaN, fail2Until: NaN, fail3X: NaN, fail3Z: NaN, fail3Until: NaN, fail4X: NaN, fail4Z: NaN, fail4Until: NaN, heading: this.rng.range(0, 6.283), speed: 0, want: 0, steer: 0, chkT: 0, chkD: 0, stuck: 0, cx: x, cz: z, ctx: x, ctz: z, bestD: Infinity, age,
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
        a.want = 0;
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
    this.env.step(dtH, this.envRng);
    this.rainAcc += this.env.rain * dtH;
    this.hash.clear();
    const list = this.animals;
    for (let i = 0; i < list.length; i++) this.hash.insert(list[i]!);
    this.groupAcc += dt;
    if (this.groupAcc >= 4) {
      this.groupAcc = 0;
      this.rebuildGroups();
    }
    this.terrAccH += dtH;
    if (this.terrAccH >= 1) {
      this.terrAccH -= 1;
      this.updateTerritories();
    }
    if (this.boundary.open) {
      this.regAccH += dtH;
      if (this.regAccH >= 1) {
        this.regAccH -= 1;
        this.stepRegional();
        this.settleNewcomers();
      }
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
      if (this.boundary.open) this.maybeBeginExit(a, sp, dt);
      this.move(a, sp, dt);
      this.updateMode(a, sp);
      // an exit completes 2.5 m inside the outer line (walking behaviours count arrival within 2 m of their destination)
      if (a.transit === -1 && edgeSigned(a.x, a.z) <= -(CORRIDOR - 2.5)) {
        if (this.boundary.open) this.exiting.push(a);
        else (a.transit = -2), (a.want = 0); // closed valley (corridor tests only): stop at the outer line
      }
    }
    if (this.exiting.length) this.completeExits();
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
      // territorial species do not bud off groups by size: offspring disperse individually (updateTerritories)
      if (e.n > limit && !sp.territory) {
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
    // swimming is effortful (hunger and energy as for sprinting); it is also no place to recover
    const swimming = a.mode === MODE.Swim;
    const sprinting = a.beh === B.Flee || a.beh === B.Chase || swimming;
    const prevAgeH = Math.floor(a.age * 24);
    a.age += dtH / 24;
    a.hunger += dtH * (0.5 / 24) * (sprinting ? 1.6 : resting ? 0.7 : 1) * (a.pregnantH > 0 ? 1.15 : 1);
    a.thirst += (dtH / 34) * (1 + Math.max(0, this.env.temperature - 24) / 18) * (sprinting ? 1.5 : 1);
    a.energy = clamp01(a.energy + (resting && !swimming ? 0.13 : swimming ? -0.15 : -0.045) * dtH);
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

  /**
   * Territorial pair breeding (species with `territory`), run once per game hour. No population cap: how many
   * territories exist follows from space (centres at least `spacing` apart) and from who is alive to hold them.
   *  1. A territory with no living adult member is vacated; a dead breeder leaves its slot vacant.
   *  2. A founder (no recorded mother) fills a vacant slot of its sex in its own group. A natal adult takes a slot
   *     only when both are vacant (inheritance after both parents are gone); while one parent still breeds, the
   *     other slot waits for an outsider, so offspring never pair with a surviving parent (fathers are not
   *     recorded, so this rule is the model's inbreeding avoidance).
   *  3. A non-breeding adult member stays as a helper for `helperYears`, then disperses as a floater.
   *  4. An adult floater joins a territory it is inside if that territory lacks a breeder of its sex; otherwise it
   *     claims where it stands if that is at least `spacing` from every held centre; otherwise it keeps exploring
   *     toward a changing anchor point. Floaters do not breed.
   */
  private updateTerritories(): void {
    const now = this.env.timeH;
    // ---- 1. slots and vacancy ----
    for (const t of this.territories.values()) {
      const f = t.female ? this.byId.get(t.female) : undefined;
      const m = t.male ? this.byId.get(t.male) : undefined;
      if (!f || !f.alive || f.group !== t.group) t.female = 0;
      if (!m || !m.alive || m.group !== t.group) t.male = 0;
    }
    const adults = new Map<number, number>(); // territory group -> living adult members
    const everyone = this.regional.length ? [...this.animals, ...this.regional] : this.animals;
    for (const a of everyone) {
      if (!a.alive) continue;
      const sp = SPECIES[a.sp]!;
      if (!sp.territory || !this.territories.has(a.group) || a.age <= maturityDays(sp)) continue;
      adults.set(a.group, (adults.get(a.group) ?? 0) + 1);
    }
    for (const t of [...this.territories.values()]) {
      if (!adults.has(t.group)) {
        this.territories.delete(t.group);
        this.territoryStats.vacated++;
      }
    }
    // ---- 2-4. per animal, in id order of the animal list (deterministic) ----
    for (const a of everyone) {
      if (!a.alive || a.controlled) continue;
      const off = !!a.off;
      const sp = SPECIES[a.sp]!;
      const terr = sp.territory;
      if (!terr) continue;
      const mat = maturityDays(sp);
      const t = this.territories.get(a.group);
      if (t) {
        a.homeX = t.x;
        a.homeZ = t.z;
        if (a.age <= mat) continue;
        if (t.female === a.id || t.male === a.id) continue;
        const mySlotFree = a.sex === 0 ? t.female === 0 : t.male === 0;
        const founder = a.mother === 0;
        if (mySlotFree && (founder || (t.female === 0 && t.male === 0))) {
          if (a.sex === 0) t.female = a.id;
          else t.male = a.id;
          if (!founder) this.territoryStats.inherited++;
          continue;
        }
        // helper: disperse after the helper period
        if (a.age > mat + (terr.helperYears * 365) / LIFE_COMPRESSION) {
          a.group = this.nextId++;
          [a.homeX, a.homeZ] = this.anchor(a);
          this.territoryStats.dispersed++;
        }
        continue;
      }
      if (a.age <= mat) continue;
      // ---- floater ----
      let inside: Territory | null = null;
      let clear = true;
      for (const o of this.territories.values()) {
        if (o.sp !== a.sp) continue;
        const d = Math.hypot(o.x - a.x, o.z - a.z);
        if (d < terr.spacing) clear = false;
        if (d < terr.spacing * 0.5 && (a.sex === 0 ? o.female === 0 : o.male === 0) && !inside && o.female !== a.mother) inside = o;
      }
      if (inside) {
        a.group = inside.group;
        if (a.sex === 0) inside.female = a.id;
        else inside.male = a.id;
        a.homeX = inside.x;
        a.homeZ = inside.z;
        this.territoryStats.joined++;
        if (!off && a.origin === 1 && !a.settled && insideRegion(inside.x, inside.z)) this.markSettled(a);
      } else if (clear && (off ? this.regionalClaimOk(a, terr.spacing) : this.valley.inBounds(a.x, a.z, 60) && this.valley.waterDepth(a.x, a.z, this.env.stage) < -0.3 && !this.insideBuilding(a.x, a.z, 2))) {
        const nt: Territory = { group: a.group, sp: a.sp, x: a.x, z: a.z, female: a.sex === 0 ? a.id : 0, male: a.sex === 1 ? a.id : 0, sinceH: now };
        this.territories.set(a.group, nt);
        a.homeX = a.x;
        a.homeZ = a.z;
        this.territoryStats.claimed++;
        if (!off && a.origin === 1 && !a.settled) this.markSettled(a);
      } else if (Math.hypot(a.homeX - a.x, a.homeZ - a.z) < 80 || this.rngFor(a).chance(1 / 24)) {
        // keep exploring: a new anchor somewhere in the region (the regional landscape when the boundary is open)
        [a.homeX, a.homeZ] = this.anchor(a);
      }
    }
  }

  private seasonOk(sp: SpeciesDef): boolean {
    return sp.breedSeasons === null || sp.breedSeasons.includes(this.env.season);
  }
  private receptive(a: Animal, sp: SpeciesDef): boolean {
    if (sp.territory) {
      // only the resident female of a held territory breeds, and only with a resident male present
      const t = this.territories.get(a.group);
      if (!t || t.female !== a.id || t.male === 0) return false;
    } else if (sp.pairBreeding && a.sex === 0) {
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
      if (m.origin) c.origin = m.origin;
      m.young = c.id;
      c.waterX = m.waterX;
      c.waterZ = m.waterZ;
      c.alt = m.alt;
    }
    if (n > 0) {
      this.births[m.sp] = this.births[m.sp]! + n;
      this.events.emit({ type: 'birth', sp: m.sp, id: m.id, x: m.x, z: m.z, n });
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
  /** Head for known or nearby water; with no idea where water is, range further afield. */
  private decideWater(a: Animal, sp: SpeciesDef, vis: number): void {
    const env = this.env;
    let wx = a.waterX;
    let wz = a.waterZ;
    if (!Number.isNaN(wx) && this.recentlyFailed(a, wx, wz)) wx = wz = a.waterX = a.waterZ = NaN;
    if (Number.isNaN(wx) || this.rng.chance(0.15)) {
      // look for water within sensory range; otherwise fall back on the group's traditional knowledge (skipping sites
      // recently given up on as unreachable)
      this.deciding = a;
      const site = env.findWater(a.x, a.z, Math.max(vis * 1.5, 140), this.waterFor) ?? (a.thirst > 0.55 ? env.findWater(a.x, a.z, sp.homeRange * 2.5 + 250, this.waterFor) : null);
      this.deciding = null;
      if (site) {
        wx = a.waterX = site.x;
        wz = a.waterZ = site.z;
      }
    }
    if (Number.isNaN(wx)) {
      this.startWander(a, sp, 2.5);
    } else {
      a.beh = B.SeekWater;
      a.tx = wx;
      a.tz = wz;
      a.tAlt = 0;
      // a bird lands at the water's edge (no deeper than it can stand in), never in the channel: walk back from the
      // water point toward the bird to the first point shallow enough (bounded: at most 60 one-metre samples)
      if (sp.flies) {
        const p = this.nearestStandable(sp, wx, wz, a.x - wx, a.z - wz);
        if (p) {
          a.tx = p.x;
          a.tz = p.z;
        }
      }
    }
  }

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
    if (a.transit && a.beh !== B.Flee && a.beh !== B.Chase) return this.updateTransit(a);
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
    // issue #31: a predator watches large animals near it; a mother watches predators near her young
    const isPredator = sp.prey.length > 0;
    let big: Animal | null = null;
    let bigD2 = 25 * 25;
    const myYoung = this.dependentYoung(a);
    let danger: Animal | null = null;
    let dangerD2 = 1e18;
    this.hash.query(a.x, a.z, R, (o, d2) => {
      if (o === a || !o.alive) return;
      const osp = SPECIES[o.sp]!;
      if (isPredator && o.sp !== a.sp && d2 < bigD2 && o.alt < 1 && osp.mass * this.growth(o, osp) > sp.mass * PREY_MASS_RATIO) {
        big = o;
        bigD2 = d2;
      }
      if (myYoung && sp.predators.includes(osp.id) && o.alt < 2 && o.age > maturityDays(osp) * 0.5) {
        // a predator near her young (she knows where they are) or near her, within her senses
        const dy = Math.hypot(o.x - myYoung.x, o.z - myYoung.z);
        if (dy < 30 && dy * dy < dangerD2 && (d2 < vis * vis || d2 < sp.hearing * sp.hearing)) {
          danger = o;
          dangerD2 = dy * dy;
        }
      }
      if (o.sp === a.sp) {
        if (d2 < 3600) crowd++;
        if (a.sex === 1 && adult && d2 < mateD2 && (!sp.territory || this.territories.get(o.group)?.male === a.id) && this.receptive(o, osp)) {
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
        // many eyes: each herd mate nearby adds a chance that someone spots the predator (group vigilance)
        if (p > 0 && p < 1 && sp.group > 1) p = 1 - Math.pow(1 - p, 1 + 0.25 * Math.min(a.crowd, 8));
        if (p > 0 && d2 < threatD2 && rng.next() < p) {
          threat = o;
          threatD2 = d2;
        }
      } else if (hunter && d2 < preyD2 && o.alt < 1 && sp.prey.includes(osp.id) && this.preyValue(a, sp, o, osp) > 0 && this.detectable(a, o, d2)) {
        prey = o;
        preyD2 = d2;
      }
    });
    a.crowd = crowd;
    // narrowing helpers (closures above defeat control-flow analysis)
    const th = threat as Animal | null;
    const al = alarm as Animal | null;
    const bg = big as Animal | null;
    const dn = danger as Animal | null;
    const mt = mate as Animal | null;
    const pr = prey as Animal | null;

    if (th) {
      const d = Math.sqrt(threatD2);
      const urgency = clamp01(1.4 - d / sp.fleeDist) * (th.beh === B.Chase || th.beh === B.Stalk ? 1.3 : 0.8);
      if (urgency > a.fear) {
        if (a.fear < 0.4 && urgency >= 0.4) this.events.emit({ type: 'alarm', sp: a.sp, id: a.id, x: a.x, z: a.z });
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

    // ---- water it should not be in (rising flood, or a non-swimmer that got there): make for the shallowest ground ----
    if (a.alt < 0.3) {
      const here = this.valley.waterDepth(a.x, a.z, env.stage);
      // (a flyer tolerates up to twice its standing depth before leaving, so a small rise at the edge does not flush it)
      if (here > sp.locomotion.wadeDepth * (sp.flies ? 2 : 1) && !maySwim(sp, false)) {
        let bd = here;
        for (let k = 0; k < 8; k++) {
          const ang = (k / 8) * 6.283;
          for (const r of [8, 20]) {
            const x = a.x + Math.sin(ang) * r;
            const z = a.z + Math.cos(ang) * r;
            const d = this.valley.waterDepth(x, z, env.stage);
            if (d < bd && this.valley.inBounds(x, z, 8)) {
              bd = d;
              a.tx = x;
              a.tz = z;
            }
          }
        }
        if (bd < here) {
          a.beh = B.Flee;
          a.fear = Math.max(a.fear, 0.35);
          a.timer = 1;
          return;
        }
      }
    }

    // ---- issue #31: a mother protecting her young ----
    if (dn && myYoung && this.maternalResponse(a, sp, myYoung, dn, Math.sqrt(threatD2))) return;
    // ---- issue #31: a newborn hider stays frozen unless the predator is almost on it ----
    const hiderNow = sp.id === 'chital' && a.mother !== 0 && a.age < CHITAL_HIDE_DAYS && !!this.byId.get(a.mother)?.alive;
    // (the threat may be one it saw itself, or the one its mother's alarm pointed to)
    if (hiderNow && a.fear > 0.4 && Math.hypot(a.threatX - a.x, a.threatZ - a.z) > 5) {
      a.beh = B.Hide;
      a.want = 0;
      a.tx = a.x;
      a.tz = a.z;
      a.timer = 1;
      return;
    }
    if (hiderNow && a.fear > 0.4 && a.beh === B.Hide) this.interactions.hiderBolts++;
    // ---- flee overrides everything ----
    if (a.fear > 0.4) {
      a.timer = 1;
      this.startFlee(a, sp);
      return;
    }
    // ---- issue #31: a predator not busy hunting reacts to a large animal near it ----
    if (bg && isPredator && a.beh !== B.Stalk && a.beh !== B.Chase && a.beh !== B.Feed && !a.controlled) {
      const bsp = SPECIES[bg.sp]!;
      const d = Math.sqrt(bigD2);
      if (bsp.id === 'boar' && d < 12) {
        // an adult boar is dangerous at close range: withdraw
        a.fear = 0.6;
        a.threatX = bg.x;
        a.threatZ = bg.z;
        this.interactions.withdrawals++;
        a.timer = 1;
        this.startFlee(a, sp);
        return;
      }
      const closing = ((bg.x - bg.px) * (a.x - bg.x) + (bg.z - bg.pz) * (a.z - bg.z)) / (d || 1) > 0.02;
      if (closing || a.beh === B.Alert) {
        if (a.beh !== B.Alert) this.interactions.alerts++;
        a.beh = B.Alert;
        a.targetId = bg.id;
        a.want = 0;
        a.tx = a.x;
        a.tz = a.z;
        a.timer = rng.range(1.5, 3);
        return;
      }
    }
    // dependent young shadow the mother (they are provisioned: their thirst and hunger track hers)
    const mother = a.mother !== 0 && a.age < weanDays(sp) ? this.byId.get(a.mother) : undefined;
    const dependent = mother !== undefined && mother.alive;

    // ---- physiological emergency layer (docs/ECOLOGICAL_STABILITY_REPORT.md, "Behavioural priority policy") ----
    // Order: flood escape > flee > emergency > committed actions > dependent young > utilities.
    // Critical thirst (> CRITICAL_THIRST) interrupts feeding, chasing, stalking, resting, mating and regrouping and
    // sends the animal to water; drinking itself is never interrupted, and escape (above) still wins. The one deferral
    // is activity-pattern based, not species based: a diurnal animal already settled on its roost/rest site in darkness
    // stays there until first light (thirst saturates ~5 h after the threshold and then drains health at 0.02/h, so a
    // night's wait costs at most ~0.1 health; an animal already near death can still die, which is honest). A diurnal
    // animal that is up and moving at night anyway (e.g. after a disturbance) goes to water rather than to food.
    const restingInDark = sp.activity === 'diurnal' && env.daylight() < DARK && (a.beh === B.Roost || a.beh === B.Rest);
    if (!dependent && a.thirst > CRITICAL_THIRST && a.beh !== B.Drink && !restingInDark) {
      if (a.beh === B.SeekWater) return; // committed to the journey
      this.decideWater(a, sp, vis);
      return;
    }

    // committed actions are not interrupted by the periodic re-evaluation
    if (a.beh === B.Chase || a.beh === B.Drink) return;
    if (a.beh === B.Feed && a.hunger > 0.05) return;

    if (dependent) {
      const dm = Math.hypot(mother.x - a.x, mother.z - a.z);
      if (hiderNow) {
        // a newborn hider lies hidden where the mother left it; it moves only with her right beside it, walking
        if (dm < 6 && mother.beh !== B.Rest && mother.beh !== B.Flee) {
          a.beh = B.Follow;
          a.targetId = mother.id;
        } else {
          a.beh = B.Hide;
          a.want = 0;
          a.tx = a.x;
          a.tz = a.z;
        }
        return;
      }
      // a mobile young animal settles beside a resting mother when nothing worries it, and follows when she moves
      if (mother.beh === B.Rest && mother.speed < 0.1 && dm < 10 && a.fear < 0.2 && a.hunger < 0.8 && a.thirst < 0.8) {
        a.beh = B.Rest;
        a.want = 0;
        a.tx = a.x;
        a.tz = a.z;
        return;
      }
      a.beh = B.Follow;
      a.targetId = mother.id;
      return;
    }
    // ---- issue #31: a mother returns to a newborn hidden far away (to nurse and guard it) ----
    const hid = myYoung && sp.id === 'chital' && myYoung.age < CHITAL_HIDE_DAYS ? myYoung : null;
    if (hid && Math.hypot(hid.x - a.x, hid.z - a.z) > 100 && a.thirst < CRITICAL_THIRST) {
      a.beh = B.Wander;
      a.tx = hid.x;
      a.tz = hid.z;
      a.want = sp.walk;
      return;
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
    // ordinary (non-critical) thirst competes with the other needs; critical thirst is handled by the emergency layer
    if (a.thirst > 0.3) consider(B.SeekWater, Math.pow(a.thirst, 1.4) * 1.25);
    if (a.hunger > 0.22) consider(B.Forage, Math.pow(a.hunger, 1.15) * (0.55 + 0.45 * act));
    consider(sp.flies ? B.Roost : B.Rest, Math.pow(1 - a.energy, 1.4) * 1.1 + (1 - act) * 0.42);
    if (mt) consider(B.SeekMate, 0.5);
    // herd cohesion: an animal that has drifted far from its group wants to rejoin it
    // (ground herds only: flocking birds gather at roosts instead)
    const grp = sp.group > 2 && !sp.flies ? this.groups.get(a.group) : undefined;
    if (grp && grp.n > 1) {
      const dg = Math.hypot(grp.x - a.x, grp.z - a.z);
      if (dg > 30 && !this.recentlyFailed(a, grp.x, grp.z)) consider(B.Regroup, clamp((dg - 30) / 60, 0, 0.55) + 0.12);
    }
    let carc: Carcass | null = null;
    if (sp.diet.carrion > 0 && a.hunger > 0.25 && this.carcasses.length > 0) {
      const reach = sp.smell * (a.alt > 2 || !sp.flies ? 1 : 0.5);
      let bd = reach * reach;
      const reachDepth = maySwim(sp, false) ? Infinity : sp.locomotion.wadeDepth;
      for (const c of this.carcasses) {
        const d2 = (c.x - a.x) ** 2 + (c.z - a.z) ** 2;
        // food lying in water the animal may not enter is out of reach, not a target
        if (d2 < bd && c.kg > 0.05 && this.valley.waterDepth(c.x, c.z, env.stage) <= reachDepth && !this.recentlyFailed(a, c.x, c.z)) {
          bd = d2;
          carc = c;
        }
      }
      if (carc) consider(B.SeekCarrion, a.hunger * 1.3 * sp.diet.carrion + 0.15);
    }
    if (pr) consider(B.Stalk, a.hunger * 1.35 * (0.6 + 0.4 * act) * this.preyValue(a, sp, pr, SPECIES[pr.sp]!));

    if (best === a.beh && (best === B.Forage || best === B.Rest || best === B.Roost || best === B.SeekWater || best === B.Stalk || best === B.Regroup)) {
      if (best === B.Stalk && pr) a.targetId = pr.id;
      return;
    }
    switch (best) {
      case B.SeekWater:
        this.decideWater(a, sp, vis);
        break;
      case B.Forage: {
        // compare a handful of patches within sensory range; no global knowledge of the map
        const g = this.groups.get(a.group);
        const reach = Math.min(Math.max(vis, 25), 70);
        // a bird perched on a roof must not choose to "forage right here": that would land it inside the walls
        const onRoof = this.insideBuilding(a.x, a.z, 1);
        // nor graze where it stands if that is in water deeper than the patches it would consider elsewhere
        // feeding in shallow water is fine, but never deeper than the animal can stand in (0.15 m for the mammals)
        const feedDepth = Math.min(0.15, sp.locomotion.wadeDepth);
        const hereInvalid = onRoof || this.valley.waterDepth(a.x, a.z, env.stage) > feedDepth;
        let bs = hereInvalid ? -1e9 : this.foodScore(sp, a.x, a.z) * 1.1;
        let bx = a.x;
        let bz = a.z;
        for (let i = 0; i < 5; i++) {
          let x = a.x + rng.range(-reach, reach);
          let z = a.z + rng.range(-reach, reach);
          if (g && sp.group > 1 && i < 3) {
            x = lerp(x, g.x, 0.5);
            z = lerp(z, g.z, 0.5);
          }
          if (!this.valley.inBounds(x, z, 12) || this.valley.waterDepth(x, z, env.stage) > feedDepth || this.insideBuilding(x, z, 1) || this.recentlyFailed(a, x, z)) continue;
          const homePull = Math.hypot(x - a.homeX, z - a.homeZ) / (sp.homeRange * 3);
          const s = this.foodScore(sp, x, z) - Math.hypot(x - a.x, z - a.z) * 0.0015 - homePull * homePull * 0.4;
          if (s > bs) {
            bs = s;
            bx = x;
            bz = z;
          }
        }
        if (hereInvalid && bx === a.x && bz === a.z) {
          this.startWander(a, sp, 1);
          break;
        }
        a.beh = B.Forage;
        a.tx = bx;
        a.tz = bz;
        a.tAlt = 0;
        break;
      }
      case B.Rest: {
        a.beh = B.Rest;
        a.want = 0;
        a.tx = a.x;
        a.tz = a.z;
        // ground animals do not lie down in water (wallowing species may in shallow water): from a wet spot walk to
        // dry, open ground first; failing that, to the shallowest spot found. Fixed search order: deterministic.
        const restDepth = sp.locomotion.wallows ? sp.locomotion.wadeDepth : -0.1;
        let here = this.valley.waterDepth(a.x, a.z, this.env.stage);
        if (!sp.flies && here > restDepth) {
          search: for (const r of [3, 6, 10, 20, 35]) {
            for (let k = 0; k < 8; k++) {
              const ang = a.heading + Math.PI + (k * Math.PI) / 4;
              const x = a.x + Math.sin(ang) * r;
              const z = a.z + Math.cos(ang) * r;
              if (this.insideBuilding(x, z, 1) || !this.valley.inBounds(x, z, 8) || this.recentlyFailed(a, x, z)) continue;
              const d = this.valley.waterDepth(x, z, this.env.stage);
              if (d < -0.2) {
                a.tx = x;
                a.tz = z;
                break search;
              }
              if (d < here) {
                here = d;
                a.tx = x;
                a.tz = z;
              }
            }
          }
        }
        break;
      }
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
      case B.Regroup:
        a.beh = B.Regroup;
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

  /**
   * Issue #31: how worthwhile prey o is to predator a (0 = not a target), from what the predator can perceive: body size
   * against its own (healthy prey up to PREY_MASS_RATIO x its mass; weak chital of any size), the prey's health, and
   * whether the prey's mother is close by (a mother near her young makes it a poorer prospect, a boar sow much more so;
   * young far from the mother are easier). Hares are always prey. Replaces the earlier fixed fractions of maturity age.
   */
  preyValue(a: Animal, sp: SpeciesDef, o: Animal, osp: SpeciesDef): number {
    if (o.controlled && osp.id !== 'chital') return 0;
    if (osp.id === 'hare') return 1;
    const mass = osp.mass * this.growth(o, osp);
    const weak = o.health < 0.45;
    const limit = sp.mass * PREY_MASS_RATIO;
    if (mass > limit && !(weak && osp.id === 'chital')) return 0;
    let v = weak ? 0.9 : 1 - 0.5 * Math.min(1, mass / limit);
    const m = o.mother !== 0 && o.age < weanDays(osp) ? this.byId.get(o.mother) : undefined;
    if (m && m.alive && !m.off) {
      const dm = Math.hypot(m.x - o.x, m.z - o.z);
      if (dm < 25) v *= osp.id === 'boar' ? 0.15 : 0.6;
      else v = Math.min(1, v * 1.25);
    }
    return v;
  }

  /** A newborn lying hidden is found only at close range (by scent or by nearly stepping on it). */
  private detectable(a: Animal, o: Animal, d2: number): boolean {
    if (o.beh !== B.Hide) return true;
    return d2 < 10 * 10;
  }

  /** This animal's youngest living dependent offspring, if any (mothers only; on-map). */
  private dependentYoung(a: Animal): Animal | null {
    if (!a.young || a.sex !== 0) return null;
    const y = this.byId.get(a.young);
    if (!y || !y.alive || y.off || y.age >= weanDays(SPECIES[y.sp]!)) return null;
    return y;
  }

  /**
   * Issue #31: a mother that perceives a predator near her young chooses a response. Returns true when it set behaviour.
   *  - boar sow: defends by charging the predator (Defend), unless she is badly hurt;
   *  - chital mother: the alarm (fear relayed to the young), then either stands between young and predator and displays
   *    (Defend) or, if the predator is on top of her or she is weak, escapes. Protection does not guarantee survival.
   */
  private maternalResponse(a: Animal, sp: SpeciesDef, young: Animal, pred: Animal, predToMe: number): boolean {
    const dMe = Math.hypot(pred.x - a.x, pred.z - a.z);
    void predToMe;
    // alert the young: a fear signal they act on by their own rules (a hider freezes, a mobile young flees to her)
    if (young.fear < 0.6) {
      young.fear = 0.6;
      young.threatX = pred.x;
      young.threatZ = pred.z;
      young.timer = Math.min(young.timer, 0.3);
    }
    if (a.beh !== B.Defend) this.events.emit({ type: 'alarm', sp: a.sp, id: a.id, x: a.x, z: a.z });
    const healthy = a.health > 0.5 && a.stamina > 0.15;
    if (sp.id === 'boar' ? healthy : healthy && dMe > 5) {
      if (a.beh !== B.Defend) this.interactions.defends++;
      a.beh = B.Defend;
      a.targetId = pred.id;
      a.fear = Math.min(a.fear, 0.3);
      a.timer = 1;
      return true;
    }
    return false; // falls through to the ordinary fear/flee response
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
    const rx = ax + this.rng.range(-r, r);
    const rz = az + this.rng.range(-r, r);
    a.tx = clamp(rx, 10, REGION_SIZE - 10);
    a.tz = clamp(rz, 10, REGION_SIZE - 10);
    // open boundary: a migrant whose home lies beyond the edge (or a disperser heading out) keeps a destination outside
    if (this.boundary.open && this.isMigrant(sp) && !a.controlled && !insideRegion(rx, rz)) {
      a.tx = rx;
      a.tz = rz;
    }
    // avoid a spot recently given up on (at most 3 redraws; extra random draws happen only when one is remembered)
    for (let k = 0; k < 3 && this.recentlyFailed(a, a.tx, a.tz); k++) {
      a.tx = clamp(ax + this.rng.range(-r, r), 10, REGION_SIZE - 10);
      a.tz = clamp(az + this.rng.range(-r, r), 10, REGION_SIZE - 10);
    }
    if (this.insideBuilding(a.tx, a.tz, 1)) {
      a.tx = a.x;
      a.tz = a.z;
    }
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
    let fx = dx * c - dz * s;
    let fz = dx * s + dz * c;
    // issue #31: a dependent young animal runs to its mother unless she lies toward the threat
    const mom = a.mother !== 0 && a.age < weanDays(sp) ? this.byId.get(a.mother) : undefined;
    if (mom && mom.alive && !mom.off) {
      const mx = mom.x - a.x;
      const mz = mom.z - a.z;
      const ml = Math.hypot(mx, mz);
      if (ml > 2 && (mx * dx + mz * dz) / ml > -0.3) {
        fx = fx * 0.4 + (mx / ml) * 0.6;
        fz = fz * 0.4 + (mz / ml) * 0.6;
        const fl = Math.hypot(fx, fz) || 1;
        fx /= fl;
        fz /= fl;
      }
    }
    // herd animals flee as a herd: bend the escape toward the group unless the group lies toward the threat
    const g = sp.group > 2 && !sp.flies ? this.groups.get(a.group) : undefined;
    if (g && g.n > 1) {
      const gx = g.x - a.x;
      const gz = g.z - a.z;
      const gl = Math.hypot(gx, gz);
      if (gl > 4 && (gx * dx + gz * dz) / gl > -0.2) {
        fx = fx * 0.75 + (gx / gl) * 0.25;
        fz = fz * 0.75 + (gz / gl) * 0.25;
        const fl = Math.hypot(fx, fz) || 1;
        fx /= fl;
        fz /= fl;
      }
    }
    a.beh = B.Flee;
    a.tx = clamp(a.x + fx * 70, 8, REGION_SIZE - 8);
    a.tz = clamp(a.z + fz * 70, 8, REGION_SIZE - 8);
    if (this.boundary.open && this.boundary.fleeExit && this.isMigrant(sp) && !a.controlled && !insideRegion(a.x + fx * 70, a.z + fz * 70)) {
      a.tx = a.x + fx * 70;
      a.tz = a.z + fz * 70;
    }
    if (a.transit === -1) this.aimOut(a); // already in the corridor: keep running out
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
    this.eaten[a.sp] = this.eaten[a.sp]! + got;
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
        if (dist > 2.5) a.want = sp.flies && dist > 12 ? sp.run : sp.walk;
        else {
          a.want = 0;
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
        a.want = sp.flies && dist > 12 ? sp.run : sp.walk * 1.35;
        if (a.alt < 0.3) {
          // probe the ground ahead metre by metre so animals stop and drink at the water's edge
          const reach = Math.min(dist, a.speed * dt) + 1.2;
          // at the edge target, look toward the remembered water itself
          const pdx = dist < 1.5 && !Number.isNaN(a.waterX) ? a.waterX - a.x : dx;
          const pdz = dist < 1.5 && !Number.isNaN(a.waterX) ? a.waterZ - a.z : dz;
          const pd = Math.hypot(pdx, pdz);
          const ux = pd > 0.01 ? pdx / pd : 0;
          const uz = pd > 0.01 ? pdz / pd : 0;
          for (let s = 0; s <= reach; s += 1) {
            const wx = a.x + ux * s;
            const wz = a.z + uz * s;
            if (this.env.waterHere(wx, wz)) {
              // stop at the edge: just short of the water, and never where it is deeper than the animal can stand
              let back = Math.max(0, s - 0.6);
              while (back > 0 && this.valley.waterDepth(a.x + ux * back, a.z + uz * back, this.env.stage) > sp.locomotion.wadeDepth) back = Math.max(0, back - 0.25);
              a.x += ux * back;
              a.z += uz * back;
              a.beh = B.Drink;
              a.want = 0;
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
        a.want = 0;
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
      case B.Rest: {
        // walk to the chosen dry spot (if any), then settle
        a.want = Math.hypot(a.tx - a.x, a.tz - a.z) > 0.6 ? sp.walk : 0;
        // a young animal resting beside its mother wakes as soon as she gets up and moves off
        const m = a.mother !== 0 && a.age < weanDays(sp) ? this.byId.get(a.mother) : undefined;
        if (m && m.alive && (m.beh !== B.Rest || Math.hypot(m.x - a.x, m.z - a.z) > 12)) a.timer = 0;
        break;
      }
      case B.Hide:
        a.want = 0;
        break;
      case B.Alert: {
        // stand and face the animal being watched
        const o = this.byId.get(a.targetId);
        a.want = 0;
        if (o && o.alive) a.heading += clamp(angleDiff(a.heading, Math.atan2(o.x - a.x, o.z - a.z)), -dt * 3, dt * 3);
        else a.timer = 0;
        break;
      }
      case B.Defend:
        this.actDefend(a, sp, dt);
        break;
      case B.Roost:
        a.want = dist > 1 ? sp.run * 0.8 : 0;
        break;
      case B.Flee: {
        a.want = sp.run * (a.stamina > 0.03 ? 1 : 0.5);
        a.stamina = Math.max(0, a.stamina - dt / sp.sprintS);
        if (dist < 3) {
          if (a.fear > 0.3 && !sp.flies) this.startFlee(a, sp);
          else if (sp.group > 2 && !sp.flies && !a.controlled) {
            // danger over: a herd animal rejoins its herd instead of grazing wherever the flight ended
            a.beh = B.Regroup;
            a.timer = this.rng.range(1, 3);
          } else {
            a.beh = sp.flies ? B.Roost : B.Idle;
            a.want = 0;
            a.timer = sp.flies ? this.rng.range(4, 10) : 0;
          }
        }
        break;
      }
      case B.Regroup: {
        const g = this.groups.get(a.group);
        if (!g || g.n < 2) {
          a.beh = B.Idle;
          a.timer = 0;
          break;
        }
        // head for the herd, aiming at a point on its near side rather than its exact centre
        const dgx = g.x - a.x;
        const dgz = g.z - a.z;
        const dg = Math.hypot(dgx, dgz) || 1;
        // each individual aims at its own spot along the herd's near edge (up to 4 m to either side, fixed by its
        // id), so animals coming from the same direction do not converge on a single point
        const side = (((a.id * 0.618034) % 1) - 0.5) * 8;
        a.tx = g.x - (dgx / dg) * 5 + (dgz / dg) * side;
        a.tz = g.z - (dgz / dg) * 5 - (dgx / dg) * side;
        a.want = dg > 45 ? sp.walk * 2.4 : sp.walk * 1.4;
        if (dg < 12) {
          a.beh = B.Idle;
          a.timer = 0;
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
        a.want = d > 25 ? sp.run * 0.8 : d > 3.5 ? Math.max(sp.walk * 1.2, m.speed) : 0;
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
        a.want = sp.flies ? sp.run * 0.7 : sp.walk * 1.5;
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
        // issue #31: a defending mother confronting the predator: give up (always against a sow; against a chital mother
        // unless very hungry)
        const pm = p.mother !== 0 ? this.byId.get(p.mother) : undefined;
        if (pm && pm.alive && pm.beh === B.Defend && pm.targetId === a.id) {
          const msp = SPECIES[pm.sp]!;
          const near = Math.hypot(pm.x - a.x, pm.z - a.z) < (msp.id === 'boar' ? 15 : 6);
          if (near && (msp.id === 'boar' || a.hunger < 0.85)) {
            this.interactions.huntsAbandoned++;
            a.fear = msp.id === 'boar' ? 0.6 : 0.45;
            a.threatX = pm.x;
            a.threatZ = pm.z;
            this.startFlee(a, sp);
            a.timer = 1;
            break;
          }
        }
        if (a.beh === B.Stalk) {
          a.want = sp.walk * 1.15;
          if (d < 24 || p.beh === B.Flee) a.beh = B.Chase;
          else if (d > sp.vision * 1.3) (a.beh = B.Idle), (a.timer = 0);
        } else {
          a.want = sp.run;
          a.stamina = Math.max(0, a.stamina - dt / sp.sprintS);
          if (d < 1.8 + a.speed * dt * 0.6) this.attack(a, p);
          else if (a.stamina < 0.04 || d > 95) {
            a.beh = B.Rest;
            a.timer = this.rng.range(15, 30);
            a.want = 0;
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
        a.want = sp.flies && dist > 10 ? sp.run : sp.walk * 1.6;
        if (dist < 2.2 && a.alt < 0.4) {
          a.beh = B.Feed;
          a.want = 0;
        }
        break;
      }
      case B.Feed: {
        a.want = 0;
        const c = this.carcasses.find((k) => k.id === a.targetId);
        if (!c || c.kg <= 0.02) {
          a.beh = B.Idle;
          a.timer = 0;
          break;
        }
        const g = this.growth(a, sp);
        const bite = Math.min(c.kg, (sp.intake / 1.5) * dtH * (0.35 + 0.65 * g));
        c.kg -= bite;
        this.eaten[a.sp] = this.eaten[a.sp]! + bite;
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
        a.want = a.beh === B.Wander && dist > 1.5 ? (sp.flies && dist > 14 ? sp.run * 0.8 : sp.walk * 0.85) : 0;
        if (a.beh === B.Wander && dist <= 1.5) a.beh = B.Idle;
      }
    }
  }

  /**
   * Issue #31: a defending mother. A sow charges the predator at a run; contact drives it off and may injure it. A chital
   * mother moves between her young and the predator and holds there, stamping and facing it. Defence ends when the
   * predator is gone, has moved away from the young, or she is spent; she never pursues far from her young.
   */
  private actDefend(a: Animal, sp: SpeciesDef, dt: number): void {
    const pred = this.byId.get(a.targetId);
    const young = this.dependentYoung(a);
    if (!pred || !pred.alive || pred.off || !young || Math.hypot(pred.x - young.x, pred.z - young.z) > 40 || a.stamina < 0.05 || Math.hypot(a.x - young.x, a.z - young.z) > 45) {
      a.beh = B.Idle;
      a.timer = 0;
      a.want = 0;
      return;
    }
    if (sp.id === 'boar') {
      a.tx = pred.x;
      a.tz = pred.z;
      a.want = sp.run;
      a.stamina = Math.max(0, a.stamina - dt / sp.sprintS);
      if (Math.hypot(pred.x - a.x, pred.z - a.z) < 1.8) {
        this.interactions.chargeContacts++;
        if (this.rng.chance(0.5)) {
          pred.health -= 0.12;
          this.interactions.jackalInjuries++;
        }
        pred.fear = 0.8;
        pred.threatX = a.x;
        pred.threatZ = a.z;
        if (pred.beh === B.Stalk || pred.beh === B.Chase) this.interactions.huntsAbandoned++;
        this.startFlee(pred, SPECIES[pred.sp]!);
        pred.timer = 2;
        a.beh = B.Idle;
        a.timer = this.rng.range(1, 2);
        a.want = 0;
      }
      return;
    }
    // chital: stand between the young and the predator, then hold and face it
    const gx = young.x + (pred.x - young.x) * 0.35;
    const gz = young.z + (pred.z - young.z) * 0.35;
    a.tx = gx;
    a.tz = gz;
    const d = Math.hypot(gx - a.x, gz - a.z);
    a.want = d > 1.5 ? sp.walk * 2.2 : 0;
    if (d <= 1.5) a.heading += clamp(angleDiff(a.heading, Math.atan2(pred.x - a.x, pred.z - a.z)), -dt * 3, dt * 3);
  }

  private attack(pred: Animal, prey: Animal): void {
    const psp = SPECIES[prey.sp]!;
    const mat = maturityDays(psp);
    let p = psp.id === 'hare' ? 0.5 : prey.age < mat * 0.45 ? 0.6 : 0.28;
    // issue #31: no blanket protection from nearby adults. Only the prey's own mother, physically at its side and
    // defending, blocks the strike (the predator must then deal with her: see actDefend).
    const pm = prey.mother !== 0 ? this.byId.get(prey.mother) : undefined;
    if (pm && pm.alive && pm.beh === B.Defend && Math.hypot(pm.x - prey.x, pm.z - prey.z) < 2.5) p = 0;
    if (this.rng.next() < p) {
      this.kill(prey, 'predation');
      const c = this.carcasses[this.carcasses.length - 1]!;
      pred.beh = B.Feed;
      pred.targetId = c.id;
      pred.want = 0;
      this.events.emit({ type: 'kill', predator: pred.id, prey: prey.id, sp: prey.sp, x: prey.x, z: prey.z });
    } else {
      prey.fear = 1;
      prey.threatX = pred.x;
      prey.threatZ = pred.z;
      prey.health -= 0.08;
      pred.stamina = 0;
      pred.beh = B.Rest;
      pred.want = 0;
      pred.timer = this.rng.range(20, 40);
    }
  }

  /** Player-driven animal: intent comes from input, but physiology, perception and food-web effects are unchanged. */
  private actControlled(a: Animal, sp: SpeciesDef, dt: number, dtH: number): void {
    const c = this.control;
    if (c.mx !== 0 || c.mz !== 0) {
      const sprint = c.run && a.stamina > 0.03;
      a.want = sprint ? sp.run : c.run ? sp.run * 0.5 : sp.walk * 1.6;
      if (sprint) a.stamina = Math.max(0, a.stamina - dt / sp.sprintS);
      a.beh = sprint ? B.Flee : B.Wander;
      a.tx = clamp(a.x + c.mx * 20, 8, REGION_SIZE - 8);
      a.tz = clamp(a.z + c.mz * 20, 8, REGION_SIZE - 8);
      return;
    }
    a.want = 0;
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
    else if (c.action === 'defend') {
      // issue #31: the player's mother defends her young against the nearest predator near them (none: nothing happens)
      const y = this.dependentYoung(a);
      const t = y ? this.youngThreat(a) : null;
      if (t) {
        if (a.beh !== B.Defend) this.interactions.defends++;
        a.beh = B.Defend;
        a.targetId = t.id;
        this.actDefend(a, sp, 1 / 60);
      } else a.beh = B.Idle;
    }
    else if (a.beh !== B.Rest) a.beh = B.Idle;
  }

  /** Issue #31 (UI cue): the nearest predator within 30 m of this mother's youngest dependent, if any. */
  youngThreat(a: Animal): Animal | null {
    const y = this.dependentYoung(a);
    if (!y) return null;
    const ysp = SPECIES[y.sp]!;
    let best: Animal | null = null;
    let bd = 30 * 30;
    this.hash.query(y.x, y.z, 30, (o, d2) => {
      if (o.alive && ysp.predators.includes(SPECIES[o.sp]!.id) && d2 < bd) {
        bd = d2;
        best = o;
      }
    });
    return best;
  }

  /** Water underfoot or within a neck's reach ahead (used for player-controlled drinking and UI prompts). */
  waterNear(a: Animal): 0 | 1 | 2 {
    return this.env.waterHere(a.x, a.z) || this.env.waterHere(a.x + Math.sin(a.heading) * 1.3, a.z + Math.cos(a.heading) * 1.3);
  }

  // ------------------------------------------------------------------ movement
  /**
   * A water point an animal can stand at: not inside a ruin's walls (birds hover at roof height there and never reach
   * the floor) and not beyond the region margin that `passable` enforces. Without this, an animal could remember an
   * unreachable site, give up, and re-find the same site until it died of thirst (ECOLOGICAL_STABILITY_REPORT.md).
   */
  private readonly drinkable = (x: number, z: number): boolean =>
    !outsideWall(x, z) && !this.insideBuilding(x, z);

  private insideBuilding(x: number, z: number, margin = 0.6): boolean {
    return this.bldCell[this.env.cellIndex(x, z)] === 1 && this.valley.blocked(x, z, margin);
  }

  /** Remember a destination the animal gave up on (replaces an expired slot, else the oldest). */
  private rememberFailure(a: Animal, x: number, z: number): void {
    const until = this.env.timeH + FAILED_TARGET_HOURS;
    // the slot with the earliest expiry (NaN = empty, treated as earliest)
    const u1 = Number.isNaN(a.fail1Until) ? -Infinity : a.fail1Until;
    const u2 = Number.isNaN(a.fail2Until) ? -Infinity : a.fail2Until;
    const u3 = Number.isNaN(a.fail3Until) ? -Infinity : a.fail3Until;
    const u4 = Number.isNaN(a.fail4Until) ? -Infinity : a.fail4Until;
    const m = Math.min(u1, u2, u3, u4);
    if (u1 === m) ((a.fail1X = x), (a.fail1Z = z), (a.fail1Until = until));
    else if (u2 === m) ((a.fail2X = x), (a.fail2Z = z), (a.fail2Until = until));
    else if (u3 === m) ((a.fail3X = x), (a.fail3Z = z), (a.fail3Until = until));
    else ((a.fail4X = x), (a.fail4Z = z), (a.fail4Until = until));
  }

  /** Did the animal recently give up on a destination within FAILED_TARGET_RADIUS of (x, z)? */
  recentlyFailed(a: Animal, x: number, z: number): boolean {
    const now = this.env.timeH;
    const r2 = FAILED_TARGET_RADIUS * FAILED_TARGET_RADIUS;
    return (
      (a.fail1Until > now && (x - a.fail1X) ** 2 + (z - a.fail1Z) ** 2 < r2) ||
      (a.fail2Until > now && (x - a.fail2X) ** 2 + (z - a.fail2Z) ** 2 < r2) ||
      (a.fail3Until > now && (x - a.fail3X) ** 2 + (z - a.fail3Z) ** 2 < r2) ||
      (a.fail4Until > now && (x - a.fail4X) ** 2 + (z - a.fail4Z) ** 2 < r2)
    );
  }

  /** findWater filter for the animal currently deciding: drinkable and not recently given up on (no closure per call). */
  private deciding: Animal | null = null;
  private readonly waterFor = (x: number, z: number): boolean => this.drinkable(x, z) && !(this.deciding !== null && this.recentlyFailed(this.deciding, x, z));

  /**
   * The nearest point a species can stand at (water no deeper than its wade depth, not inside walls, in bounds) to
   * (x, z): first along the preferred direction (dx, dz) up to 60 m, then 8 directions out to 60 m. Bounded: at most
   * 108 terrain samples; called on decisions and landings only.
   */
  private nearestStandable(sp: SpeciesDef, x: number, z: number, dx: number, dz: number): { x: number; z: number } | null {
    const stage = this.env.stage;
    const wade = sp.locomotion.wadeDepth;
    const ok = (px: number, pz: number): boolean => this.valley.waterDepth(px, pz, stage) <= wade && !this.insideBuilding(px, pz) && this.valley.inBounds(px, pz, 6);
    if (ok(x, z)) return { x, z };
    const dl = Math.hypot(dx, dz);
    if (dl > 0.5) {
      const ux = dx / dl;
      const uz = dz / dl;
      for (let s = 1; s <= Math.min(60, dl + 1); s += 1) if (ok(x + ux * s, z + uz * s)) return { x: x + ux * s, z: z + uz * s };
    }
    for (const r of [2, 4, 8, 16, 32, 60]) {
      for (let k = 0; k < 8; k++) {
        const px = x + Math.sin((k * Math.PI) / 4) * r;
        const pz = z + Math.cos((k * Math.PI) / 4) * r;
        if (ok(px, pz)) return { x: px, z: pz };
      }
    }
    return null;
  }

  /**
   * A flyer low over water it cannot stand in, or about to land in it, gets a standable landing point and the intent
   * to reach it (a bird never hovers over the water with nowhere to go).
   */
  private safeLanding(a: Animal, sp: SpeciesDef): void {
    const stage = this.env.stage;
    const wade = sp.locomotion.wadeDepth;
    const overWater = a.alt < 1.5 && this.valley.waterDepth(a.x, a.z, stage) > wade;
    const targetWet = this.valley.waterDepth(a.tx, a.tz, stage) > wade;
    if (!targetWet && !overWater) return;
    if (targetWet) {
      const p = this.nearestStandable(sp, a.tx, a.tz, a.x - a.tx, a.z - a.tz);
      if (p) {
        a.tx = p.x;
        a.tz = p.z;
      } else {
        a.tAlt = Math.max(a.tAlt, 3); // nothing to stand on nearby: stay airborne
      }
    }
    if (overWater) a.want = Math.max(a.want, sp.walk * 2);
  }

  /** The movement mode renderers and diagnostics read: what the animal is physically doing this tick. */
  private updateMode(a: Animal, sp: SpeciesDef): void {
    if (a.alt > 0.25) {
      a.mode = a.beh === B.Roost && a.speed < 0.05 && a.alt > 1 ? MODE.Perch : MODE.Fly;
      return;
    }
    const d = this.valley.waterDepth(a.x, a.z, this.env.stage);
    a.mode = !sp.flies && d > swimDepth(sp) ? MODE.Swim : d > 0.02 ? MODE.Wade : MODE.Walk;
  }


  // ------------------------------------------------------------------ open boundary (issue #29)
  /**
   * Open the valley boundary for this run (must be called before the first step; the closed valley never calls it).
   * Creates the finite regional population: jackal territories packed into the ring by the same spacing rule valley
   * floaters use, and hares in an edge strip at the valley's initial density. Everything is drawn from migRng.
   */
  configureBoundary(o: Partial<BoundaryConfig>): void {
    if (this.tick !== 0) throw new Error('configureBoundary must be called before the first step');
    this.boundary = { ...CLOSED_BOUNDARY, ...o };
    if (!this.boundary.open) return;
    this.migRng = new Rng(hash3(this.seed, 99, 3));
    this.migration = emptyMigrationStats(SPECIES.length);
    this.sectorSuit = Array.from({ length: SECTORS }, () => this.migRng!.range(0.6, 1));
    this.initRegional();
  }

  private isMigrant(sp: SpeciesDef): boolean {
    return MIGRANT_SPECIES.includes(sp.id);
  }
  private rngFor(a: Animal): Rng {
    return a.off ? this.migRng! : this.rng;
  }
  /** A dispersal / exploration anchor: anywhere in the valley (closed) or the regional landscape (open). */
  private anchor(a: Animal): [number, number] {
    const r = this.rngFor(a);
    if (!this.boundary.open) return [r.range(80, REGION_SIZE - 80), r.range(80, REGION_SIZE - 80)];
    const w = this.boundary.ringW;
    return [r.range(-w + 80, REGION_SIZE + w - 80), r.range(-w + 80, REGION_SIZE + w - 80)];
  }
  /** An off-map floater may claim where it stands: outside the valley, its exclusive disc inside the landscape, on suitable ground. */
  private regionalClaimOk(a: Animal, spacing: number): boolean {
    const c = edgeSigned(a.x, a.z);
    if (c >= 0 || c < -(this.boundary.ringW - spacing / 2)) return false;
    return this.migRng!.next() < this.sectorSuit[sectorOf(a.x, a.z)]!;
  }
  private markSettled(a: Animal): void {
    a.settled = true;
    this.migration!.settled[a.sp]!++;
  }
  /** Off-map equilibrium for hunger and thirst (pre-registered): 0.25 + 0.35 (1 - suitability (1 - crowding)). */
  private offNeed(a: Animal): number {
    const suit = this.sectorSuit[sectorOf(a.x, a.z)]!;
    return 0.25 + 0.35 * (1 - suit * (1 - this.offCrowding(a)));
  }
  /** Off-map crowding 0..1 for hares (local density against strip capacity); jackals are regulated by spacing (0). */
  private offCrowding(a: Animal): number {
    if (SPECIES[a.sp]!.id !== 'hare') return 0;
    let n = 0;
    for (const o of this.regional) if (o.alive && o.sp === a.sp && Math.abs(o.x - a.x) < 200 && Math.abs(o.z - a.z) < 200) n++;
    const cap = this.hareDensity() * 400 * 400 * this.boundary.hareCapacity;
    return clamp01(n / Math.max(1, cap));
  }
  /** The valley's initial hare density, animals per m² (off-map hares live at this density x suitability). */
  private hareDensity(): number {
    return SPECIES[SPECIES_INDEX.hare]!.initial / (REGION_SIZE * REGION_SIZE);
  }

  private initRegional(): void {
    const r = this.migRng!;
    const w = this.boundary.ringW;
    const st = this.migration!;
    const make = (si: number, x: number, z: number, group: number, homeX: number, homeZ: number, adult: boolean, sex: 0 | 1 | null): Animal => {
      const sp = SPECIES[si]!;
      const mat = maturityDays(sp);
      const age = adult ? r.range(mat, lifeDays(sp) * 0.7) : r.chance(0.22) ? r.range(mat * 0.35, mat) : r.range(mat, lifeDays(sp) * 0.7);
      const a: Animal = {
        id: this.nextId++, sp: si, x, z, alt: 0, px: x, pz: z, palt: 0, mode: MODE.Walk, fail1X: NaN, fail1Z: NaN, fail1Until: NaN, fail2X: NaN, fail2Z: NaN, fail2Until: NaN, fail3X: NaN, fail3Z: NaN, fail3Until: NaN, fail4X: NaN, fail4Z: NaN, fail4Until: NaN, heading: r.range(0, 6.283), speed: 0, want: 0, steer: 0, chkT: 0, chkD: 0, stuck: 0, cx: x, cz: z, ctx: x, ctz: z, bestD: Infinity, age,
        sex: sex ?? (r.chance(0.5) ? 0 : 1), health: 1, hunger: r.range(0.1, 0.5), thirst: r.range(0.05, 0.4), energy: r.range(0.5, 1), stamina: 1, fear: 0, beh: B.Idle,
        tx: x, tz: z, tAlt: 0, targetId: 0, threatX: x, threatZ: z, pregnantH: 0, cooldownH: 0, homeX, homeZ, group, mother: 0,
        waterX: NaN, waterZ: NaN, timer: 1, crowd: 0, alive: true, controlled: false, origin: 1, off: true,
      };
      this.regional.push(a);
      this.byId.set(a.id, a);
      st.initialRegional[si]!++;
      return a;
    };
    // jackals: random sequential packing of territory centres in the ring, same spacing rule as valley floaters
    const J = SPECIES_INDEX.jackal;
    const terr = SPECIES[J]!.territory;
    if (terr) {
      const rr = terr.spacing / 2;
      const held = [...this.territories.values()].filter((t) => t.sp === J).map((t) => [t.x, t.z] as [number, number]);
      for (let k = 0; k < 40000; k++) {
        const x = r.range(-w, REGION_SIZE + w);
        const z = r.range(-w, REGION_SIZE + w);
        const c = edgeSigned(x, z);
        if (c >= 0 || c < -(w - rr)) continue;
        if (held.some(([hx, hz]) => Math.hypot(hx - x, hz - z) < terr.spacing)) continue;
        held.push([x, z]);
        const u = r.next();
        if (u >= 0.9) continue; // vacant (pre-registered: pair 0.75, single 0.15, vacant 0.10)
        const group = this.nextId++;
        const t: Territory = { group, sp: J, x, z, female: 0, male: 0, sinceH: this.env.timeH };
        const f = u < 0.75 || r.chance(0.5) ? make(J, x + r.range(-14, 14), z + r.range(-14, 14), group, x, z, true, 0) : null;
        const m = u < 0.75 || !f ? make(J, x + r.range(-14, 14), z + r.range(-14, 14), group, x, z, true, 1) : null;
        if (f) t.female = f.id;
        if (m) t.male = m.id;
        // a third member as often as populate() makes jackal groups of three
        if (u < 0.75 && r.range(0.6, 1.3) * 2 >= 2.5) make(J, x + r.range(-14, 14), z + r.range(-14, 14), group, x, z, false, null).mother = 0;
        this.territories.set(group, t);
      }
    }
    // hares: the valley's initial density x sector suitability x capacity multiplier, in a strip HARE_STRIP deep
    const H = SPECIES_INDEX.hare;
    const strip = 4 * REGION_SIZE * HARE_STRIP + Math.PI * HARE_STRIP * HARE_STRIP;
    const target = Math.round(this.hareDensity() * strip * 0.8 * this.boundary.hareCapacity); // 0.8 = mean of U(0.6, 1)
    let placed = 0;
    for (let k = 0; k < 200000 && placed < target; k++) {
      const x = r.range(-HARE_STRIP, REGION_SIZE + HARE_STRIP);
      const z = r.range(-HARE_STRIP, REGION_SIZE + HARE_STRIP);
      const c = edgeSigned(x, z);
      if (c >= 0 || c < -HARE_STRIP) continue;
      if (r.next() >= this.sectorSuit[sectorOf(x, z)]!) continue;
      make(H, x, z, this.nextId++, x, z, false, null);
      placed++;
    }
  }

  /** Physically passable straight crossing from (x, z) along the outward normal, wall to the corridor's outer line. */
  private crossingOk(sp: SpeciesDef, x: number, z: number, fleeing: boolean): boolean {
    const [nx, nz] = outwardNormal(x, z);
    // the point on the wall line straight across from (x, z)
    const bx = nx === -1 ? EDGE_WALL : nx === 1 ? REGION_SIZE - EDGE_WALL : clamp(x, EDGE_WALL, REGION_SIZE - EDGE_WALL);
    const bz = nz === -1 ? EDGE_WALL : nz === 1 ? REGION_SIZE - EDGE_WALL : clamp(z, EDGE_WALL, REGION_SIZE - EDGE_WALL);
    const swim = maySwim(sp, fleeing);
    let prevH = this.valley.height(bx, bz);
    for (let s = 2; s <= EDGE_WALL + CORRIDOR; s += 2) {
      const px = bx + nx * s;
      const pz = bz + nz * s;
      const h = this.valley.height(px, pz);
      if (Math.abs(h - prevH) / 2 > MAX_UP_GRADE) return false;
      if (!swim && this.valley.waterSurface(pz) + this.env.stage - h > sp.locomotion.wadeDepth) return false;
      prevH = h;
    }
    return true;
  }

  /** The animal intends to cross: open boundary, migrant, destination beyond the region. */
  private exitTarget(a: Animal, sp: SpeciesDef): boolean {
    return this.boundary.open && this.isMigrant(sp) && !a.controlled && !a.transit && !insideRegion(a.tx, a.tz);
  }

  /**
   * Start an exit when a migrant heading for a destination beyond the edge reaches the wall at a passable point: it walks
   * straight out through the corridor (transit -1). A predator chasing prey that is in the corridor may follow it in.
   */
  private maybeBeginExit(a: Animal, sp: SpeciesDef, dt: number): void {
    if (a.transit || a.controlled || a.alt > 0.25 || !this.isMigrant(sp)) return;
    const chasingOut = a.beh === B.Chase && (this.byId.get(a.targetId)?.transit ?? 0) === -1;
    if (!chasingOut && insideRegion(a.tx, a.tz)) return;
    // within reach of the wall this tick (large ticks cover tens of metres: judged by what the animal can cover now)
    if (edgeSigned(a.x, a.z) > EDGE_WALL + 2.5 + Math.max(a.speed, a.want) * dt) return;
    const fleeing = a.beh === B.Flee;
    if (fleeing && !this.boundary.fleeExit) return;
    if (!this.crossingOk(sp, a.x, a.z, fleeing)) {
      this.migration!.refused[a.sp]!++;
      return;
    }
    a.transit = -1;
    const home = !insideRegion(a.homeX, a.homeZ);
    a.exitKind = fleeing ? 'flee' : chasingOut ? 'excursion' : home && this.territories.has(a.group) ? 'excursion' : home && a.origin === 1 && !a.settled ? 'excursion' : 'emigration';
    if (!chasingOut) this.aimOut(a);
  }

  /** Destination straight out to just inside the corridor's outer line (steering never looks beyond it). */
  private aimOut(a: Animal): void {
    const [nx, nz] = outwardNormal(a.x, a.z);
    const s = edgeSigned(a.x, a.z) + CORRIDOR; // the outer line itself (passable for animals in transit)
    a.tx = a.x + nx * s;
    a.tz = a.z + nz * s;
  }

  /** Animals that reached the corridor's outer line leave the valley (after the per-animal loop). */
  private completeExits(): void {
    const st = this.migration!;
    for (const a of this.exiting) {
      if (!a.alive || a.transit !== -1) continue;
      // a pursuit in progress continues beyond the observed valley by the same chase rules (owner decision 1)
      let pred: Animal | null = null;
      let pd = 95;
      for (const o of this.animals) {
        if (!o.alive || o.beh !== B.Chase || o.targetId !== a.id) continue;
        const d = Math.hypot(o.x - a.x, o.z - a.z);
        if (d < pd) (pd = d), (pred = o);
      }
      const kind = a.exitKind ?? 'emigration';
      (kind === 'flee' ? st.exitFlee : kind === 'excursion' ? st.exitExcursion : st.exitEmigration)[a.sp]!++;
      this.leave(a);
      if (pred) this.continuePursuit(pred, a, pd);
      // dependent young near the mother follow her out
      for (const y of this.animals) {
        if (!y.alive || y.mother !== a.id || y.transit || y.controlled || y.age >= weanDays(SPECIES[y.sp]!) || Math.hypot(y.x - a.x, y.z - a.z) > 80) continue;
        y.transit = -1;
        y.exitKind = kind;
        y.tx = a.x;
        y.tz = a.z;
      }
    }
    this.exiting.length = 0;
    this.animals = this.animals.filter((a) => !a.off);
  }

  private leave(a: Animal): void {
    a.off = true;
    a.transit = 0;
    a.beh = B.Idle;
    a.speed = 0;
    a.want = 0;
    a.alt = 0;
    this.regional.push(a);
  }

  /**
   * Pursuit past the corridor's outer line: the chase continues on open ground by the on-map rules (run speeds, stamina
   * spent at 1/sprintS per second, a tired prey at half speed, the predator gives up when spent or 95 m behind, the
   * on-map capture odds when it closes to 1.8 m; no guarding adults). Captured prey dies off-map; the predator follows
   * it out (its kill is beyond the edge). Otherwise the predator turns back into the valley.
   */
  private continuePursuit(pred: Animal, prey: Animal, gap: number): void {
    const r = this.migRng!;
    const st = this.migration!;
    const ps = SPECIES[pred.sp]!;
    const qs = SPECIES[prey.sp]!;
    let g = gap;
    let sp = pred.stamina;
    let sq = prey.stamina;
    let captured = false;
    for (let t = 0; t < 600; t++) {
      if (sp < 0.04 || g > 95) break;
      const vp = ps.run;
      const vq = qs.run * (sq > 0.03 ? 1 : 0.5);
      sp = Math.max(0, sp - 1 / ps.sprintS);
      sq = Math.max(0, sq - 1 / qs.sprintS);
      g += vq - vp;
      if (g < 1.8) {
        const mat = maturityDays(qs);
        const p = qs.id === 'hare' ? 0.5 : prey.age < mat * 0.45 ? 0.6 : 0.28;
        captured = r.next() < p;
        break;
      }
    }
    pred.stamina = sp;
    if (captured) {
      st.pursuitCaptured[prey.sp]!++;
      st.offDeathsPredation[prey.sp]!++;
      prey.alive = false;
      this.byId.delete(prey.id);
      pred.transit = -1;
      pred.exitKind = 'excursion';
      this.aimOut(pred);
      pred.beh = B.Wander;
    } else {
      st.pursuitEscaped[prey.sp]!++;
      prey.stamina = sq;
      pred.beh = B.Rest;
      pred.want = 0;
      pred.timer = this.rng.range(15, 30);
      if (outsideWall(pred.x, pred.z)) {
        pred.transit = 1;
        const [nx, nz] = outwardNormal(pred.x, pred.z);
        pred.tx = pred.x - nx * (CORRIDOR + 20);
        pred.tz = pred.z - nz * (CORRIDOR + 20);
        pred.beh = B.Wander;
      } else pred.transit = 0;
    }
  }

  /**
   * Off-map coarse model, once per game hour, in id order (docs/OPEN_BOUNDARY_DESIGN.md §4): aging, needs relaxing to the
   * sector equilibrium, the on-map hazards (x offmapHazard), reproduction by the on-map rules, and movement at the
   * species' own walking pace (per game hour walk x 3600 / TIME_SCALE m, scaled by its activity). Movement into the
   * valley enters through the corridor; movement out of the landscape is a permanent departure.
   */
  private stepRegional(): void {
    const r = this.migRng!;
    const st = this.migration!;
    const w = this.boundary.ringW;
    const k = 1 - Math.exp(-1 / 12);
    const list = this.regional;
    for (let i = 0; i < list.length; i++) {
      const a = list[i]!;
      if (!a.alive || !a.off) continue;
      const sp = SPECIES[a.sp]!;
      a.age += 1 / 24;
      const mother = a.mother !== 0 && a.age < weanDays(sp) ? this.byId.get(a.mother) : undefined;
      const n = this.offNeed(a);
      a.hunger += (n - a.hunger) * k;
      a.thirst += (n - a.thirst) * k;
      if (mother?.alive) {
        a.hunger = Math.min(a.hunger, mother.hunger + 0.05);
        a.thirst = Math.min(a.thirst, mother.thirst + 0.05);
      }
      const old = a.age / lifeDays(sp);
      if (old > 0.8) {
        a.health -= 0.006 * ((old - 0.8) / 0.2);
        if (a.health <= 0 || old > 1.2) {
          this.offDeath(a, st.offDeathsAge);
          continue;
        }
      } else if (a.hunger < 0.7 && a.thirst < 0.7 && a.health < 1) a.health = Math.min(1, a.health + 0.006);
      const juvenile = a.age < maturityDays(sp) * 0.5;
      let hz = (juvenile ? sp.juvHazard : sp.adultHazard) * this.boundary.offmapHazard;
      hz *= 1 + this.offCrowding(a) * 4 / Math.max(6, sp.group * 2.5);
      if (a.health < 0.5) hz *= 2.5;
      if (juvenile && a.mother !== 0 && !mother?.alive && a.age < weanDays(sp)) hz *= 6;
      if (r.next() < hz / 24) {
        this.offDeath(a, st.offDeathsBackground);
        continue;
      }
      if (a.cooldownH > 0) a.cooldownH -= 1;
      if (a.pregnantH > 0) {
        a.pregnantH -= 1;
        if (a.pregnantH <= 0) this.regionalBirth(a, sp);
      } else if (this.receptiveOff(a, sp) && r.next() < ((0.6 * Math.min(1.6, this.fertility[a.sp]!)) / 24) * (1 - this.offCrowding(a))) {
        // births scale with crowding against capacity (pre-registered in revision 2, section 4; omitted in the first
        // implementation, which let off-map hares grow without bound): no conception at or above capacity
        a.pregnantH = gestationHours(sp);
      }
      this.moveRegional(a, sp, mother, w);
    }
    this.regional = list.filter((a) => a.alive && a.off);
  }

  private offDeath(a: Animal, row: number[]): void {
    a.alive = false;
    row[a.sp]!++;
    this.byId.delete(a.id);
  }

  /** Receptive off-map: the on-map thresholds, a resident pair for territorial species, an adult male nearby for others. */
  private receptiveOff(a: Animal, sp: SpeciesDef): boolean {
    if (a.sex !== 0 || a.cooldownH > 0 || a.hunger >= 0.6 || a.health <= 0.55 || a.age <= maturityDays(sp) || !this.seasonOk(sp)) return false;
    if (sp.territory) {
      const t = this.territories.get(a.group);
      if (!t || t.female !== a.id || t.male === 0) return false;
      const m = this.byId.get(t.male);
      return !!m && m.alive && !!m.off;
    }
    const mat = maturityDays(sp);
    return this.regional.some((o) => o.alive && o.sp === a.sp && o.sex === 1 && o.age > mat && Math.abs(o.x - a.x) < 400 && Math.abs(o.z - a.z) < 400);
  }

  private regionalBirth(m: Animal, sp: SpeciesDef): void {
    const r = this.migRng!;
    m.pregnantH = 0;
    m.cooldownH = intervalHours(sp) - gestationHours(sp);
    const f = this.fertility[m.sp]!;
    const base = sp.litter[0] + r.int(sp.litter[1] - sp.litter[0] + 1);
    const cond = m.hunger > 0.75 ? 0.5 : 1;
    const n = Math.floor(base * Math.min(f, 2) * cond + r.next() * 0.999 * (f > 1 || cond < 1 ? 1 : 0));
    for (let i = 0; i < n; i++) {
      const x = m.x + r.range(-1.5, 1.5);
      const z = m.z + r.range(-1.5, 1.5);
      const c: Animal = { ...m, id: this.nextId++, x, z, px: x, pz: z, age: 0, sex: r.chance(0.5) ? 0 : 1, health: 1, hunger: m.hunger, thirst: m.thirst, energy: 0.8, stamina: 1, fear: 0, beh: B.Idle, pregnantH: 0, cooldownH: 0, mother: m.id, origin: 1, settled: false, exitKind: undefined, onH: 0, transit: 0,
        fail1X: NaN, fail1Z: NaN, fail1Until: NaN, fail2X: NaN, fail2Z: NaN, fail2Until: NaN, fail3X: NaN, fail3Z: NaN, fail3Until: NaN, fail4X: NaN, fail4Z: NaN, fail4Until: NaN, waterX: NaN, waterZ: NaN, speed: 0, want: 0 };
      this.regional.push(c);
      this.byId.set(c.id, c);
    }
    this.migration!.offBirths[m.sp]! += n;
  }

  private moveRegional(a: Animal, sp: SpeciesDef, mother: Animal | undefined, w: number): void {
    const r = this.migRng!;
    const px = a.x;
    const pz = a.z;
    if (mother?.alive && mother.off) {
      // dependent young stay with the mother
      a.x = mother.x + r.range(-3, 3);
      a.z = mother.z + r.range(-3, 3);
    } else {
      const step = this.activity(sp) * sp.walk * (3600 / TIME_SCALE);
      const t = sp.territory ? this.territories.get(a.group) : undefined;
      if (sp.territory && !t) {
        // floater / disperser: directed travel toward its anchor; a new anchor on arrival
        const dx = a.homeX - a.x;
        const dz = a.homeZ - a.z;
        const d = Math.hypot(dx, dz);
        if (d <= step) [a.homeX, a.homeZ] = this.anchor(a);
        const s = Math.min(step, d) / (d || 1);
        a.x += dx * s;
        a.z += dz * s;
      } else {
        // ranging around the home range centre (territory centre or home), reflected within 1.5 x home range
        const hx = t ? t.x : a.homeX;
        const hz = t ? t.z : a.homeZ;
        const ang = r.range(0, 6.283);
        let nx = a.x + Math.cos(ang) * step;
        let nz = a.z + Math.sin(ang) * step;
        const lim = sp.homeRange * 1.5;
        const d = Math.hypot(nx - hx, nz - hz);
        if (d > lim) {
          nx = hx + ((nx - hx) / d) * lim;
          nz = hz + ((nz - hz) / d) * lim;
        }
        a.x = nx;
        a.z = nz;
      }
    }
    // the landscape bounds where homes and territory centres exist, not how far a resident ranges around its own home:
    // a resident of an outer territory may step past the outer line while ranging and is not lost. An animal without a
    // home range (a floater or disperser) that crosses it has left for good.
    const hasHome = sp.territory ? !!this.territories.get(a.group) : true;
    if (!hasHome && !insideLandscape(a.x, a.z, w)) {
      // left the regional landscape for good: not a death
      a.alive = false;
      this.migration!.departed[a.sp]!++;
      this.byId.delete(a.id);
      return;
    }
    const e = entryPoint(px, pz, a.x, a.z);
    if (!e) return;
    // movement carried it to the valley: a crossing attempt at the corridor's outer line
    const ok = this.crossingOk(sp, e[0], e[1], false);
    const pass = this.migRng!.next() < this.boundary.connectivity;
    if (!ok || !pass) {
      this.migration!.refused[a.sp]!++;
      a.x = px;
      a.z = pz;
      return;
    }
    if (!this.boundary.inflow) {
      this.migration!.suppressed[a.sp]!++;
      a.x = px;
      a.z = pz;
      return;
    }
    if (mother?.alive && mother.off) {
      // young never enter on their own; they come in with the mother
      a.x = px;
      a.z = pz;
      return;
    }
    this.enterValley(a, e[0], e[1]);
    for (const y of this.regional) if (y.alive && y.off && y.mother === a.id && y.age < weanDays(SPECIES[y.sp]!)) this.enterValley(y, e[0] + r.range(-1, 1), e[1] + r.range(-1, 1));
  }

  private enterValley(a: Animal, x: number, z: number): void {
    const [nx, nz] = outwardNormal(x, z);
    a.off = false;
    a.x = a.px = x;
    a.z = a.pz = z;
    a.alt = a.palt = 0;
    a.transit = 1;
    a.tx = x - nx * (CORRIDOR + 20);
    a.tz = z - nz * (CORRIDOR + 20);
    a.beh = B.Wander;
    a.want = SPECIES[a.sp]!.walk;
    a.speed = 0;
    a.timer = 0.5;
    a.onH = 0;
    a.heading = Math.atan2(-nx, -nz);
    a.mode = MODE.Walk;
    a.stuck = 0;
    a.bestD = Infinity;
    (a.origin === 1 && !a.settled ? this.migration!.entryVisit : this.migration!.entryReturn)[a.sp]!++;
    this.animals.push(a);
  }

  /** Hourly on-map bookkeeping for newcomers: a regional-lineage hare whose home is outside settles after HARE_SETTLE_H hours inside. */
  private settleNewcomers(): void {
    for (const a of this.animals) {
      if (!a.alive || a.origin !== 1 || a.settled || a.transit) continue;
      a.onH = (a.onH ?? 0) + 1;
      if (SPECIES[a.sp]!.id === 'hare' && a.onH >= HARE_SETTLE_H) {
        a.homeX = a.x;
        a.homeZ = a.z;
        this.markSettled(a);
      }
    }
  }

  /**
   * An animal in boundary transit that is not fleeing or chasing walks its corridor route: in, until it is inside the
   * wall; out, to the corridor's outer line (completeExits then moves it off-map). An exit whose destination has come
   * back inside the valley is abandoned once the animal is back inside the wall.
   */
  private updateTransit(a: Animal): void {
    if (a.transit === 1 && !outsideWall(a.x, a.z)) {
      a.transit = 0;
      a.timer = 0;
      return;
    }
    if (a.transit === -2) {
      a.want = 0;
      a.timer = 1;
      return;
    }
    if (a.transit === -1 && insideRegion(a.tx, a.tz) && !outsideWall(a.x, a.z)) {
      a.transit = 0;
      if (this.migration) this.migration.exitAborted[a.sp]!++;
      a.exitKind = undefined;
      a.timer = 0;
      return;
    }
    a.beh = B.Wander;
    a.want = SPECIES[a.sp]!.walk;
    a.timer = 0.5;
  }

  private passable(sp: SpeciesDef, a: Animal | null, x: number, z: number, fromDepth: number, fleeing: boolean): boolean {
    if (edgeBlocks(a, x, z)) return false;
    if (this.insideBuilding(x, z)) return false;
    // no animal walks deeper than its wade depth unless it may swim; anything can always retreat toward shallower water
    if (!maySwim(sp, fleeing)) {
      const d = a?.transit ? this.valley.waterSurface(z) + this.env.stage - this.valley.height(x, z) : this.valley.waterDepth(x, z, this.env.stage);
      if (d > sp.locomotion.wadeDepth && d >= fromDepth) return false;
    }
    return true;
  }

  private move(a: Animal, sp: SpeciesDef, dt: number): void {
    a.px = a.x;
    a.pz = a.z;
    a.palt = a.alt;
    // a flyer about to land on the ground never lands in water deeper than it can stand in, whatever the behaviour
    // chose: the landing point moves back along the approach to the first standable spot (bounded scan)
    // no destination lies beyond the edge wall: a perch, roost tree or carcass in the outer strip is approached to the
    // wall and reached there, never chased forever from the wall (B1 follow-up: birds hovered 2 m short of a roost tree
    // at z = 4 m and starved)
    // (animals in boundary transit are the exception: their destination is the corridor itself)
    if (!a.transit && !this.exitTarget(a, sp)) {
      a.tx = clamp(a.tx, EDGE_WALL, REGION_SIZE - EDGE_WALL);
      a.tz = clamp(a.tz, EDGE_WALL, REGION_SIZE - EDGE_WALL);
    }
    if (sp.flies && a.alt > 0.3 && a.beh !== B.Drink && ((a.tAlt < 1 && Math.hypot(a.tx - a.x, a.tz - a.z) < 12) || a.alt < 1.5)) this.safeLanding(a, sp);
    const dx = a.tx - a.x;
    const dz = a.tz - a.z;
    const dist = Math.hypot(dx, dz);
    // ---- speed: approach what the behaviour wants within acceleration limits; brake for the destination ----
    const loco = locomotion(sp);
    const rate = a.want > a.speed ? loco.accel : loco.decel;
    a.speed += clamp(a.want - a.speed, -rate * dt, rate * dt);
    if (!sp.flies && a.want > 0) a.speed = Math.min(a.speed, Math.sqrt(2 * loco.decel * Math.max(0, dist - 0.4)) + 0.25);
    if (a.speed < 0.02 && a.want <= 0) a.speed = 0;
    if (sp.flies) {
      // climb when travelling, descend on approach. Decided from this tick's speed: using the previous tick's speed
      // left a bird that was blocked on the ground (speed reset to 0) unable ever to take off, which at large ticks
      // pinned birds on river banks until they died of thirst (docs/ECOLOGICAL_STABILITY_REPORT.md, "Ground-pinned birds")
      let want = a.speed > sp.walk * 1.5 && dist > 9 ? Math.max(a.tAlt, 7 + (a.id % 9)) : dist < 9 ? a.tAlt : a.alt;
      // no touching down on water deeper than it can stand in: keep flying until over standable ground
      if (want < 1.2 && this.valley.waterDepth(a.x, a.z, this.env.stage) > sp.locomotion.wadeDepth) want = Math.max(1.2, Math.min(a.alt, 1.2));
      a.alt += clamp(want - a.alt, -6 * dt, 5 * dt);
      if (a.alt < 0.05) a.alt = 0;
      // roofs are perches (tAlt > 0); nothing lands on the floor inside a ruin
      if (a.alt < 2.5 && a.tAlt < 1 && this.insideBuilding(a.x, a.z)) a.alt = 2.5;
    }
    // personal space: herd animals standing or ambling shuffle apart instead of occupying the same spot
    if (!sp.flies && sp.group > 1 && a.speed < sp.walk * 0.6 && a.want < sp.walk * 0.6 && !a.controlled && a.beh !== B.Drink && a.beh !== B.Flee && a.beh !== B.Follow && this.giveSpace(a, sp, dt, loco.agility, a.beh === B.Rest ? 0.5 : 1)) {
      a.chkT = 0;
      return;
    }
    if (a.speed <= 0 || dist < 0.05) {
      a.chkT = 0;
      return;
    }
    const goal = Math.atan2(dx, dz);
    let step = Math.min(a.speed * dt, dist);
    if (a.alt > 1) {
      // arrival: inside twice its turning radius a flyer slows (so the circle it can turn shrinks to half the distance)
      // and turns harder, instead of orbiting a nearby target forever (docs/BEHAVIOUR_AUDIT.md, finding 8)
      const TURN = 2.2;
      const arriving = dist < (2 * a.speed) / TURN;
      if (arriving) a.speed = Math.min(a.speed, Math.max(0.5, TURN * dist * 0.5));
      step = Math.min(a.speed * dt, dist);
      if (dist <= Math.max(step, 0.3)) {
        a.x = clamp(a.tx, EDGE_WALL, REGION_SIZE - EDGE_WALL);
        a.z = clamp(a.tz, EDGE_WALL, REGION_SIZE - EDGE_WALL);
        return;
      }
      const maxTurn = TURN * dt * (arriving ? 2 : 1);
      a.heading += clamp(angleDiff(a.heading, goal), -maxTurn, maxTurn);
      a.x = clamp(a.x + Math.sin(a.heading) * step, EDGE_WALL, REGION_SIZE - EDGE_WALL);
      a.z = clamp(a.z + Math.cos(a.heading) * step, EDGE_WALL, REGION_SIZE - EDGE_WALL);
      return;
    }
    if (outsideWall(a.x, a.z) && !a.transit) {
      // defensive (and for saves made before EDGE_WALL applied to flight): an animal on the ground inside the edge
      // strip walks straight inward, so it can never be trapped where every step is refused
      const nx = clamp(a.x, EDGE_WALL, REGION_SIZE - EDGE_WALL) - a.x;
      const nz = clamp(a.z, EDGE_WALL, REGION_SIZE - EDGE_WALL) - a.z;
      const nl = Math.hypot(nx, nz) || 1;
      a.heading = Math.atan2(nx, nz);
      a.x += (nx / nl) * Math.min(step, nl);
      a.z += (nz / nl) * Math.min(step, nl);
      return;
    }
    if (this.insideBuilding(a.x, a.z)) {
      // defensive: anything that does end up inside walks straight out
      a.x += Math.sin(a.heading) * step;
      a.z += Math.cos(a.heading) * step;
      return;
    }
    // ---- steering: look ahead along a fixed set of headings and take the cheapest; turn toward it smoothly ----
    const look = clamp(a.speed * 1.2, a.steer !== 0 ? 4 : 2.5, 12) + step;
    const steered = this.steer(a, sp, goal, look, dist);
    const desired = Number.isNaN(steered) ? a.heading + Math.PI : steered; // everything blocked: turn around
    // turning rate falls with speed (a sprinting deer arcs; a walking one can pivot) and with body size
    const maxTurn = (loco.agility * 4.5 * dt) / (1 + a.speed / 6);
    a.heading += clamp(angleDiff(a.heading, desired), -maxTurn, maxTurn);
    // continuous sweep: the step is walked in samples of at most SWEEP_M (bounded by SWEEP_SAMPLES_MAX; no distance is
    // lost). Each sample is checked for walls, region edge and water the species may not enter, and the speed factor
    // follows the depth at each sample, so a large tick neither jumps a shoreline or wall corner nor crosses deep
    // water at walking speed (docs/BEHAVIOUR_AUDIT.md, findings 5-6).
    const fleeing = a.beh === B.Flee;
    const hx = Math.sin(a.heading);
    const hz = Math.cos(a.heading);
    const n = Math.min(SWEEP_SAMPLES_MAX, Math.max(1, Math.ceil(step / SWEEP_M)));
    const sub = step / n;
    const water = sp.locomotion;
    const swimD = swimDepth(sp);
    let depth = this.valley.waterDepth(a.x, a.z, this.env.stage);
    const factor = (d: number): number => (d > swimD ? water.swimSpeed : d > water.wadeDepth ? 0.6 : 1);
    for (let i = 0; i < n; i++) {
      // the slower of the sample's start and end: entering deeper water slows the animal at once
      const ahead = this.valley.waterDepth(a.x + hx * sub, a.z + hz * sub, this.env.stage);
      const f = Math.min(factor(depth), factor(ahead));
      const nx = a.x + hx * sub * f;
      const nz = a.z + hz * sub * f;
      if (!this.passable(sp, a, nx, nz, depth, fleeing)) {
        a.speed = 0; // pressed against an obstacle: stop and keep turning next tick (no instant heading snaps)
        break;
      }
      a.x = nx;
      a.z = nz;
      depth = this.valley.waterDepth(a.x, a.z, this.env.stage);
    }
    // ---- progress check: give up on destinations the animal genuinely cannot reach ----
    // Two signals, checked every 4 s: the animal itself has not moved (pinned, whatever its goal is doing), or its
    // closest approach to the current destination has not improved (which also catches back-and-forth dithering).
    const fixedGoal = a.beh !== B.Chase && a.beh !== B.Stalk && a.beh !== B.Follow && a.beh !== B.SeekMate && a.beh !== B.Regroup;
    // a new destination (fixed goals: moved > 1 m; moving goals: jumped > 25 m in one tick) restarts the record
    if (Math.hypot(a.tx - a.ctx, a.tz - a.ctz) > (fixedGoal ? 1 : 25)) {
      a.bestD = dist;
      a.chkD = Infinity;
    }
    if (!fixedGoal || Math.hypot(a.tx - a.ctx, a.tz - a.ctz) > 1) {
      a.ctx = a.tx;
      a.ctz = a.tz;
    }
    a.bestD = Math.min(a.bestD, dist);
    a.chkT += dt;
    if (a.chkT >= 4) {
      const selfMoved = Math.hypot(a.x - a.cx, a.z - a.cz);
      // oscillating back and forth never improves the closest approach, so this catches dithering too
      const noProgress = dist > 2 && a.chkD - a.bestD < 0.8;
      if (!a.controlled && a.want > 0 && (selfMoved < 0.6 || noProgress)) a.stuck++;
      else a.stuck = 0;
      a.chkD = a.bestD;
      a.cx = a.x;
      a.cz = a.z;
      a.chkT = 0;
      if (a.stuck >= 2) {
        a.stuck = 0;
        a.steer = 0;
        a.timer = 0;
        if (a.beh === B.Flee) this.startFlee(a, sp);
        else {
          // remember what could not be reached, so the next decision does not choose it again at once
          this.rememberFailure(a, a.tx, a.tz);
          if (a.beh === B.SeekWater) a.waterX = a.waterZ = NaN; // remembered water is out of reach from here
          a.beh = B.Idle;
          a.want = 0;
        }
      }
    }
  }

  /**
   * Step away from same-species neighbours closer than about one body length: the animal turns toward the open side
   * at its normal turning rate and walks forward slowly (0.25 m/s), so facing and movement agree. A resting animal
   * reacts only when badly crowded (reach 0.5: it gets up, steps aside, and lies down again).
   */
  private giveSpace(a: Animal, sp: SpeciesDef, dt: number, agility: number, reach = 1): boolean {
    const personal = Math.max(0.6, sp.length * 1.1) * reach;
    let px = 0;
    let pz = 0;
    this.hash.query(a.x, a.z, personal, (o, d2) => {
      if (o === a || o.sp !== a.sp || !o.alive) return;
      const d = Math.sqrt(d2);
      // exactly coincident: separate along a direction fixed by the pair's ids (deterministic, symmetric)
      const ang = d > 1e-3 ? Math.atan2(a.x - o.x, a.z - o.z) : ((Math.min(a.id, o.id) * 2.39996) % (Math.PI * 2)) + (a.id < o.id ? 0 : Math.PI);
      const w = (personal - d) / personal;
      px += Math.sin(ang) * w;
      pz += Math.cos(ang) * w;
    });
    const m = Math.hypot(px, pz);
    if (m < 1e-6) return false;
    // turn toward the open side first; only step once roughly facing it (no sideways sliding)
    const want = Math.atan2(px, pz);
    const turn = angleDiff(a.heading, want);
    const maxTurn = agility * 4.5 * dt;
    a.heading += clamp(turn, -maxTurn, maxTurn);
    if (Math.abs(angleDiff(a.heading, want)) > 0.5) return true; // turning on the spot this tick
    const step = Math.min(0.25, 0.25 * m * 4) * dt;
    const nx = a.x + Math.sin(a.heading) * step;
    const nz = a.z + Math.cos(a.heading) * step;
    const depth = this.valley.waterDepth(a.x, a.z, this.env.stage);
    // making room never means wading in: the step may not end in water deeper than where the animal stands
    const wet = this.valley.waterDepth(nx, nz, this.env.stage) > Math.max(-0.05, depth);
    if (!wet && this.passable(sp, a, nx, nz, depth, false) && this.terrainCost(sp, a, nx, nz, this.valley.heightFast(a.x, a.z), step + 1e-3) < 0.5) {
      a.x = nx;
      a.z = nz;
      a.speed = Math.max(a.speed, step / dt); // a real (slow) step: renderers animate legs from speed and distance
      return true;
    }
    return false;
  }

  /**
   * Cost of stepping toward (x, z) from the animal's position for a ground animal; Infinity if impassable.
   * Buildings and region edges are walls; deep water is avoided (strongly by jackals, impassable for small mammals);
   * slopes above ~25 degrees cost more and cliffs are refused.
   */
  private terrainCost(sp: SpeciesDef, a: Animal, x: number, z: number, h0: number, dist: number): number {
    if (edgeBlocks(a, x, z)) return Infinity;
    if (this.insideBuilding(x, z, 0.9)) return Infinity;
    const h = this.valley.heightFast(x, z);
    const depth = this.valley.waterSurface(z) + this.env.stage - h;
    let cost = 0;
    const loco = sp.locomotion;
    if (depth > loco.wadeDepth) {
      const fleeing = a.beh === B.Flee;
      if (!maySwim(sp, fleeing)) return Infinity;
      // deep wading costs a little; swimming costs the species' aversion (less when escaping)
      cost += loco.waterAversion * (depth > swimDepth(sp) ? 1 : 0.25) * (fleeing ? 0.35 : 1);
    }
    const grade = (h - h0) / dist;
    if (grade > MAX_UP_GRADE || grade < -MAX_DOWN_GRADE) return Infinity;
    return cost + Math.max(0, Math.abs(grade) - 0.45) * 1.5;
  }

  /** Bounded look-ahead steering with deterministic tie-breaking and side hysteresis. Returns NaN if fully blocked. */
  private steer(a: Animal, sp: SpeciesDef, goal: number, look: number, goalDist = Infinity): number {
    const h0 = this.valley.heightFast(a.x, a.z);
    let best = NaN;
    let bestCost = Infinity;
    let bestOff = 0;
    for (const off of STEER_OFFSETS) {
      // once an obstacle forces a detour, commit to that side until the direct line is clear again (the "bug"
      // wall-following rule); without it an animal facing a wide wall dithers left-right in a local minimum
      let cost = Math.abs(off) * 0.9 + (a.steer !== 0 && off !== 0 && Math.sign(off) !== Math.sign(a.steer) ? 3 : 0);
      const h = goal + off;
      const sx = Math.sin(h);
      const sz = Math.cos(h);
      // a near sample (just beyond this tick's step) stops far samples skipping over a building corner
      // never judge a heading by ground beyond the destination itself (a target at the water's edge must not look
      // blocked by the water behind it)
      for (const d0 of [1.2, look * 0.5, look]) {
        const d = Math.max(0.3, Math.min(d0, goalDist));
        const c = this.terrainCost(sp, a, a.x + sx * d, a.z + sz * d, h0, d);
        cost += c;
        if (cost === Infinity) break;
      }
      if (cost < bestCost - 1e-9) {
        bestCost = cost;
        best = h;
        bestOff = off;
      }
    }
    if (bestCost !== Infinity) a.steer = bestOff;
    return best;
  }

  // ------------------------------------------------------------------ persistence & verification
  snapshot(): SimSnapshot {
    return {
      version: SAVE_VERSION, seed: this.seed, tick: this.tick, rng: this.rng.state, envRng: this.envRng.state, nextId: this.nextId, env: this.env.snapshot(),
      animals: this.animals.filter((a) => a.alive).map((a) => ({ ...a })), carcasses: this.carcasses.map((c) => ({ ...c })),
      fertility: [...this.fertility], births: [...this.births], deaths: this.deaths.map((r) => [...r]),
      history: this.history.map((h) => ({ ...h, pops: [...h.pops] })), statAcc: this.statAcc, groupAcc: this.groupAcc, rainAcc: this.rainAcc,
      groups: [...this.groups].map(([id, g]) => [id, g.x, g.z, g.n]), eaten: [...this.eaten],
      territories: [...this.territories.values()].map((t) => ({ ...t })), territoryStats: { ...this.territoryStats }, interactions: { ...this.interactions }, terrAccH: this.terrAccH,
      ...(this.boundary.open ? { boundary: { ...this.boundary }, regional: this.regional.filter((a) => a.alive).map((a) => ({ ...a })), migRng: this.migRng!.state, migration: JSON.parse(JSON.stringify(this.migration)) as MigrationStats, sectorSuit: [...this.sectorSuit], regAccH: this.regAccH } : {}), founders: this.founders,
    };
  }

  private restore(s: SimSnapshot): void {
    this.tick = s.tick;
    this.rng.state = s.rng;
    // older saves: a deterministic stream derived from seed and tick (their future weather differs from what the old
    // shared stream would have produced, but loads stay reproducible)
    this.envRng.state = s.envRng ?? hash3(this.seed, s.tick, 2);
    this.nextId = s.nextId;
    this.env.restore(s.env);
    // fields added after save v1 was defined default sensibly, so older saves load unchanged
    const norm = (a: Animal): Animal => {
      const old = a as Partial<Animal> & Animal;
      return { ...a, waterX: old.waterX ?? NaN, waterZ: old.waterZ ?? NaN, mode: old.mode ?? MODE.Walk, fail1X: old.fail1X ?? NaN, fail1Z: old.fail1Z ?? NaN, fail1Until: old.fail1Until ?? NaN, fail2X: old.fail2X ?? NaN, fail2Z: old.fail2Z ?? NaN, fail2Until: old.fail2Until ?? NaN, fail3X: old.fail3X ?? NaN, fail3Z: old.fail3Z ?? NaN, fail3Until: old.fail3Until ?? NaN, fail4X: old.fail4X ?? NaN, fail4Z: old.fail4Z ?? NaN, fail4Until: old.fail4Until ?? NaN, want: old.want ?? a.speed, steer: old.steer ?? 0, chkT: old.chkT ?? 0, chkD: old.chkD ?? 0, stuck: old.stuck ?? 0, cx: old.cx ?? a.x, cz: old.cz ?? a.z, ctx: old.ctx ?? a.tx, ctz: old.ctz ?? a.tz, bestD: old.bestD ?? Infinity };
    };
    this.animals = s.animals.map(norm);
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
    if (s.eaten) this.eaten = [...s.eaten];
    this.territories.clear();
    for (const t of s.territories ?? []) this.territories.set(t.group, { ...t });
    if (s.territoryStats) this.territoryStats = { ...s.territoryStats };
    this.interactions = { ...emptyInteractions(), ...(s.interactions ?? {}) };
    this.terrAccH = s.terrAccH ?? 0;
    this.founders = s.founders ?? 0;
    if (s.boundary?.open) {
      this.boundary = { ...s.boundary };
      this.migRng = new Rng(0);
      this.migRng.state = s.migRng!;
      this.migration = JSON.parse(JSON.stringify(s.migration)) as MigrationStats;
      this.sectorSuit = [...(s.sectorSuit ?? [])];
      this.regAccH = s.regAccH ?? 0;
      this.regional = (s.regional ?? []).map(norm);
      for (const a of this.regional) this.byId.set(a.id, a);
    }
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
    mix(this.envRng.state);
    if (this.boundary.open) {
      for (const a of this.regional) {
        if (!a.alive) continue;
        mix(a.id); mix(a.x); mix(a.z); mix(a.hunger); mix(a.health);
      }
      mix(this.migRng!.state);
    }
    return h;
  }
}
