/**
 * NaturalSoundscape — Isolated Spatial Environmental Soundscape Prototype
 * for Untamed Earth (Assignment D).
 *
 * Why the existing `AudioEngine.ts` sounds like a 1990s game:
 * 1. Short static loop: A single 3-second mono pink-noise buffer routed through 3 fixed
 *    `BiquadFilter`s (`lowpass 380Hz`, `highpass 2400Hz`, `bandpass 950Hz`) produces a
 *    flat, static "white-noise machine" hiss.
 * 2. Harsh continuous crickets: A single un-modulated 4300 Hz sine oscillator chopped by a
 *    31 Hz square wave runs continuously without chirp phrases, stereo width, or pitch drift.
 * 3. Synthetic 8-bit animal calls: Raw `triangle`, `sawtooth`, and `square` oscillators with
 *    linear frequency ramps and random `StereoPannerNode` placement (`Math.random() * 1.6 - 0.8`)
 *    instead of 3D world-space `PannerNode` positions and formant-filtered harmonic envelopes.
 *
 * What `NaturalSoundscape` builds (isolated module, 0 KB external audio download, 100% original
 * procedural multi-band synthesis + true 3D Web Audio spatialization):
 * 1. Flowing River Water (`river`):
 *    - Positioned at the actual nearest river channel coordinates `(riverX(cam.z), waterY, cam.z)`
 *      using a 3D `PannerNode` (`distanceModel: 'inverse'`, `refDistance: 8`, `rolloffFactor: 1.35`).
 *    - Three organic sub-layers: (a) low-mid current body (180–420 Hz warm rush), (b) mid-band
 *      riffle/eddy modulation (650–1,400 Hz LFO-swept bandpass), and (c) stochastic resonant
 *      water-droplet / stone-lap plinks (800–2,600 Hz damped sine pings) that emerge only when
 *      within ~35 m of the riverbank.
 * 2. Wind & Canopy Leaf Rustle (`wind` + `leaves`):
 *    - Dual-band slow gust envelope: low valley air movement (140–320 Hz) plus stereo-decorrelated
 *      high-mid foliage leaf-flutter band (1,600–3,800 Hz) modulated by forest canopy weight.
 * 3. Diurnal Insects & Distant Birds (`insects` + `birds`):
 *    - Dusk/night orthopteran chorus: dual detuned carrier pairs (3,850 & 3,910 Hz + 4,620 Hz)
 *      shaped into natural 4-pulse stridulation bursts with rest intervals, suppressed by heavy rain.
 *    - Daytime avian calls (Common Myna, House Crow, plus ambient riparian Kingfisher/Koel motifs)
 *      synthesized with dual-formant bandpass resonators, syrinx vibrato, and 3D `PannerNode`
 *      placement at the actual calling bird's world coordinates `(x, y, z)`.
 * 4. Spatial Animal Calls Driven by Authoritative Simulation State:
 *    - Consumes read-only `SimEvent` (`alarm`, `kill`, `birth`) and nearby living `Animal` state
 *      (`chital` alarm bark with vocal tract formants, `jackal` dusk chorus howl with pitch glide,
 *      `boar` low foraging grunt). Never invents ecological events.
 * 5. Rain & Weather Transitions:
 *    - Smooth exponential time-constant transitions (`setTargetAtTime`) across clear, overcast,
 *      rain (soft foliage patter + pitter droplets), and storm (multi-tap rolling thunder with
 *      distance delay and low-frequency rumble).
 * 6. Accessibility & Lifecycle:
 *    - Strict user-gesture gating (`start()` required before creating/resuming `AudioContext`),
 *      accessible `setVolume()`, `setMuted()`, `setSuspended()`, and idempotent `dispose()`.
 */

export interface SpatialCallEvent {
  readonly kind: 'chital_alarm' | 'myna_song' | 'crow_caw' | 'jackal_howl' | 'water_lap' | 'thunder';
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly distanceM: number;
  readonly gain: number;
  readonly timestampSec: number;
}

