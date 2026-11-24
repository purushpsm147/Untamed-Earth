/**
 * EcoSoundscape: the Web Audio side of the ecological soundscape vertical slice.
 *
 * Architecture (docs/AUDIO_INTEGRATION.md, docs/handover/AUDIO_HANDOVER.md):
 *  - It NEVER creates an AudioContext. It is attached to a host: the game's single AudioContext + master bus
 *    (AudioEngine.host) when live, or an OfflineAudioContext when rendering a review recording.
 *  - Real events arrive through `ingest()` (wired to onAudioEvents by EcoAudioObserver) and are routed by the
 *    CallRouter. Ambient beds, state-derived calls and movement come from the SoundscapePlanner.
 *  - Every voice is a small graph: synth -> occlusion low-pass -> gain -> PannerNode -> soundscape bus. All of its
 *    nodes are disconnected when its last source ends (or immediately on dispose).
 *  - The voice budget is decided on the audio clock (VoicePool), so it is correct for frames scheduled ahead.
 *  - It holds no reference to the Simulation and cannot write to it.
 */
import type { EcoAudioEvent, SpeciesId } from '@untamed/ecology';
import { azimuth, clamp, distance, listenerForward, occlusion, type ListenerPose, type Vec3, type WorldSampler } from './acoustics';
import { CallRouter, type DropReason } from './callRouter';
import { SoundscapePlanner, type BedTargets, type PlannerOptions, type SoundscapeFrame, type VoiceRequest } from './planner';
import { profileById, type CallId, type CallProfile } from './repertoire';
import { PresentationRng } from './rng';
import { VoiceGraph, makeChorus, makeNoise, planCall, planMovement, planThunder, type ChorusKind, type NoiseBank, type SynthPlan } from './synth';
import { VoicePool, type VoiceCategory } from './voicePool';

export interface AudioHost {
  readonly ctx: BaseAudioContext;
  /** Where the soundscape bus connects: the game's master gain (volume, mute, compressor) or a recorder. */
  readonly destination: AudioNode;
}

export interface SoundscapeOptions {
  seed: number;
  sampler: WorldSampler;
  /** 'HRTF' for headphones (High/Ultra, review recordings); 'equalpower' is cheaper. */
  panningModel: PanningModelType;
  planner: Partial<PlannerOptions>;
  /** Event-driven calls on/off (A/B listening). */
  eventCalls: boolean;
  /** Bus level. */
  level: number;
}

export interface Cue {
  /** Audio-clock time the sound starts (s). */
  t: number;
  kind: 'event-call' | 'state-call' | 'movement' | 'thunder' | 'drop' | 'reject';
  label: string;
  species?: SpeciesId;
  animalId?: number;
  distanceM?: number;
  /** Degrees, + = listener's right. */
  azimuthDeg?: number;
  terrainOcclusion?: number;
  foliageM?: number;
  gainDb?: number;
  why: string;
}

interface LiveVoice {
  readonly id: number;
  readonly graph: VoiceGraph;
  readonly gain: GainNode;
  readonly category: VoiceCategory;
  endAt: number;
  ended: number;
}

const WING_HZ: Partial<Record<SpeciesId, number>> = { crow: 5.5, myna: 11 };
const HOOVED: ReadonlySet<SpeciesId> = new Set<SpeciesId>(['chital', 'boar']);
const CHORUS_LEN: Record<ChorusKind, [number, number]> = { cricket: [12.7, 17.9], cicada: [15.1, 23.3], frog: [14.3, 19.7] };

class Bed {
  readonly gain: GainNode;
  readonly filter: BiquadFilterNode;
  constructor(ctx: BaseAudioContext, buf: AudioBuffer, type: BiquadFilterType, f: number, q: number, out: AudioNode, rng: PresentationRng, nodes: AudioNode[], sources: AudioScheduledSourceNode[], rate = 1) {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.playbackRate.value = rate * rng.range(0.97, 1.03);
    this.filter = ctx.createBiquadFilter();
    this.filter.type = type;
    this.filter.frequency.value = f;
    this.filter.Q.value = q;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    src.connect(this.filter).connect(this.gain).connect(out);
    src.start(ctx.currentTime, rng.range(0, buf.duration));
    nodes.push(src, this.filter, this.gain);
    sources.push(src);
  }
}

