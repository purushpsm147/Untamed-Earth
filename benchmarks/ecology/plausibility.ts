/**
 * Common-sense behaviour audit (read-only). Attach to a Simulation, call afterStep(dt) after every sim.step(dt), then
 * summary(). It reads animal and terrain state only: no writes, no random draws, no event emission
 * (tests/unit/plausibility-audit.test.ts proves identical state hash and both RNG streams with it attached).
 *
 * It records *candidate* violations with enough context (species, behaviour, depth, step length) to separate genuine
 * implausibility from legitimate species behaviour; the classification is in docs/BEHAVIOUR_AUDIT.md, not here.
 *
 * Units: exposure in animal-hours (game time), rates per animal-day. One step at speed dt covers dt*60 game seconds.
 */
import { B, BEHAVIOR_NAMES, SPECIES, TIME_SCALE, type Animal, type Simulation } from '@untamed/ecology';

const NS = SPECIES.length;
const NB = BEHAVIOR_NAMES.length;
/** Depth above which the simulation itself treats an animal as wading/swimming (move(): step *= 0.4). */
export const SWIM_DEPTH = 0.45;
/** Maximum grades the simulation's steering refuses (simulation.ts MAX_UP_GRADE / MAX_DOWN_GRADE). */
const MAX_UP = 0.95;
const MAX_DOWN = 1.3;
const RESTING = new Set<number>([B.Rest, B.Roost, B.Idle]);
const FEEDING = new Set<number>([B.Forage, B.Feed]);
/** Behaviours with a fixed destination, used for retry-loop detection. */
const GOAL = new Set<number>([B.SeekWater, B.SeekCarrion, B.Forage, B.Rest, B.Roost, B.Regroup, B.Wander]);

export const AUDIT_CATEGORIES = [
  'deepWaterGround', // ground animal standing/moving in water deeper than SWIM_DEPTH
  'birdInWater', // flying species on the ground in water deeper than 0.1 m
  'restInWater', // Rest/Roost/Idle on the ground in water deeper than 0.1 m
  'feedInDeepWater', // Forage/Feed in water deeper than SWIM_DEPTH
  'insideBuilding', // within a building footprint below 2 m altitude
  'passThroughBuilding', // ground step whose path crosses a footprint although both ends are outside
  'gradeExceeded', // ground step steeper than the steering limits
  'shorelineSkip', // ground step that crossed water faster than the species can move through it, or water it may not enter
  'shorelineSkipLegacy', // the Mission 1 definition: crosses water deeper than a fixed 0.45 m, both ends <= 0.3 m (species-blind)
  'groundRoost', // bird settled to roost below 1 m altitude
  'stuckHour', // trying to move (want > 0) for most of a game hour but net displacement < 3 m
  'retryLoop', // re-chose (within 3 m) a destination it abandoned unreached within the past 2 game hours
  'darkTravel', // diurnal species moving faster than half walking speed in darkness while not fleeing
] as const;
export type AuditCategory = (typeof AUDIT_CATEGORIES)[number];

export interface AuditExample {
  cat: AuditCategory;
  day: number;
  hour: number;
  sp: string;
  id: number;
  beh: string;
  x: number;
  z: number;
  alt: number;
  depth: number;
  detail: string;
}

interface Track {
  hourX: number;
  hourZ: number;
  hourT: number;
  hourPath: number;
  hourWant: number;
  wasRoostSettled: boolean;
  wasInWater: boolean;
  wasInside: boolean;
  lastBeh: number;
  lastTx: number;
  lastTz: number;
  lastDist: number;
  /** Abandoned destinations: [x, z, gameHour] ring of 4. */
  abandoned: number[];
}

/** Per-category counts: exposure in animal-hours and episodes, split by species and behaviour. */
interface Tally {
  hours: Float64Array; // [sp]
  episodes: Float64Array; // [sp]
  byBeh: Float64Array; // [sp * NB + beh] episodes
}
const tally = (): Tally => ({ hours: new Float64Array(NS), episodes: new Float64Array(NS), byBeh: new Float64Array(NS * NB) });

