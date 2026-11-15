/**
 * CuriosityDirector — Independent, deterministic documentary camera director.
 *
 * Architectural contract:
 * - Read-only consumer of world snapshots and SimEvents.
 * - Never mutates Simulation, Animal, Environment, or Valley state.
 * - Strictly bounded memory (fixed caps on candidate, event, and cooldown tables).
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
}

export type SubjectKind = 'event' | 'animal' | 'scenic';

export interface ObservationTarget {
  readonly key: string;
  readonly kind: SubjectKind;
  readonly animalId: number | null;
  readonly eventType: SimEventLike['type'] | null;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly score: number;
  readonly reason: string;
}

export interface CameraPose {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly lookX: number;
  readonly lookY: number;
  readonly lookZ: number;
  readonly fov: number;
  /** Suggested cross-fade / cut opacity [0..1] when reducedMotion is enabled. */
  readonly fadeAlpha: number;
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
  /** Hard cap on candidate evaluations per decision step. */
  readonly maxCandidates: number;
  /** Hard cap on cooldown map entries. */
  readonly maxCooldownEntries: number;
  /** Comfort: maximum camera speed in m/s (reduced motion uses 40% of it). Long transitions glide instead of jumping. */
  readonly maxSpeedMps: number;
  /** Framing: camera distance in body lengths, so a myna and a deer fill a similar part of the frame. */
  readonly bodyLengthsAway: number;
  /** Safety: never frame an animal from closer than this (near plane, foliage, comfort). */
  readonly minStandoffM: number;
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
} as const;

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

