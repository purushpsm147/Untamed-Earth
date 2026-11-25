/**
 * SoundscapePlanner: turns one observation frame into ambient bed targets and voice requests. Pure (no Web Audio).
 *
 * Inputs are read-only observations (observe.ts contracts + terrain). Outputs are presentation decisions only.
 * The planner draws from its own PresentationRng; it has no reference to the Simulation at all.
 *
 * What drives what (every sound has a cause in the frame):
 *  - wind, gust          <- ambient.wind (m/s) with a presentation gust process (mean-reverting noise)
 *  - leaf / grass rustle <- habitat.forest / habitat.meadow x wind
 *  - rain, canopy patter <- ambient.rain (mm/h), habitat.forest
 *  - river               <- distance to the real river channel, river stage (spate is louder)
 *  - crickets (night)    <- 1 - daylight, temperature (chirp rate rises with temperature), habitat.invertebrates, rain
 *  - cicadas (day)       <- daylight, temperature, season, habitat.forest
 *  - frogs               <- Monsoon/Post-monsoon, night, wetland or river proximity, habitat.smallFauna, rain
 *  - event calls         <- NOT here: CallRouter, from real simulation events only
 *  - state-derived calls <- a real animal's behaviour and time of day (repertoire.ts tier 'state-derived')
 *  - movement            <- a real animal's gait, speed, altitude change and water depth
 *  - thunder             <- ambient.weather === 'storm'
 */
import type { AmbientConditions, AnimalMotionView, LocalHabitat, SpeciesId } from '@untamed/ecology';
import { clamp, distance, type ListenerPose, type Vec3 } from './acoustics';
import { profileFor, type CallId, type CallProfile } from './repertoire';
import { PresentationRng } from './rng';

/** An animal as the soundscape sees it: the motion contract plus terrain-derived context. */
export interface AnimalObs extends AnimalMotionView {
  /** World y of the animal's head (terrain + alt + ~body height). */
  readonly y: number;
  /** Water depth at the animal, metres (<= 0 dry). */
  readonly waterDepth: number;
  /** Forest density 0..1 under the animal. */
  readonly forest: number;
}

export type AmbientObs = Pick<AmbientConditions, 'hour' | 'daylight' | 'sunElevation' | 'season' | 'weather' | 'rain' | 'cloud' | 'wind' | 'windDir' | 'temperatureC' | 'riverStage'>;
export type HabitatObs = Pick<LocalHabitat, 'forest' | 'meadow' | 'wetland' | 'riverDistance' | 'waterDepth' | 'invertebrates' | 'smallFauna'>;

export interface SoundscapeFrame {
  /** Real seconds since the previous frame. */
  readonly realDt: number;
  /** Real seconds since the soundscape started. */
  readonly realTime: number;
  readonly simRate: number;
  readonly listener: ListenerPose;
  readonly ambient: AmbientObs;
  readonly habitat: HabitatObs;
  /** Nearest point of the river channel at the water surface. */
  readonly river: Vec3;
  readonly animals: readonly AnimalObs[];
}

export interface BedTargets {
  wind: number;
  windCutoff: number;
  leaves: number;
  leavesCutoff: number;
  grass: number;
  rain: number;
  rainCanopy: number;
  /** Source level of the river voice (distance is applied by its panner). */
  river: number;
  riverBrightness: number;
  riverPos: Vec3;
  insects: number;
  /** Cricket chirps per second (temperature dependent). */
  insectChirpRate: number;
  cicadas: number;
  frogs: number;
  distant: number;
  /** Diagnostics for cue sheets. */
  dayPart: DayPart;
  gust: number;
}

export type DayPart = 'night' | 'dawn' | 'day' | 'dusk';

export type MovementKind = 'footfall' | 'splash' | 'takeoff' | 'wingbeat';

export interface VoiceRequest {
  readonly type: 'call' | 'movement' | 'thunder';
  readonly call?: CallId;
  readonly profile?: CallProfile;
  readonly movement?: MovementKind;
  readonly animalId: number;
  readonly species?: SpeciesId;
  readonly pos: Vec3;
  /** Start offset from the frame time, seconds (chorus joiners). */
  readonly delayS: number;
  /** 0..1 strength (gait, body size, group size). */
  readonly intensity: number;
  /** Surface hint for footfalls: 0 open ground .. 1 dense vegetation. */
  readonly vegetation?: number;
  readonly why: string;
  readonly provenance: Provenance;
}

