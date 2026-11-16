import { QUALITY_ORDER, QualityName } from './quality';

export type QualityChange = 'none' | 'resolution' | 'preset';
/** Frame-rate the governor tries to hold. */
export type FpsTarget = 30 | 60;

/**
 * Deterministic, renderer-independent frame-time quality governor.
 *
 * - The ceiling is an explicit user/initial preference, never the current downgraded preset.
 * - Under sustained overload it lowers render resolution first (to 50%), then steps one preset down (keeping 50%).
 *   A preset step is what reduces shadows, vegetation range, grass and rain density, water detail and
 *   draw distance (see quality.ts); the governor itself only decides when.
 * - With sustained headroom it restores resolution, then presets, up to the ceiling. An upgrade that
 *   immediately fails doubles the wait before the next attempt; one that holds halves it again.
 * - Every automatic downgrade is a measured trial. The mean frame time over the 1.2 s before the change is compared
 *   with the mean over 0.3-1.5 s after it. A downgrade that did not cut frame time by at least 5% while the device is
 *   still overloaded is undone exactly, and further downgrades are held off (30 s, doubling to 8 min on repeats)
 *   unless frame time then gets materially worse. This is what keeps Auto from throwing away quality when the
 *   slowdown is somewhere rendering settings cannot reach (for example main-thread work). It is a measurement of
 *   whether rendering settings helped, NOT a classification of the device as CPU- or GPU-bound.
 * - Rendering work is adjustable; the ecology engine is deliberately not referenced here.
 */
/** Outcome of the most recent downgrade trial, for diagnostics (F3 overlay, profiler report). */
export interface DowngradeTrial {
  kind: 'resolution' | 'preset';
  from: string;
  to: string;
  /** Mean frame time before and after the change, ms (measured). */
  beforeMs: number;
  afterMs: number;
  verdict: 'helped' | 'no-help-rolled-back';
}

export interface GovernorStats {
  trials: number;
  helped: number;
  rolledBack: number;
  /** Seconds left in the hold after an ineffective downgrade (0 when not holding). */
  holdS: number;
  last: DowngradeTrial | null;
}

const BASE_WINDOW_S = 1.2;
const TRIAL_SETTLE_S = 0.3;
const TRIAL_EVAL_S = 1.2;
const MIN_GAIN = 0.05;
const HOLD_MIN_S = 30;
const HOLD_MAX_S = 480;
const WORSE_FACTOR = 1.3;

export class QualityGovernor {
  quality: QualityName;
  ceiling: QualityName;
  auto = true;
  scale = 1;
  frameMs = 16.7;
  targetFps: FpsTarget = 60;
  private slowSeconds = 0;
  private fastSeconds = 0;
  private secondsSinceUpgrade = 99;
  private upgradeDelay = 8;
  private upgradeSettled = true;
  private longStreak = 0;
  // recent raw frame intervals (seconds) for the trial baseline
  private readonly recent: number[] = [];
  private recentSum = 0;
  // the downgrade under evaluation
  private trial: { kind: 'resolution' | 'preset'; prevQuality: QualityName; prevScale: number; baseMs: number; t: number; sum: number; n: number } | null = null;
  private holdLeft = 0;
  private holdDelay = HOLD_MIN_S;
  private holdRefMs = 0;
  private readonly stat: GovernorStats = { trials: 0, helped: 0, rolledBack: 0, holdS: 0, last: null };
  // start-up calibration window
  private calLeft = 0;
  private calT = 0;
  private calSum = 0;
  private calN = 0;

  /** @param ceiling highest preset Auto may use; defaults to the initial preset. */
  constructor(initial: QualityName, ceiling: QualityName = initial) {
    const top = Math.max(QUALITY_ORDER.indexOf(initial), QUALITY_ORDER.indexOf(ceiling));
    this.quality = initial;
    this.ceiling = QUALITY_ORDER[top]!;
  }

  /** An explicit choice by the player: becomes both the current preset and the ceiling. */
  setQuality(quality: QualityName, auto: boolean): void {
    this.quality = quality;
    this.ceiling = quality;
    this.auto = auto;
    this.scale = 1;
    this.calLeft = 0;
    this.resetCounters();
  }

  setAuto(auto: boolean): void {
    if (this.auto === auto) return;
    this.auto = auto;
    this.resetCounters();
  }

  setTarget(fps: FpsTarget): void {
    if (this.targetFps === fps) return;
    this.targetFps = fps;
    this.resetCounters();
  }

  /**
   * Bounded start-up assessment. For the next few seconds of rendered frames, a device that is badly
   * overloaded steps down whole presets at once instead of creeping through resolution steps first.
   * It costs nothing beyond the frames the game is drawing anyway, and it never upgrades.
   */
  beginCalibration(seconds = 4): void {
    this.calLeft = seconds;
    this.calT = this.calSum = this.calN = 0;
    this.resetCounters();
  }
  get calibrating(): boolean {
    return this.calLeft > 0;
  }

