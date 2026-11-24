/**
 * CuriosityDirector — Independent, deterministic documentary camera director.
 *
 * Originally by Gemini (PR #6) with GPT-6's safety fixes (PR #8); reworked for Living Valley V1 into a documentary
 * director (docs/CURIOSITY_DIRECTOR.md, "V1 director"):
 * - decisions at a low, fixed cadence (not every frame), neighbourhood-first and bounded;
 * - herds and family groups are subjects in their own right (group shots), not only individuals;
 * - narrative continuity: related subjects (same group, mother/young, predator/prey, events in the same scene) are
 *   preferred over unrelated ones, and an ongoing chase or flight is not cut away from at the maximum hold;
 * - shot planning: side-on profile shots of moving animals with leading room, the 180° rule (the camera stays on its
 *   side of the action), several azimuths tried for a clear line of sight over terrain and ruins;
 * - transitions: nearby subjects are reached by a speed-capped glide; distant ones by a fade-out / cut / fade-in, as a
 *   film editor would, never by a long fast flight (reduced motion cuts sooner and fades more slowly).
 *
 * Architectural contract (unchanged):
 * - Read-only consumer of world snapshots and SimEvents.
 * - Never mutates Simulation, Animal, Environment, or Valley state.
 * - Strictly bounded memory (fixed caps on candidate, event, group and cooldown tables).
 * - Deterministic for identical initial config + ordered inputs + dt steps.
 */

export type SimEventLike =
  | { type: 'birth'; sp: number; id?: number; x: number; z: number; n: number }
  | { type: 'death'; sp: number; id: number; cause: string; x: number; z: number }
  | { type: 'kill'; predator: number; prey: number; sp: number; x: number; z: number }
  | { type: 'alarm'; sp: number; id?: number; x: number; z: number };

/** Minimal read-only animal view required by the director. */
export interface AnimalSnapshotView {
  readonly id: number;
  readonly sp: number;
  readonly x: number;
  readonly z: number;
  readonly alt: number;
  readonly heading: number;
  readonly speed: number;
  readonly beh: number;
  readonly alive: boolean;
  readonly age?: number;
  readonly fear?: number;
  readonly group?: number;
  /** Mother's id (0 = not recorded). Used only for narrative continuity. */
  readonly mother?: number;
  /** Current prey / carcass / mate target id, as the simulation holds it. */
  readonly targetId?: number;
}

/** Minimal read-only environment view required by the director. */
export interface EnvSnapshotView {
  readonly timeH: number;
  readonly weather: 'clear' | 'cloudy' | 'rain' | 'storm';
  readonly cloud: number;
  readonly rain: number;
  readonly wind: number;
  readonly stage: number;
}

/** Minimal read-only terrain/landmark query interface. */
export interface WorldQueryView {
  readonly size: number;
  height(x: number, z: number): number;
  waterSurface(z: number): number;
  readonly buildings?: ReadonlyArray<{
    readonly x: number;
    readonly z: number;
    readonly w: number;
    readonly d: number;
    readonly h: number;
    /** Optional rotation and collapse data from Valley buildings. */
    readonly rot?: number;
    readonly collapse?: number;
  }>;
}

export interface WorldSnapshotView {
  readonly tick: number;
  readonly animals: ReadonlyArray<AnimalSnapshotView>;
  readonly env: EnvSnapshotView;
  readonly world: WorldQueryView;
  /** Optional body length of an animal in metres (species size x growth). Used for framing; defaults to 1.5 m. */
  readonly sizeOf?: (a: AnimalSnapshotView) => number;
  /** Optional O(1) lookup by id (the game passes its id map); otherwise the director scans `animals`. */
  readonly find?: (id: number) => AnimalSnapshotView | undefined;
}

export type SubjectKind = 'event' | 'animal' | 'group' | 'scenic';

/** Why a subject was chosen: shown to the player ("Why this shot") and used by tests. */
export type ShotWhy = 'event' | 'continuity' | 'activity' | 'group' | 'scenic' | 'focus';

export interface ObservationTarget {
  readonly key: string;
  readonly kind: SubjectKind;
  /** The animal the camera frames; for a group shot, the member nearest the group's centre. */
  readonly animalId: number | null;
  readonly eventType: SimEventLike['type'] | null;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly score: number;
  readonly reason: string;
  /** Group subjects: the group id, its living member count and spread radius (m). */
  readonly groupId?: number | null;
  readonly members?: number;
  readonly radius?: number;
  readonly why?: ShotWhy;
  /** Human-readable continuity link to the previous subject, when there is one (e.g. "same herd"). */
  readonly link?: string | null;
  /** Director time (s) at which the event happened, for event subjects. */
  readonly eventAtSec?: number;
}

export interface CameraPose {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly lookX: number;
  readonly lookY: number;
  readonly lookZ: number;
  readonly fov: number;
  /** Scene opacity [0..1]: 1 = fully visible, 0 = black (during a cut). Games draw a fade overlay from it. */
  readonly fadeAlpha: number;
}

/** Shot diagnostics for the HUD and tests. */
export interface ShotInfo {
  /** 'profile' (side-on, moving subject), 'portrait' (still subject), 'wide' (group), 'scenic', 'event'. */
  readonly style: 'profile' | 'portrait' | 'wide' | 'scenic' | 'event';
  readonly why: ShotWhy | null;
  readonly link: string | null;
  readonly cutting: boolean;
  readonly cuts: number;
  readonly glides: number;
  readonly decisions: number;
  readonly losBlockedAzimuths: number;
  readonly clearShot: boolean;
}

export interface DirectorConfig {
  /** Minimum seconds to stay on a subject before switching (unless subject dies/vanishes). */
  readonly minHoldSec: number;
  /** Maximum seconds before forcing a fresh look if another novel subject exists. */
  readonly maxHoldSec: number;
  /** Multiplicative score margin required to preempt the current subject after minHoldSec. */
  readonly switchHysteresis: number;
  /** Cooldown in seconds before re-selecting the exact same subject key. */
  readonly subjectCooldownSec: number;
  /** Cooldown in seconds for a specific event type to avoid event-type fatigue. */
  readonly eventTypeCooldownSec: number;
  /** Maximum distance (meters) for proximity bonus normalization. */
  readonly proximityRangeM: number;
  /** Minimum camera clearance above terrain or water surface (meters). */
  readonly minClearanceM: number;
  /** Reduced-motion accessibility flag: avoids fast orbit sweeps and uses gentle pans/fades. */
  readonly reducedMotion: boolean;
  /** Hard cap on tracked recent events to guarantee bounded memory under saturation. */
  readonly maxEventBuffer: number;
  /** Hard cap on expensive candidate evaluations (line-of-sight shot planning) per decision. */
  readonly maxCandidates: number;
  /** Hard cap on cooldown map entries. */
  readonly maxCooldownEntries: number;
  /** Comfort: maximum camera speed in m/s (reduced motion uses 40% of it). Long transitions glide instead of jumping. */
  readonly maxSpeedMps: number;
  /** Framing: camera distance in body lengths, so a myna and a deer fill a similar part of the frame. */
  readonly bodyLengthsAway: number;
  /** Safety: never frame an animal from closer than this (near plane, foliage, comfort). */
  readonly minStandoffM: number;
  /** Seconds between subject decisions (the camera itself moves every frame). */
  readonly decisionIntervalSec: number;
  /** A new subject further than this from the current camera is reached by a fade cut, not a glide. Infinity = never cut. */
  readonly cutDistanceM: number;
  /** Same, with reduced motion (fades are gentler than long glides). */
  readonly reducedMotionCutDistanceM: number;
  /** Fade-out, black hold and fade-in durations of a cut (s); reduced motion uses 1.6x. */
  readonly fadeOutSec: number;
  readonly fadeHoldSec: number;
  readonly fadeInSec: number;
  /** Smallest group (same group id, alive) that is offered as a group subject. */
  readonly minGroupSize: number;
  /** Hard cap on groups tracked per decision. */
  readonly maxGroups: number;
  /** When the population exceeds this, animals are sampled with a rotating deterministic stride. */
  readonly maxScan: number;
}