/**
 * Where a sound came from (AUD-02). Exactly one source per sound:
 *  - 'sim-event'    a real Simulation event (alarm/kill) delivered through onAudioEvents
 *  - 'animal-state' a real animal's current state (behaviour, gait, altitude). For calls this is NOT a simulated
 *                   vocal event: the simulation does not model vocalisation (tier 'state-derived', lab only)
 *  - 'environment'  weather / time of day / habitat driving an ambient sound
 *  - 'test-harness' synthetic input used only by automated gates; never produced by the lab or game
 */
export type Provenance =
  | { readonly source: 'sim-event'; readonly event: 'alarm' | 'kill'; readonly animalId: number; readonly timeH: number }
  | { readonly source: 'animal-state'; readonly animalId: number; readonly behavior: string; readonly gait: string; readonly vocalEventSimulated: false }
  | { readonly source: 'environment'; readonly driver: string }
  | { readonly source: 'test-harness'; readonly note: string };

export interface PlannerOptions {
  stateCalls: boolean;
  movement: boolean;
  beds: boolean;
  /** Movement sounds only within this radius, metres. */
  movementRadius: number;
  /** Above this simulation rate, state-derived calls stop (they would be impossibly frequent). */
  maxCallRate: number;
  /** Above this rate, footsteps stop (animals move N x faster than real; cadence would be absurd). */
  maxMovementRate: number;
}

/**
 * Defaults are the PRODUCTION defaults. State-derived calls are off (DIRECTOR TASK AUD-02): lab-only, separately
 * switchable, pending biological evidence and human listening.
 */
export const PLANNER_DEFAULTS: PlannerOptions = { stateCalls: false, movement: true, beds: true, movementRadius: 30, maxCallRate: 10, maxMovementRate: 2 };

/** Twilight factor 0..1, peaking with the sun just around the horizon (sun elevation in radians). */
export function twilight(sunElevation: number): number {
  return clamp(1 - Math.abs(sunElevation - 0.03) / 0.16, 0, 1);
}

export function dayPart(a: Pick<AmbientObs, 'hour' | 'sunElevation' | 'daylight'>): DayPart {
  if (twilight(a.sunElevation) > 0.25) return a.hour < 12 ? 'dawn' : 'dusk';
  return a.daylight > 0.5 ? 'day' : 'night';
}

/**
 * Cricket chirp rate from air temperature. Stridulation rate rises with temperature in crickets generally;
 * Dolbear's relation (chirps/min ~ 7.2 T - 32, T in C) is used for the SHAPE only. It was described for a North
 * American tree cricket and is not a claim about South Asian species.
 */
export function chirpRate(tempC: number): number {
  return clamp((7.2 * tempC - 32) / 60, 0.4, 4.5);
}

const BIRD_ACTIVE = new Set(['wander', 'graze', 'travel-to-water', 'drink', 'flee', 'court', 'travel-to-carrion', 'feed', 'regroup', 'idle']);

export class SoundscapePlanner {
  private readonly rng: PresentationRng;
  private gust = 0;
  /** Natural silence: alternating active and lull phases for state-derived calls. */
  private lull = false;
  private phaseLeft = 0;
  private readonly lastCall = new Map<string, number>();
  private readonly stepPhase = new Map<number, number>();
  private readonly wasAirborne = new Map<number, boolean>();
  private frames = 0;
  readonly opts: PlannerOptions;

  constructor(seed: number, opts: Partial<PlannerOptions> = {}) {
    this.rng = new PresentationRng(seed);
    this.opts = { ...PLANNER_DEFAULTS, ...opts };
    this.phaseLeft = this.rng.range(8, 30);
  }

  get inLull(): boolean {
    return this.lull;
  }

