/**
 * Read-only observation contracts for presentation layers (animation, audio, UI).
 *
 * These are the ONLY interfaces visual and audio modules should use to consume the ecosystem. They are derived
 * from authoritative simulation state on demand; nothing here writes to the simulation, and nothing here creates
 * events the simulation did not emit. Presentation code must not import Simulation internals beyond this file.
 *
 * Stability: fields may be added; existing fields keep their meaning. Version bumps are noted in
 * docs/INTEGRATION_CONTRACTS.md.
 */
import { DeathCause, SimEvent, Simulation, type Animal } from './simulation';
import { B } from './simulation';
import { SPECIES, SpeciesId, maturityDays } from './species';

export const OBSERVE_CONTRACT_VERSION = 1;

// ------------------------------------------------------------------ 1. animal motion & animation state

/** Coarse behaviour family for animation selection. Derived from the simulation's behaviour code. */
export type BehaviorFamily =
  | 'idle' | 'wander' | 'graze' | 'travel-to-water' | 'drink' | 'rest' | 'flee' | 'court'
  | 'stalk' | 'chase' | 'travel-to-carrion' | 'feed' | 'roost' | 'follow-mother' | 'regroup'
  // issue #31 (additive): watching an approaching animal; a mother defending her young; a newborn lying hidden
  | 'alert' | 'defend' | 'hide';

const FAMILY: Record<number, BehaviorFamily> = {
  [B.Idle]: 'idle', [B.Wander]: 'wander', [B.Forage]: 'graze', [B.SeekWater]: 'travel-to-water', [B.Drink]: 'drink',
  [B.Rest]: 'rest', [B.Flee]: 'flee', [B.SeekMate]: 'court', [B.Stalk]: 'stalk', [B.Chase]: 'chase',
  [B.SeekCarrion]: 'travel-to-carrion', [B.Feed]: 'feed', [B.Roost]: 'roost', [B.Follow]: 'follow-mother', [B.Regroup]: 'regroup',
  [B.Alert]: 'alert', [B.Defend]: 'defend', [B.Hide]: 'hide',
};

/** Behaviour family of one animal without building a full view (per-frame use by renderers). */
export function behaviorFamily(a: Animal): BehaviorFamily {
  return FAMILY[a.beh] ?? 'idle';
}

/** Locomotion mode derived from speed relative to the species' own walk/run speeds. */
export type Gait = 'still' | 'walk' | 'trot' | 'run' | 'fly' | 'swim';

export interface AnimalMotionView {
  readonly id: number;
  readonly species: SpeciesId;
  /** World position, metres. y is NOT included: presentation samples terrain itself (alt is height above it). */
  readonly x: number;
  readonly z: number;
  /** Height above ground (birds); 0 for ground animals. */
  readonly alt: number;
  /** Radians; 0 faces +z, increasing toward +x. */
  readonly heading: number;
  /** Current speed, m/s. */
  readonly speed: number;
  /** Position at the previous simulation tick, for interpolation (lerp by the renderer's alpha). */
  readonly prevX: number;
  readonly prevZ: number;
  readonly prevAlt: number;
  readonly behavior: BehaviorFamily;
  readonly gait: Gait;
  /** 0..1, perceived danger. Use for alert posture; do not use to trigger sounds (use 'alarm' events). */
  readonly fear: number;
  readonly lifeStage: 'juvenile' | 'subadult' | 'adult';
  readonly sex: 'female' | 'male';
  /** 0..1 body size relative to an adult of the species (growth). */
  readonly size: number;
  /** Adult head-and-body length of the species, metres. Multiply by size for this animal. */
  readonly speciesLength: number;
  readonly group: number;
  /** 0 if not recorded. */
  readonly mother: number;
  readonly controlledByPlayer: boolean;
}

export function gaitOf(sim: Simulation, a: Animal): Gait {
  const sp = SPECIES[a.sp]!;
  if (a.alt > 0.25) return 'fly';
  if (a.speed <= 0.05) return 'still';
  if (sim.valley.waterDepth(a.x, a.z, sim.env.stage) > 0.45 && !sp.flies) return 'swim';
  if (a.speed <= sp.walk * 1.7) return 'walk';
  if (a.speed <= sp.run * 0.6) return 'trot';
  return 'run';
}

export function motionView(sim: Simulation, a: Animal): AnimalMotionView {
  const sp = SPECIES[a.sp]!;
  const mat = maturityDays(sp);
  return {
    id: a.id, species: sp.id, x: a.x, z: a.z, alt: a.alt, heading: a.heading, speed: a.speed,
    prevX: a.px, prevZ: a.pz, prevAlt: a.palt, behavior: FAMILY[a.beh] ?? 'idle', gait: gaitOf(sim, a), fear: a.fear,
    lifeStage: a.age < mat * 0.4 ? 'juvenile' : a.age < mat ? 'subadult' : 'adult', sex: a.sex ? 'male' : 'female',
    size: sim.growth(a, sp), speciesLength: sp.length, group: a.group, mother: a.mother, controlledByPlayer: a.controlled,
  };
}

/** Living animals within `radius` of (x, z). Bounded by the population; no allocation of the full set. */
export function animalsNear(sim: Simulation, x: number, z: number, radius: number, out: AnimalMotionView[] = []): AnimalMotionView[] {
  out.length = 0;
  const r2 = radius * radius;
  for (const a of sim.animals) {
    if (!a.alive) continue;
    const dx = a.x - x;
    const dz = a.z - z;
    if (dx * dx + dz * dz <= r2) out.push(motionView(sim, a));
  }
  return out;
}

// ------------------------------------------------------------------ 2. ecological audio events

