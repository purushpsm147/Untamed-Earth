/**
 * Ecological diagnostics observer (Mission 4). OPT-IN and SIMULATION-NEUTRAL BY CONSTRUCTION: it is never referenced
 * by the simulation; a script attaches it, it subscribes to the simulation's existing events (birth, death, kill,
 * alarm) and reads animal/environment state after each step. It never writes state and never calls anything that
 * draws from either random stream (tests/unit/ecology-observer.test.ts proves identical state, RNG and replay).
 *
 * Calendar: one life-year is 48 game days (LIFE_COMPRESSION 7.6); four 12-day seasons.
 */
import { B, BEHAVIOR_NAMES, DEATH_CAUSES, SPECIES, Simulation, maturityDays, type DeathCause } from '@untamed/ecology';

const SEASON_NAMES = ['Winter', 'Summer', 'Monsoon', 'Post-monsoon'];
const NS = SPECIES.length;
const zeros = (): number[] => SPECIES.map(() => 0);

export interface DaySample {
  day: number;
  season: number;
  pops: number[];
  juveniles: number[];
  adultFemales: number[];
  pregnant: number[];
  /** Adult females in breeding season that are blocked by hunger >= 0.6 / health <= 0.55 (receptivity rules). */
  femalesHungerBlocked: number[];
  hungerMean: number[];
  thirstMean: number[];
  healthMean: number[];
  starving: number[]; // hunger >= 1
  parched: number[]; // thirst >= 0.9
  /** Of animals with thirst > 0.7: share that remember no drinking site. */
  thirstyNoWaterMemory: number[];
  intakeKgPerCapita: number[];
  vegMeanValley: number;
  /** Mean usable forage fraction in the cells where chital stand. */
  vegAtChital: number;
  /** Per chital herd (mean over herds): 90th-percentile forage fraction on a fixed ring of points within 150 m / 400 m. */
  vegNearHerd150: number;
  vegNearHerd400: number;
  /** Mean distance of chital from their (fixed) home-range centre, m. */
  chitalFromHome: number;
  stage: number;
  rainMm: number;
}

export class EcoObserver {
  readonly days: DaySample[] = [];
  readonly births = SPECIES.map(() => SEASON_NAMES.map(() => 0));
  readonly litters = zeros();
  /** deaths[species][cause] and by season / life stage */
  readonly deaths = SPECIES.map(() => Object.fromEntries(DEATH_CAUSES.map((c) => [c, 0])) as Record<DeathCause, number>);
  readonly deathsBySeason = SPECIES.map(() => SEASON_NAMES.map(() => 0));
  readonly juvenileDeaths = SPECIES.map(() => Object.fromEntries(DEATH_CAUSES.map((c) => [c, 0])) as Record<DeathCause, number>);
  readonly deathAges: number[][] = SPECIES.map(() => []);
  /** Context of each dehydration death: remembered water?, behaviour, distance to river centreline, age, life stage. */
  readonly dehydration: { sp: string; day: number; rememberedWater: boolean; behaviour: string; riverDistM: number; ageDays: number; juvenile: boolean }[] = [];
  /** behaviour time budget: samples[species][behaviour] (hourly) */
  readonly budget = SPECIES.map(() => BEHAVIOR_NAMES.map(() => 0));
  /** habitat use: weighted samples[species][forest, meadow, wetland, settlement, dump] */
  readonly habitat = SPECIES.map(() => [0, 0, 0, 0, 0]);
  readonly distancePerDay = zeros();
  readonly alarms = zeros();
  /** jackal hunting */
  readonly hunt = {
    stalks: 0, chases: 0, chasesBySpecies: zeros(), kills: 0, killsBySpecies: zeros(), escapes: 0, chaseSeconds: 0, killsOutsideChase: 0,
    /** why chases that did not kill ended: attack made but missed, jackal exhausted, prey out of range (> 95 m), other */
    failed: { attackMissed: 0, exhausted: 0, outran: 0, other: 0 },
    /** closest approach (m) in failed chases, summed (divide by escapes) */
    closestSum: 0,
  };
  /**
   * Reproduction (hourly, adult females; receptivity rules replicated read-only from Simulation.receptive):
   * eligible = adult, in season, not pregnant; receptiveHours = also cooldown over, hunger < 0.6, health > 0.55 and
   * (pair breeders) the oldest female of her group; maleNearHours = receptive with an adult male within vision.
   * blockedBy counts the first failing rule for eligible-but-not-receptive hours. Conceptions / failed matings are
   * detected from pregnantH and cooldownH transitions.
   */
  readonly repro = SPECIES.map(() => ({ eligibleHours: 0, receptiveHours: 0, maleNearHours: 0, conceptions: 0, failedMatings: 0, blockedBy: { cooldown: 0, hunger: 0, health: 0, notDominant: 0 } }));
  private prevRepro = new Map<number, { preg: number; cool: number }>();
  /**
   * Pair breeders, in season, hourly: distance from each adult female to her own group's nearest adult male and to the
   * nearest adult male of any group, bucketed: <50 m, 50-150, 150-400, >400, none alive.
   */
  readonly pairDistance = { ownMale: [0, 0, 0, 0, 0], anyMale: [0, 0, 0, 0, 0] };
  /** cohort survival: id -> birth day; and outcome */
  private readonly born = new Map<number, { sp: number; day: number }>();
  readonly cohort = SPECIES.map(() => ({ born: 0, reachedMaturity: 0, diedBeforeMaturity: 0 }));