export const DEFAULT_DIRECTOR_CONFIG: DirectorConfig = {
  minHoldSec: 8.0,
  maxHoldSec: 22.0,
  switchHysteresis: 1.25,
  subjectCooldownSec: 30.0,
  eventTypeCooldownSec: 10.0,
  proximityRangeM: 450.0,
  minClearanceM: 2.2,
  reducedMotion: false,
  maxEventBuffer: 32,
  maxCandidates: 64,
  maxCooldownEntries: 128,
  maxSpeedMps: 55,
  bodyLengthsAway: 6,
  minStandoffM: 3.5,
  decisionIntervalSec: 0.5,
  cutDistanceM: 160,
  reducedMotionCutDistanceM: 45,
  fadeOutSec: 0.45,
  fadeHoldSec: 0.15,
  fadeInSec: 0.6,
  minGroupSize: 3,
  maxGroups: 256,
  maxScan: 600,
};

/** Behavior constants mirrored from packages/ecology/src/simulation.ts (read-only). */
const BEH = {
  Idle: 0,
  Wander: 1,
  Forage: 2,
  SeekWater: 3,
  Drink: 4,
  Rest: 5,
  Flee: 6,
  SeekMate: 7,
  Stalk: 8,
  Chase: 9,
  SeekCarrion: 10,
  Feed: 11,
  Roost: 12,
  Follow: 13,
  Regroup: 14,
} as const;

/** Behaviours that are a story in progress: the director does not cut away from them at the maximum hold. */
const ONGOING = new Set<number>([BEH.Chase, BEH.Stalk, BEH.Flee, BEH.Feed, BEH.SeekMate]);
/** Shortlist size for line-of-sight shot planning per decision (bounded by maxCandidates). */
const SHORTLIST = 8;

interface BufferedEvent {
  readonly event: SimEventLike;
  readonly receivedAtSec: number;
  readonly baseSignificance: number;
  readonly key: string;
}

interface ScoredCandidate {
  readonly key: string;
  readonly kind: SubjectKind;
  readonly animalId: number | null;
  readonly eventType: SimEventLike['type'] | null;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly score: number;
  readonly reason: string;
  readonly groupId?: number | null;
  readonly members?: number;
  readonly radius?: number;
  readonly why?: ShotWhy;
  readonly link?: string | null;
  readonly eventAtSec?: number;
}

interface GroupInfo {
  id: number;
  sp: number;
  n: number;
  sx: number;
  sz: number;
  sxx: number;
  szz: number;
  act: number;
  fleeing: number;
  moving: number;
  rep: number;
  repD: number;
}

interface Shot {
  key: string;
  style: ShotInfo['style'];
  /** Camera azimuth around the subject (x = cos, z = sin), radians. */
  az: number;
  drift: number;
  standoff: number;
  height: number;
  clear: boolean;
  blocked: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function damp(current: number, target: number, lambda: number, dt: number): number {
  return lerp(current, target, 1 - Math.exp(-lambda * Math.max(0, dt)));
}

function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/** Deterministic scenic anchor points when no animals or salient events are present. */
const SCENIC_ANCHORS: ReadonlyArray<{ key: string; x: number; z: number; reason: string }> = [
  { key: 'scenic:river_bend', x: 720, z: 470, reason: 'Scenic river crossing and bridge' },
  { key: 'scenic:wetland', x: 700, z: 1190, reason: 'Scenic wetland basin' },
  { key: 'scenic:settlement', x: 1010, z: 440, reason: 'Reclaimed settlement ruins' },
  { key: 'scenic:forest_ridge', x: 420, z: 680, reason: 'Forest canopy overlook' },
  { key: 'scenic:dump_overlook', x: 1090, z: 1010, reason: 'Post-industrial scrapyard' },
];

/** Conservative, rotated 2D footprint test for the segment traversed by the camera. */
type BuildingQuery = NonNullable<WorldQueryView['buildings']>[number];

function segmentIntersectsBuilding(
  ax: number, az: number, bx: number, bz: number, b: BuildingQuery, margin = 2,
): boolean {
  const angle = b.rot ?? 0;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const toLocal = (x: number, z: number): [number, number] => {
    // Same convention as Valley.blocked() and the landmark builder: world = (lx·cos + lz·sin, −lx·sin + lz·cos),
    // so local = (dx·cos − dz·sin, dx·sin + dz·cos). (The original used the inverse rotation.)
    const dx = x - b.x, dz = z - b.z;
    return [dx * cos - dz * sin, dx * sin + dz * cos];
  };
  const [x0, z0] = toLocal(ax, az);
  const [x1, z1] = toLocal(bx, bz);
  const halfW = b.w * 0.5 + margin;
  const halfD = b.d * 0.5 + margin;
  let enter = 0, exit = 1;
  for (const [start, end, half] of [[x0, x1, halfW], [z0, z1, halfD]]) {
    const delta = end - start;
    if (Math.abs(delta) < 1e-9) {
      if (Math.abs(start) > half) return false;
    } else {
      const t0 = (-half - start) / delta;
      const t1 = (half - start) / delta;
      enter = Math.max(enter, Math.min(t0, t1));
      exit = Math.min(exit, Math.max(t0, t1));
      if (enter > exit) return false;
    }
  }
  return true;
}

const DEFAULT_SIZE_M = 1.5;
const sizeOf = (snapshot: WorldSnapshotView, a: AnimalSnapshotView): number => Math.max(0.05, snapshot.sizeOf?.(a) ?? DEFAULT_SIZE_M);
/** Aim at the animal's body, not 0.7 m above it: about 40% of its length above its feet, capped at 0.7 m. */
const aimLift = (snapshot: WorldSnapshotView, a: AnimalSnapshotView): number => Math.min(0.7, sizeOf(snapshot, a) * 0.4);
const groundAt = (s: WorldSnapshotView, x: number, z: number): number => Math.max(s.world.height(x, z), s.world.waterSurface(z) + s.env.stage);

export class CuriosityDirector {
  private cfg: DirectorConfig;
  /** Number of subject changes so far (diagnostics / tests). */
  switches = 0;
  private active = false;
  private elapsedSec = 0;
  private holdSec = 0;
  private scenicIndex = 0;
  private decisionT = 0;
  private decisions = 0;
  private cuts = 0;
  private glides = 0;
  private scanOffset = 0;
  /** Running cut: fade out (camera keeps the old shot), hold black, jump, fade in. */
  private cut: { phase: 'out' | 'hold' | 'in'; t: number } | null = null;
  private shot: Shot | null = null;
  private driftSign = 1;
  /** Fresh score of the current subject at the last decision (hysteresis compares against this). */
  private currentScore = 0;
  private readonly groups = new Map<number, GroupInfo>();

