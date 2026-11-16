/**
 * Named experimental variants for controlled comparisons. Each takes a fresh Simulation (same seed, so the weather,
 * which has its own random stream, is identical across variants) and changes exactly one thing; it returns a function
 * that undoes the change. 'baseline' changes nothing.
 */
import { ECO_EXPERIMENT, type Simulation } from '@untamed/ecology';

export type Variant = (sim: Simulation) => (() => void) | void;
type Flag = keyof typeof ECO_EXPERIMENT;

const off = (...flags: Flag[]): Variant => () => {
  const saved = flags.map((f) => [f, ECO_EXPERIMENT[f]] as const);
  for (const f of flags) ECO_EXPERIMENT[f] = false;
  return () => { for (const [f, v] of saved) ECO_EXPERIMENT[f] = v; };
};

export const VARIANTS: Record<string, Variant> = {
  baseline: () => undefined,
  'no-many-eyes': off('manyEyes'),
  'no-coordinated-flight': off('coordinatedFlight'),
  'no-regroup': off('regroup'),
  'no-locomotion-limits': off('locomotionLimits'),
  'no-jackal-water-avoidance': off('jackalDeepWaterAvoidance'),
  'no-personal-space': off('personalSpace'),
  'no-dry-resting': off('dryResting'),
  'no-pursuit-giveup': off('pursuitGiveUp'),
  'no-moving-goal-giveup': off('pursuitGiveUp', 'movingGoalGiveUp'),
  'living-valley-off': off('manyEyes', 'coordinatedFlight', 'regroup', 'locomotionLimits', 'jackalDeepWaterAvoidance', 'personalSpace', 'dryResting', 'pursuitGiveUp', 'movingGoalGiveUp'),
};
