/**
 * Resolution-first quality controller. Pure logic (no WebGL) so its smoothing and
 * hysteresis can be unit-tested with synthetic frame times.
 *
 * Order of sacrifice: render resolution (down to 50%), then one preset step
 * (which lowers shadows, vegetation range, draw distance, water detail and rain density).
 * It never touches simulation state.
 */
export type AdaptAction = 'none' | 'resolution-down' | 'resolution-up' | 'preset-down';

export class AdaptiveQuality {
  frameMs = 16.7;
  resScale = 1;
  auto = true;
  private slowT = 0;
  private fastT = 0;
  private upWait = 8;
  private sinceRaise = 99;

  /** @param level index of the current preset (0 = lowest). */
  constructor(public level: number) {}

  reset(level: number): void {
    this.level = level;
    this.resScale = 1;
    this.slowT = this.fastT = 0;
  }

  step(dt: number, hidden = false): AdaptAction {
    if (dt > 0.25 || hidden) return 'none'; // tab switches and hitches are not evidence
    this.frameMs += (dt * 1000 - this.frameMs) * 0.06;
    if (!this.auto) return 'none';
    const budget = this.level === 0 ? 36 : 21;
    this.sinceRaise += dt;
    if (this.frameMs > budget) {
      this.slowT += dt;
      this.fastT = 0;
    } else {
      this.slowT = Math.max(0, this.slowT - dt * 0.5);
      if (this.frameMs < 17.8) this.fastT += dt;
    }
    if (this.slowT > 1.5) {
      this.slowT = 0;
      // an upgrade that immediately failed makes the next attempt wait twice as long
      if (this.sinceRaise < 5) this.upWait = Math.min(180, this.upWait * 2);
      if (this.resScale > 0.55) {
        this.resScale = Math.max(0.5, Math.round((this.resScale - 0.1) * 10) / 10);
        return 'resolution-down';
      }
      if (this.level > 0) {
        this.level--;
        this.resScale = 0.8;
        return 'preset-down';
      }
      return 'none';
    }
    if (this.fastT > this.upWait && this.resScale < 1) {
      this.fastT = 0;
      this.sinceRaise = 0;
      this.resScale = Math.min(1, Math.round((this.resScale + 0.1) * 10) / 10);
      return 'resolution-up';
    }
    return 'none';
  }
}