  private sim: Simulation;
  private off: () => void;
  private prevBeh = new Map<number, number>();
  private chaseStart = new Map<number, { t: number; sp: number; killed: boolean; target: number; closest: number }>();
  private lastPos = new Map<number, { x: number; z: number }>();
  private dayDist = zeros();
  private lastEaten: number[];
  private lastDay = -1;
  private tick = 0;
  private rainAcc = 0;

  constructor(sim: Simulation) {
    this.sim = sim;
    this.lastEaten = [...sim.eaten];
    for (const a of sim.animals) this.prevBeh.set(a.id, a.beh);
    this.off = sim.events.on((e) => {
      const season = sim.env.season;
      if (e.type === 'birth') {
        this.births[e.sp]![season]! += e.n;
        this.litters[e.sp]!++;
      } else if (e.type === 'death') {
        const a = sim.byId.get(e.id);
        this.deaths[e.sp]![e.cause]++;
        this.deathsBySeason[e.sp]![season]!++;
        if (a && e.cause === 'dehydration') {
          this.dehydration.push({ sp: SPECIES[e.sp]!.id, day: Math.floor(sim.env.timeH / 24), rememberedWater: !Number.isNaN(a.waterX), behaviour: BEHAVIOR_NAMES[a.beh]!, riverDistM: Math.round(sim.valley.sample(a.x, a.z).riverD), ageDays: +a.age.toFixed(1), juvenile: a.age < maturityDays(SPECIES[e.sp]!) });
        }
        if (a) {
          this.deathAges[e.sp]!.push(a.age);
          if (a.age < maturityDays(SPECIES[e.sp]!)) this.juvenileDeaths[e.sp]![e.cause]++;
        }
        const b = this.born.get(e.id);
        if (b && a && a.age < maturityDays(SPECIES[b.sp]!)) this.cohort[b.sp]!.diedBeforeMaturity++;
      } else if (e.type === 'kill') {
        this.hunt.kills++;
        this.hunt.killsBySpecies[e.sp]!++;
        const c = this.chaseStart.get(e.predator);
        if (c) c.killed = true;
        else this.hunt.killsOutsideChase++;
      } else if (e.type === 'alarm') this.alarms[e.sp]!++;
    });
  }

  detach(): void {
    this.off();
  }