export class EcoSoundscape {
  readonly ctx: BaseAudioContext;
  readonly out: GainNode;
  readonly router = new CallRouter();
  readonly pool = new VoicePool();
  readonly planner: SoundscapePlanner;
  private readonly rng: PresentationRng;
  private readonly opts: SoundscapeOptions;
  private readonly noise: NoiseBank;
  private readonly bedNodes: AudioNode[] = [];
  private readonly bedSources: AudioScheduledSourceNode[] = [];
  private readonly voices = new Map<number, LiveVoice>();
  private readonly queue: EcoAudioEvent[] = [];
  private beds!: {
    wind: Bed; leaves: Bed; grass: Bed; rain: Bed; canopy: Bed; distant: Bed;
    river: Bed; riverLp: BiquadFilterNode; riverPanner: PannerNode;
    chorus: Record<ChorusKind, { a: Bed; b: Bed; rate: number; regen: number }>;
  };
  private readonly requests: VoiceRequest[] = [];
  private riverOccT = -1;
  private disposed = false;
  private listener: ListenerPose = { x: 0, y: 0, z: 0, yaw: 0 };
  private lastBeds: BedTargets | null = null;
  /** Nodes currently connected (beds + live voices): the disposal gate checks this returns to the bed baseline. */
  liveNodes = 0;
  readonly bedNodeCount: number;
  readonly cues: Cue[] = [];
  /** Optional sink for every cue (recordings keep all; the live lab keeps the last N in `cues`). */
  onCue: ((c: Cue) => void) | null = null;
  readonly counters = { eventCalls: 0, stateCalls: 0, movement: 0, thunder: 0, rejected: 0, frames: 0, planMs: 0 };

  constructor(readonly host: AudioHost, opts: Partial<SoundscapeOptions> & { sampler: WorldSampler }) {
    this.opts = { seed: 1, panningModel: 'HRTF', planner: {}, eventCalls: true, level: 1, ...opts };
    this.ctx = host.ctx;
    this.rng = new PresentationRng(this.opts.seed * 7919 + 13);
    this.planner = new SoundscapePlanner(this.opts.seed, this.opts.planner);
    this.out = this.ctx.createGain();
    this.out.gain.value = this.opts.level;
    this.out.connect(host.destination);
    this.noise = { white: makeNoise(this.ctx, 4, 'white', this.rng), pink: makeNoise(this.ctx, 8, 'pink', this.rng) };
    this.buildBeds();
    this.bedNodeCount = this.bedNodes.length + 1;
    this.liveNodes = this.bedNodeCount;
  }