  private currentTarget: ObservationTarget | null = null;
  private pose: CameraPose = {
    x: 720,
    y: 35,
    z: 520,
    lookX: 720,
    lookY: 12,
    lookZ: 470,
    fov: 54,
    fadeAlpha: 1,
  };

  private readonly eventBuffer: BufferedEvent[] = [];
  private readonly cooldowns = new Map<string, number>();
  private readonly noveltyCounts = new Map<string, number>();

  constructor(config: Partial<DirectorConfig> = {}) {
    this.cfg = { ...DEFAULT_DIRECTOR_CONFIG, ...config };
  }

  /** Activate Curiosity Mode from the current manual camera position. */
  start(initialPose?: Partial<CameraPose>): void {
    this.active = true;
    this.holdSec = 0;
    this.decisionT = 0;
    this.cut = null;
    this.shot = null;
    // a new session always starts with a fresh decision (the last subject is remembered only for cooldown/novelty)
    this.currentTarget = null;
    if (initialPose) {
      this.pose = { ...this.pose, ...initialPose, fadeAlpha: 1 };
    }
  }

  /** Immediately interrupt Curiosity Mode (e.g., on manual camera input or possess). */
  interrupt(): void {
    this.active = false;
    this.cut = null;
    this.pose = { ...this.pose, fadeAlpha: 1 };
  }

  /** Toggle the reduced-motion profile at runtime (accessibility setting). */
  setReducedMotion(on: boolean): void {
    this.cfg = { ...this.cfg, reducedMotion: on };
  }

  get config(): Readonly<DirectorConfig> {
    return this.cfg;
  }

  /**
   * Observe a specific animal now (e.g. one the player picked). Read-only like everything else here.
   * Returns false if the animal is not in the snapshot or is dead.
   */
  focus(snapshot: WorldSnapshotView, animalId: number): boolean {
    if (!this.active) return false;
    const a = this.findAnimal(snapshot, animalId);
    if (!a || !a.alive) return false;
    this.adoptTarget(snapshot, { key: `animal:${a.id}`, kind: 'animal', animalId: a.id, eventType: null, x: a.x, y: groundAt(snapshot, a.x, a.z) + a.alt + aimLift(snapshot, a), z: a.z, score: 1, reason: `Wildlife #${a.id} (${this.behaviorLabel(a.beh)})`, why: 'focus', link: null });
    this.currentScore = 1;
    return true;
  }

  isActive(): boolean {
    return this.active;
  }

  getCurrentTarget(): ObservationTarget | null {
    return this.currentTarget;
  }

  getPose(): CameraPose {
    return this.pose;
  }

  /** True while a fade cut is running (captions should wait for the new picture). */
  isCutting(): boolean {
    return this.cut !== null;
  }

  getShotInfo(): ShotInfo {
    return {
      style: this.shot?.style ?? (this.currentTarget?.kind === 'scenic' ? 'scenic' : 'portrait'),
      why: this.currentTarget?.why ?? null,
      link: this.currentTarget?.link ?? null,
      cutting: this.cut !== null,
      cuts: this.cuts,
      glides: this.glides,
      decisions: this.decisions,
      losBlockedAzimuths: this.shot?.blocked ?? 0,
      clearShot: this.shot?.clear ?? true,
    };
  }

  /** Seconds since the director started (events carry their receive time on this clock). */
  get clock(): number {
    return this.elapsedSec;
  }

  /** Diagnostic counts to verify bounded memory invariants in tests. */
  getResourceStats(): { eventBufferSize: number; cooldownSize: number; noveltySize: number; groupSize: number } {
    return {
      eventBufferSize: this.eventBuffer.length,
      cooldownSize: this.cooldowns.size,
      noveltySize: this.noveltyCounts.size,
      groupSize: this.groups.size,
    };
  }

  /** Clear all state and buffers deterministically. */
  reset(): void {
    this.active = false;
    this.elapsedSec = 0;
    this.holdSec = 0;
    this.scenicIndex = 0;
    this.decisionT = 0;
    this.decisions = 0;
    this.cuts = 0;
    this.glides = 0;
    this.scanOffset = 0;
    this.cut = null;
    this.shot = null;
    this.driftSign = 1;
    this.currentScore = 0;
    this.currentTarget = null;
    this.eventBuffer.length = 0;
    this.cooldowns.clear();
    this.noveltyCounts.clear();
    this.groups.clear();
  }

  /** Force skip to the next best subject on the next update. */
  skip(snapshot: WorldSnapshotView): ObservationTarget | null {
    if (!this.active) return null;
    const excludedKey = this.currentTarget?.key;
    if (this.currentTarget) {
      this.recordCooldown(this.currentTarget.key, this.cfg.subjectCooldownSec);
      if (this.currentTarget.eventType) {
        this.recordCooldown(`eventType:${this.currentTarget.eventType}`, this.cfg.eventTypeCooldownSec);
      }
    }
    // A cooldown only *discourages* reuse. A user-requested Skip must explicitly
    // exclude the prior target, even when it has the highest biological score.
    const next = this.selectBestCandidate(snapshot, excludedKey);
    this.adoptTarget(snapshot, next);
    this.stepCamera(snapshot, this.currentTarget!, 0);
    return this.currentTarget;
  }

  /**
   * Ingest a simulation event without mutating it.
   * Bounded ring-eviction prevents unbounded growth under event saturation.
   */
  pushEvent(event: SimEventLike): void {
    const baseSignificance = this.eventSignificance(event);
    const key = this.eventKey(event);

    if (this.eventBuffer.length >= this.cfg.maxEventBuffer) {
      // Evict the lowest-scoring or oldest event deterministically
      let evictIdx = 0;
      let lowestScore = Infinity;
      for (let i = 0; i < this.eventBuffer.length; i++) {
        const b = this.eventBuffer[i]!;
        const age = Math.max(0, this.elapsedSec - b.receivedAtSec);
        const eff = b.baseSignificance * Math.exp(-age / 12);
        if (eff < lowestScore) {
          lowestScore = eff;
          evictIdx = i;
        }
      }
      // If incoming event is weaker than all buffered events, drop it
      if (baseSignificance <= lowestScore) {
        return;
      }
      this.eventBuffer.splice(evictIdx, 1);
    }

    this.eventBuffer.push({
      event,
      receivedAtSec: this.elapsedSec,
      baseSignificance,
      key,
    });
    // a significant event is worth an earlier look than the regular cadence
    if (baseSignificance >= 0.7) this.decisionT = Math.max(this.decisionT, this.cfg.decisionIntervalSec);
  }

  /**
   * Advance the director by dt seconds using a read-only world snapshot.
   * Returns the active observation target (or null if inactive).
   */
  update(snapshot: WorldSnapshotView, dt: number): ObservationTarget | null {
    if (!this.active) return null;

    const safeDt = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.25);
    this.elapsedSec += safeDt;
    this.holdSec += safeDt;
    this.decisionT += safeDt;

    this.pruneExpiredEvents();

    let currentTracked = this.currentTarget ? this.refreshCurrentTarget(snapshot, this.currentTarget) : null;
    const lost = this.currentTarget !== null && currentTracked === null;
    if (currentTracked) this.currentTarget = currentTracked;