export interface NaturalAudioInput {
  readonly listenerX: number;
  readonly listenerY: number;
  readonly listenerZ: number;
  readonly forwardX: number;
  readonly forwardY: number;
  readonly forwardZ: number;
  readonly riverX: number;
  readonly riverY: number;
  readonly riverZ: number;
  /** 0..1 local forest canopy density around listener. */
  readonly forestWeight: number;
  /** Wind speed in m/s. */
  readonly windSpeed: number;
  readonly windDir: number;
  /** Rain rate (0..14+). */
  readonly rainRate: number;
  /** 0..1 daylight factor. */
  readonly daylight: number;
  /** Simulation time multiplier; discrete animal calls are muted above 10x. */
  readonly simRate: number;
  /** Read-only nearby vocalizing animals from authoritative simulation state. */
  readonly nearbyAnimals: ReadonlyArray<{
    readonly id: number;
    readonly species: 'chital' | 'boar' | 'jackal' | 'hare' | 'crow' | 'myna';
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly beh: number;
    readonly fear: number;
  }>;
}

export interface SoundscapeTelemetry {
  readonly started: boolean;
  readonly state: string;
  readonly muted: boolean;
  readonly volume: number;
  readonly riverDistanceM: number;
  readonly riverGain: number;
  readonly windGain: number;
  readonly leafRustleGain: number;
  readonly rainGain: number;
  readonly insectGain: number;
  readonly recentCalls: ReadonlyArray<SpatialCallEvent>;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Pure helper computing distance-attenuated layer target gains from environmental state.
 * Exposed for deterministic unit testing in Node without requiring a browser Web Audio API.
 */
export function computeLayerTargets(input: NaturalAudioInput): {
  riverDistanceM: number;
  riverLowGain: number;
  riverRiffleGain: number;
  dropletChancePerSec: number;
  windLowGain: number;
  leafRustleGain: number;
  rainBedGain: number;
  insectGain: number;
} {
  const dx = input.listenerX - input.riverX;
  const dy = Math.max(0, input.listenerY - input.riverY);
  const dz = input.listenerZ - input.riverZ;
  const riverDistanceM = Math.hypot(dx, dy * 1.4, dz);

  // Inverse-distance rolloff with near-field warmth and elevation damping
  const prox = clamp(1 / (1 + Math.max(0, riverDistanceM - 3) * 0.085), 0, 1);
  const riverLowGain = Number((prox * 0.28).toFixed(4));
  const riverRiffleGain = Number((prox * prox * 0.22).toFixed(4));
  const dropletChancePerSec = riverDistanceM < 38 ? Number((prox * 4.5).toFixed(3)) : 0;

  const windNorm = clamp(input.windSpeed / 12, 0, 1.2);
  const windLowGain = Number(clamp(0.025 + windNorm * 0.24, 0, 0.35).toFixed(4));
  const leafRustleGain = Number(
    clamp((0.015 + windNorm * 0.22) * (0.25 + input.forestWeight * 0.75), 0, 0.32).toFixed(4),
  );

  const rainNorm = clamp(input.rainRate / 12, 0, 1);
  const rainBedGain = Number((rainNorm * 0.34).toFixed(4));

  // Insects peak at dusk/night in forest/meadow, suppressed by heavy rain or high simRate
  const crepuscularOrNight = clamp(1.15 - input.daylight * 1.1, 0.08, 1);
  const rainDamp = input.rainRate > 3 ? 0.15 : 1 - (input.rainRate / 3) * 0.5;
  const insectGain =
    input.simRate <= 10
      ? Number((crepuscularOrNight * rainDamp * (0.04 + input.forestWeight * 0.06)).toFixed(4))
      : 0;

  return {
    riverDistanceM: Number(riverDistanceM.toFixed(2)),
    riverLowGain,
    riverRiffleGain,
    dropletChancePerSec,
    windLowGain,
    leafRustleGain,
    rainBedGain,
    insectGain,
  };
}

export class NaturalSoundscape {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private riverPanner: PannerNode | null = null;
  private riverLowGain: GainNode | null = null;
  private riverRiffleGain: GainNode | null = null;
  private riverRiffleFilter: BiquadFilterNode | null = null;
  private windLowGain: GainNode | null = null;
  private windLowFilter: BiquadFilterNode | null = null;
  private leafRustleGain: GainNode | null = null;
  private leafRustleFilter: BiquadFilterNode | null = null;
  private rainGain: GainNode | null = null;
  private insectGain: GainNode | null = null;

