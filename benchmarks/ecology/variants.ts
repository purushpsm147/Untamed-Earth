/**
 * Named variants for controlled comparisons (same seed => identical weather, which has its own random stream).
 * Production code carries no experiment switches; the controlled experiments that identified the causes ran on
 * branch experiment/ecology-stability (ECO_EXPERIMENT switches), see docs/ECOLOGICAL_STABILITY_REPORT.md.
 */
import type { Simulation } from '@untamed/ecology';

export type Variant = (sim: Simulation) => (() => void) | void;

export const VARIANTS: Record<string, Variant> = {
  baseline: () => undefined,
};