    if (!this.currentTarget || lost || this.decisionT >= this.cfg.decisionIntervalSec) {
      this.decisionT = 0;
      this.decisions++;
      const best = this.selectBestCandidate(snapshot);
      if (!this.currentTarget || lost) {
        // nothing yet, or the current animal died or disappeared: switch immediately
        this.adoptTarget(snapshot, best);
      } else {
        currentTracked = this.currentTarget;
        const ongoing = this.isOngoing(snapshot, currentTracked);
        const maxHold = ongoing ? this.cfg.maxHoldSec * 1.6 : this.cfg.maxHoldSec;
        const holdExpired = this.holdSec >= maxHold;
        const canPreempt =
          this.holdSec >= this.cfg.minHoldSec &&
          best.key !== currentTracked.key &&
          best.score >= this.currentScore * this.cfg.switchHysteresis;

        if ((holdExpired && best.key !== currentTracked.key) || canPreempt) {
          this.recordCooldown(currentTracked.key, this.cfg.subjectCooldownSec);
          if (currentTracked.eventType) {
            this.recordCooldown(`eventType:${currentTracked.eventType}`, this.cfg.eventTypeCooldownSec);
          }
          this.adoptTarget(snapshot, best);
        } else if (this.shot && !this.cut) {
          // still on the same subject: re-plan the angle only if the view became blocked (hysteresis on angle)
          this.maybeReplan(snapshot, this.currentTarget);
        }
      }
    }

    if (this.currentTarget) {
      this.stepCamera(snapshot, this.currentTarget, safeDt);
    }

    return this.currentTarget;
  }

  private findAnimal(snapshot: WorldSnapshotView, id: number): AnimalSnapshotView | undefined {
    if (snapshot.find) return snapshot.find(id);
    for (let i = 0; i < snapshot.animals.length; i++) if (snapshot.animals[i]!.id === id) return snapshot.animals[i];
    return undefined;
  }

  private isOngoing(snapshot: WorldSnapshotView, t: ObservationTarget): boolean {
    if (t.kind === 'group') {
      const g = t.groupId != null ? this.groups.get(t.groupId) : undefined;
      return !!g && g.fleeing >= 2;
    }
    if (t.animalId === null) return false;
    const a = this.findAnimal(snapshot, t.animalId);
    return !!a && a.alive && ONGOING.has(a.beh);
  }

  private adoptTarget(snapshot: WorldSnapshotView, candidate: ScoredCandidate): void {
    const previous = this.currentTarget;
    this.currentTarget = {
      key: candidate.key,
      kind: candidate.kind,
      animalId: candidate.animalId,
      eventType: candidate.eventType,
      x: candidate.x,
      y: candidate.y,
      z: candidate.z,
      score: candidate.score,
      reason: candidate.reason,
      groupId: candidate.groupId ?? null,
      members: candidate.members,
      radius: candidate.radius,
      why: candidate.why,
      link: candidate.link ?? null,
      eventAtSec: candidate.eventAtSec,
    };
    this.currentScore = candidate.score;
    this.holdSec = 0;
    this.switches++;
    const prevCount = this.noveltyCounts.get(candidate.key) ?? 0;
    this.setBoundedMap(this.noveltyCounts, candidate.key, prevCount + 1, this.cfg.maxCooldownEntries);
    this.driftSign = -this.driftSign;

    // Transition: a nearby subject is reached by a glide, a distant one by a cut (editing, not flying).
    const shot = this.planShot(snapshot, this.currentTarget, previous);
    const dx = shot.camX - this.pose.x;
    const dz = shot.camZ - this.pose.z;
    const far = Math.hypot(dx, dz);
    const cutAt = this.cfg.reducedMotion ? this.cfg.reducedMotionCutDistanceM : this.cfg.cutDistanceM;
    this.shot = shot.shot;
    if (previous && previous.key === candidate.key) return;
    if (this.cut) {
      // already cutting: the running cut lands on the new subject. If it was fading in, fade out again from the
      // current opacity (never flash back to full picture first).
      if (this.cut.phase === 'in') {
        const rm = this.cfg.reducedMotion ? 1.6 : 1;
        this.cut = { phase: 'out', t: (1 - this.pose.fadeAlpha) * this.cfg.fadeOutSec * rm };
      }
      return;
    }
    if (far > cutAt) {
      this.cut = { phase: 'out', t: 0 };
      this.cuts++;
    } else {
      this.cut = null;
      this.glides++;
    }
  }

  private refreshCurrentTarget(
    snapshot: WorldSnapshotView,
    target: ObservationTarget,
  ): ObservationTarget | null {
    if (target.kind === 'group') {
      // group centre is refreshed at decisions; between them the camera follows the representative member
      const rep = target.animalId === null ? undefined : this.findAnimal(snapshot, target.animalId);
      const g = target.groupId != null ? this.groups.get(target.groupId) : undefined;
      if ((!rep || !rep.alive) && (!g || g.n === 0)) return null;
      return target;
    }
    if (target.animalId === null) {
      return target;
    }
    const a = this.findAnimal(snapshot, target.animalId);
    if (!a) return null;
    if (!a.alive) return null;
    return {
      ...target,
      x: a.x,
      y: groundAt(snapshot, a.x, a.z) + a.alt + aimLift(snapshot, a),
      z: a.z,
    };
  }

  // ------------------------------------------------------------------ candidate selection
  /** One bounded pass: group aggregates (centre, spread, activity) keyed by group id. */
  private rebuildGroups(snapshot: WorldSnapshotView): void {
    this.groups.clear();
    const animals = snapshot.animals;
    for (let i = 0; i < animals.length; i++) {
      const a = animals[i]!;
      if (!a.alive || !a.group) continue;
      let g = this.groups.get(a.group);
      if (!g) {
        if (this.groups.size >= this.cfg.maxGroups) continue;
        g = { id: a.group, sp: a.sp, n: 0, sx: 0, sz: 0, sxx: 0, szz: 0, act: 0, fleeing: 0, moving: 0, rep: a.id, repD: Infinity };
        this.groups.set(a.group, g);
      }
      if (a.sp !== g.sp) continue;
      g.n++;
      g.sx += a.x;
      g.sz += a.z;
      g.sxx += a.x * a.x;
      g.szz += a.z * a.z;
      g.act += this.behaviorSignificance(a);
      if (a.beh === BEH.Flee) g.fleeing++;
      if (a.speed > 0.8) g.moving++;
    }
    // representative: the member nearest the centre (second bounded pass only over grouped animals)
    for (let i = 0; i < animals.length; i++) {
      const a = animals[i]!;
      if (!a.alive || !a.group) continue;
      const g = this.groups.get(a.group);
      if (!g || g.sp !== a.sp || g.n === 0) continue;
      const d = (a.x - g.sx / g.n) ** 2 + (a.z - g.sz / g.n) ** 2;
      if (d < g.repD || (d === g.repD && a.id < g.rep)) {
        g.repD = d;
        g.rep = a.id;
      }
    }
  }

  private groupRadius(g: GroupInfo): number {
    const mx = g.sx / g.n;
    const mz = g.sz / g.n;
    const v = Math.max(0, g.sxx / g.n - mx * mx) + Math.max(0, g.szz / g.n - mz * mz);
    // ~1.6 standard deviations covers most of the group
    return Math.sqrt(v) * 1.6 + 1.5;
  }