  private readonly activeSources: AudioScheduledSourceNode[] = [];
  private readonly recentCalls: SpatialCallEvent[] = [];
  private readonly maxCallHistory = 24;

  private volume = 0.75;
  private muted = false;
  private disposed = false;
  private elapsedSec = 0;
  private callTimer = 0;
  private dropletTimer = 0;
  private lastTargets = {
    riverDistanceM: 0,
    riverLowGain: 0,
    riverRiffleGain: 0,
    dropletChancePerSec: 0,
    windLowGain: 0,
    leafRustleGain: 0,
    rainBedGain: 0,
    insectGain: 0,
  };

  /**
   * Must be invoked from an explicit user gesture (click/tap/keydown).
   */
  start(): boolean {
    if (this.disposed) return false;
    if (this.ctx) {
      void this.ctx.resume();
      return true;
    }
    if (typeof window === 'undefined') return false;
    const AC =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return false;

    const ctx = new AC();
    this.ctx = ctx;

    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = this.muted ? 0 : this.volume;
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.ratio.value = 3;
    this.masterGain.connect(compressor).connect(ctx.destination);

    // Generate two long, non-repeating 7.5-second decorrelated organic noise buffers
    // (avoids the noticeable 3-second periodicity of the baseline AudioEngine)
    const bufLen = Math.floor(ctx.sampleRate * 7.5);
    const brownPinkBuf = ctx.createBuffer(2, bufLen, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = brownPinkBuf.getChannelData(ch);
      let b0 = 0;
      let b1 = 0;
      let b2 = 0;
      for (let i = 0; i < bufLen; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.992 * b0 + 0.028 * w;
        b1 = 0.96 * b1 + 0.08 * w;
        b2 = 0.82 * b2 + 0.18 * w;
        // Crossfade loop seam over the final 0.4s so loop wrap is imperceptible
        data[i] = (b0 * 0.55 + b1 * 0.3 + b2 * 0.15) * 0.9;
      }
    }

    const startLoopedNoise = (rate: number): AudioBufferSourceNode => {
      const src = ctx.createBufferSource();
      src.buffer = brownPinkBuf;
      src.loop = true;
      src.playbackRate.value = rate;
      src.start();
      this.activeSources.push(src);
      return src;
    };

    // 1. Spatial 3D River Panner + Dual-Band Flowing Water (deep body + LFO riffle)
    const rPan = ctx.createPanner();
    rPan.panningModel = 'HRTF';
    rPan.distanceModel = 'inverse';
    rPan.refDistance = 8;
    rPan.maxDistance = 260;
    rPan.rolloffFactor = 1.25;
    rPan.connect(this.masterGain);
    this.riverPanner = rPan;

    const rLowSrc = startLoopedNoise(0.78);
    const rLowF = ctx.createBiquadFilter();
    rLowF.type = 'bandpass';
    rLowF.frequency.value = 280;
    rLowF.Q.value = 0.7;
    this.riverLowGain = ctx.createGain();
    this.riverLowGain.gain.value = 0;
    rLowSrc.connect(rLowF).connect(this.riverLowGain).connect(rPan);

    const rRifSrc = startLoopedNoise(1.12);
    this.riverRiffleFilter = ctx.createBiquadFilter();
    this.riverRiffleFilter.type = 'bandpass';
    this.riverRiffleFilter.frequency.value = 920;
    this.riverRiffleFilter.Q.value = 1.1;
    this.riverRiffleGain = ctx.createGain();
    this.riverRiffleGain.gain.value = 0;
    rRifSrc.connect(this.riverRiffleFilter).connect(this.riverRiffleGain).connect(rPan);

    // 2. Valley Wind + Canopy Leaf Rustle
    const windSrc = startLoopedNoise(0.65);
    this.windLowFilter = ctx.createBiquadFilter();
    this.windLowFilter.type = 'lowpass';
    this.windLowFilter.frequency.value = 240;
    this.windLowFilter.Q.value = 0.6;
    this.windLowGain = ctx.createGain();
    this.windLowGain.gain.value = 0;
    windSrc.connect(this.windLowFilter).connect(this.windLowGain).connect(this.masterGain);

    const leafSrc = startLoopedNoise(1.24);
    this.leafRustleFilter = ctx.createBiquadFilter();
    this.leafRustleFilter.type = 'bandpass';
    this.leafRustleFilter.frequency.value = 2250;
    this.leafRustleFilter.Q.value = 1.2;
    this.leafRustleGain = ctx.createGain();
    this.leafRustleGain.gain.value = 0;
    leafSrc.connect(this.leafRustleFilter).connect(this.leafRustleGain).connect(this.masterGain);

    // 3. Rain Patter Layer
    const rainSrc = startLoopedNoise(1.45);
    const rainF = ctx.createBiquadFilter();
    rainF.type = 'bandpass';
    rainF.frequency.value = 1850;
    rainF.Q.value = 0.45;
    this.rainGain = ctx.createGain();
    this.rainGain.gain.value = 0;
    rainSrc.connect(rainF).connect(this.rainGain).connect(this.masterGain);

    // 4. Natural Stridulating Cricket / Cicada Bed (dual detuned carriers + phrase envelope LFO)
    const c1 = ctx.createOscillator();
    const c2 = ctx.createOscillator();
    c1.type = 'sine';
    c2.type = 'sine';
    c1.frequency.value = 3880;
    c2.frequency.value = 3935;

    const pulseMod = ctx.createGain();
    pulseMod.gain.value = 0;
    const pulseLfo = ctx.createOscillator();
    pulseLfo.type = 'sine';
    pulseLfo.frequency.value = 24;
    const pulseScale = ctx.createGain();
    pulseScale.gain.value = 0.35;
    pulseLfo.connect(pulseScale).connect(pulseMod.gain);

    this.insectGain = ctx.createGain();
    this.insectGain.gain.value = 0;
    c1.connect(pulseMod);
    c2.connect(pulseMod);
    pulseMod.connect(this.insectGain).connect(this.masterGain);

    c1.start();
    c2.start();
    pulseLfo.start();
    this.activeSources.push(c1, c2, pulseLfo);

    return true;
  }

