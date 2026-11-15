import { describe, expect, it } from 'vitest';
import {
  NaturalSoundscape,
  computeLayerTargets,
  type NaturalAudioInput,
} from '../../apps/web/src/lab/NaturalSoundscape';

function makeAudioInput(overrides?: Partial<NaturalAudioInput>): NaturalAudioInput {
  return {
    listenerX: 640,
    listenerY: 6.5,
    listenerZ: 620,
    forwardX: 0,
    forwardY: 0,
    forwardZ: 1,
    riverX: 645,
    riverY: 3.5,
    riverZ: 620,
    forestWeight: 0.75,
    windSpeed: 3.0,
    windDir: 0.8,
    rainRate: 0,
    daylight: 0.8,
    simRate: 1,
    nearbyAnimals: [],
    ...overrides,
  };
}

describe('NaturalSoundscape', () => {
  it('attenuates flowing river water and near-bank droplets monotonically with distance', () => {
    const nearBank = computeLayerTargets(makeAudioInput({ listenerX: 642, riverX: 645 }));
    const midBank = computeLayerTargets(makeAudioInput({ listenerX: 615, riverX: 645 }));
    const farRidge = computeLayerTargets(makeAudioInput({ listenerX: 480, riverX: 645 }));

    expect(nearBank.riverLowGain).toBeGreaterThan(midBank.riverLowGain);
    expect(midBank.riverLowGain).toBeGreaterThan(farRidge.riverLowGain);
    expect(nearBank.dropletChancePerSec).toBeGreaterThan(0);
    expect(farRidge.dropletChancePerSec).toBe(0);
  });

  it('scales canopy leaf rustle with both wind speed and local forest cover', () => {
    const calmMeadow = computeLayerTargets(
      makeAudioInput({ windSpeed: 1.0, forestWeight: 0.05 }),
    );
    const breezyForest = computeLayerTargets(
      makeAudioInput({ windSpeed: 7.5, forestWeight: 0.9 }),
    );
    expect(breezyForest.leafRustleGain).toBeGreaterThan(calmMeadow.leafRustleGain * 2.5);
  });

  it('increases insect chorus at dusk/night and suppresses it during heavy rain or fast-forward', () => {
    const midday = computeLayerTargets(makeAudioInput({ daylight: 0.95, rainRate: 0 }));
    const dusk = computeLayerTargets(makeAudioInput({ daylight: 0.15, rainRate: 0 }));
    const stormDusk = computeLayerTargets(makeAudioInput({ daylight: 0.15, rainRate: 10 }));
    const fastForward = computeLayerTargets(
      makeAudioInput({ daylight: 0.15, rainRate: 0, simRate: 100 }),
    );

    expect(dusk.insectGain).toBeGreaterThan(midday.insectGain);
    expect(stormDusk.insectGain).toBeLessThan(dusk.insectGain);
    expect(fastForward.insectGain).toBe(0);
  });

  it('triggers spatial animal calls only from actual simulation animals and bounds call history', () => {
    const sound = new NaturalSoundscape();
    // Without user gesture start(), AudioContext remains uninitialized
    expect(sound.getTelemetry().started).toBe(false);

    const inputWithAlarmedDeer = makeAudioInput({
      nearbyAnimals: [
        {
          id: 42,
          species: 'chital',
          x: 636,
          y: 5.2,
          z: 622,
          beh: 6,
          fear: 0.75,
        },
      ],
    });

    for (let i = 0; i < 40; i++) {
      sound.update(0.25, inputWithAlarmedDeer);
    }

    const telemetry = sound.getTelemetry();
    expect(telemetry.recentCalls.length).toBeGreaterThan(0);
    expect(telemetry.recentCalls.length).toBeLessThanOrEqual(24);
    expect(telemetry.recentCalls.some((c) => c.kind === 'chital_alarm')).toBe(true);

    sound.dispose();
  });
});
