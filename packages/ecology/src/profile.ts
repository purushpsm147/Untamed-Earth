/**
 * Opt-in, low-overhead profiler for Simulation.step(). Disabled by default (Simulation.profiler === null), in which
 * case the only cost is a null check per stage. It reads only the wall clock: it never touches either random stream,
 * so enabling it cannot change simulation state (tested in tests/unit/step-profiler.test.ts).
 *
 * Stage times are inclusive of nested stages where noted; `exclusive()` subtracts the nesting.
 */
export const PROFILE_STAGES = [
  'environment', // weather, vegetation, soil moisture, nutrients (Environment.step)
  'spatialIndex', // spatial-hash rebuild
  'herdGroups', // group centroid rebuild (every 4 s)
  'physiology', // needs, health, ageing, pregnancy; INCLUDES births and most deaths
  'births', // giveBirth (nested in physiology)
  'deaths', // kill (nested in physiology, predation or experiments)
  'decide', // INCLUDES perception
  'perception', // spatial query over vision/hearing radius and per-neighbour evaluation (nested in decide)
  'actPredation', // per-tick behaviour of stalking/chasing animals, including attacks
  'actHerd', // regroup / follow-mother behaviour
  'act', // all other behaviours (forage, drink, rest, flee, ...)
  'move', // locomotion and steering; INCLUDES personalSpace
  'personalSpace', // herd personal-space query and step (nested in move)
  'carcasses',
  'sweep', // removal of dead animals from lists
  'stats', // population history sample (every 2 game hours)
] as const;
export type ProfileStage = (typeof PROFILE_STAGES)[number];

const NESTED: Partial<Record<ProfileStage, ProfileStage>> = { births: 'physiology', perception: 'decide', personalSpace: 'move' };

export class StepProfiler {
  readonly ms = Object.fromEntries(PROFILE_STAGES.map((s) => [s, 0])) as Record<ProfileStage, number>;
  readonly calls = Object.fromEntries(PROFILE_STAGES.map((s) => [s, 0])) as Record<ProfileStage, number>;
  /** Spatial-hash queries and candidate items visited (before the radius test). */
  readonly query = { queries: 0, visited: 0 };
  /** Wall time of each whole step(), ms. */
  readonly tickMs: number[] = [];
  ticks = 0;
  /** Animals present at the start of each step, summed (for per-animal costs). */
  animalTicks = 0;

  now(): number {
    return performance.now();
  }
  /** Add the time since t0 to a stage and return the current time (for chaining). */
  lap(stage: ProfileStage, t0: number): number {
    const t = performance.now();
    this.ms[stage] += t - t0;
    this.calls[stage]++;
    return t;
  }
  /** Stage times with nested stages subtracted from their parents (deaths are spread across parents; left as is). */
  exclusive(): Record<ProfileStage, number> {
    const out = { ...this.ms };
    for (const [child, parent] of Object.entries(NESTED) as [ProfileStage, ProfileStage][]) out[parent] -= out[child];
    return out;
  }
  reset(): void {
    for (const s of PROFILE_STAGES) this.ms[s] = this.calls[s] = 0;
    this.query.queries = this.query.visited = 0;
    this.tickMs.length = 0;
    this.ticks = this.animalTicks = 0;
  }
}
