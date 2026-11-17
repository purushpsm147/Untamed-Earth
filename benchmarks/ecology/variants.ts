/**
 * Named variants for controlled comparisons (same seed => identical weather, which has its own random stream).
 * Production code carries no experiment switches; the controlled experiments that identified the causes ran on
 * branch experiment/ecology-stability (ECO_EXPERIMENT switches), see docs/ECOLOGICAL_STABILITY_REPORT.md.
 */
import { SPECIES, type Simulation } from '@untamed/ecology';

export type Variant = (sim: Simulation) => (() => void) | void;

/**
 * Sensitivity: a different jackal territory spacing (m). Territory size is the model's largest uncertainty (field home
 * ranges are 1-47 km2; the valley is ~2 km2). Restored after the run; existing territories are re-evaluated.
 */
const territorySpacing = (m: number): Variant => (sim) => {
  const t = SPECIES.find((s) => s.id === 'jackal')!.territory!;
  const old = t.spacing;
  t.spacing = m;
  sim.territories.clear();
  (sim as unknown as { updateTerritories(): void }).updateTerritories();
  return () => {
    t.spacing = old;
  };
};

export const VARIANTS: Record<string, Variant> = {
  baseline: () => undefined,
  'territory-spacing-720': territorySpacing(720),
};