  private buildBeds(): void {
    const ctx = this.ctx;
    const r = this.rng;
    const N = this.bedNodes;
    const S = this.bedSources;
    const brown = makeNoise(ctx, 19.9, 'brown', r);
    const pink = makeNoise(ctx, 17.3, 'pink', r);
    const pink2 = makeNoise(ctx, 13.7, 'pink', r);
    const white = makeNoise(ctx, 11.3, 'white', r);
    const wind = new Bed(ctx, brown, 'lowpass', 220, 0.5, this.out, r, N, S, 1);
    const leaves = new Bed(ctx, pink, 'bandpass', 2300, 0.9, this.out, r, N, S, 1);
    const grass = new Bed(ctx, pink2, 'highpass', 3600, 0.7, this.out, r, N, S, 1);
    const rain = new Bed(ctx, white, 'bandpass', 2600, 0.5, this.out, r, N, S, 1);
    const canopy = new Bed(ctx, pink2, 'bandpass', 950, 0.7, this.out, r, N, S, 0.9);
    const distant = new Bed(ctx, brown, 'lowpass', 110, 0.5, this.out, r, N, S, 0.7);
    // river: its own panner at the nearest channel point, plus an occlusion low-pass updated twice a second
    const riverLp = ctx.createBiquadFilter();
    riverLp.type = 'lowpass';
    riverLp.frequency.value = 6000;
    const riverPanner = this.makePanner(15, 1.0, 900);
    riverLp.connect(riverPanner).connect(this.out);
    N.push(riverLp, riverPanner);
    const river = new Bed(ctx, pink, 'lowpass', 1400, 0.4, riverLp, r, N, S, 0.85);
    const chorus = {} as Record<ChorusKind, { a: Bed; b: Bed; rate: number; regen: number }>;
    for (const kind of ['cricket', 'cicada', 'frog'] as ChorusKind[]) {
      const rate = kind === 'cricket' ? 2.5 : 1;
      const [la, lb] = CHORUS_LEN[kind];
      const a = new Bed(ctx, makeChorus(ctx, kind, la, kind === 'cicada' ? 3 : 6, rate, r), 'highpass', 150, 0.5, this.out, r, N, S);
      const b = new Bed(ctx, makeChorus(ctx, kind, lb, kind === 'cicada' ? 2 : 5, rate, r), 'highpass', 150, 0.5, this.out, r, N, S);
      chorus[kind] = { a, b, rate, regen: 0 };
    }
    this.beds = { wind, leaves, grass, rain, canopy, distant, river, riverLp, riverPanner, chorus };
  }

  private makePanner(ref: number, rolloff: number, max: number): PannerNode {
    const p = this.ctx.createPanner();
    p.panningModel = this.opts.panningModel;
    p.distanceModel = 'inverse';
    p.refDistance = ref;
    p.rolloffFactor = rolloff;
    p.maxDistance = max;
    return p;
  }

  /** Queue a real ecological event (from onAudioEvents). Routed on the next frame. */
  ingest(e: EcoAudioEvent): void {
    if (this.disposed) return;
    if (this.queue.length < 256) this.queue.push(e);
  }