  /** Call when the page becomes visible again: evidence gathered before the pause is stale. */
  resume(): void {
    this.trial = null; // a trial spanning a hidden period measures nothing
    this.recent.length = 0;
    this.recentSum = 0;
    this.slowSeconds = 0;
    this.fastSeconds = 0;
    this.longStreak = 0;
  }

  get stats(): GovernorStats {
    return { ...this.stat, holdS: Math.max(0, this.holdLeft) };
  }

  private resetCounters(): void {
    this.trial = null;
    this.holdLeft = 0;
    this.holdDelay = HOLD_MIN_S;
    this.recent.length = 0;
    this.recentSum = 0;
    this.slowSeconds = 0;
    this.fastSeconds = 0;
    this.secondsSinceUpgrade = 99;
    this.upgradeDelay = 8;
    this.upgradeSettled = true;
    this.longStreak = 0;
    this.frameMs = 1000 / this.targetFps;
  }

  /** Frame time above which the device is not holding the target (21 ms at 60 fps). Low tolerates ~28 fps. */
  overloadMs(): number {
    const budget = 1000 / this.targetFps;
    return this.quality === 'low' ? Math.max(36, budget * 1.26) : budget * 1.26;
  }
  /** Frame time below which the target is being held comfortably (17.8 ms at 60 fps). */
  headroomMs(): number {
    return (1000 / this.targetFps) * 1.07;
  }

  /** Sample a real rendered-frame interval; skip hidden tabs and resume gaps. */
  sample(dt: number, hidden: boolean): QualityChange {
    if (!Number.isFinite(dt) || dt <= 0 || hidden) {
      this.longStreak = 0;
      return 'none';
    }
    // trials compare real intervals (bounded only against absurd gaps): the 250 ms cap below would hide real gains
    const raw = Math.min(dt, 2);
    if (dt > 0.25) {
      // One very long frame is a hitch or a tab coming back. Several in a row, while visible, is a device
      // that cannot keep up at all: without this it would never produce a usable sample and never adapt.
      if (++this.longStreak < 3) return 'none';
      dt = 0.25;
    } else this.longStreak = 0;
    this.frameMs += (dt * 1000 - this.frameMs) * 0.06;
    this.recent.push(raw);
    this.recentSum += raw;
    while (this.recent.length > 1 && this.recentSum - this.recent[0]! >= BASE_WINDOW_S) this.recentSum -= this.recent.shift()!;
    if (!this.auto) return 'none';

    if (this.calLeft > 0) {
      this.calLeft -= dt;
      this.calT += dt;
      this.calSum += dt * 1000;
      this.calN++;
      if (this.calT >= 0.5) {
        const avg = this.calSum / this.calN;
        this.calT = this.calSum = this.calN = 0;
        const i = QUALITY_ORDER.indexOf(this.quality);
        if (avg > this.overloadMs() * 1.8 && i > 0) {
          this.quality = QUALITY_ORDER[i - 1]!;
          this.scale = 1;
          this.trial = null;
          this.frameMs = avg;
          this.slowSeconds = 0;
          this.fastSeconds = 0;
          return 'preset';
        }
      }
    }

    // ---- evaluate the downgrade on trial (counters below keep running, so a helpful step costs no extra time) ----
    let trialRunning = false;
    if (this.trial && this.trial.t + dt < TRIAL_SETTLE_S + TRIAL_EVAL_S) {
      const tr = this.trial;
      tr.t += dt;
      if (tr.t > TRIAL_SETTLE_S) {
        tr.sum += raw * 1000;
        tr.n++;
      }
      trialRunning = true;
    } else if (this.trial) {
      const tr = this.trial;
      tr.sum += raw * 1000;
      tr.n++;
      this.trial = null;
      const after = tr.sum / Math.max(1, tr.n);
      const helped = after <= tr.baseMs * (1 - MIN_GAIN) || after < this.overloadMs();
      const rec: DowngradeTrial = {
        kind: tr.kind, from: `${tr.prevQuality}@${tr.prevScale}`, to: `${this.quality}@${this.scale}`,
        beforeMs: Math.round(tr.baseMs * 10) / 10, afterMs: Math.round(after * 10) / 10, verdict: helped ? 'helped' : 'no-help-rolled-back',
      };
      this.stat.last = rec;
      if (helped) {
        this.stat.helped++;
        this.holdDelay = HOLD_MIN_S;
      } else {
        this.slowSeconds = 0;
        this.fastSeconds = 0;
        // undo exactly; do not try again for a while unless things get clearly worse
        this.stat.rolledBack++;
        const presetChanged = tr.prevQuality !== this.quality;
        this.quality = tr.prevQuality;
        this.scale = tr.prevScale;
        this.holdLeft = this.holdDelay;
        this.holdRefMs = tr.baseMs;
        this.holdDelay = Math.min(HOLD_MAX_S, this.holdDelay * 2);
        this.frameMs = tr.baseMs;
        return presetChanged ? 'preset' : 'resolution';
      }
    }
    if (this.holdLeft > 0) this.holdLeft -= dt;

    const overloaded = this.frameMs > this.overloadMs();
    const hasHeadroom = this.frameMs < this.headroomMs();
    this.secondsSinceUpgrade += dt;
    if (!this.upgradeSettled && this.secondsSinceUpgrade >= 20) {
      // the last upgrade held: be a little less cautious about the next one
      this.upgradeSettled = true;
      this.upgradeDelay = Math.max(8, this.upgradeDelay / 2);
    }
    if (overloaded) {
      this.slowSeconds += dt;
      this.fastSeconds = 0;
    } else {
      this.slowSeconds = Math.max(0, this.slowSeconds - dt * 0.5);
      this.fastSeconds = hasHeadroom ? this.fastSeconds + dt : 0;
    }

    if (trialRunning) return 'none';
    if (this.slowSeconds >= 1.5) {
      this.slowSeconds = 0;
      this.fastSeconds = 0;
      // Back off further attempts if a recent quality upgrade caused a regression.
      if (this.secondsSinceUpgrade < 5) {
        this.upgradeDelay = Math.min(600, this.upgradeDelay * 2);
        this.upgradeSettled = true;
      }
      // after an ineffective downgrade, wait out the hold unless frame time has become clearly worse
      if (this.holdLeft > 0 && this.frameMs < this.holdRefMs * WORSE_FACTOR) return 'none';
      const prevQuality = this.quality;
      const prevScale = this.scale;
      let kind: 'resolution' | 'preset';
      if (this.scale > 0.55) {
        this.scale = Math.max(0.5, Math.round((this.scale - 0.1) * 100) / 100);
        kind = 'resolution';
      } else {
        const i = QUALITY_ORDER.indexOf(this.quality);
        if (i <= 0) return 'none';
        // keep the current (floor) resolution: every downgrade step must reduce work, or its trial cannot pass
        this.quality = QUALITY_ORDER[i - 1]!;
        kind = 'preset';
      }
      this.holdLeft = 0;
      this.stat.trials++;
      this.trial = { kind, prevQuality, prevScale, baseMs: (this.recentSum / this.recent.length) * 1000, t: 0, sum: 0, n: 0 };
      return kind;
    }

    if (this.calLeft > 0) return 'none'; // calibration only ever steps down
    if (this.fastSeconds < this.upgradeDelay || this.secondsSinceUpgrade < 5) return 'none';
    this.fastSeconds = 0;
    const scaleWasBelowOne = this.scale < 0.999;
    const index = QUALITY_ORDER.indexOf(this.quality);
    if (!scaleWasBelowOne && index >= QUALITY_ORDER.indexOf(this.ceiling)) return 'none';
    this.secondsSinceUpgrade = 0;
    this.upgradeSettled = false;

    if (scaleWasBelowOne) {
      this.scale = Math.min(1, Math.round((this.scale + 0.1) * 100) / 100);
      return 'resolution';
    }
    this.quality = QUALITY_ORDER[index + 1]!;
    // A preset upgrade is deliberately softened by temporarily using lower resolution.
    this.scale = 0.8;
    return 'preset';
  }
}

