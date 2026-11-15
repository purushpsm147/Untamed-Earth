/**
 * Curiosity Mode's director: decides WHAT is worth watching. Pure logic, no rendering,
 * no simulation writes. The camera rig (in Curiosity.ts) decides HOW to look at it.
 */
export interface Candidate {
  /** Stable identity for novelty tracking, e.g. "a:42" or "p:bridge". */
  key: string;
  kind: 'animal' | 'place';
  /** Animal id for kind === 'animal'. */
  id: number;
  x: number;
  z: number;
  /** Intrinsic interest: ecological significance times rarity. */
  base: number;
  /** Short tag for diagnostics and tests, e.g. "chase", "drink", "scenic". */
  tag: string;
}

export interface DirectorConfig {
  /** Never leave a subject sooner than this (seconds), unless it becomes invalid. */
  minDwell: number;
  /** Always move on after this long. */
  maxDwell: number;
  /** A rival must beat the current subject's score by this factor to interrupt it. */
  switchRatio: number;
  /** Seconds for a previously watched subject to regain full novelty. */
  noveltyRecovery: number;
  /** Distance (m) at which proximity halves the score. */
  halfDistance: number;
}

export const DEFAULT_DIRECTOR: DirectorConfig = { minDwell: 12, maxDwell: 40, switchRatio: 1.7, noveltyRecovery: 120, halfDistance: 260 };

export class Director {
  current: Candidate | null = null;
  /** Time the current subject was chosen. */
  since = 0;
  switches = 0;
  private readonly seen = new Map<string, number>();

  constructor(readonly cfg: DirectorConfig = DEFAULT_DIRECTOR) {}

  score(c: Candidate, camX: number, camZ: number, now: number): number {
    const d = Math.hypot(c.x - camX, c.z - camZ);
    const proximity = 1 / (1 + d / this.cfg.halfDistance);
    const last = this.seen.get(c.key);
    const novelty = last === undefined ? 1 : Math.min(1, Math.max(0.05, (now - last) / this.cfg.noveltyRecovery));
    return c.base * proximity * novelty;
  }

  /**
   * Pick the subject for the next interval.
   * @param valid whether the current subject still exists (animal alive, etc.)
   * @param force skip the current subject regardless of dwell time
   */
  choose(cands: Candidate[], camX: number, camZ: number, now: number, valid: boolean, force = false): Candidate | null {
    const cur = this.current;
    const dwell = now - this.since;
    let best: Candidate | null = null;
    let bestS = 0;
    for (const c of cands) {
      if (cur && c.key === cur.key) continue;
      const s = this.score(c, camX, camZ, now);
      if (s > bestS) {
        bestS = s;
        best = c;
      }
    }
    let change = force || !cur || !valid || dwell >= this.cfg.maxDwell;
    if (!change && cur && dwell >= this.cfg.minDwell && best) {
      // refresh the incumbent's intrinsic interest from the latest candidates (its behaviour may have changed)
      const live = cands.find((c) => c.key === cur.key);
      const curS = live ? live.base / (1 + Math.hypot(live.x - camX, live.z - camZ) / this.cfg.halfDistance) : 0;
      change = bestS > curS * this.cfg.switchRatio;
    }
    if (!change || !best) {
      if (cur && !valid && !best) this.current = null;
      return this.current;
    }
    if (cur) this.seen.set(cur.key, now);
    this.current = best;
    this.since = now;
    this.seen.set(best.key, now);
    this.switches++;
    // bounded memory: forget subjects that have fully regained novelty
    if (this.seen.size > 200) for (const [k, t] of this.seen) if (now - t > this.cfg.noveltyRecovery) this.seen.delete(k);
    return best;
  }
}