  /** Narrative link of a candidate to the current subject: [factor, description]. */
  private continuity(snapshot: WorldSnapshotView, c: { key: string; animal?: AnimalSnapshotView; groupId?: number | null; x: number; z: number; event?: boolean }): [number, string | null] {
    const cur = this.currentTarget;
    if (!cur || cur.key === c.key) return [1, null];
    const curAnimal = cur.animalId !== null ? this.findAnimal(snapshot, cur.animalId) : undefined;
    const curGroup = cur.kind === 'group' ? cur.groupId ?? null : curAnimal?.group ?? null;
    const a = c.animal;
    if (a && curAnimal && cur.kind !== 'group') {
      if (curAnimal.targetId === a.id && (curAnimal.beh === BEH.Chase || curAnimal.beh === BEH.Stalk)) return [1.55, 'the animal it was hunting'];
      if (a.targetId === curAnimal.id && (a.beh === BEH.Chase || a.beh === BEH.Stalk)) return [1.55, 'the predator hunting it'];
      if (a.mother === curAnimal.id) return [1.45, 'its offspring'];
      if (curAnimal.mother === a.id) return [1.45, 'its mother'];
    }
    if (curGroup && ((a && a.group === curGroup) || c.groupId === curGroup)) return [1.3, 'the same group'];
    if (c.event) {
      const d = Math.hypot(c.x - this.pose.lookX, c.z - this.pose.lookZ);
      if (d < 150) return [1.25, 'in the same scene'];
    }
    return [1, null];
  }

  private selectBestCandidate(snapshot: WorldSnapshotView, excludedKey?: string): ScoredCandidate {
    this.rebuildGroups(snapshot);
    const curKey = this.currentTarget?.key;
    let currentFresh = -1;
    let best: ScoredCandidate | null = null;
    const better = (c: ScoredCandidate): boolean => !best || c.score > best.score || (c.score === best.score && c.key < best.key);

    // 1. Buffered events (few, bounded by maxEventBuffer)
    for (let i = 0; i < this.eventBuffer.length; i++) {
      const b = this.eventBuffer[i]!;
      if (b.key === excludedKey) continue;
      const e = b.event;
      const age = Math.max(0, this.elapsedSec - b.receivedAtSec);
      const decay = Math.exp(-age / 14);
      const proximity = this.proximityFactor(e.x, e.z);
      const novelty = this.noveltyFactor(b.key, b.key === curKey);
      const cooldown = this.cooldownFactor(b.key) * this.cooldownFactor(`eventType:${e.type}`);
      const visibility = this.visibilityFactor(snapshot.world, e.x, e.z);
      const animalId = e.type === 'kill' ? e.predator : e.type !== 'death' && e.id !== undefined ? e.id : null;
      const subject = animalId !== null ? this.findAnimal(snapshot, animalId) : undefined;
      // something left to film? The animal named by the event alive and present; otherwise only the place.
      const observable = animalId === null ? 0.8 : subject && subject.alive ? 1 : 0.5;
      const [link, linkText] = this.continuity(snapshot, { key: b.key, animal: subject, x: e.x, z: e.z, event: true });
      const score = b.baseSignificance * decay * proximity * novelty * cooldown * visibility * observable * link;
      if (b.key === curKey) currentFresh = score;
      const x = subject && subject.alive ? subject.x : e.x;
      const z = subject && subject.alive ? subject.z : e.z;
      const cand: ScoredCandidate = {
        key: b.key,
        kind: 'event',
        animalId,
        eventType: e.type,
        x,
        y: groundAt(snapshot, x, z) + (subject && subject.alive ? subject.alt + aimLift(snapshot, subject) : 0.8),
        z,
        score,
        reason: `Event: ${e.type}`,
        why: linkText ? 'continuity' : 'event',
        link: linkText,
        eventAtSec: b.receivedAtSec,
      };
      if (better(cand)) best = cand;
    }

    // 2. Animals: a cheap score for every living animal (rotating stride above maxScan), then a short list
    const animals = snapshot.animals;
    const n = animals.length;
    const shortlist: ScoredCandidate[] = [];
    if (n > 0) {
      const stride = n <= this.cfg.maxScan ? 1 : Math.ceil(n / this.cfg.maxScan);
      this.scanOffset = stride > 1 ? (this.scanOffset + 1) % stride : 0;
      for (let i = this.scanOffset; i < n; i += stride) {
        const a = animals[i]!;
        if (!a.alive) continue;
        const key = `animal:${a.id}`;
        if (key === excludedKey) continue;
        let sig = this.behaviorSignificance(a);
        // a calm member of a herd is better shown as part of the herd (the group candidate below)
        const g = a.group ? this.groups.get(a.group) : undefined;
        if (g && g.n >= this.cfg.minGroupSize && !ONGOING.has(a.beh) && a.beh !== BEH.Follow) sig *= 0.8;
        const proximity = this.proximityFactor(a.x, a.z);
        const novelty = this.noveltyFactor(key, key === curKey);
        const cooldown = this.cooldownFactor(key);
        const [link, linkText] = this.continuity(snapshot, { key, animal: a, x: a.x, z: a.z });
        const score = sig * proximity * novelty * cooldown * link;
        const cand: ScoredCandidate = {
          key,
          kind: 'animal',
          animalId: a.id,
          eventType: null,
          x: a.x,
          y: groundAt(snapshot, a.x, a.z) + a.alt + aimLift(snapshot, a),
          z: a.z,
          score,
          reason: `Wildlife #${a.id} (${this.behaviorLabel(a.beh)})`,
          why: linkText ? 'continuity' : 'activity',
          link: linkText,
        };
        if (key === curKey) currentFresh = score * this.visibilityFactor(snapshot.world, a.x, a.z);
        this.pushShortlist(shortlist, cand);
      }
    }

    // 3. Groups
    for (const g of this.groups.values()) {
      if (g.n < this.cfg.minGroupSize) continue;
      const key = `group:${g.id}`;
      if (key === excludedKey) continue;
      const cx = g.sx / g.n;
      const cz = g.sz / g.n;
      const meanAct = g.act / g.n;
      let sig = 0.36 + Math.max(0, meanAct - 0.25) * 0.8 + Math.min(0.12, g.n * 0.008);
      if (g.fleeing >= 2) sig += 0.35;
      sig = Math.min(0.95, sig);
      const proximity = this.proximityFactor(cx, cz);
      const novelty = this.noveltyFactor(key, key === curKey);
      const cooldown = this.cooldownFactor(key);
      const [link, linkText] = this.continuity(snapshot, { key, groupId: g.id, x: cx, z: cz });
      const score = sig * proximity * novelty * cooldown * link;
      const cand: ScoredCandidate = {
        key,
        kind: 'group',
        animalId: g.rep,
        eventType: null,
        x: cx,
        y: groundAt(snapshot, cx, cz) + 0.6,
        z: cz,
        score,
        reason: `Group of ${g.n}${g.fleeing >= 2 ? ' in flight' : ''}`,
        groupId: g.id,
        members: g.n,
        radius: this.groupRadius(g),
        why: linkText ? 'continuity' : g.fleeing >= 2 ? 'activity' : 'group',
        link: linkText,
      };
      if (key === curKey) currentFresh = score;
      this.pushShortlist(shortlist, cand);
    }

    // 4. Line-of-sight check only for the short list (bounded work per decision)
    const limit = Math.min(SHORTLIST, this.cfg.maxCandidates);
    for (let i = 0; i < shortlist.length && i < limit; i++) {
      const c = shortlist[i]!;
      const vis = this.visibilityFactor(snapshot.world, c.x, c.z);
      const scored = { ...c, score: c.score * vis };
      if (better(scored)) best = scored;
    }

    // 5. Scenic fallback if no salient animals/events or all are on deep cooldown
    if (!best || best.score < 0.08) {
      const scenic = this.pickScenicFallback(snapshot, excludedKey);
      if (scenic.key === curKey) currentFresh = scenic.score;
      if (!best || scenic.score > best.score) {
        best = scenic;
      }
    }

    // keep the stored score of the current subject current (hysteresis compares against what it is worth now)
    if (curKey && currentFresh >= 0) this.currentScore = currentFresh;
    else if (curKey && this.currentTarget?.kind === 'scenic') this.currentScore = Math.max(0.05, this.currentScore * 0.98);
    return best!;
  }