  /**
   * Advance the soundscape by one observation frame and schedule its audio at audio-clock time `when`
   * (ctx.currentTime when live; an increasing timeline when rendering offline).
   */
  frame(f: SoundscapeFrame, when: number): void {
    if (this.disposed) return;
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    this.counters.frames++;
    this.listener = f.listener;
    this.setListener(f.listener, when);
    const { beds, requests } = this.planner.plan(f, this.requests);
    this.lastBeds = beds;
    this.applyBeds(beds, f, when);
    // real events first: they have priority and define the scene
    for (const e of this.queue) {
      const sourceY = this.opts.sampler.height(e.x, e.z) + 1;
      for (const d of this.router.route(e, { listener: f.listener, realTime: f.realTime, simRate: f.simRate, sourceY })) {
        if (d.action === 'drop') {
          if (d.reason !== 'silent-kind') this.cue({ t: when, kind: 'drop', label: `${e.kind}:${e.species}`, species: e.species, animalId: e.animalId, why: dropWhy(d.reason, d.trigger) });
          continue;
        }
        if (!this.opts.eventCalls) continue;
        this.startCall(d.profile, d.voiceAnimalId, { x: e.x, y: sourceY, z: e.z }, when, 1, `${e.kind} event${e.kind === 'kill' ? ` (prey ${e.preySpecies} #${e.preyId})` : ''}`, 'event-call');
      }
    }
    this.queue.length = 0;
    for (const r of requests) {
      const at = when + r.delayS;
      if (r.type === 'call' && r.profile) this.startCall(r.profile, r.animalId, r.pos, at, r.intensity, r.why, 'state-call');
      else if (r.type === 'movement' && r.movement) {
        const plan = planMovement(r.movement, this.rng, r.intensity, r.vegetation ?? 0, r.species ? HOOVED.has(r.species) : false, (r.species && WING_HZ[r.species]) || 8);
        this.startVoice(plan, 'movement', r.pos, at, 0.12 * r.intensity, 4, 1.4, 80, { kind: 'movement', label: `${r.movement}:${r.species}`, species: r.species, animalId: r.animalId, why: r.why });
      } else if (r.type === 'thunder') {
        const plan = planThunder(this.rng, r.intensity, distance(r.pos, f.listener));
        this.startVoice(plan, 'oneshot-env', r.pos, at, 0.6, 2000, 0.2, 8000, { kind: 'thunder', label: 'thunder', why: r.why }, false);
      }
    }
    if (typeof performance !== 'undefined') this.counters.planMs += performance.now() - t0;
  }

  private startCall(p: CallProfile, animalId: number, pos: Vec3, at: number, intensity: number, why: string, kind: 'event-call' | 'state-call'): void {
    const plan = planCall(p.id, this.rng, intensity);
    this.startVoice(plan, kind === 'event-call' ? 'call' : 'ambient-call', pos, at, p.level, p.refM, 1.15, p.rangeM, { kind, label: p.id, species: p.species, animalId, why }, true, p.priority);
  }

  private startVoice(plan: SynthPlan, category: VoiceCategory, pos: Vec3, at: number, level: number, ref: number, rolloff: number, maxD: number, cue: Omit<Cue, 't'>, occlude = true, priority = 0.5): void {
    const d = distance(pos, this.listener);
    const proximity = ref / (ref + rolloff * (Math.max(d, ref) - ref));
    const adm = this.pool.request(category, priority * proximity, at + plan.dur, at);
    if (!adm.admit) {
      this.counters.rejected++;
      this.cue({ t: at, ...cue, kind: 'reject', why: `voice budget full (${category}); ${cue.why}` });
      return;
    }
    if (adm.steal !== null) this.fadeOut(adm.steal, at);
    const occ = occlude ? occlusion(pos, this.listener, this.opts.sampler) : { gain: 1, cutoffHz: 18000, terrain: 0, foliageM: 0 };
    const g = new VoiceGraph(this.ctx);
    const lp = g.filter('lowpass', occ.cutoffHz, 0.5);
    const vg = g.gain(level * occ.gain);
    const pan = g.node(this.makePanner(ref, rolloff, Math.max(maxD, ref + 1)));
    setPos(pan, pos, at);
    lp.connect(vg).connect(pan).connect(this.out);
    plan.build(g, lp, at, this.noise);
    const v: LiveVoice = { id: adm.id, graph: g, gain: vg, category, endAt: at + plan.dur, ended: 0 };
    this.voices.set(v.id, v);
    this.liveNodes += g.nodes.length;
    for (const s of g.sources) s.onended = () => this.sourceEnded(v);
    if (cue.kind === 'event-call') this.counters.eventCalls++;
    else if (cue.kind === 'state-call') this.counters.stateCalls++;
    else if (cue.kind === 'movement') this.counters.movement++;
    else if (cue.kind === 'thunder') this.counters.thunder++;
    if (cue.kind !== 'movement' || d < 12) {
      this.cue({
        t: at, ...cue, distanceM: round(d, 1), azimuthDeg: Math.round((azimuth(this.listener, pos) * 180) / Math.PI),
        terrainOcclusion: round(occ.terrain, 2), foliageM: round(occ.foliageM, 0), gainDb: round(20 * Math.log10(Math.max(1e-6, level * occ.gain * proximity)), 1),
      });
    }
  }

  private sourceEnded(v: LiveVoice): void {
    v.ended++;
    if (v.ended >= v.graph.sources.length) this.releaseVoice(v);
  }

  private releaseVoice(v: LiveVoice): void {
    if (!this.voices.has(v.id)) return;
    this.voices.delete(v.id);
    this.pool.release(v.id);
    for (const s of v.graph.sources) s.onended = null;
    for (const n of v.graph.nodes) n.disconnect();
    this.liveNodes -= v.graph.nodes.length;
  }

  /** Voice stealing: 50 ms fade, then stop its sources (their 'ended' releases the nodes). */
  private fadeOut(id: number, at: number): void {
    const v = this.voices.get(id);
    if (!v) return;
    v.gain.gain.cancelScheduledValues(at);
    v.gain.gain.setTargetAtTime(0, at, 0.015);
    for (const s of v.graph.sources) {
      try {
        s.stop(at + 0.06);
      } catch {
        // a source that was never started cannot be stopped; it is still disconnected by its siblings' 'ended'
      }
    }
  }

  private setListener(l: ListenerPose, when: number): void {
    const L = this.ctx.listener;
    const f = listenerForward(l.yaw);
    if (L.positionX) {
      const tc = 0.03;
      L.positionX.setTargetAtTime(l.x, when, tc);
      L.positionY.setTargetAtTime(l.y, when, tc);
      L.positionZ.setTargetAtTime(l.z, when, tc);
      L.forwardX.setTargetAtTime(f.x, when, tc);
      L.forwardY.setTargetAtTime(f.y, when, tc);
      L.forwardZ.setTargetAtTime(f.z, when, tc);
      L.upX.setValueAtTime(0, when);
      L.upY.setValueAtTime(1, when);
      L.upZ.setValueAtTime(0, when);
    } else {
      // older WebKit
      (L as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(l.x, l.y, l.z);
      (L as unknown as { setOrientation(a: number, b: number, c: number, d: number, e: number, g: number): void }).setOrientation(f.x, f.y, f.z, 0, 1, 0);
    }
  }

  private applyBeds(b: BedTargets, f: SoundscapeFrame, when: number): void {
    const B = this.beds;
    const tc = 0.6;
    B.wind.gain.gain.setTargetAtTime(b.wind, when, tc);
    B.wind.filter.frequency.setTargetAtTime(b.windCutoff, when, 0.4);
    B.leaves.gain.gain.setTargetAtTime(b.leaves, when, 0.35);
    B.leaves.filter.frequency.setTargetAtTime(b.leavesCutoff, when, 0.35);
    B.grass.gain.gain.setTargetAtTime(b.grass, when, 0.35);
    B.rain.gain.gain.setTargetAtTime(b.rain, when, 0.8);
    B.canopy.gain.gain.setTargetAtTime(b.rainCanopy, when, 0.8);
    B.distant.gain.gain.setTargetAtTime(b.distant, when, 1);
    B.river.gain.gain.setTargetAtTime(b.river, when, 0.5);
    B.river.filter.frequency.setTargetAtTime(900 + 900 * b.riverBrightness, when, 0.5);
    setPos(B.riverPanner, b.riverPos, when, 0.2);
    if (f.realTime - this.riverOccT >= 0.5 || this.riverOccT < 0) {
      this.riverOccT = f.realTime;
      const occ = occlusion({ ...b.riverPos, y: b.riverPos.y + 0.3 }, f.listener, this.opts.sampler);
      B.riverLp.frequency.setTargetAtTime(occ.cutoffHz, when, 0.3);
    }
    const ch = B.chorus;
    ch.cricket.a.gain.gain.setTargetAtTime(b.insects, when, 1.5);
    ch.cricket.b.gain.gain.setTargetAtTime(b.insects, when, 1.5);
    ch.cicada.a.gain.gain.setTargetAtTime(b.cicadas, when, 2);
    ch.cicada.b.gain.gain.setTargetAtTime(b.cicadas, when, 2);
    ch.frog.a.gain.gain.setTargetAtTime(b.frogs, when, 2);
    ch.frog.b.gain.gain.setTargetAtTime(b.frogs, when, 2);
    // the cricket chirp rate follows temperature: regenerate a layer when it drifts (alternating layers, so the
    // switch is masked by the other one)
    const c = ch.cricket;
    if (Math.abs(b.insectChirpRate - c.rate) > 0.35 && f.realTime - c.regen > 20 && b.insects > 0.002) {
      c.rate = b.insectChirpRate;
      c.regen = f.realTime;
      this.regenChorus('cricket', c.rate, when);
    }
  }

  private regenChorus(kind: ChorusKind, rate: number, when: number): void {
    const layer = this.beds.chorus[kind];
    // replace the source feeding layer.a: build a fresh looping source into its filter, crossfaded by the bed gain
    const buf = makeChorus(this.ctx, kind, CHORUS_LEN[kind][0], 6, rate, this.rng);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(layer.a.filter);
    src.start(when, this.rng.range(0, buf.duration));
    // stop the previous source(s) feeding that filter after the new one is running
    const idx = this.bedSources.findIndex((s) => (s as unknown as { __feeds?: BiquadFilterNode }).__feeds === layer.a.filter);
    const old = idx >= 0 ? this.bedSources[idx]! : this.firstSourceOf(layer.a.filter);
    (src as unknown as { __feeds: BiquadFilterNode }).__feeds = layer.a.filter;
    if (old) {
      old.stop(when + 0.05);
      old.onended = () => old.disconnect();
      const oi = this.bedSources.indexOf(old);
      if (oi >= 0) this.bedSources.splice(oi, 1, src);
      const ni = this.bedNodes.indexOf(old);
      if (ni >= 0) this.bedNodes.splice(ni, 1, src);
    }
  }

  private firstSourceOf(filter: BiquadFilterNode): AudioScheduledSourceNode | undefined {
    // beds push (src, filter, gain) in order: the source sits just before its filter
    const i = this.bedNodes.indexOf(filter);
    const n = i > 0 ? this.bedNodes[i - 1] : undefined;
    return n && 'stop' in n ? (n as AudioScheduledSourceNode) : undefined;
  }

  telemetry(): {
    liveVoices: number; liveNodes: number; bedNodes: number; poolPeak: number; route: Record<'play' | DropReason, number>;
    counters: EcoSoundscape['counters']; beds: BedTargets | null; lull: boolean;
  } {
    this.pool.expire(this.ctx.currentTime);
    return {
      liveVoices: this.voices.size, liveNodes: this.liveNodes, bedNodes: this.bedNodeCount, poolPeak: this.pool.stats.peak, route: { ...this.router.stats },
      counters: { ...this.counters }, beds: this.lastBeds, lull: this.planner.inLull,
    };
  }

  private cue(c: Cue): void {
    this.onCue?.(c);
    this.cues.push(c);
    if (this.cues.length > 200) this.cues.shift();
  }

  /** Idempotent. Stops and disconnects every node this soundscape created; never closes the host context. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const v of [...this.voices.values()]) {
      for (const s of v.graph.sources) {
        try {
          s.stop();
        } catch {
          // never started (scheduled in the future on a context that is being torn down)
        }
      }
      this.releaseVoice(v);
    }
    for (const s of this.bedSources) {
      s.onended = null;
      try {
        s.stop();
      } catch {
        // already stopped
      }
    }
    for (const n of this.bedNodes) n.disconnect();
    this.out.disconnect();
    this.liveNodes = 0;
    this.queue.length = 0;
    this.pool.clear();
  }

  get isDisposed(): boolean {
    return this.disposed;
  }
}

function setPos(p: PannerNode, v: Vec3, when: number, tc = 0): void {
  if (p.positionX) {
    if (tc > 0) {
      p.positionX.setTargetAtTime(v.x, when, tc);
      p.positionY.setTargetAtTime(v.y, when, tc);
      p.positionZ.setTargetAtTime(v.z, when, tc);
    } else {
      p.positionX.setValueAtTime(v.x, when);
      p.positionY.setValueAtTime(v.y, when);
      p.positionZ.setValueAtTime(v.z, when);
    }
  } else (p as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(v.x, v.y, v.z);
}

function round(v: number, dp: number): number {
  const k = 10 ** dp;
  return Math.round(v * k) / k;
}

function dropWhy(r: DropReason, trigger?: string): string {
  switch (r) {
    case 'unsupported':
      return `silent by evidence policy (${trigger}); see repertoire.ts SILENT`;
    case 'out-of-range':
      return 'beyond the call range';
    case 'cooldown':
      return 'same animal called within its cooldown';
    case 'merged':
      return 'merged into a simultaneous alarm nearby';
    case 'rate-gate':
      return 'time acceleration gate';
    default:
      return r;
  }
}

export { clamp, profileById };
export type { CallId };
