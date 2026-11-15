import { QUALITY_ORDER, QualityName } from './quality';

export type QualityChange = 'none' | 'resolution' | 'preset';
/** Frame-rate the governor tries to hold. */
export type FpsTarget = 30 | 60;

/**
 * Deterministic, renderer-independent frame-time quality governor.
 *
 * - The ceiling is an explicit user/initial preference, never the current downgraded preset.
 * - Under sustained overload it lowers render resolution first (to 50%), then steps one preset down.
 *   A preset step is what reduces shadows, vegetation range, grass and rain density, water detail and
 *   draw distance (see quality.ts); the governor itself only decides when.
 * - With sustained headroom it restores resolution, then presets, up to the ceiling. An upgrade that
 *   immediately fails doubles the wait before the next attempt; one that holds halves it again.
 * - Rendering work is adjustable; the ecology engine is deliberately not referenced here.
 */
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
    this.slowSeconds = 0;
    this.fastSeconds = 0;
    this.longStreak = 0;
  }

  private resetCounters(): void {
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
    if (dt > 0.25) {
      // One very long frame is a hitch or a tab coming back. Several in a row, while visible, is a device
      // that cannot keep up at all: without this it would never produce a usable sample and never adapt.
      if (++this.longStreak < 3) return 'none';
      dt = 0.25;
    } else this.longStreak = 0;
    this.frameMs += (dt * 1000 - this.frameMs) * 0.06;
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
          this.frameMs = avg;
          this.slowSeconds = 0;
          this.fastSeconds = 0;
          return 'preset';
        }
      }
    }

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

    if (this.slowSeconds >= 1.5) {
      this.slowSeconds = 0;
      this.fastSeconds = 0;
      // Back off further attempts if a recent quality upgrade caused a regression.
      if (this.secondsSinceUpgrade < 5) {
        this.upgradeDelay = Math.min(600, this.upgradeDelay * 2);
        this.upgradeSettled = true;
      }
      if (this.scale > 0.55) {
        this.scale = Math.max(0.5, Math.round((this.scale - 0.1) * 100) / 100);
        return 'resolution';
      }
      const i = QUALITY_ORDER.indexOf(this.quality);
      if (i > 0) {
        this.quality = QUALITY_ORDER[i - 1]!;
        this.scale = 0.8;
        return 'preset';
      }
      return 'none';
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
