export interface AudioScene {
  wind: number;
  rain: number;
  /** 0..1 proximity to flowing water. */
  water: number;
  day: number;
  crows: number;
  mynas: number;
  jackals: number;
  /** Simulation rate; creature calls are suppressed in fast-forward. */
  rate: number;
}

/** Fully synthesised soundscape (no samples): filtered-noise beds plus procedurally voiced animal calls. */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private wind!: GainNode;
  private windF!: BiquadFilterNode;
  private rain!: GainNode;
  private river!: GainNode;
  private cricket!: GainNode;
  private volume = 0.7;
  muted = false;
  private t = 0;
  error: string | null = null;

  /** Must be called from a user gesture. */
  start(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    try {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = (this.ctx = new AC());
      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;
      const comp = ctx.createDynamicsCompressor();
      this.master.connect(comp).connect(ctx.destination);
      const noise = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
      const d = noise.getChannelData(0);
      let b0 = 0;
      for (let i = 0; i < d.length; i++) {
        // slightly pink: one-pole filtered white noise mixed with white
        const w = Math.random() * 2 - 1;
        b0 = 0.97 * b0 + 0.03 * w;
        d[i] = b0 * 6 + w * 0.25;
      }
      const bed = (type: BiquadFilterType, freq: number, q: number): [GainNode, BiquadFilterNode] => {
        const src = ctx.createBufferSource();
        src.buffer = noise;
        src.loop = true;
        src.playbackRate.value = 0.8 + Math.random() * 0.4;
        const f = ctx.createBiquadFilter();
        f.type = type;
        f.frequency.value = freq;
        f.Q.value = q;
        const g = ctx.createGain();
        g.gain.value = 0;
        src.connect(f).connect(g).connect(this.master);
        src.start();
        return [g, f];
      };
      [this.wind, this.windF] = bed('lowpass', 380, 0.4);
      [this.rain] = bed('highpass', 2400, 0.3);
      [this.river] = bed('bandpass', 950, 0.5);
      // crickets: a high tone chopped by a pulse train
      const osc = ctx.createOscillator();
      osc.frequency.value = 4300;
      const chop = ctx.createGain();
      chop.gain.value = 0;
      const lfo = ctx.createOscillator();
      lfo.type = 'square';
      lfo.frequency.value = 31;
      const lfoG = ctx.createGain();
      lfoG.gain.value = 0.5;
      lfo.connect(lfoG).connect(chop.gain);
      this.cricket = ctx.createGain();
      this.cricket.gain.value = 0;
      osc.connect(chop).connect(this.cricket).connect(this.master);
      osc.start();
      lfo.start();
    } catch (e) {
      this.ctx = null;
      this.error = `Audio unavailable: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  setVolume(v: number): void {
    this.volume = v;
    this.applyGain();
  }
  setMuted(m: boolean): void {
    this.muted = m;
    this.applyGain();
  }
  private applyGain(): void {
    if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime, 0.05);
  }

  private tone(type: OscillatorType, freqs: [number, number][], dur: number, gain: number, when = 0, filter?: [number, number]): void {
    const ctx = this.ctx!;
    const t0 = ctx.currentTime + when;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freqs[0]![1], t0);
    for (const [t, f] of freqs) o.frequency.linearRampToValueAtTime(f, t0 + t * dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + Math.min(0.03, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    let node: AudioNode = o;
    if (filter) {
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = filter[0];
      f.Q.value = filter[1];
      node = o.connect(f);
    }
    // random stereo placement stands in for full spatialisation
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 1.6 - 0.8;
    node.connect(g).connect(pan).connect(this.master);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  private myna(vol: number): void {
    const n = 3 + Math.floor(Math.random() * 4);
    let t = 0;
    for (let i = 0; i < n; i++) {
      const f = 1800 + Math.random() * 1800;
      const up = Math.random() < 0.5;
      this.tone('triangle', [[0, f], [0.5, f * (up ? 1.35 : 0.75)], [1, f * (up ? 1.1 : 0.9)]], 0.09 + Math.random() * 0.08, vol * 0.08, t);
      t += 0.13 + Math.random() * 0.12;
    }
  }
  private crow(vol: number): void {
    const n = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) this.tone('sawtooth', [[0, 520], [0.3, 470], [1, 360]], 0.3, vol * 0.11, i * 0.42, [1300, 2.5]);
  }
  private howl(vol: number): void {
    const f = 480 + Math.random() * 120;
    this.tone('sine', [[0, f], [0.25, f * 1.7], [0.7, f * 1.6], [1, f * 1.05]], 2.2, vol * 0.07);
    if (Math.random() < 0.6) this.tone('sine', [[0, f * 1.2], [0.3, f * 1.9], [1, f * 1.3]], 1.8, vol * 0.05, 0.9);
  }
  /** Chital alarm bark. */
  alarm(vol: number): void {
    if (!this.ctx) return;
    this.tone('square', [[0, 950], [1, 620]], 0.16, vol * 0.07, 0, [1500, 3]);
  }
  thunder(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const len = 3.5;
    const buf = ctx.createBuffer(1, ctx.sampleRate * len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b = 0;
    for (let i = 0; i < d.length; i++) {
      b = 0.985 * b + 0.015 * (Math.random() * 2 - 1);
      const t = i / d.length;
      d[i] = b * 14 * Math.exp(-t * 3.2) * (0.6 + 0.4 * Math.sin(t * 40));
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = 0.9;
    src.connect(g).connect(this.master);
    src.start(ctx.currentTime + 0.4 + Math.random() * 1.5);
  }

  update(dt: number, s: AudioScene): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    this.wind.gain.setTargetAtTime(Math.min(0.5, 0.035 + s.wind * 0.03), now, 0.5);
    this.windF.frequency.setTargetAtTime(260 + s.wind * 60 + Math.sin(now * 0.3) * 80, now, 0.5);
    this.rain.gain.setTargetAtTime(Math.min(0.4, s.rain * 0.04), now, 0.6);
    this.river.gain.setTargetAtTime(s.water * 0.2, now, 0.4);
    const calls = s.rate <= 10;
    this.cricket.gain.setTargetAtTime(calls ? (1 - s.day) * 0.012 * (s.rain > 0.5 ? 0.2 : 1) : 0, now, 1);
    if (!calls) return;
    this.t += dt;
    if (this.t < 0.5) return;
    this.t = 0;
    const quiet = s.rain > 4 ? 0.2 : 1;
    if (Math.random() < Math.min(0.5, s.mynas * 0.06) * s.day * quiet) this.myna(0.6 + Math.random() * 0.4);
    if (Math.random() < Math.min(0.3, s.crows * 0.035) * s.day * quiet) this.crow(0.5 + Math.random() * 0.5);
    const dusk = s.day > 0.02 && s.day < 0.5 ? 1 : s.day <= 0.02 ? 0.35 : 0;
    if (Math.random() < Math.min(0.03, s.jackals * 0.012) * dusk) this.howl(0.6 + Math.random() * 0.4);
  }
}