  /** Call after every sim.step(dt). Read-only. */
  afterStep(dt: number): void {
    const sim = this.sim;
    this.tick++;
    this.rainAcc += sim.env.rain * (dt * 60) / 3600;
    const day = Math.floor(sim.env.timeH / 24);
    // behaviour transitions every tick (hunting episodes need it); cheap
    for (const a of sim.animals) {
      if (!a.alive) continue;
      const prev = this.prevBeh.get(a.id);
      if (prev === undefined) {
        // first sight: a newborn (age < 1 day) starts a cohort record
        if (a.age < 1 && a.mother !== 0) {
          this.born.set(a.id, { sp: a.sp, day });
          this.cohort[a.sp]!.born++;
        }
      }
      if (a.sp === 2) {
        if (a.beh === B.Stalk && prev !== B.Stalk) this.hunt.stalks++;
        if (a.beh === B.Chase && prev !== B.Chase) {
          this.hunt.chases++;
          const t = sim.byId.get(a.targetId);
          const tsp = t ? t.sp : 0;
          this.hunt.chasesBySpecies[tsp]!++;
          this.chaseStart.set(a.id, { t: sim.tick, sp: tsp, killed: false, target: a.targetId, closest: t ? Math.hypot(t.x - a.x, t.z - a.z) : Infinity });
        }
        if (a.beh === B.Chase) {
          const c = this.chaseStart.get(a.id);
          const t = c ? sim.byId.get(c.target) : undefined;
          if (c && t) c.closest = Math.min(c.closest, Math.hypot(t.x - a.x, t.z - a.z));
        }
        if (prev === B.Chase && a.beh !== B.Chase) {
          const c = this.chaseStart.get(a.id);
          if (c) {
            this.hunt.chaseSeconds += (sim.tick - c.t) * dt;
            if (!c.killed) {
              this.hunt.escapes++;
              this.hunt.closestSum += Number.isFinite(c.closest) ? c.closest : 0;
              const t = sim.byId.get(c.target);
              const d = t ? Math.hypot(t.x - a.x, t.z - a.z) : Infinity;
              // attack(): a miss sets stamina to exactly 0 and rests 20-40 s; exhaustion ends a chase at stamina < 0.04
              if (a.beh === B.Rest && a.stamina === 0) this.hunt.failed.attackMissed++;
              else if (a.beh === B.Rest && a.stamina < 0.04) this.hunt.failed.exhausted++;
              else if (d > 95) this.hunt.failed.outran++;
              else this.hunt.failed.other++;
            }
            this.chaseStart.delete(a.id);
          }
        }
      }
      this.prevBeh.set(a.id, a.beh);
      // cohort maturity
      const b = this.born.get(a.id);
      if (b && a.age >= maturityDays(SPECIES[a.sp]!)) {
        this.cohort[a.sp]!.reachedMaturity++;
        this.born.delete(a.id);
      }
    }
    // conception / failed mating transitions (every tick)
    for (const a of sim.animals) {
      if (!a.alive || a.sex !== 0) continue;
      const p = this.prevRepro.get(a.id);
      if (p) {
        if (p.preg <= 0 && a.pregnantH > 0) this.repro[a.sp]!.conceptions++;
        else if (a.cooldownH > p.cool + 5 && a.cooldownH <= 6.01 && a.pregnantH <= 0) this.repro[a.sp]!.failedMatings++;
      }
      this.prevRepro.set(a.id, { preg: a.pregnantH, cool: a.cooldownH });
    }
    // hourly samples: behaviour budget, habitat use, movement
    if (this.tick % Math.max(1, Math.round(3600 / 60 / dt)) === 0) {
      this.sampleRepro();
      for (const a of sim.animals) {
        if (!a.alive) continue;
        this.budget[a.sp]![a.beh]!++;
        const s = sim.valley.sample(a.x, a.z);
        const h = this.habitat[a.sp]!;
        h[0] += s.forest; h[1] += s.meadow; h[2] += s.wetland; h[3] += s.settlement; h[4] += s.dump;
        const p = this.lastPos.get(a.id);
        if (p) this.dayDist[a.sp]! += Math.hypot(a.x - p.x, a.z - p.z);
        this.lastPos.set(a.id, { x: a.x, z: a.z });
      }
    }
    if (day !== this.lastDay) {
      if (this.lastDay >= 0) this.sampleDay(this.lastDay);
      this.lastDay = day;
    }
  }

  private sampleRepro(): void {
    const sim = this.sim;
    const season = sim.env.season;
    for (const a of sim.animals) {
      if (!a.alive || a.sex !== 0) continue;
      const sp = SPECIES[a.sp]!;
      if (a.age <= maturityDays(sp) || a.pregnantH > 0) continue;
      if (sp.breedSeasons !== null && !sp.breedSeasons.includes(season)) continue;
      const r = this.repro[a.sp]!;
      r.eligibleHours++;
      let dominant = true;
      if (sp.pairBreeding) for (const o of sim.animals) if (o.alive && o.sp === a.sp && o.group === a.group && o.sex === 0 && o.age > a.age) dominant = false;
      if (sp.pairBreeding) {
        let own = Infinity;
        let any = Infinity;
        for (const m of sim.animals) {
          if (!m.alive || m.sp !== a.sp || m.sex !== 1 || m.age <= maturityDays(sp)) continue;
          const d = Math.hypot(m.x - a.x, m.z - a.z);
          any = Math.min(any, d);
          if (m.group === a.group) own = Math.min(own, d);
        }
        const b = (d: number): number => (d === Infinity ? 4 : d < 50 ? 0 : d < 150 ? 1 : d < 400 ? 2 : 3);
        this.pairDistance.ownMale[b(own)]!++;
        this.pairDistance.anyMale[b(any)]!++;
      }
      if (a.cooldownH > 0) { r.blockedBy.cooldown++; continue; }
      if (a.hunger >= 0.6) { r.blockedBy.hunger++; continue; }
      if (a.health <= 0.55) { r.blockedBy.health++; continue; }
      if (!dominant) { r.blockedBy.notDominant++; continue; }
      r.receptiveHours++;
      const v2 = sp.vision * sp.vision;
      if (sim.animals.some((m) => m.alive && m.sp === a.sp && m.sex === 1 && m.age > maturityDays(sp) && (m.x - a.x) ** 2 + (m.z - a.z) ** 2 < v2)) r.maleNearHours++;
    }
  }

