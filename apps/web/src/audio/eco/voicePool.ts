/**
 * Voice budget (pure bookkeeping). Each category has a cap and the pool has a hard total cap.
 * When a category is full, a new voice is admitted only if its score (priority x proximity gain) beats the
 * quietest playing voice of that category, which is then stolen (the caller fades it out over ~50 ms).
 */
export type VoiceCategory = 'call' | 'ambient-call' | 'movement' | 'oneshot-env';

export const DEFAULT_CAPS: Record<VoiceCategory, number> = { call: 8, 'ambient-call': 6, movement: 10, 'oneshot-env': 4 };
export const DEFAULT_TOTAL_CAP = 24;

export interface PoolEntry {
  readonly id: number;
  readonly category: VoiceCategory;
  readonly score: number;
  /** Audio-clock time at which the voice has finished (scheduled end). */
  readonly endAt: number;
}

export type Admission = { admit: true; id: number; steal: number | null } | { admit: false };

export class VoicePool {
  private readonly live = new Map<number, PoolEntry>();
  private nextId = 1;
  readonly stats = { admitted: 0, rejected: 0, stolen: 0, peak: 0 };

  constructor(
    private readonly caps: Record<VoiceCategory, number> = DEFAULT_CAPS,
    private readonly totalCap = DEFAULT_TOTAL_CAP,
  ) {}

  get size(): number {
    return this.live.size;
  }

  count(cat: VoiceCategory): number {
    let n = 0;
    for (const v of this.live.values()) if (v.category === cat) n++;
    return n;
  }

  /**
   * Forget voices whose scheduled end is at or before `now`. Admission works on the audio clock, not on
   * 'ended' callbacks, so it is also correct when many frames are scheduled ahead (offline rendering).
   */
  expire(now: number): void {
    for (const [id, v] of this.live) if (v.endAt <= now) this.live.delete(id);
  }

  request(category: VoiceCategory, score: number, endAt: number, now = -Infinity): Admission {
    this.expire(now);
    let steal: PoolEntry | null = null;
    const full = this.count(category) >= this.caps[category] || this.live.size >= this.totalCap;
    if (full) {
      const sameCat = this.count(category) >= this.caps[category];
      for (const v of this.live.values()) {
        if (sameCat && v.category !== category) continue;
        if (!steal || v.score < steal.score) steal = v;
      }
      if (!steal || steal.score >= score) {
        this.stats.rejected++;
        return { admit: false };
      }
      this.live.delete(steal.id);
      this.stats.stolen++;
    }
    const id = this.nextId++;
    this.live.set(id, { id, category, score, endAt });
    this.stats.admitted++;
    this.stats.peak = Math.max(this.stats.peak, this.live.size);
    return { admit: true, id, steal: steal ? steal.id : null };
  }

  release(id: number): void {
    this.live.delete(id);
  }

  clear(): void {
    this.live.clear();
  }
}