  plan(f: SoundscapeFrame, out: VoiceRequest[] = []): { beds: BedTargets; requests: VoiceRequest[] } {
    out.length = 0;
    const dt = clamp(Number.isFinite(f.realDt) ? f.realDt : 0, 0, 0.25);
    this.frames++;
    this.stepGust(dt);
    this.stepLull(dt);
    const beds = this.beds(f);
    if (this.opts.stateCalls && f.simRate <= this.opts.maxCallRate) this.stateCalls(f, dt, out);
    if (this.opts.movement && f.simRate <= this.opts.maxMovementRate) this.movement(f, dt, out);
    if (f.ambient.weather === 'storm' && f.simRate <= 100 && this.rng.poisson(1 / 25, dt)) {
      const ang = this.rng.range(0, Math.PI * 2);
      const dist = this.rng.range(800, 5000);
      out.push({
        type: 'thunder', animalId: 0, pos: { x: f.listener.x + Math.sin(ang) * dist, y: f.listener.y + 300, z: f.listener.z + Math.cos(ang) * dist },
        delayS: 0, intensity: clamp(1.4 - dist / 5000, 0.3, 1), why: 'weather=storm', provenance: { source: 'environment', driver: 'weather=storm' },
      });
    }
    if (this.frames % 600 === 0) this.prune(f);
    return { beds, requests: out };
  }

  private stepGust(dt: number): void {
    // Ornstein-Uhlenbeck: tau 6 s, unit-ish variance; presentation only
    const tau = 6;
    this.gust += (-this.gust / tau) * dt + Math.sqrt(dt) * 0.55 * (this.rng.next() * 2 - 1) * 1.7;
    this.gust = clamp(this.gust, -1.5, 1.5);
  }

  private stepLull(dt: number): void {
    this.phaseLeft -= dt;
    if (this.phaseLeft > 0) return;
    this.lull = !this.lull;
    this.phaseLeft = this.lull ? this.rng.range(6, 20) : this.rng.range(15, 45);
  }

  private beds(f: SoundscapeFrame): BedTargets {
    const a = f.ambient;
    const h = f.habitat;
    const on = this.opts.beds ? 1 : 0;
    const windEff = Math.max(0, a.wind * (1 + 0.35 * this.gust));
    const night = 1 - a.daylight;
    const tw = twilight(a.sunElevation);
    const heavyRain = a.rain > 4;
    const rainN = clamp(a.rain / 12, 0, 1);
    const invertN = clamp(h.invertebrates / 1.0, 0, 1.5);
    const faunaN = clamp(h.smallFauna / 0.8, 0, 1.5);
    const riverD = distance(f.listener, f.river);
    const flow = clamp(0.75 + a.riverStage * 0.25, 0.3, 1.6);
    const wetSeason = a.season === 'Monsoon' ? 1 : a.season === 'Post-monsoon' ? 0.5 : 0;
    const hot = clamp((a.temperatureC - 26) / 8, 0, 1);
    const warm = clamp((a.temperatureC - 14) / 8, 0, 1);
    const nearWater = Math.max(h.wetland, clamp(1 - h.riverDistance / 120, 0, 1));
    return {
      // At ear level a light breeze is heard mostly through vegetation (leaves/grass below); low-frequency wind
      // rumble is largely a microphone artefact, so the low layer only grows above a light breeze (~3 m/s).
      // Measured before this change: 63-250 Hz within 5 dB of the total in every scenario (docs/evidence/audio).
      wind: on * clamp(0.006 + 0.03 * clamp((windEff - 3) / 6, 0, 1.5), 0, 0.3),
      windCutoff: 170 + 42 * windEff,
      leaves: on * clamp(Math.pow(h.forest, 0.8) * Math.pow(windEff / 8, 1.4) * 0.26, 0, 0.3),
      leavesCutoff: 2100 + 110 * windEff,
      grass: on * clamp(h.meadow * (windEff / 8) * 0.07, 0, 0.1),
      rain: on * Math.pow(rainN, 0.7) * 0.3,
      rainCanopy: on * Math.pow(rainN, 0.7) * h.forest * 0.22,
      river: on * (riverD < 450 ? 0.24 * flow : 0),
      riverBrightness: clamp(0.6 + a.riverStage * 0.3, 0.3, 1.4),
      riverPos: f.river,
      insects: on * Math.pow(night, 1.3) * warm * Math.min(1, invertN) * (heavyRain ? 0.2 : 1 - rainN * 0.5) * 0.05,
      insectChirpRate: chirpRate(a.temperatureC),
      cicadas: on * a.daylight * (1 - tw) * hot * (a.season === 'Summer' || a.season === 'Monsoon' ? 1 : 0.2) * h.forest * (heavyRain ? 0.1 : 1) * 0.03,
      frogs: on * wetSeason * Math.pow(night, 1.1) * nearWater * Math.min(1, faunaN) * (0.5 + 0.5 * clamp(a.rain / 2, 0, 1)) * 0.06,
      distant: on * (0.003 + 0.003 * clamp(windEff / 6, 0, 1)),
      dayPart: dayPart(a),
      gust: this.gust,
    };
  }