  private sampleDay(day: number): void {
    const sim = this.sim;
    const env = sim.env;
    const pops = zeros(), juv = zeros(), af = zeros(), preg = zeros(), blocked = zeros(), hun = zeros(), thi = zeros(), hea = zeros(), starv = zeros(), parch = zeros(), thirsty = zeros(), noMem = zeros();
    let vegChital = 0;
    let nChital = 0;
    for (const a of sim.animals) {
      if (!a.alive) continue;
      const sp = SPECIES[a.sp]!;
      const mat = maturityDays(sp);
      pops[a.sp]!++;
      if (a.age < mat) juv[a.sp]!++;
      else if (a.sex === 0) {
        af[a.sp]!++;
        if (a.pregnantH > 0) preg[a.sp]!++;
        const inSeason = sp.breedSeasons === null || sp.breedSeasons.includes(env.season);
        if (inSeason && a.pregnantH <= 0 && (a.hunger >= 0.6 || a.health <= 0.55)) blocked[a.sp]!++;
      }
      hun[a.sp]! += a.hunger; thi[a.sp]! += a.thirst; hea[a.sp]! += a.health;
      if (a.hunger >= 1) starv[a.sp]!++;
      if (a.thirst >= 0.9) parch[a.sp]!++;
      if (a.thirst > 0.7) {
        thirsty[a.sp]!++;
        if (Number.isNaN(a.waterX)) noMem[a.sp]!++;
      }
      if (a.sp === 0) {
        vegChital += env.vegFrac(env.cellIndex(a.x, a.z));
        nChital++;
      }
    }
    // forage around each chital herd: fixed sample pattern (no randomness), 90th percentile of what is reachable
    const herds = new Map<number, { x: number; z: number; n: number }>();
    let fromHome = 0;
    for (const a of sim.animals) {
      if (!a.alive || a.sp !== 0) continue;
      const h = herds.get(a.group) ?? { x: 0, z: 0, n: 0 };
      h.x += a.x; h.z += a.z; h.n++;
      herds.set(a.group, h);
      fromHome += Math.hypot(a.x - a.homeX, a.z - a.homeZ);
    }
    const ring = (cx: number, cz: number, R: number): number => {
      const v: number[] = [];
      for (let k = 0; k < 48; k++) {
        const ang = k * 2.39996;
        const r = R * Math.sqrt((k + 0.5) / 48);
        const x = cx + Math.cos(ang) * r;
        const z = cz + Math.sin(ang) * r;
        if (!sim.valley.inBounds(x, z, 12) || sim.valley.waterDepth(x, z, env.stage) > 0.15) continue;
        v.push(env.vegFrac(env.cellIndex(x, z)));
      }
      v.sort((p, q) => p - q);
      return v.length ? v[Math.floor(v.length * 0.9)]! : 0;
    };
    let n150 = 0;
    let n400 = 0;
    for (const h of herds.values()) {
      n150 += ring(h.x / h.n, h.z / h.n, 150);
      n400 += ring(h.x / h.n, h.z / h.n, 400);
    }
    let vegSum = 0;
    for (let c = 0; c < env.veg.length; c++) vegSum += env.vegFrac(c);
    const intake = SPECIES.map((_, i) => (pops[i]! ? (sim.eaten[i]! - this.lastEaten[i]!) / pops[i]! : 0));
    this.lastEaten = [...sim.eaten];
    for (let i = 0; i < NS; i++) this.distancePerDay[i]! += pops[i]! ? this.dayDist[i]! / pops[i]! : 0;
    this.dayDist = zeros();
    const avg = (s: number[]): number[] => s.map((x, i) => (pops[i]! ? +(x / pops[i]!).toFixed(3) : 0));
    this.days.push({
      day, season: env.season, pops, juveniles: juv, adultFemales: af, pregnant: preg, femalesHungerBlocked: blocked,
      hungerMean: avg(hun), thirstMean: avg(thi), healthMean: avg(hea), starving: starv, parched: parch,
      thirstyNoWaterMemory: thirsty.map((t, i) => (t ? +(noMem[i]! / t).toFixed(3) : 0)), intakeKgPerCapita: intake.map((x) => +x.toFixed(3)),
      vegMeanValley: +(vegSum / env.veg.length).toFixed(4), vegAtChital: nChital ? +(vegChital / nChital).toFixed(4) : 0,
      vegNearHerd150: herds.size ? +(n150 / herds.size).toFixed(4) : 0, vegNearHerd400: herds.size ? +(n400 / herds.size).toFixed(4) : 0,
      chitalFromHome: nChital ? Math.round(fromHome / nChital) : 0,
      stage: +env.stage.toFixed(3), rainMm: +this.rainAcc.toFixed(1),
    });
    this.rainAcc = 0;
  }