/**
 * Frame pacing: decides which animation-frame callbacks render, so the game does not draw faster than
 * the chosen target on fast displays (30 fps on a 60 Hz screen, 60 on 120 Hz, ...).
 *
 * It counts callbacks rather than comparing timestamps, which keeps the cadence perfectly even, and it
 * never skips right after a long frame, so a device that is already struggling loses nothing.
 */
export class FramePacer {
  /** 0 = render every callback (the display's own rate). */
  target: FpsTarget | 0 = 60;
  /** Estimated interval between animation-frame callbacks, i.e. the display refresh. */
  refreshMs = 16.7;
  private readonly recent: number[] = [];
  private since = 0;

  /** Render every `divisor`-th callback. Never drops below the target when the display can reach it. */
  get divisor(): number {
    if (this.target === 0) return 1;
    return Math.max(1, Math.floor(1000 / this.target / this.refreshMs + 0.05));
  }

  /** @param deltaMs time since the previous animation-frame callback. @returns whether to render now. */
  tick(deltaMs: number): boolean {
    if (deltaMs > 2 && deltaMs < 100) {
      const r = this.recent;
      r.push(deltaMs);
      if (r.length > 90) r.shift();
      if (r.length >= 20 && r.length % 10 === 0) {
        // a low percentile ignores slow frames and measures what the display can deliver
        const sorted = [...r].sort((a, b) => a - b);
        this.refreshMs = sorted[Math.floor(sorted.length * 0.1)]!;
      }
    }
    this.since++;
    if (this.since >= this.divisor || deltaMs > this.refreshMs * 1.5) {
      this.since = 0;
      return true;
    }
    return false;
  }
}