  private ready(id: number, p: CallProfile, now: number): boolean {
    const last = this.lastCall.get(`${id}:${p.id}`);
    return last === undefined || now - last >= p.cooldownS;
  }
  private mark(id: number, p: CallProfile, now: number): void {
    this.lastCall.set(`${id}:${p.id}`, now);
  }

  private stateCalls(f: SoundscapeFrame, dt: number, out: VoiceRequest[]): void {
    const a = f.ambient;
    const tw = twilight(a.sunElevation);
    const morning = a.hour < 12;
    const rainDamp = a.rain > 4 ? 0.15 : 1 - clamp(a.rain / 4, 0, 1) * 0.5;
    const lull = this.lull ? 0.12 : 1;
    const now = f.realTime;
    const jackalGroupsDone = new Set<number>();
    for (const an of f.animals) {
      const d = distance(an, f.listener);
      let p: CallProfile | undefined;
      let rate = 0;
      let why = '';
      switch (an.species) {
        case 'crow':
        case 'myna': {
          if (an.behavior === 'roost') {
            p = profileFor(an.species, 'state:roost-twilight');
            rate = tw * (an.species === 'crow' ? 1 / 10 : 1 / 7);
            why = `roost, twilight ${tw.toFixed(2)}`;
          } else if (BIRD_ACTIVE.has(an.behavior) && a.daylight > 0.25) {
            p = profileFor(an.species, 'state:active-day');
            const chorus = morning ? 1 + 2.5 * tw : 1;
            rate = (an.species === 'crow' ? 1 / 45 : 1 / 35) * chorus;
            why = `${an.behavior}, daylight ${a.daylight.toFixed(2)}${chorus > 1.2 ? ', dawn chorus' : ''}`;
          }
          rate *= rainDamp * lull;
          break;
        }
        case 'boar':
          if (an.behavior === 'graze' || an.behavior === 'feed') {
            p = profileFor('boar', 'state:forage-near');
            rate = 1 / 10;
            why = an.behavior;
          }
          break;
        case 'jackal': {
          if (a.daylight < 0.3 && an.behavior !== 'rest' && !jackalGroupsDone.has(an.group)) {
            p = profileFor('jackal', 'state:active-night');
            // one decision per group per frame; dusk/early night peak
            jackalGroupsDone.add(an.group);
            rate = (1 / 300) * (1 + 1.5 * (morning ? 0 : tw)) * (a.rain > 4 ? 0.3 : 1);
            why = `group ${an.group} active at night/dusk`;
          }
          break;
        }
        default:
          break;
      }
      if (!p || rate <= 0 || d > p.rangeM || !this.ready(an.id, p, now)) continue;
      if (!this.rng.poisson(rate, dt)) continue;
      this.mark(an.id, p, now);
      out.push({ type: 'call', call: p.id, profile: p, animalId: an.id, species: an.species, pos: { x: an.x, y: an.y, z: an.z }, delayS: 0, intensity: 1, why: `${why} (state-derived; not a simulated vocal event)`, provenance: { source: 'animal-state', animalId: an.id, behavior: an.behavior, gait: an.gait, vocalEventSimulated: false } });
      if (an.species === 'jackal') this.chorusJoiners(f, an, p, out);
    }
  }

  /** Group mates join a jackal chorus (group chorusing). Only real, living, awake members of the same group. */
  private chorusJoiners(f: SoundscapeFrame, leader: AnimalObs, p: CallProfile, out: VoiceRequest[]): void {
    let delay = 0;
    for (const m of f.animals) {
      if (m.id === leader.id || m.species !== 'jackal' || m.group !== leader.group || m.behavior === 'rest') continue;
      if ((m.x - leader.x) ** 2 + (m.z - leader.z) ** 2 > 400 * 400) continue;
      if (distance(m, f.listener) > p.rangeM) continue;
      delay += this.rng.range(0.5, 2.5);
      this.mark(m.id, p, f.realTime);
      out.push({ type: 'call', call: p.id, profile: p, animalId: m.id, species: 'jackal', pos: { x: m.x, y: m.y, z: m.z }, delayS: delay, intensity: 0.85, why: `joins chorus of ${leader.id} (state-derived; not a simulated vocal event)`, provenance: { source: 'animal-state', animalId: m.id, behavior: m.behavior, gait: m.gait, vocalEventSimulated: false } });
    }
  }