  /** Summary for reports (behaviour budget as shares, habitat as shares). */
  summary(): Record<string, unknown> {
    const share = (row: number[]): Record<string, number> => {
      const t = row.reduce((s, x) => s + x, 0) || 1;
      return Object.fromEntries(row.map((x, i) => [BEHAVIOR_NAMES[i]!, +(x / t).toFixed(3)]).filter(([, v]) => (v as number) > 0));
    };
    const hab = (row: number[]): Record<string, number> => {
      const t = row.reduce((s, x) => s + x, 0) || 1;
      return Object.fromEntries(['forest', 'meadow', 'wetland', 'settlement', 'dump'].map((k, i) => [k, +(row[i]! / t).toFixed(3)]));
    };
    return {
      births: Object.fromEntries(SPECIES.map((s, i) => [s.id, Object.fromEntries(SEASON_NAMES.map((n, j) => [n, this.births[i]![j]]))])),
      litters: Object.fromEntries(SPECIES.map((s, i) => [s.id, this.litters[i]])),
      deaths: Object.fromEntries(SPECIES.map((s, i) => [s.id, this.deaths[i]])),
      juvenileDeaths: Object.fromEntries(SPECIES.map((s, i) => [s.id, this.juvenileDeaths[i]])),
      deathsBySeason: Object.fromEntries(SPECIES.map((s, i) => [s.id, Object.fromEntries(SEASON_NAMES.map((n, j) => [n, this.deathsBySeason[i]![j]]))])),
      medianDeathAgeDays: Object.fromEntries(SPECIES.map((s, i) => { const a = [...this.deathAges[i]!].sort((x, y) => x - y); return [s.id, a.length ? +a[a.length >> 1]!.toFixed(1) : null]; })),
      cohortSurvivalToMaturity: Object.fromEntries(SPECIES.map((s, i) => { const c = this.cohort[i]!; const done = c.reachedMaturity + c.diedBeforeMaturity; return [s.id, { born: c.born, resolved: done, survived: c.reachedMaturity, rate: done ? +(c.reachedMaturity / done).toFixed(3) : null }]; })),
      behaviourBudget: Object.fromEntries(SPECIES.map((s, i) => [s.id, share(this.budget[i]!)])),
      habitatUse: Object.fromEntries(SPECIES.map((s, i) => [s.id, hab(this.habitat[i]!)])),
      meanDailyDistanceM: Object.fromEntries(SPECIES.map((s, i) => [s.id, this.days.length ? Math.round(this.distancePerDay[i]! / this.days.length) : 0])),
      alarms: Object.fromEntries(SPECIES.map((s, i) => [s.id, this.alarms[i]])),
      reproduction: Object.fromEntries(SPECIES.map((s, i) => [s.id, this.repro[i]])),
      dehydrationDeaths: this.dehydration,
      jackalPairDistanceBuckets: { labels: ['<50', '50-150', '150-400', '>400', 'none'], ...this.pairDistance },
      hunting: { ...this.hunt, chasesBySpecies: Object.fromEntries(SPECIES.map((s, i) => [s.id, this.hunt.chasesBySpecies[i]])), killsBySpecies: Object.fromEntries(SPECIES.map((s, i) => [s.id, this.hunt.killsBySpecies[i]])), successPerChase: this.hunt.chases ? +(this.hunt.kills / this.hunt.chases).toFixed(3) : null, meanClosestFailedM: this.hunt.escapes ? +(this.hunt.closestSum / this.hunt.escapes).toFixed(1) : null },
    };
  }
}
