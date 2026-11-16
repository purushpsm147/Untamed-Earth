/**
 * Presentation-only pose blending for animals. Inputs come from the read-only observation contract (behaviour
 * family, movement, fear); the output only drives the vertex shader. Nothing here can write to the simulation.
 * Pure and deterministic so transitions are unit-testable without WebGL.
 */
import type { BehaviorFamily } from '@untamed/ecology';

export interface PoseState {
  /** 0 standing .. 1 lying (legs folded), raw ramp. */
  lie: number;
  /** Head pitch (radians; positive lowers the head) and leg-swing amplitude, both smoothed. */
  head: number;
  amp: number;
}

export interface PoseInput {
  family: BehaviorFamily;
  moving: boolean;
  running: boolean;
  flying: boolean;
  /** Species never lies down in this model (birds). */
  flier: boolean;
  fear: number;
  /** Seconds, and a per-animal offset for idle variation. */
  time: number;
  seed: number;
}

/** Seconds to lie fully down, and to get up. Getting up is quick: the simulation may already be moving the animal. */
export const LIE_DOWN_S = 1 / 0.65;
export const GET_UP_S = 1 / 2.2;

export function newPose(): PoseState {
  return { lie: 0, head: 0, amp: 0 };
}

/** Advance the pose by dt seconds. Returns the eased lie amount (0..1) to draw with. */
export function stepPose(v: PoseState, p: PoseInput, dt: number): number {
  const resting = p.family === 'rest' && !p.moving && !p.flying && !p.flier;
  v.lie = resting ? Math.min(1, v.lie + dt / LIE_DOWN_S) : Math.max(0, v.lie - dt / GET_UP_S);
  v.amp += ((p.moving && !p.flying ? (p.running ? 0.75 : 0.42) : 0) - v.amp) * Math.min(1, dt * 6);
  const eating = (p.family === 'graze' || p.family === 'drink' || p.family === 'feed') && !p.moving;
  // alert: head high; lying: head up and still; grazing: head to the ground with a slow bob; drinking: lower
  const target = p.fear > 0.3 ? -0.3
    : v.lie > 0.5 ? -0.12
    : eating ? (p.flier ? 0.9 : (p.family === 'drink' ? 1.68 : 1.55) + Math.sin(p.time * 2.2 + p.seed) * 0.08)
    : p.running ? 0.35 : Math.sin(p.time * 0.4 + p.seed) * 0.06;
  v.head += (target - v.head) * Math.min(1, dt * 4);
  return v.lie * v.lie * (3 - 2 * v.lie); // smoothstep: settle and rise without a mechanical linear slide
}