  private pushShortlist(list: ScoredCandidate[], c: ScoredCandidate): void {
    // insertion into a small descending list (deterministic tie-break on key)
    let i = list.length;
    while (i > 0 && (list[i - 1]!.score < c.score || (list[i - 1]!.score === c.score && list[i - 1]!.key > c.key))) i--;
    if (i >= SHORTLIST) return;
    list.splice(i, 0, c);
    if (list.length > SHORTLIST) list.length = SHORTLIST;
  }

  private pickScenicFallback(snapshot: WorldSnapshotView, excludedKey?: string): ScoredCandidate {
    let chosen = SCENIC_ANCHORS[this.scenicIndex % SCENIC_ANCHORS.length]!;
    let bestScore = -1;

    for (let i = 0; i < SCENIC_ANCHORS.length; i++) {
      const anchor = SCENIC_ANCHORS[i]!;
      if (anchor.key === excludedKey) continue;
      const weatherBonus = snapshot.env.weather === 'storm' || snapshot.env.weather === 'rain' ? 0.14 : 0.1;
      const s = weatherBonus * this.noveltyFactor(anchor.key, anchor.key === this.currentTarget?.key) * this.cooldownFactor(anchor.key);
      if (s > bestScore) {
        bestScore = s;
        chosen = anchor;
        this.scenicIndex = i;
      }
    }

    const x = clamp(chosen.x, 16, Math.max(16, snapshot.world.size - 16));
    const z = clamp(chosen.z, 16, Math.max(16, snapshot.world.size - 16));
    const y = groundAt(snapshot, x, z) + 2.0;

    return {
      key: chosen.key,
      kind: 'scenic',
      animalId: null,
      eventType: null,
      x,
      y,
      z,
      score: Math.max(0.05, bestScore),
      reason:
        snapshot.env.weather === 'storm'
          ? `${chosen.reason} during storm`
          : chosen.reason,
      why: 'scenic',
      link: null,
    };
  }

  // ------------------------------------------------------------------ shot planning
  /** Is the straight line from a camera position to the subject clear of terrain and ruins? */
  private lineClear(snapshot: WorldSnapshotView, cx: number, cy: number, cz: number, tx: number, ty: number, tz: number): boolean {
    for (let k = 1; k <= 6; k++) {
      const t = k / 7;
      const x = lerp(cx, tx, t);
      const z = lerp(cz, tz, t);
      if (snapshot.world.height(x, z) + 0.3 > lerp(cy, ty, t)) return false;
    }
    const buildings = snapshot.world.buildings;
    if (buildings) {
      for (const b of buildings) {
        if (!segmentIntersectsBuilding(cx, cz, tx, tz, b, 0.5)) continue;
        const roof = snapshot.world.height(b.x, b.z) + b.h * (1 - (b.collapse ?? 0) * 0.4);
        if (Math.min(cy, ty) < roof) return false;
      }
    }
    return true;
  }

  private shotDistances(snapshot: WorldSnapshotView, target: ObservationTarget): { standoff: number; height: number; style: ShotInfo['style'] } {
    if (target.kind === 'group') {
      const r = target.radius ?? 8;
      // fit the group in about 80% of a 54° field of view
      const standoff = clamp((r + 2) / Math.tan((54 * Math.PI) / 360 * 0.8), Math.max(this.cfg.minStandoffM, 10), 90);
      return { standoff, height: clamp(standoff * 0.3, 2, 14), style: 'wide' };
    }
    const f = this.framing(snapshot, target);
    if (target.kind === 'scenic') return { standoff: f.standoff, height: f.heightOffset, style: 'scenic' };
    const a = target.animalId !== null ? this.findAnimal(snapshot, target.animalId) : undefined;
    const style: ShotInfo['style'] = target.kind === 'event' && !a ? 'event' : a && a.speed > 0.8 ? 'profile' : 'portrait';
    return { standoff: f.standoff, height: f.heightOffset, style };
  }

  /**
   * Choose the camera azimuth for a subject. Moving animals: side-on and slightly ahead (leading room), on the side
   * the camera is already on (the 180° rule: a cut never flips the direction of travel on screen). Still subjects:
   * keep the current viewing angle. Up to 8 azimuths are tried for a clear line of sight.
   */
  private planShot(snapshot: WorldSnapshotView, target: ObservationTarget, previous: ObservationTarget | null): { shot: Shot; camX: number; camZ: number } {
    const { standoff, height, style } = this.shotDistances(snapshot, target);
    const a = target.kind !== 'scenic' && target.animalId !== null ? this.findAnimal(snapshot, target.animalId) : undefined;
    const curAz = Math.atan2(this.pose.z - target.z, this.pose.x - target.x);
    let pref = curAz;
    if (a && a.speed > 0.8 && target.kind !== 'group') {
      // heading 0 = +z; direction of travel (sin h, cos h); camera vector at ±(90° − 25°) from it
      const hdAz = Math.atan2(Math.cos(a.heading), Math.sin(a.heading));
      const left = hdAz + Math.PI / 2 - 0.44;
      const right = hdAz - Math.PI / 2 + 0.44;
      pref = Math.abs(wrapAngle(left - curAz)) <= Math.abs(wrapAngle(right - curAz)) ? left : right;
    } else if (!previous && target.kind === 'scenic') {
      pref = 0.6;
    }
    const offsets = [0, 0.52, -0.52, 1.05, -1.05, 1.57, -1.57, Math.PI];
    let chosen = pref;
    let clear = false;
    let blocked = 0;
    for (const o of offsets) {
      const az = pref + o;
      const cx = clamp(target.x + Math.cos(az) * standoff, 8, snapshot.world.size - 8);
      const cz = clamp(target.z + Math.sin(az) * standoff, 8, snapshot.world.size - 8);
      const cy = Math.max(target.y + height, groundAt(snapshot, cx, cz) + this.cfg.minClearanceM);
      if (this.lineClear(snapshot, cx, cy, cz, target.x, target.y, target.z)) {
        chosen = az;
        clear = true;
        break;
      }
      blocked++;
    }
    const drift = (this.cfg.reducedMotion ? 0.012 : style === 'wide' ? 0.02 : 0.035) * this.driftSign;
    const shot: Shot = { key: target.key, style, az: wrapAngle(chosen), drift, standoff, height: clear ? height : height * 1.8, clear, blocked };
    return { shot, camX: target.x + Math.cos(shot.az) * standoff, camZ: target.z + Math.sin(shot.az) * standoff };
  }