export class PlausibilityAudit {
  readonly tallies = new Map<AuditCategory, Tally>(AUDIT_CATEGORIES.map((c) => [c, tally()]));
  readonly animalHours = new Float64Array(NS);
  /** Ground-step length histogram per species: <=0.5, <=1, <=2, <=5, <=10, >10 m. */
  readonly stepHist = SPECIES.map(() => new Float64Array(6));
  /** Exposure (animal-hours) by behaviour, to report Wander/Idle shares. */
  readonly behHours = SPECIES.map(() => new Float64Array(NB));
  /** Exposure in water by depth band (ground, alt < 0.5): (0, 0.1], (0.1, 0.3], (0.3, 0.45], (0.45, 1], > 1 m. */
  readonly depthHours = SPECIES.map(() => new Float64Array(5));
  readonly examples: AuditExample[] = [];
  private readonly exampleCount = new Map<string, number>();
  private readonly tracks = new Map<number, Track>();

  constructor(private readonly sim: Simulation, private readonly maxExamplesPerCatSp = 3) {}

  private depthAt(x: number, z: number): number {
    return this.sim.valley.waterDepth(x, z, this.sim.env.stage);
  }

  private hit(cat: AuditCategory, a: Animal, hours: number, episode: boolean, depth: number, detail: string): void {
    const t = this.tallies.get(cat)!;
    t.hours[a.sp] = t.hours[a.sp]! + hours;
    if (!episode) return;
    t.episodes[a.sp] = t.episodes[a.sp]! + 1;
    t.byBeh[a.sp * NB + a.beh] = t.byBeh[a.sp * NB + a.beh]! + 1;
    const key = `${cat}:${a.sp}`;
    const n = this.exampleCount.get(key) ?? 0;
    if (n >= this.maxExamplesPerCatSp) return;
    this.exampleCount.set(key, n + 1);
    const env = this.sim.env;
    this.examples.push({
      cat, day: Math.floor(env.timeH / 24), hour: +env.hour.toFixed(2), sp: SPECIES[a.sp]!.id, id: a.id, beh: BEHAVIOR_NAMES[a.beh]!,
      x: +a.x.toFixed(1), z: +a.z.toFixed(1), alt: +a.alt.toFixed(2), depth: +depth.toFixed(2), detail,
    });
  }

