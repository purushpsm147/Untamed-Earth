/**
 * Presentation-only random stream for the soundscape (mulberry32).
 *
 * The soundscape has its OWN generator, seeded independently of the simulation, so that
 *  - nothing it draws can change the simulation's random sequence (audio observes; it never influences), and
 *  - an offline recording of a scenario is reproducible: same scenario + same browser build -> same samples.
 */
export class PresentationRng {
  private s: number;
  constructor(seed: number) {
    this.s = (seed ^ 0x9e3779b9) >>> 0;
  }
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }
  int(a: number, b: number): number {
    return Math.floor(this.range(a, b + 1));
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  /** Probability that a Poisson process of `ratePerS` fires at least once in `dt` seconds. */
  poisson(ratePerS: number, dt: number): boolean {
    return ratePerS > 0 && this.next() < 1 - Math.exp(-ratePerS * dt);
  }
}