  private maybeReplan(snapshot: WorldSnapshotView, target: ObservationTarget): void {
    const s = this.shot!;
    if (target.kind === 'group' && target.groupId != null) {
      // refresh the group's centre, spread and representative at the decision cadence
      const g = this.groups.get(target.groupId);
      if (g && g.n > 0) {
        const cx = g.sx / g.n;
        const cz = g.sz / g.n;
        this.currentTarget = { ...target, x: cx, z: cz, y: groundAt(snapshot, cx, cz) + 0.6, members: g.n, radius: this.groupRadius(g), animalId: g.rep };
        const d = this.shotDistances(snapshot, this.currentTarget);
        s.standoff = d.standoff;
        s.height = s.clear ? d.height : d.height * 1.8;
      }
    } else {
      const d = this.shotDistances(snapshot, target);
      s.standoff = d.standoff;
      s.height = s.clear ? d.height : d.height * 1.8;
      s.style = d.style;
    }
    const t = this.currentTarget!;
    if (this.lineClear(snapshot, this.pose.x, this.pose.y, this.pose.z, t.x, t.y, t.z)) return;
    const re = this.planShot(snapshot, t, t);
    this.shot = re.shot;
  }

  // ------------------------------------------------------------------ camera
  private desiredPose(snapshot: WorldSnapshotView, target: ObservationTarget, dt: number): { x: number; y: number; z: number; lx: number; ly: number; lz: number } {
    const s = this.shot!;
    const a = target.kind !== 'scenic' && target.kind !== 'group' && target.animalId !== null ? this.findAnimal(snapshot, target.animalId) : undefined;
    if (a && a.speed > 0.8 && s.style === 'profile') {
      // keep the side-on angle as the animal turns, at a limited angular rate
      const hdAz = Math.atan2(Math.cos(a.heading), Math.sin(a.heading));
      const left = hdAz + Math.PI / 2 - 0.44;
      const right = hdAz - Math.PI / 2 + 0.44;
      const goal = Math.abs(wrapAngle(left - s.az)) <= Math.abs(wrapAngle(right - s.az)) ? left : right;
      const maxRate = (this.cfg.reducedMotion ? 0.1 : 0.25) * dt;
      s.az = wrapAngle(s.az + clamp(wrapAngle(goal - s.az), -maxRate, maxRate));
    } else {
      s.az = wrapAngle(s.az + s.drift * dt);
    }
    const bound = Math.max(8, snapshot.world.size - 8);
    const x = clamp(target.x + Math.cos(s.az) * s.standoff, 8, bound);
    const z = clamp(target.z + Math.sin(s.az) * s.standoff, 8, bound);
    const y = Math.max(target.y + s.height, groundAt(snapshot, x, z) + this.cfg.minClearanceM);
    // composition: leading room ahead of a moving animal (it sits behind the frame centre, looking into space)
    let lx = target.x;
    let lz = target.z;
    if (a && a.speed > 0.8) {
      const lead = Math.min(s.standoff * 0.3, a.speed * 0.8);
      lx += Math.sin(a.heading) * lead;
      lz += Math.cos(a.heading) * lead;
    }
    return { x, y, z, lx, ly: target.y, lz };
  }

  /** A jump destination must be as safe as a glide: above terrain/water and above any ruin it lands in. */
  private safeJump(snapshot: WorldSnapshotView, x: number, y: number, z: number): number {
    let ny = Math.max(y, groundAt(snapshot, x, z) + this.cfg.minClearanceM);
    const buildings = snapshot.world.buildings;
    if (buildings) {
      for (const b of buildings) {
        if (!segmentIntersectsBuilding(x, z, x, z, b)) continue;
        const roofY = snapshot.world.height(b.x, b.z) + b.h * (1 - (b.collapse ?? 0) * 0.4) + this.cfg.minClearanceM;
        ny = Math.max(ny, roofY);
      }
    }
    return ny;
  }

  private stepCamera(
    snapshot: WorldSnapshotView,
    target: ObservationTarget,
    dt: number,
  ): void {
    if (!this.shot || this.shot.key !== target.key) this.shot = this.planShot(snapshot, target, null).shot;
    const rm = this.cfg.reducedMotion ? 1.6 : 1;

    // A running cut: the picture fades out on the old shot, the camera relocates while the screen is black, then
    // fades in on the new subject. No visible motion is faster than the comfort cap.
    if (this.cut) {
      const c = this.cut;
      c.t += dt;
      if (c.phase === 'out') {
        const alpha = clamp(1 - c.t / (this.cfg.fadeOutSec * rm), 0, 1);
        this.pose = { ...this.pose, fadeAlpha: alpha };
        if (alpha > 0) return;
        c.phase = 'hold';
        c.t = 0;
      }
      if (c.phase === 'hold') {
        this.pose = { ...this.pose, fadeAlpha: 0 };
        if (c.t < this.cfg.fadeHoldSec * rm) return;
        const d = this.desiredPose(snapshot, target, 0);
        const y = this.safeJump(snapshot, d.x, d.y, d.z);
        this.pose = { x: d.x, y, z: d.z, lookX: d.lx, lookY: d.ly, lookZ: d.lz, fov: this.fovFor(target), fadeAlpha: 0 };
        c.phase = 'in';
        c.t = 0;
        return;
      }
      // fade in while the shot continues normally below
      const alpha = clamp(c.t / (this.cfg.fadeInSec * rm), 0, 1);
      if (alpha >= 1) this.cut = null;
      this.glideTo(snapshot, target, dt, alpha);
      return;
    }

    // Gentle fade pulse during glided transitions when reducedMotion is enabled
    const targetFade = this.cfg.reducedMotion && this.holdSec < 0.6 ? 0.65 + (this.holdSec / 0.6) * 0.35 : 1;
    this.glideTo(snapshot, target, dt, targetFade);
  }

  private fovFor(target: ObservationTarget): number {
    return target.kind === 'scenic' ? 58 : target.kind === 'group' ? 54 : 50;
  }

  private glideTo(snapshot: WorldSnapshotView, target: ObservationTarget, dt: number, fadeAlpha: number): void {
    const d = this.desiredPose(snapshot, target, dt);
    const desiredX = d.x;
    const desiredZ = d.z;
    const desiredY = d.y;

    const posLambda = this.cfg.reducedMotion ? 1.8 : 3.2;
    const lookLambda = this.cfg.reducedMotion ? 2.4 : 4.5;

    let nextX = damp(this.pose.x, desiredX, posLambda, dt);
    let nextZ = damp(this.pose.z, desiredZ, posLambda, dt);
    const floorAtNext = groundAt(snapshot, nextX, nextZ) + this.cfg.minClearanceM;

    let nextY = Math.max(floorAtNext, damp(this.pose.y, desiredY, posLambda, dt));
    // comfort cap on travel speed: a subject 500 m away is reached by gliding, not in two frames
    const maxStep = this.cfg.maxSpeedMps * (this.cfg.reducedMotion ? 0.4 : 1) * dt;
    const sx = nextX - this.pose.x, sy = nextY - this.pose.y, sz = nextZ - this.pose.z;
    const stepLen = Math.hypot(sx, sy, sz);
    if (stepLen > maxStep && stepLen > 0) {
      const f = maxStep / stepLen;
      nextX = this.pose.x + sx * f;
      nextZ = this.pose.z + sz * f;
      // never let the cap push the camera below the floor
      const floor = groundAt(snapshot, nextX, nextZ) + this.cfg.minClearanceM;
      nextY = Math.max(floor, this.pose.y + sy * f);
    }

    // A safe endpoint alone is insufficient: the *path* between successive
    // camera poses may cross a building, including rotated footprints.
    // Hold horizontal movement below the roof; rise outside before crossing.
    // If a manual camera starts inside a building, immediately escape vertically.
    const buildings = snapshot.world.buildings;
    if (buildings) {
      for (const b of buildings) {
        if (!segmentIntersectsBuilding(this.pose.x, this.pose.z, nextX, nextZ, b)) continue;
        const roofY =
          snapshot.world.height(b.x, b.z) +
          b.h * (1 - (b.collapse ?? 0) * 0.4) +
          this.cfg.minClearanceM;
        if (Math.min(this.pose.y, nextY) >= roofY) continue;
        if (this.pose.y < roofY) {
          const startsInside = segmentIntersectsBuilding(
            this.pose.x, this.pose.z, this.pose.x, this.pose.z, b,
          );
          nextX = this.pose.x;
          nextZ = this.pose.z;
          // Do not teleport upwards outside the obstruction; climb while waiting.
          // A camera already inside needs immediate correction to be collision-free.
          const climb = startsInside ? roofY : Math.min(roofY, this.pose.y + 12 * dt);
          nextY = Math.max(nextY, climb);
          if (startsInside) nextY = Math.max(nextY, roofY);
        } else {
          // Camera is already above the roof; maintain clearance throughout the crossing.
          nextY = Math.max(nextY, roofY);
        }
      }
    }

    this.pose = {
      x: nextX,
      y: nextY,
      z: nextZ,
      lookX: damp(this.pose.lookX, d.lx, lookLambda, dt),
      lookY: damp(this.pose.lookY, d.ly, lookLambda, dt),
      lookZ: damp(this.pose.lookZ, d.lz, lookLambda, dt),
      fov: this.fovFor(target),
      fadeAlpha,
    };
  }