export class CuriosityDirector {
  private cfg: DirectorConfig;
  /** Number of subject changes so far (diagnostics / tests). */
  switches = 0;
  private active = false;
  private elapsedSec = 0;
  private holdSec = 0;
  private orbitAngle = 0.6;
  private scenicIndex = 0;

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
    if (initialPose) {
      this.pose = { ...this.pose, ...initialPose, fadeAlpha: 1 };
    }
  }

  /** Immediately interrupt Curiosity Mode (e.g., on manual camera input or possess). */
  interrupt(): void {
    this.active = false;
  }

  /** Toggle the reduced-motion profile at runtime (accessibility setting). */
  setReducedMotion(on: boolean): void {
    this.cfg = { ...this.cfg, reducedMotion: on };
  }

  /**
   * Observe a specific animal now (e.g. one the player picked). Read-only like everything else here.
   * Returns false if the animal is not in the snapshot or is dead.
   */
  focus(snapshot: WorldSnapshotView, animalId: number): boolean {
    if (!this.active) return false;
    const a = snapshot.animals.find((o) => o.id === animalId && o.alive);
    if (!a) return false;
    const ground = Math.max(snapshot.world.height(a.x, a.z), snapshot.world.waterSurface(a.z) + snapshot.env.stage);
    this.adoptTarget({ key: `animal:${a.id}`, kind: 'animal', animalId: a.id, eventType: null, x: a.x, y: ground + a.alt + aimLift(snapshot, a), z: a.z, score: 1, reason: `Wildlife #${a.id} (${this.behaviorLabel(a.beh)})` });
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

  /** Diagnostic counts to verify bounded memory invariants in tests. */
  getResourceStats(): { eventBufferSize: number; cooldownSize: number; noveltySize: number } {
    return {
      eventBufferSize: this.eventBuffer.length,
      cooldownSize: this.cooldowns.size,
      noveltySize: this.noveltyCounts.size,
    };
  }

  /** Clear all state and buffers deterministically. */
  reset(): void {
    this.active = false;
    this.elapsedSec = 0;
    this.holdSec = 0;
    this.orbitAngle = 0.6;
    this.scenicIndex = 0;
    this.currentTarget = null;
    this.eventBuffer.length = 0;
    this.cooldowns.clear();
    this.noveltyCounts.clear();
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
    this.currentTarget = null;
    this.holdSec = 0;
    const next = this.selectBestCandidate(snapshot, excludedKey);
    this.adoptTarget(next);
    this.stepCamera(snapshot, next, 0);
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
        const b = this.eventBuffer[i];
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

    this.pruneExpiredEvents();

    const best = this.selectBestCandidate(snapshot);

    if (!this.currentTarget) {
      this.adoptTarget(best);
    } else {
      const currentTracked = this.refreshCurrentTarget(snapshot, this.currentTarget);
      if (!currentTracked) {
        // Current animal died or disappeared — switch immediately
        this.adoptTarget(best);
      } else {
        this.currentTarget = currentTracked;
        const holdExpired = this.holdSec >= this.cfg.maxHoldSec;
        const canPreempt =
          this.holdSec >= this.cfg.minHoldSec &&
          best.key !== currentTracked.key &&
          best.score >= currentTracked.score * this.cfg.switchHysteresis;

        if ((holdExpired && best.key !== currentTracked.key) || canPreempt) {
          this.recordCooldown(currentTracked.key, this.cfg.subjectCooldownSec);
          if (currentTracked.eventType) {
            this.recordCooldown(`eventType:${currentTracked.eventType}`, this.cfg.eventTypeCooldownSec);
          }
          this.adoptTarget(best);
        }
      }
    }

    if (this.currentTarget) {
      this.stepCamera(snapshot, this.currentTarget, safeDt);
    }

    return this.currentTarget;
  }

  private adoptTarget(candidate: ScoredCandidate): void {
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
    };
    this.holdSec = 0;
    this.switches++;
    const prevCount = this.noveltyCounts.get(candidate.key) ?? 0;
    this.setBoundedMap(this.noveltyCounts, candidate.key, prevCount + 1, this.cfg.maxCooldownEntries);
  }

  private refreshCurrentTarget(
    snapshot: WorldSnapshotView,
    target: ObservationTarget,
  ): ObservationTarget | null {
    if (target.animalId === null) {
      return target;
    }
    for (let i = 0; i < snapshot.animals.length; i++) {
      const a = snapshot.animals[i];
      if (a.id === target.animalId) {
        if (!a.alive) return null;
        const groundY = Math.max(
          snapshot.world.height(a.x, a.z),
          snapshot.world.waterSurface(a.z) + snapshot.env.stage,
        );
        return {
          ...target,
          x: a.x,
          y: groundY + a.alt + aimLift(snapshot, a),
          z: a.z,
        };
      }
    }
    return null;
  }

  private selectBestCandidate(snapshot: WorldSnapshotView, excludedKey?: string): ScoredCandidate {
    let best: ScoredCandidate | null = null;

    // 1. Score buffered events
    for (let i = 0; i < this.eventBuffer.length; i++) {
      const b = this.eventBuffer[i];
      if (b.key === excludedKey) continue;
      const age = Math.max(0, this.elapsedSec - b.receivedAtSec);
      const decay = Math.exp(-age / 14);
      const proximity = this.proximityFactor(b.event.x, b.event.z);
      const novelty = this.noveltyFactor(b.key);
      const cooldown = this.cooldownFactor(b.key) * this.cooldownFactor(`eventType:${b.event.type}`);
      const visibility = this.visibilityFactor(snapshot.world, b.event.x, b.event.z);

      const score = b.baseSignificance * decay * proximity * novelty * cooldown * visibility;
      if (!best || score > best.score || (score === best.score && b.key < best.key)) {
        const y =
          Math.max(
            snapshot.world.height(b.event.x, b.event.z),
            snapshot.world.waterSurface(b.event.z) + snapshot.env.stage,
          ) + 0.8;
        best = {
          key: b.key,
          kind: 'event',
          animalId: b.event.type === 'kill' ? b.event.predator : b.event.type !== 'death' && b.event.id !== undefined ? b.event.id : null,
          eventType: b.event.type,
          x: b.event.x,
          y,
          z: b.event.z,
          score,
          reason: `Event: ${b.event.type}`,
        };
      }
    }

    // 2. Score bounded sample of living animals (deterministic stride if population > maxCandidates)
    const animals = snapshot.animals;
    const n = animals.length;
    if (n > 0) {
      const stride = n <= this.cfg.maxCandidates ? 1 : Math.ceil(n / this.cfg.maxCandidates);
      let evaluated = 0;
      for (let i = 0; i < n && evaluated < this.cfg.maxCandidates; i += stride) {
        const a = animals[i];
        if (!a.alive) continue;
        evaluated++;

        const key = `animal:${a.id}`;
        if (key === excludedKey) continue;
        const sig = this.behaviorSignificance(a);
        const proximity = this.proximityFactor(a.x, a.z);
        const novelty = this.noveltyFactor(key);
        const cooldown = this.cooldownFactor(key);
        const visibility = this.visibilityFactor(snapshot.world, a.x, a.z);

        const score = sig * proximity * novelty * cooldown * visibility;
        if (!best || score > best.score || (score === best.score && key < best.key)) {
          const groundY = Math.max(
            snapshot.world.height(a.x, a.z),
            snapshot.world.waterSurface(a.z) + snapshot.env.stage,
          );
          best = {
            key,
            kind: 'animal',
            animalId: a.id,
            eventType: null,
            x: a.x,
            y: groundY + a.alt + aimLift(snapshot, a),
            z: a.z,
            score,
            reason: `Wildlife #${a.id} (${this.behaviorLabel(a.beh)})`,
          };
        }
      }
    }

    // 3. Scenic fallback if no salient animals/events or all are on deep cooldown
    if (!best || best.score < 0.08) {
      const scenic = this.pickScenicFallback(snapshot, excludedKey);
      if (!best || scenic.score > best.score) {
        best = scenic;
      }
    }

    return best;
  }

  private pickScenicFallback(snapshot: WorldSnapshotView, excludedKey?: string): ScoredCandidate {
    let chosen = SCENIC_ANCHORS[this.scenicIndex % SCENIC_ANCHORS.length];
    let bestScore = -1;

    for (let i = 0; i < SCENIC_ANCHORS.length; i++) {
      const anchor = SCENIC_ANCHORS[i];
      if (anchor.key === excludedKey) continue;
      const weatherBonus = snapshot.env.weather === 'storm' || snapshot.env.weather === 'rain' ? 0.14 : 0.1;
      const s = weatherBonus * this.noveltyFactor(anchor.key) * this.cooldownFactor(anchor.key);
      if (s > bestScore) {
        bestScore = s;
        chosen = anchor;
        this.scenicIndex = i;
      }
    }

    const x = clamp(chosen.x, 16, Math.max(16, snapshot.world.size - 16));
    const z = clamp(chosen.z, 16, Math.max(16, snapshot.world.size - 16));
    const y =
      Math.max(
        snapshot.world.height(x, z),
        snapshot.world.waterSurface(z) + snapshot.env.stage,
      ) + 2.0;

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
    };
  }

  private stepCamera(
    snapshot: WorldSnapshotView,
    target: ObservationTarget,
    dt: number,
  ): void {
    const orbitSpeed = this.cfg.reducedMotion ? 0.025 : 0.08;
    this.orbitAngle = (this.orbitAngle + orbitSpeed * dt) % (Math.PI * 2);

    const { standoff, heightOffset } = this.framing(snapshot, target);

    let desiredX = target.x + Math.cos(this.orbitAngle) * standoff;
    let desiredZ = target.z + Math.sin(this.orbitAngle) * standoff;

    const boundMax = Math.max(8, snapshot.world.size - 8);
    desiredX = clamp(desiredX, 8, boundMax);
    desiredZ = clamp(desiredZ, 8, boundMax);

    const groundAtCam = Math.max(
      snapshot.world.height(desiredX, desiredZ),
      snapshot.world.waterSurface(desiredZ) + snapshot.env.stage,
    );
    const desiredY = Math.max(target.y + heightOffset, groundAtCam + this.cfg.minClearanceM);

    const posLambda = this.cfg.reducedMotion ? 1.8 : 3.2;
    const lookLambda = this.cfg.reducedMotion ? 2.4 : 4.5;

    let nextX = damp(this.pose.x, desiredX, posLambda, dt);
    let nextZ = damp(this.pose.z, desiredZ, posLambda, dt);
    const floorAtNext =
      Math.max(
        snapshot.world.height(nextX, nextZ),
        snapshot.world.waterSurface(nextZ) + snapshot.env.stage,
      ) + this.cfg.minClearanceM;

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
      const floor = Math.max(snapshot.world.height(nextX, nextZ), snapshot.world.waterSurface(nextZ) + snapshot.env.stage) + this.cfg.minClearanceM;
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

    // Gentle fade pulse during transitions when reducedMotion is enabled
    const targetFade = this.cfg.reducedMotion && this.holdSec < 0.6 ? 0.65 + (this.holdSec / 0.6) * 0.35 : 1;

    this.pose = {
      x: nextX,
      y: nextY,
      z: nextZ,
      lookX: damp(this.pose.lookX, target.x, lookLambda, dt),
      lookY: damp(this.pose.lookY, target.y, lookLambda, dt),
      lookZ: damp(this.pose.lookZ, target.z, lookLambda, dt),
      fov: target.kind === 'scenic' ? 58 : 50,
      fadeAlpha: targetFade,
    };
  }

  /**
   * Camera distance and height for a target. Animals are framed by body size (bodyLengthsAway, never closer than
   * minStandoffM) and from further back when they move fast; scenery and unattached events keep fixed framing.
   */
  framing(snapshot: WorldSnapshotView, target: ObservationTarget): { standoff: number; heightOffset: number } {
    if (target.kind === 'scenic') return { standoff: 28, heightOffset: 12 };
    const a = target.animalId === null ? undefined : snapshot.animals.find((o) => o.id === target.animalId);
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
        return 0.58;
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

  private noveltyFactor(key: string): number {
    const seen = this.noveltyCounts.get(key) ?? 0;
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
      if (this.elapsedSec - this.eventBuffer[i].receivedAtSec > 30) {
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