/**
 * An event that genuinely happened in the simulation, in a form audio can use. These are adapted 1:1 from
 * Simulation.events; there is no second event system. Ambient sounds without a simulated cause (insects, wind,
 * unspecific birdsong) must be driven by AmbientConditions, never presented as events.
 */
export interface EcoAudioEvent {
  readonly kind: 'alarm' | 'kill' | 'birth' | 'death';
  readonly species: SpeciesId;
  /** The animal that produced the sound (alarm caller, predator for kills, mother for births, the deceased). */
  readonly animalId: number;
  readonly x: number;
  readonly z: number;
  /** Simulation time in game hours when it happened. */
  readonly timeH: number;
  /** 0..1 suggested loudness from what happened (a kill is louder than a birth); not a measurement. */
  readonly intensity: number;
  /** For deaths only. */
  readonly cause?: DeathCause;
  /** For kills only: the prey animal's id and species. */
  readonly preyId?: number;
  readonly preySpecies?: SpeciesId;
}

export function toAudioEvent(sim: Simulation, e: SimEvent): EcoAudioEvent {
  const timeH = sim.env.timeH;
  switch (e.type) {
    case 'alarm':
      return { kind: 'alarm', species: SPECIES[e.sp]!.id, animalId: e.id, x: e.x, z: e.z, timeH, intensity: 0.8 };
    case 'kill': {
      const pred = sim.byId.get(e.predator);
      return {
        kind: 'kill', species: pred ? SPECIES[pred.sp]!.id : 'jackal', animalId: e.predator, x: e.x, z: e.z, timeH, intensity: 1,
        preyId: e.prey, preySpecies: SPECIES[e.sp]!.id,
      };
    }
    case 'birth':
      return { kind: 'birth', species: SPECIES[e.sp]!.id, animalId: e.id, x: e.x, z: e.z, timeH, intensity: 0.3 };
    case 'death':
      return { kind: 'death', species: SPECIES[e.sp]!.id, animalId: e.id, x: e.x, z: e.z, timeH, intensity: e.cause === 'predation' ? 0.9 : 0.2, cause: e.cause };
  }
}

/** Subscribe to real ecological events as audio events. Returns the unsubscribe function (call it on dispose). */
export function onAudioEvents(sim: Simulation, fn: (e: EcoAudioEvent) => void): () => void {
  return sim.events.on((e) => fn(toAudioEvent(sim, e)));
}

// ------------------------------------------------------------------ 3. ambient environmental conditions

export interface AmbientConditions {
  readonly timeH: number;
  /** 0..24 */
  readonly hour: number;
  /** 0 night .. 1 full day */
  readonly daylight: number;
  /** Sun elevation, radians (negative below the horizon). */
  readonly sunElevation: number;
  readonly season: 'Winter' | 'Summer' | 'Monsoon' | 'Post-monsoon';
  readonly weather: 'clear' | 'cloudy' | 'rain' | 'storm';
  /** Rain rate, mm/h. */
  readonly rain: number;
  readonly cloud: number;
  /** m/s and radians. */
  readonly wind: number;
  readonly windDir: number;
  readonly temperatureC: number;
  /** River stage offset, metres (negative in drought). */
  readonly riverStage: number;
}

const SEASONS = ['Winter', 'Summer', 'Monsoon', 'Post-monsoon'] as const;

export function ambientConditions(sim: Simulation): AmbientConditions {
  const e = sim.env;
  return {
    timeH: e.timeH, hour: e.hour, daylight: e.daylight(), sunElevation: e.sunElevation(), season: SEASONS[e.season]!,
    weather: e.weather, rain: e.rain, cloud: e.cloud, wind: e.wind, windDir: e.windDir, temperatureC: e.temperature, riverStage: e.stage,
  };
}

/** Local habitat and activity around a listener: drives ambient beds (leaf rustle, insects, water). */
export interface LocalHabitat {
  readonly forest: number;
  readonly meadow: number;
  readonly wetland: number;
  readonly settlement: number;
  readonly dump: number;
  /** Horizontal distance to the river centreline, metres. */
  readonly riverDistance: number;
  /** Depth of water at the point (<= 0 means dry), metres. */
  readonly waterDepth: number;
  /** Abstract small-fauna and invertebrate abundance in the cell (relative units; insects/frogs/rodents). */
  readonly invertebrates: number;
  readonly smallFauna: number;
  /** Count of living animals per species within `radius`, and how many of those are active (not resting/roosting). */
  readonly nearby: Readonly<Record<SpeciesId, { readonly count: number; readonly active: number }>>;
}

export function localHabitat(sim: Simulation, x: number, z: number, radius = 80): LocalHabitat {
  const v = sim.valley;
  const s = v.sample(x, z);
  const c = sim.env.cellIndex(x, z);
  const nearby = Object.fromEntries(SPECIES.map((sp) => [sp.id, { count: 0, active: 0 }])) as Record<SpeciesId, { count: number; active: number }>;
  const r2 = radius * radius;
  for (const a of sim.animals) {
    if (!a.alive || (a.x - x) ** 2 + (a.z - z) ** 2 > r2) continue;
    const n = nearby[SPECIES[a.sp]!.id];
    n.count++;
    if (a.beh !== B.Rest && a.beh !== B.Roost) n.active++;
  }
  return {
    forest: s.forest, meadow: s.meadow, wetland: s.wetland, settlement: s.settlement, dump: s.dump, riverDistance: s.riverD,
    waterDepth: v.waterDepth(x, z, sim.env.stage), invertebrates: sim.env.invert[c]!, smallFauna: sim.env.fauna[c]!, nearby,
  };
}
