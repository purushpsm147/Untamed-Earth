/**
 * Builds a SoundscapeFrame from the simulation using ONLY read-only observation contracts (observe.ts) plus
 * terrain reads (presentation already samples terrain itself: INTEGRATION_CONTRACTS.md).
 *
 * Reads: onAudioEvents, ambientConditions, localHabitat, motionView, valley.heightFast / riverX / waterSurface /
 * waterDepth, env.forest grid. Writes: nothing. In particular it never sets `sim.focus` (that is the camera's input
 * and changes decision frequency; audio must not influence the simulation).
 */
import { ambientConditions, localHabitat, motionView, onAudioEvents, type EcoAudioEvent, type Simulation } from '@untamed/ecology';
import type { ListenerPose, WorldSampler } from './acoustics';
import type { AnimalObs, SoundscapeFrame } from './planner';

/** Animals farther than this are ignored entirely (the largest call range is the jackal chorus). */
export const OBSERVE_RADIUS = 1400;
const HABITAT_RADIUS = 80;

export function worldSampler(sim: Simulation): WorldSampler {
  const v = sim.valley;
  const env = sim.env;
  return {
    height: (x, z) => v.heightFast(x, z),
    forest: (x, z) => env.forest[env.cellIndex(x, z)] ?? 0,
  };
}

/** Body height (m) used to place a call at an animal's head. Coarse, by body length. */
function headHeight(len: number, size: number): number {
  return Math.max(0.15, len * 0.6 * size);
}

export class FrameBuilder {
  private readonly animals: AnimalObs[] = [];
  private habitatT = -1;
  private habitat: SoundscapeFrame['habitat'] | null = null;
  constructor(private readonly sim: Simulation) {}

  build(listener: ListenerPose, realDt: number, realTime: number, simRate: number): SoundscapeFrame {
    const sim = this.sim;
    const v = sim.valley;
    const env = sim.env;
    const r2 = OBSERVE_RADIUS * OBSERVE_RADIUS;
    this.animals.length = 0;
    for (const a of sim.animals) {
      if (!a.alive) continue;
      const dx = a.x - listener.x;
      const dz = a.z - listener.z;
      if (dx * dx + dz * dz > r2) continue;
      const m = motionView(sim, a);
      const ground = v.heightFast(a.x, a.z);
      this.animals.push({
        ...m,
        y: ground + a.alt + headHeight(m.speciesLength, m.size),
        waterDepth: v.waterDepth(a.x, a.z, env.stage),
        forest: env.forest[env.cellIndex(a.x, a.z)] ?? 0,
      });
    }
    // habitat changes slowly in space; sample it at most 4 times per real second
    if (!this.habitat || realTime - this.habitatT >= 0.25 || this.habitatT < 0) {
      const h = localHabitat(sim, listener.x, listener.z, HABITAT_RADIUS);
      this.habitat = { forest: h.forest, meadow: h.meadow, wetland: h.wetland, riverDistance: h.riverDistance, waterDepth: h.waterDepth, invertebrates: h.invertebrates, smallFauna: h.smallFauna };
      this.habitatT = realTime;
    }
    const rx = v.riverX(listener.z);
    return {
      realDt, realTime, simRate, listener,
      ambient: ambientConditions(sim),
      habitat: this.habitat,
      river: { x: rx, y: v.waterSurface(listener.z) + env.stage, z: listener.z },
      animals: this.animals,
    };
  }
}

/** Subscribes to real events for the soundscape; dispose() unsubscribes. */
export class EcoAudioObserver {
  private off: (() => void) | null;
  constructor(sim: Simulation, sink: (e: EcoAudioEvent) => void) {
    this.off = onAudioEvents(sim, sink);
  }
  dispose(): void {
    this.off?.();
    this.off = null;
  }
}