  /** Call after every sim.step(dt). */
  afterStep(dt: number): void {
    const sim = this.sim;
    const v = sim.valley;
    const hours = (dt * TIME_SCALE) / 3600;
    const gameH = sim.env.timeH;
    const dark = sim.env.daylight() < 0.1;
    for (const a of sim.animals) {
      if (!a.alive) continue;
      const sp = SPECIES[a.sp]!;
      this.animalHours[a.sp] = this.animalHours[a.sp]! + hours;
      this.behHours[a.sp]![a.beh] = this.behHours[a.sp]![a.beh]! + hours;
      let t = this.tracks.get(a.id);
      if (!t) {
        t = { hourX: a.x, hourZ: a.z, hourT: gameH, hourPath: 0, hourWant: 0, wasRoostSettled: false, wasInWater: false, wasInside: false, lastBeh: a.beh, lastTx: a.tx, lastTz: a.tz, lastDist: 0, abandoned: [] };
        this.tracks.set(a.id, t);
      }
      const onGround = a.alt < 0.5;
      const prevGround = a.palt < 0.5;
      const depth = this.depthAt(a.x, a.z);
      const stepLen = Math.hypot(a.x - a.px, a.z - a.pz);

      // ---- water ----
      if (onGround && depth > 0) {
        const band = depth <= 0.1 ? 0 : depth <= 0.3 ? 1 : depth <= SWIM_DEPTH ? 2 : depth <= 1 ? 3 : 4;
        this.depthHours[a.sp]![band] = this.depthHours[a.sp]![band]! + hours;
      }
      const inDeep = onGround && depth > SWIM_DEPTH;
      if (!sp.flies && inDeep) this.hit('deepWaterGround', a, hours, !t.wasInWater, depth, `step ${stepLen.toFixed(1)} m`);
      if (sp.flies && a.alt < 0.3 && depth > 0.1) this.hit('birdInWater', a, hours, !t.wasInWater, depth, '');
      if (onGround && depth > 0.1 && RESTING.has(a.beh) && a.speed < 0.05) this.hit('restInWater', a, hours, !t.wasInWater || t.lastBeh !== a.beh, depth, '');
      if (onGround && depth > SWIM_DEPTH && FEEDING.has(a.beh) && a.speed < 0.05) this.hit('feedInDeepWater', a, hours, !t.wasInWater || t.lastBeh !== a.beh, depth, '');
      t.wasInWater = onGround && depth > (sp.flies ? 0.1 : SWIM_DEPTH);

      // ---- obstacles ----
      const inside = a.alt < 2 && v.blocked(a.x, a.z, 0);
      if (inside) this.hit('insideBuilding', a, hours, !t.wasInside, depth, `alt ${a.alt.toFixed(1)}`);
      t.wasInside = inside;

      // ---- ground steps: histogram, swept checks along the segment ----
      if (onGround && prevGround && stepLen > 0.05) {
        const h = this.stepHist[a.sp]!;
        h[stepLen <= 0.5 ? 0 : stepLen <= 1 ? 1 : stepLen <= 2 ? 2 : stepLen <= 5 ? 3 : stepLen <= 10 ? 4 : 5]! += 1;
        if (stepLen > 0.5) {
          const n = Math.min(64, Math.ceil(stepLen / 0.5));
          const d0 = this.depthAt(a.px, a.pz);
          let maxDepth = Math.max(d0, depth);
          let crossed = false;
          const endsOutside = !v.blocked(a.px, a.pz, 0) && !inside;
          for (let i = 1; i < n; i++) {
            const f = i / n;
            const x = a.px + (a.x - a.px) * f;
            const z = a.pz + (a.z - a.pz) * f;
            maxDepth = Math.max(maxDepth, this.depthAt(x, z));
            if (endsOutside && !crossed && v.blocked(x, z, 0)) crossed = true;
          }
          if (crossed) this.hit('passThroughBuilding', a, 0, true, depth, `step ${stepLen.toFixed(1)} m`);
          if (!sp.flies && d0 <= 0.3 && depth <= 0.3 && maxDepth > SWIM_DEPTH) this.hit('shorelineSkipLegacy', a, 0, true, depth, `step ${stepLen.toFixed(1)} m over ${maxDepth.toFixed(2)} m deep`);
          // species-aware: did the step cross water faster than the species can move through it, or cross water it
          // may not enter? (A narrow band crossed at swimming speed within one tick is legitimate.)
          const loco = (sp as { locomotion?: { wadeDepth: number; swim: string; swimSpeed: number } }).locomotion;
          if (!sp.flies && loco) {
            const maySwim = loco.swim === 'capable' || loco.swim === 'strong' || (loco.swim === 'escape' && a.beh === B.Flee);
            const m = Math.min(128, Math.ceil(stepLen / 0.5));
            const piece = stepLen / m;
            let need = 0;
            let forbidden = false;
            for (let i = 0; i < m; i++) {
              const f = (i + 0.5) / m;
              const d = this.depthAt(a.px + (a.x - a.px) * f, a.pz + (a.z - a.pz) * f);
              if (d > loco.wadeDepth + 0.01 && !maySwim && d > Math.min(d0, depth) + 0.01) forbidden = true;
              const k = d > loco.wadeDepth * 2 ? loco.swimSpeed : d > loco.wadeDepth ? 0.6 : 1;
              need += piece / (sp.run * Math.max(k, 1e-3));
            }
            const dtS = hours * 3600 / TIME_SCALE;
            if (forbidden || need > dtS * 1.1) this.hit('shorelineSkip', a, 0, true, depth, `step ${stepLen.toFixed(1)} m over ${maxDepth.toFixed(2)} m deep: ${forbidden ? 'forbidden water' : `needs ${need.toFixed(2)} s of ${dtS.toFixed(2)} s`}`);
          }
          const grade = (v.heightFast(a.x, a.z) - v.heightFast(a.px, a.pz)) / stepLen;
          if (!sp.flies && (grade > MAX_UP || grade < -MAX_DOWN)) this.hit('gradeExceeded', a, 0, true, depth, `grade ${grade.toFixed(2)} over ${stepLen.toFixed(1)} m`);
        }
      }

      // ---- roosting ----
      const settled = a.beh === B.Roost && Math.hypot(a.tx - a.x, a.tz - a.z) < 1;
      if (sp.flies && settled && a.alt < 1) this.hit('groundRoost', a, hours, !t.wasRoostSettled, depth, `perch height ${a.tAlt.toFixed(1)}`);
      t.wasRoostSettled = sp.flies && settled && a.alt < 1;

      // ---- dark travel ----
      if (dark && sp.activity === 'diurnal' && a.speed > sp.walk * 0.5 && a.beh !== B.Flee) this.hit('darkTravel', a, hours, t.lastBeh !== a.beh, depth, `speed ${a.speed.toFixed(1)}`);

      // ---- retry loops: a goal behaviour ended unreached, then the same destination is chosen again ----
      if (GOAL.has(t.lastBeh) && a.beh === B.Idle && t.lastDist > 2) {
        t.abandoned.push(t.lastTx, t.lastTz, gameH);
        if (t.abandoned.length > 12) t.abandoned.splice(0, 3);
      }
      if (GOAL.has(a.beh) && (a.beh !== t.lastBeh || Math.hypot(a.tx - t.lastTx, a.tz - t.lastTz) > 1)) {
        for (let i = 0; i < t.abandoned.length; i += 3) {
          if (gameH - t.abandoned[i + 2]! < 2 && Math.hypot(a.tx - t.abandoned[i]!, a.tz - t.abandoned[i + 1]!) < 3) {
            this.hit('retryLoop', a, 0, true, depth, `${BEHAVIOR_NAMES[a.beh]} target ${a.tx.toFixed(0)},${a.tz.toFixed(0)}`);
            break;
          }
        }
      }

      // ---- stuck hours ----
      t.hourPath += stepLen;
      if (a.want > 0) t.hourWant += hours;
      if (gameH - t.hourT >= 1) {
        const span = gameH - t.hourT;
        const net = Math.hypot(a.x - t.hourX, a.z - t.hourZ);
        if (t.hourWant > 0.5 * span && net < 3 && !RESTING.has(a.beh) && a.beh !== B.Drink && a.beh !== B.Feed) {
          this.hit('stuckHour', a, span, true, depth, `path ${t.hourPath.toFixed(1)} m, net ${net.toFixed(1)} m`);
        }
        t.hourX = a.x;
        t.hourZ = a.z;
        t.hourT = gameH;
        t.hourPath = 0;
        t.hourWant = 0;
      }
      t.lastBeh = a.beh;
      t.lastTx = a.tx;
      t.lastTz = a.tz;
      t.lastDist = Math.hypot(a.tx - a.x, a.tz - a.z);
    }
  }

