import { QUALITY_ORDER, QualityName } from './quality';

export type QualityChange = 'none' | 'resolution' | 'preset';

/**
 * Deterministic, renderer-independent frame-time quality governor.
 * The ceiling is an explicit user/initial preference, never the current downgraded preset.
 * Rendering work is adjustable; the ecology engine is deliberately not referenced here.
 */
export class QualityGovernor {
  quality: QualityName;
  ceiling: QualityName;
  auto = true;
  scale = 1;
  frameMs = 16.7;
  private slowSeconds = 0;
  private fastSeconds = 0;
  private secondsSinceUpgrade = 99;
  private upgradeDelay = 8;

  constructor(initial: QualityName) {
    this.quality = initial;
    this.ceiling = initial;
  }

  setQuality(quality: QualityName, auto: boolean): void {
    this.quality = quality;
    this.ceiling = quality;
    this.auto = auto;
    this.scale = 1;
    this.resetCounters();
  }

  setAuto(auto: boolean): void {
    if (this.auto === auto) return;
    this.auto = auto;
    this.resetCounters();
  }

  private resetCounters(): void {
    this.slowSeconds = 0;
    this.fastSeconds = 0;
    this.secondsSinceUpgrade = 99;
    this.upgradeDelay = 8;
    this.frameMs = 16.7;
  }

  /** Sample a real animation-frame interval; skip hidden tabs and giant resume delays. */
  sample(dt: number, hidden: boolean): QualityChange {
    if (!Number.isFinite(dt) || dt <= 0 || dt > 0.25 || hidden) return 'none';
    this.frameMs += (dt * 1000 - this.frameMs) * 0.06;
    if (!this.auto) return 'none';

    const overloaded = this.frameMs > (this.quality === 'low' ? 36 : 21);
    const hasHeadroom = this.frameMs < 17.8;
    this.secondsSinceUpgrade += dt;
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
      if (this.secondsSinceUpgrade < 5) this.upgradeDelay = Math.min(180, this.upgradeDelay * 2);
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

    if (this.fastSeconds < this.upgradeDelay || this.secondsSinceUpgrade < 5) return 'none';
    this.fastSeconds = 0;
    const scaleWasBelowOne = this.scale < 0.999;
    const index = QUALITY_ORDER.indexOf(this.quality);
    if (!scaleWasBelowOne && index >= QUALITY_ORDER.indexOf(this.ceiling)) return 'none';
    this.secondsSinceUpgrade = 0;

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
