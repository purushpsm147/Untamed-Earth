import { describe, expect, it } from 'vitest';
import { B } from '@untamed/ecology';
import {
  computeChitalInstancePose,
  resolveChitalPose,
} from '../../apps/web/src/lab/ChitalPrototype';

describe('ChitalPrototype ecological pose resolver', () => {
  it('maps authoritative animal behavior, speed, and fear to the 6 documentary poses without mutating state', () => {
    const idleDeer = Object.freeze({ beh: B.Idle, speed: 0.0, fear: 0.0 });
    const walkingDeer = Object.freeze({ beh: B.Wander, speed: 1.8, fear: 0.0 });
    const runningDeer = Object.freeze({ beh: B.Flee, speed: 6.5, fear: 0.7 });
    const grazingDeer = Object.freeze({ beh: B.Forage, speed: 0.05, fear: 0.0 });
    const drinkingDeer = Object.freeze({ beh: B.Drink, speed: 0.0, fear: 0.0 });
    const alertDeer = Object.freeze({ beh: B.Idle, speed: 0.0, fear: 0.45 });

    expect(resolveChitalPose(idleDeer)).toBe('idle');
    expect(resolveChitalPose(walkingDeer)).toBe('walking');
    expect(resolveChitalPose(runningDeer)).toBe('running');
    expect(resolveChitalPose(grazingDeer)).toBe('grazing');
    expect(resolveChitalPose(drinkingDeer)).toBe('drinking');
    expect(resolveChitalPose(alertDeer)).toBe('alert');
  });

  it('produces distinct multi-joint neck, head, leg, and tail parameters across grazing, alert, and running states', () => {
    const baseInput = {
      id: 7,
      sex: 1 as const,
      isAdult: true,
      growth: 1,
      x: 635,
      y: 5,
      z: 620,
      heading: 1.0,
      speed: 0,
      beh: B.Idle,
      fear: 0,
      hunger: 0.3,
      thirst: 0.2,
      energy: 0.8,
    };

    const graze = computeChitalInstancePose({ ...baseInput, beh: B.Forage }, 1.2, 10.0);
    const alert = computeChitalInstancePose({ ...baseInput, fear: 0.6 }, 1.2, 10.0);
    const run = computeChitalInstancePose(
      { ...baseInput, beh: B.Flee, speed: 6.0, fear: 0.8 },
      1.2,
      10.0,
    );

    // Grazing lowers neck strongly (+z) while alert raises neck (-z) and raises white tail flag (poseB[0] = 1)
    expect(graze.poseA[2]).toBeGreaterThan(0.8);
    expect(alert.poseA[2]).toBeLessThan(0);
    expect(alert.poseB[0]).toBe(1.0);

    // Running has high leg swing amplitude and knee lift multiplier
    expect(run.poseA[1]).toBeGreaterThan(0.8);
    expect(run.poseB[3]).toBeGreaterThan(1.2);
  });
});