  /**
   * Camera distance and height for a target. Animals are framed by body size (bodyLengthsAway, never closer than
   * minStandoffM) and from further back when they move fast; scenery and unattached events keep fixed framing.
   */
  framing(snapshot: WorldSnapshotView, target: ObservationTarget): { standoff: number; heightOffset: number } {
    if (target.kind === 'scenic') return { standoff: 28, heightOffset: 12 };
    const a = target.animalId === null ? undefined : this.findAnimal(snapshot, target.animalId);
    if (!a) return target.kind === 'event' ? { standoff: 14, heightOffset: 4.2 } : { standoff: 10, heightOffset: 4.2 };
    const size = sizeOf(snapshot, a);
    const motion = 1 + clamp(a.speed / 8, 0, 1); // up to 2x for sprinting or flying subjects
    const standoff = Math.max(this.cfg.minStandoffM, size * this.cfg.bodyLengthsAway * motion);
    // a little above the subject, proportional to the distance, so the view looks gently down at it
    return { standoff, heightOffset: clamp(standoff * 0.35, 1.2, 4.2) };
  }

  private eventSignificance(e: SimEventLike): number {
    switch (e.type) {
      case 'kill':
        return 1.0;
      case 'birth':
        return 0.88;
      case 'alarm':
        return 0.72;
      case 'death':
        // a predation death is followed by its kill event; other deaths leave only a carcass to film
        return e.cause === 'predation' ? 0.3 : 0.45;
    }
  }

  private behaviorSignificance(a: AnimalSnapshotView): number {
    let base = 0.25;
    switch (a.beh) {
      case BEH.Chase:
        base = 0.85;
        break;
      case BEH.Stalk:
        base = 0.72;
        break;
      case BEH.Flee:
        base = 0.68;
        break;
      case BEH.SeekMate:
        base = 0.56;
        break;
      case BEH.Drink:
        base = 0.48;
        break;
      case BEH.Forage:
      case BEH.Feed:
      case BEH.SeekCarrion:
        base = 0.42;
        break;
      case BEH.Follow:
        base = 0.4;
        break;
      case BEH.Rest:
      case BEH.Roost:
        base = 0.22;
        break;
      default:
        base = 0.28;
    }
    const motionBonus = clamp(a.speed * 0.02, 0, 0.12);
    return base + motionBonus;
  }

  private behaviorLabel(beh: number): string {
    switch (beh) {
      case BEH.Chase:
        return 'chasing';
      case BEH.Stalk:
        return 'stalking';
      case BEH.Flee:
        return 'fleeing';
      case BEH.SeekMate:
        return 'courting';
      case BEH.Drink:
        return 'drinking';
      case BEH.Forage:
        return 'foraging';
      case BEH.Feed:
        return 'feeding';
      case BEH.SeekCarrion:
        return 'scavenging';
      case BEH.Follow:
        return 'following';
      case BEH.Rest:
        return 'resting';
      case BEH.Roost:
        return 'roosting';
      case BEH.Regroup:
        return 'rejoining its group';
      default:
        return 'wandering';
    }
  }

  private proximityFactor(x: number, z: number): number {
    const dx = x - this.pose.lookX;
    const dz = z - this.pose.lookZ;
    const dist = Math.hypot(dx, dz);
    return 0.55 + 0.45 * Math.exp(-dist / Math.max(1, this.cfg.proximityRangeM));
  }

  /** Novelty; the current subject is not penalised for its own adoption (holding is not repetition). */
  private noveltyFactor(key: string, isCurrent = false): number {
    const seen = Math.max(0, (this.noveltyCounts.get(key) ?? 0) - (isCurrent ? 1 : 0));
    return 1 / (1 + seen * 0.35);
  }

  private cooldownFactor(key: string): number {
    const until = this.cooldowns.get(key);
    if (until === undefined || this.elapsedSec >= until) return 1;
    const rem = until - this.elapsedSec;
    return clamp(0.15 + 0.85 * Math.exp(-rem / 6), 0.15, 1);
  }

  private visibilityFactor(world: WorldQueryView, x: number, z: number): number {
    // Check midpoint terrain occlusion between current camera and target
    const mx = (this.pose.x + x) * 0.5;
    const mz = (this.pose.z + z) * 0.5;
    const midGround = world.height(mx, mz);
    const targetGround = world.height(x, z);
    const ridgeDelta = midGround - Math.max(this.pose.y, targetGround + 4);
    if (ridgeDelta > 8) return 0.45;
    if (ridgeDelta > 2) return 0.75;
    return 1.0;
  }

  private eventKey(e: SimEventLike): string {
    switch (e.type) {
      case 'kill':
        return `event:kill:${e.predator}:${e.prey}`;
      case 'death':
        return `event:death:${e.id}`;
      case 'birth':
        return `event:birth:${e.sp}:${Math.round(e.x / 24)}:${Math.round(e.z / 24)}`;
      case 'alarm':
        return `event:alarm:${e.sp}:${Math.round(e.x / 24)}:${Math.round(e.z / 24)}`;
    }
  }

  private pruneExpiredEvents(): void {
    for (let i = this.eventBuffer.length - 1; i >= 0; i--) {
      if (this.elapsedSec - this.eventBuffer[i]!.receivedAtSec > 30) {
        this.eventBuffer.splice(i, 1);
      }
    }
  }

  private recordCooldown(key: string, durationSec: number): void {
    this.setBoundedMap(this.cooldowns, key, this.elapsedSec + durationSec, this.cfg.maxCooldownEntries);
  }

  private setBoundedMap<K, V>(map: Map<K, V>, key: K, value: V, maxSize: number): void {
    if (map.has(key)) {
      map.delete(key);
    } else if (map.size >= maxSize) {
      const oldestKey = map.keys().next().value;
      if (oldestKey !== undefined) {
        map.delete(oldestKey);
      }
    }
    map.set(key, value);
  }
}