  private movement(f: SoundscapeFrame, dt: number, out: VoiceRequest[]): void {
    const r = this.opts.movementRadius;
    for (const an of f.animals) {
      const d = distance(an, f.listener);
      const airborne = an.alt > 0.25;
      const was = this.wasAirborne.get(an.id);
      this.wasAirborne.set(an.id, airborne);
      if (d > Math.max(r, 40)) {
        this.stepPhase.delete(an.id);
        continue;
      }
      if (an.gait === 'fly' || airborne) {
        if (was === false && d <= 40) {
          out.push({ type: 'movement', movement: 'takeoff', animalId: an.id, species: an.species, pos: { x: an.x, y: an.y, z: an.z }, delayS: 0, intensity: clamp(an.speciesLength / 0.42, 0.4, 1), why: 'alt rose above 0.25 m', provenance: { source: 'animal-state', animalId: an.id, behavior: an.behavior, gait: an.gait, vocalEventSimulated: false } });
        } else if (d <= 15 && an.speed > 2 && this.rng.poisson(0.8, dt)) {
          out.push({ type: 'movement', movement: 'wingbeat', animalId: an.id, species: an.species, pos: { x: an.x, y: an.y, z: an.z }, delayS: 0, intensity: 0.5, why: `flying ${an.speed.toFixed(1)} m/s`, provenance: { source: 'animal-state', animalId: an.id, behavior: an.behavior, gait: an.gait, vocalEventSimulated: false } });
        }
        continue;
      }
      if (d > r || an.gait === 'still' || an.speed <= 0.05) continue;
      const gaitStride = an.gait === 'run' ? 1.5 : an.gait === 'trot' ? 1.0 : an.gait === 'swim' ? 0.9 : 0.6;
      const stride = Math.max(0.15, an.speciesLength * an.size * gaitStride);
      // footfalls per metre: two audible impacts per stride (fore and hind pairs blur together)
      let ph = (this.stepPhase.get(an.id) ?? this.rng.next()) + (an.speed * f.simRate * dt * 2) / stride;
      const wet = an.gait === 'swim' || an.waterDepth > 0.04;
      let k = 0;
      while (ph >= 1 && k < 4) {
        ph -= 1;
        const strength = clamp((an.speciesLength * an.size) / 1.5, 0.15, 1) * (an.gait === 'run' ? 1 : an.gait === 'trot' ? 0.75 : 0.5);
        out.push({
          type: 'movement', movement: wet ? 'splash' : 'footfall', animalId: an.id, species: an.species, pos: { x: an.x, y: an.y - 0.8 * an.size, z: an.z },
          delayS: k * 0.03 + this.rng.range(0, 0.02), intensity: strength, vegetation: an.forest, why: `${an.gait} ${an.speed.toFixed(1)} m/s${wet ? ' in water' : ''}`, provenance: { source: 'animal-state', animalId: an.id, behavior: an.behavior, gait: an.gait, vocalEventSimulated: false },
        });
        k++;
      }
      this.stepPhase.set(an.id, ph % 1);
    }
  }

  /** Bounded memory: forget animals no longer in the frame. */
  private prune(f: SoundscapeFrame): void {
    const ids = new Set(f.animals.map((a) => a.id));
    for (const k of this.stepPhase.keys()) if (!ids.has(k)) this.stepPhase.delete(k);
    for (const k of this.wasAirborne.keys()) if (!ids.has(k)) this.wasAirborne.delete(k);
    for (const [k, t] of this.lastCall) if (f.realTime - t > 900) this.lastCall.delete(k);
  }

  /** For tests: sizes of the internal maps (bounded memory). */
  memory(): { stepPhase: number; wasAirborne: number; lastCall: number } {
    return { stepPhase: this.stepPhase.size, wasAirborne: this.wasAirborne.size, lastCall: this.lastCall.size };
  }
}
