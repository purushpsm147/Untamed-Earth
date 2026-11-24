/**
 * CallRouter: decides whether a REAL ecological event becomes an audible call (docs/AUDIO_INTEGRATION.md).
 *
 * Pure and deterministic. It never creates events and never touches Web Audio; the soundscape asks it and acts on
 * the decision. Every drop has a reason so routing can be audited (telemetry and the recording cue sheets).
 */
import type { EcoAudioEvent } from '@untamed/ecology';
import { distance, type Vec3 } from './acoustics';
import { profileFor, type CallProfile, type Trigger } from './repertoire';

export type DropReason = 'silent-kind' | 'unsupported' | 'out-of-range' | 'cooldown' | 'merged' | 'rate-gate';

export interface PlayDecision {
  readonly action: 'play';
  readonly profile: CallProfile;
  readonly event: EcoAudioEvent;
  readonly distanceM: number;
  /** Which animal voices the call (the alarm caller, the predator, or the prey for distress). */
  readonly voiceAnimalId: number;
}
export interface DropDecision {
  readonly action: 'drop';
  readonly reason: DropReason;
  readonly event: EcoAudioEvent;
  readonly trigger?: Trigger;
}
export type RouteDecision = PlayDecision | DropDecision;

export interface RouteContext {
  /** Listener (camera) position, metres. */
  readonly listener: Vec3;
  /** Real (wall/audio) time in seconds: cooldowns are perceptual, so they run in real time. */
  readonly realTime: number;
  /** Simulation speed multiplier. */
  readonly simRate: number;
  /** Terrain height + 1 m at the event's position (the router itself does not read terrain). */
  readonly sourceY: number;
}

export const ROUTER_DEFAULTS = {
  /** Above this rate events arrive far faster than real calls could: play none (the soundscape is a bed). */
  muteAboveRate: 100,
  /** Above this rate play at most one call per profile per `throttleS` real seconds. */
  throttleAboveRate: 10,
  throttleS: 2,
  /** Alarms of the same call within this time and radius merge into the first one (a herd barks as one). */
  mergeWindowS: 0.3,
  mergeRadiusM: 15,
};

function triggersFor(e: EcoAudioEvent): { trigger: Trigger; species: EcoAudioEvent['species']; animalId: number }[] {
  switch (e.kind) {
    case 'alarm':
      return [{ trigger: 'event:alarm', species: e.species, animalId: e.animalId }];
    case 'kill': {
      const out: { trigger: Trigger; species: EcoAudioEvent['species']; animalId: number }[] = [
        { trigger: 'event:kill', species: e.species, animalId: e.animalId },
      ];
      if (e.preySpecies && e.preyId) out.push({ trigger: 'event:kill-prey', species: e.preySpecies, animalId: e.preyId });
      return out;
    }
    default:
      return [];
  }
}

export class CallRouter {
  private readonly lastByAnimal = new Map<string, number>();
  private readonly lastByProfile = new Map<string, number>();
  private readonly recent: { id: string; t: number; x: number; z: number }[] = [];
  readonly stats: Record<'play' | DropReason, number> = { play: 0, 'silent-kind': 0, unsupported: 0, 'out-of-range': 0, cooldown: 0, merged: 0, 'rate-gate': 0 };

  constructor(private readonly cfg = ROUTER_DEFAULTS) {}

  /** One event can yield several decisions (a kill: the scuffle and, for hares, the prey's scream). */
  route(e: EcoAudioEvent, c: RouteContext): RouteDecision[] {
    const ts = triggersFor(e);
    if (ts.length === 0) return [this.drop(e, 'silent-kind')];
    return ts.map(({ trigger, species, animalId }) => this.routeOne(e, trigger, species, animalId, c));
  }

  private routeOne(e: EcoAudioEvent, trigger: Trigger, species: EcoAudioEvent['species'], animalId: number, c: RouteContext): RouteDecision {
    const profile = profileFor(species, trigger);
    if (!profile) return this.drop(e, 'unsupported', trigger);
    if (c.simRate > this.cfg.muteAboveRate) return this.drop(e, 'rate-gate', trigger);
    const d = distance({ x: e.x, y: c.sourceY, z: e.z }, c.listener);
    if (d > profile.rangeM) return this.drop(e, 'out-of-range', trigger);
    const keyA = `${animalId}:${profile.id}`;
    const lastA = this.lastByAnimal.get(keyA);
    if (lastA !== undefined && c.realTime - lastA < profile.cooldownS) return this.drop(e, 'cooldown', trigger);
    if (c.simRate > this.cfg.throttleAboveRate) {
      const lastP = this.lastByProfile.get(profile.id);
      if (lastP !== undefined && c.realTime - lastP < this.cfg.throttleS) return this.drop(e, 'rate-gate', trigger);
    }
    // merge near-simultaneous alarms of the same call close together
    while (this.recent.length && c.realTime - this.recent[0]!.t > this.cfg.mergeWindowS) this.recent.shift();
    if (trigger === 'event:alarm') {
      const r2 = this.cfg.mergeRadiusM ** 2;
      if (this.recent.some((r) => r.id === profile.id && (r.x - e.x) ** 2 + (r.z - e.z) ** 2 <= r2)) {
        this.lastByAnimal.set(keyA, c.realTime);
        return this.drop(e, 'merged', trigger);
      }
    }
    this.lastByAnimal.set(keyA, c.realTime);
    this.lastByProfile.set(profile.id, c.realTime);
    this.recent.push({ id: profile.id, t: c.realTime, x: e.x, z: e.z });
    if (this.lastByAnimal.size > 4096) this.prune(c.realTime);
    this.stats.play++;
    return { action: 'play', profile, event: e, distanceM: d, voiceAnimalId: animalId };
  }

  private drop(e: EcoAudioEvent, reason: DropReason, trigger?: Trigger): DropDecision {
    this.stats[reason]++;
    return { action: 'drop', reason, event: e, trigger };
  }

  /** Bounded memory: forget cooldowns older than any profile's cooldown. */
  private prune(now: number): void {
    for (const [k, t] of this.lastByAnimal) if (now - t > 600) this.lastByAnimal.delete(k);
  }

  reset(): void {
    this.lastByAnimal.clear();
    this.lastByProfile.clear();
    this.recent.length = 0;
  }
}