  summary(): Record<string, unknown> {
    const animalDays = Array.from(this.animalHours, (h) => h / 24);
    const cats: Record<string, unknown> = {};
    for (const [cat, t] of this.tallies) {
      const perSp: Record<string, unknown> = {};
      SPECIES.forEach((s, i) => {
        if (t.episodes[i] === 0 && t.hours[i] === 0) return;
        const beh: Record<string, number> = {};
        for (let b = 0; b < NB; b++) if (t.byBeh[i * NB + b]) beh[BEHAVIOR_NAMES[b]!] = t.byBeh[i * NB + b]!;
        perSp[s.id] = {
          episodes: t.episodes[i], episodesPerAnimalDay: +(t.episodes[i]! / Math.max(1e-9, animalDays[i]!)).toFixed(5),
          hours: +t.hours[i]!.toFixed(2), shareOfTime: +(t.hours[i]! / Math.max(1e-9, this.animalHours[i]!)).toFixed(6), byBehaviour: beh,
        };
      });
      cats[cat] = perSp;
    }
    const share = (row: Float64Array, i: number): Record<string, number> =>
      Object.fromEntries(Array.from(row, (h, b) => [BEHAVIOR_NAMES[b]!, +(h / Math.max(1e-9, this.animalHours[i]!)).toFixed(4)]).filter(([, x]) => (x as number) > 0));
    return {
      animalDays: Object.fromEntries(SPECIES.map((s, i) => [s.id, +animalDays[i]!.toFixed(2)])),
      categories: cats,
      stepHistogram: Object.fromEntries(SPECIES.map((s, i) => [s.id, Array.from(this.stepHist[i]!)])),
      depthHours: Object.fromEntries(SPECIES.map((s, i) => [s.id, Array.from(this.depthHours[i]!, (h) => +h.toFixed(2))])),
      behaviourShare: Object.fromEntries(SPECIES.map((s, i) => [s.id, share(this.behHours[i]!, i)])),
      examples: this.examples,
    };
  }
}