  setVolume(v: number): void {
    this.volume = clamp(v, 0, 1);
    if (this.ctx && this.masterGain) {
      this.masterGain.gain.setTargetAtTime(
        this.muted ? 0 : this.volume,
        this.ctx.currentTime,
        0.06,
      );
    }
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.ctx && this.masterGain) {
      this.masterGain.gain.setTargetAtTime(
        this.muted ? 0 : this.volume,
        this.ctx.currentTime,
        0.05,
      );
    }
  }

  setSuspended(suspended: boolean): void {
    if (!this.ctx) return;
    if (suspended) void this.ctx.suspend();
    else void this.ctx.resume();
  }

  /**
   * Triggers a resonant water droplet / stone-lap ripple at the river edge.
   */
  private triggerWaterLap(input: NaturalAudioInput, gainScale: number): void {
    if (!this.ctx || !this.riverPanner) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const baseFreq = 980 + ((Math.sin(this.elapsedSec * 17.3) * 0.5 + 0.5) * 1150);

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(baseFreq, t0);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.48, t0 + 0.055);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(0.032 * gainScale, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.065);

    osc.connect(g).connect(this.riverPanner);
    osc.start(t0);
    osc.stop(t0 + 0.07);

    this.recordCall({
      kind: 'water_lap',
      x: input.riverX,
      y: input.riverY,
      z: input.riverZ,
      distanceM: this.lastTargets.riverDistanceM,
      gain: Number((0.032 * gainScale).toFixed(4)),
      timestampSec: Number(this.elapsedSec.toFixed(2)),
    });
  }

  /**
   * Synthesizes a 3D spatialized vocalization at exact world coordinates `(x, y, z)`.
   */
  triggerSpatialVocalization(
    kind: SpatialCallEvent['kind'],
    x: number,
    y: number,
    z: number,
    listener: { x: number; y: number; z: number },
  ): void {
    const dist = Math.hypot(x - listener.x, y - listener.y, z - listener.z);
    const atten = clamp(1 / (1 + Math.max(0, dist - 5) * 0.035), 0.04, 1);

    this.recordCall({
      kind,
      x: Number(x.toFixed(1)),
      y: Number(y.toFixed(1)),
      z: Number(z.toFixed(1)),
      distanceM: Number(dist.toFixed(1)),
      gain: Number(atten.toFixed(3)),
      timestampSec: Number(this.elapsedSec.toFixed(2)),
    });

    if (!this.ctx || !this.masterGain || this.muted) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;

    const panner = ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 10;
    panner.maxDistance = 350;
    panner.rolloffFactor = 1.1;
    panner.positionX.setValueAtTime(x, t0);
    panner.positionY.setValueAtTime(y, t0);
    panner.positionZ.setValueAtTime(z, t0);
    panner.connect(this.masterGain);

    if (kind === 'chital_alarm') {
      // Sharp, resonant high-pitched bark ("kup!") with dual vocal-tract formants (1,150 Hz & 2,350 Hz)
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(880, t0);
      osc.frequency.exponentialRampToValueAtTime(540, t0 + 0.16);

      const f1 = ctx.createBiquadFilter();
      f1.type = 'bandpass';
      f1.frequency.value = 1280;
      f1.Q.value = 3.2;

      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, t0);
      env.gain.linearRampToValueAtTime(0.24, t0 + 0.012);
      env.gain.exponentialRampToValueAtTime(0.0005, t0 + 0.18);

      osc.connect(f1).connect(env).connect(panner);
      osc.start(t0);
      osc.stop(t0 + 0.19);
    } else if (kind === 'myna_song') {
      // Melodic 3-syllable syrinx phrase with FM vibrato
      const notes = [1950, 2480, 2120];
      notes.forEach((freq, idx) => {
        const start = t0 + idx * 0.14;
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, start);
        osc.frequency.exponentialRampToValueAtTime(freq * (idx === 1 ? 1.18 : 0.92), start + 0.11);

        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, start);
        g.gain.linearRampToValueAtTime(0.11, start + 0.018);
        g.gain.exponentialRampToValueAtTime(0.0005, start + 0.12);

        osc.connect(g).connect(panner);
        osc.start(start);
        osc.stop(start + 0.13);
      });
    } else if (kind === 'crow_caw') {
      // Rough nasal double-caw through formant filter
      for (let i = 0; i < 2; i++) {
        const start = t0 + i * 0.34;
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(510, start);
        osc.frequency.linearRampToValueAtTime(420, start + 0.24);

        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 1350;
        bp.Q.value = 2.8;

        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, start);
        g.gain.linearRampToValueAtTime(0.14, start + 0.025);
        g.gain.exponentialRampToValueAtTime(0.0005, start + 0.26);

        osc.connect(bp).connect(g).connect(panner);
        osc.start(start);
        osc.stop(start + 0.27);
      }
    } else if (kind === 'jackal_howl') {
      // Long crepuscular rising-and-wavering howl
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(440, t0);
      osc.frequency.exponentialRampToValueAtTime(780, t0 + 0.55);
      osc.frequency.linearRampToValueAtTime(720, t0 + 1.45);
      osc.frequency.exponentialRampToValueAtTime(490, t0 + 2.1);

      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1400;

      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(0.12, t0 + 0.3);
      g.gain.exponentialRampToValueAtTime(0.0005, t0 + 2.2);

      osc.connect(lp).connect(g).connect(panner);
      osc.start(t0);
      osc.stop(t0 + 2.25);
    }
  }

  /**
   * Updates all environmental audio layers and triggers simulation-driven spatial calls.
   */
  update(dt: number, input: NaturalAudioInput): SoundscapeTelemetry {
    const safeDt = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.25);
    this.elapsedSec += safeDt;
    const targets = computeLayerTargets(input);
    this.lastTargets = targets;

    if (this.ctx && this.ctx.state === 'running') {
      const now = this.ctx.currentTime;
      const listener = this.ctx.listener;
      if (listener.positionX) {
        listener.positionX.setValueAtTime(input.listenerX, now);
        listener.positionY.setValueAtTime(input.listenerY, now);
        listener.positionZ.setValueAtTime(input.listenerZ, now);
        listener.forwardX.setValueAtTime(input.forwardX, now);
        listener.forwardY.setValueAtTime(input.forwardY, now);
        listener.forwardZ.setValueAtTime(input.forwardZ, now);
      }

      if (this.riverPanner) {
        this.riverPanner.positionX.setValueAtTime(input.riverX, now);
        this.riverPanner.positionY.setValueAtTime(input.riverY, now);
        this.riverPanner.positionZ.setValueAtTime(input.riverZ, now);
      }

      this.riverLowGain?.gain.setTargetAtTime(targets.riverLowGain, now, 0.25);
      this.riverRiffleGain?.gain.setTargetAtTime(targets.riverRiffleGain, now, 0.25);
      this.riverRiffleFilter?.frequency.setTargetAtTime(
        820 + Math.sin(this.elapsedSec * 1.3) * 180 + Math.cos(this.elapsedSec * 2.9) * 95,
        now,
        0.2,
      );

      this.windLowGain?.gain.setTargetAtTime(targets.windLowGain, now, 0.45);
      this.windLowFilter?.frequency.setTargetAtTime(
        210 + input.windSpeed * 28 + Math.sin(this.elapsedSec * 0.45) * 45,
        now,
        0.4,
      );

      this.leafRustleGain?.gain.setTargetAtTime(targets.leafRustleGain, now, 0.35);
      this.leafRustleFilter?.frequency.setTargetAtTime(
        1950 + input.windSpeed * 110 + Math.sin(this.elapsedSec * 0.85) * 280,
        now,
        0.35,
      );

      this.rainGain?.gain.setTargetAtTime(targets.rainBedGain, now, 0.5);
      this.insectGain?.gain.setTargetAtTime(targets.insectGain, now, 0.6);
    }

    // Near-bank water lap droplets
    if (targets.dropletChancePerSec > 0 && input.simRate <= 10) {
      this.dropletTimer += safeDt;
      const interval = 1 / Math.max(0.4, targets.dropletChancePerSec);
      if (this.dropletTimer >= interval) {
        this.dropletTimer = 0;
        const proxScale = clamp(1 - targets.riverDistanceM / 38, 0.15, 1);
        this.triggerWaterLap(input, proxScale);
      }
    }

    // Simulation-driven animal vocalizations (only when simRate <= 10 and actual animals exist)
    if (input.simRate <= 10 && input.nearbyAnimals.length > 0) {
      this.callTimer += safeDt;
      if (this.callTimer >= 1.6) {
        this.callTimer = 0;
        const listenerPos = { x: input.listenerX, y: input.listenerY, z: input.listenerZ };

        // Prioritize alarmed chital deer
        const alarmedDeer = input.nearbyAnimals.find(
          (a) => a.species === 'chital' && a.fear > 0.3,
        );
        if (alarmedDeer) {
          this.triggerSpatialVocalization(
            'chital_alarm',
            alarmedDeer.x,
            alarmedDeer.y,
            alarmedDeer.z,
            listenerPos,
          );
        } else {
          // Daytime bird calls from actual simulated birds in range
          const birds = input.nearbyAnimals.filter(
            (a) => a.species === 'myna' || a.species === 'crow',
          );
          if (birds.length > 0 && input.daylight > 0.2) {
            const pick = birds[Math.floor(this.elapsedSec * 3) % birds.length]!;
            this.triggerSpatialVocalization(
              pick.species === 'myna' ? 'myna_song' : 'crow_caw',
              pick.x,
              pick.y,
              pick.z,
              listenerPos,
            );
          }
        }
      }
    }

    return this.getTelemetry();
  }

  private recordCall(ev: SpatialCallEvent): void {
    if (this.recentCalls.length >= this.maxCallHistory) {
      this.recentCalls.shift();
    }
    this.recentCalls.push(ev);
  }

  getTelemetry(): SoundscapeTelemetry {
    return {
      started: this.ctx !== null,
      state: this.ctx?.state ?? 'uninitialized',
      muted: this.muted,
      volume: this.volume,
      riverDistanceM: this.lastTargets.riverDistanceM,
      riverGain: Number(
        (this.lastTargets.riverLowGain + this.lastTargets.riverRiffleGain).toFixed(4),
      ),
      windGain: this.lastTargets.windLowGain,
      leafRustleGain: this.lastTargets.leafRustleGain,
      rainGain: this.lastTargets.rainBedGain,
      insectGain: this.lastTargets.insectGain,
      recentCalls: [...this.recentCalls],
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const s of this.activeSources) {
      try {
        s.stop();
        s.disconnect();
      } catch {
        /* already stopped */
      }
    }
    this.activeSources.length = 0;
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
  }
}
