/**
 * Named variants for controlled comparisons (same seed => identical weather, which has its own random stream).
 * Production code carries no experiment switches; the controlled experiments that identified the causes ran on
 * branch experiment/ecology-stability (ECO_EXPERIMENT switches), see docs/ECOLOGICAL_STABILITY_REPORT.md.
 */
import { SPECIES_INDEX, SPECIES, type Simulation } from '@untamed/ecology';

export type Variant = (sim: Simulation) => (() => void) | void;

/** Temporarily set the jackal's plant-food weight (fruit, plant matter); restored after the run. */
const jackalVeg = (w: number): Variant => () => {
  const d = SPECIES[SPECIES_INDEX.jackal]!.diet;
  const old = d.veg;
  d.veg = w;
  return () => {
    d.veg = old;
  };
};

export const VARIANTS: Record<string, Variant> = {
  baseline: () => undefined,
  // Gate 2, experiment 1: jackal plant share toward field diet composition (default 0.12)
  'jackal-veg-0.3': jackalVeg(0.3),
  'jackal-veg-0.5': jackalVeg(0.5),
};
