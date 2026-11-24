/**
 * Procedural voices for the ecological soundscape. Original synthesis only: no samples, no third-party audio.
 *
 * HONESTY NOTE. Every frequency, duration and repetition pattern below is a DESIGN GUESS made to be broadly
 * consistent with qualitative descriptions (repertoire.ts). None has been compared with reference recordings and
 * none may be quoted as species data. Status of every call: 'procedural-unverified' until a listening review.
 *
 * Two-phase design: `plan(rng, intensity)` decides all random parameters and the total duration (so the voice
 * budget can admit or reject a voice before any node exists); `build(g, out, t0)` creates the nodes. All nodes are
 * registered in the VoiceGraph so the owner can disconnect every one of them when the voice ends.
 * Works on any BaseAudioContext (live AudioContext and OfflineAudioContext for recordings).
 */
import type { PresentationRng } from './rng';
import type { CallId } from './repertoire';
import type { MovementKind } from './planner';

export class VoiceGraph {
  readonly nodes: AudioNode[] = [];
  readonly sources: AudioScheduledSourceNode[] = [];
  constructor(readonly ctx: BaseAudioContext) {}
  node<T extends AudioNode>(n: T): T {
    this.nodes.push(n);
    return n;
  }
  source<T extends AudioScheduledSourceNode>(n: T): T {
    this.nodes.push(n);
    this.sources.push(n);
    return n;
  }
  osc(type: OscillatorType, f: number): OscillatorNode {
    const o = this.source(this.ctx.createOscillator());
    o.type = type;
    o.frequency.value = f;
    return o;
  }
  filter(type: BiquadFilterType, f: number, q = 0.707): BiquadFilterNode {
    const b = this.node(this.ctx.createBiquadFilter());
    b.type = type;
    b.frequency.value = f;
    b.Q.value = q;
    return b;
  }
  gain(v = 0): GainNode {
    const g = this.node(this.ctx.createGain());
    g.gain.value = v;
    return g;
  }
  noise(buf: AudioBuffer, t0: number, dur: number, offset: number, rate = 1): AudioBufferSourceNode {
    const s = this.source(this.ctx.createBufferSource());
    s.buffer = buf;
    s.playbackRate.value = rate;
    s.start(t0, offset % Math.max(0.01, buf.duration - dur - 0.05), dur + 0.02);
    return s;
  }
}

/** Shared noise for one-shot voices (one per soundscape, generated from the presentation seed). */
export interface NoiseBank {
  white: AudioBuffer;
  pink: AudioBuffer;
}

export interface SynthPlan {
  /** Seconds from t0 until the voice is silent and all sources have stopped. */
  readonly dur: number;
  build(g: VoiceGraph, out: AudioNode, t0: number, noise: NoiseBank): void;
}

/** Percussive envelope on a gain param: fast attack, exponential decay. */
function env(p: AudioParam, t0: number, peak: number, attack: number, dur: number): void {
  p.setValueAtTime(0.00001, t0);
  p.linearRampToValueAtTime(Math.max(0.00002, peak), t0 + attack);
  p.exponentialRampToValueAtTime(0.00001, t0 + dur);
}

// ---------------------------------------------------------------------------------------------- vocalisations

function chitalBark(rng: PresentationRng, k: number): SynthPlan {
  // short, sharp, high bark; 1-3 repeats. Guess: f0 ~0.75-0.95 kHz falling ~35 %, two resonances.
  const n = rng.int(1, 3);
  const barks = Array.from({ length: n }, () => ({ t: 0, f: rng.range(750, 950), d: rng.range(0.12, 0.2), gap: rng.range(0.7, 1.4) }));
  let t = 0;
  for (const b of barks) ((b.t = t), (t += b.gap));
  const dur = barks[n - 1]!.t + barks[n - 1]!.d + 0.05;
  return {
    dur,
    build(g, out, t0, noise) {
      for (const b of barks) {
        const s = t0 + b.t;
        const o = g.osc('sawtooth', b.f);
        o.frequency.setValueAtTime(b.f, s);
        o.frequency.exponentialRampToValueAtTime(b.f * 0.65, s + b.d);
        const f1 = g.filter('bandpass', 1250, 4);
        const f2 = g.filter('bandpass', 2600, 5);
        const e = g.gain();
        env(e.gain, s, 0.9 * k, 0.008, b.d);
        o.connect(f1).connect(e);
        o.connect(f2).connect(e);
        e.connect(out);
        o.start(s);
        o.stop(s + b.d + 0.02);
        // breathy onset
        const nz = g.noise(noise.white, s, 0.04, rng.range(0, 1.5));
        const nf = g.filter('bandpass', 2200, 1.5);
        const ne = g.gain();
        env(ne.gain, s, 0.25 * k, 0.004, 0.04);
        nz.connect(nf).connect(ne).connect(out);
      }
    },
  };
}

function boarSnort(rng: PresentationRng, k: number): SynthPlan {
  const d = rng.range(0.2, 0.32);
  const f0 = rng.range(95, 130);
  const off = rng.range(0, 1.5);
  return {
    dur: d + 0.05,
    build(g, out, t0, noise) {
      const nz = g.noise(noise.pink, t0, d, off);
      const lp = g.filter('lowpass', 900, 0.8);
      const e = g.gain();
      env(e.gain, t0, 1.1 * k, 0.006, d);
      nz.connect(lp).connect(e).connect(out);
      const o = g.osc('sawtooth', f0);
      const ol = g.filter('lowpass', 500);
      const oe = g.gain();
      env(oe.gain, t0, 0.35 * k, 0.01, d * 0.8);
      o.connect(ol).connect(oe).connect(out);
      o.start(t0);
      o.stop(t0 + d);
    },
  };
}

function boarGrunt(rng: PresentationRng, k: number): SynthPlan {
  const n = rng.int(2, 4);
  const gr = Array.from({ length: n }, (_, i) => ({ t: i * rng.range(0.3, 0.5), f: rng.range(80, 120), d: rng.range(0.12, 0.2), am: rng.range(22, 34) }));
  const last = gr[n - 1]!;
  return {
    dur: last.t + last.d + 0.05,
    build(g, out, t0) {
      for (const x of gr) {
        const s = t0 + x.t;
        const o = g.osc('sawtooth', x.f);
        const lp = g.filter('lowpass', 480, 1.2);
        const am = g.gain(0.5);
        const lfo = g.osc('sine', x.am);
        const lg = g.gain(0.5);
        lfo.connect(lg).connect(am.gain);
        const e = g.gain();
        env(e.gain, s, 0.8 * k, 0.02, x.d);
        o.connect(lp).connect(am).connect(e).connect(out);
        o.start(s);
        lfo.start(s);
        o.stop(s + x.d + 0.02);
        lfo.stop(s + x.d + 0.02);
      }
    },
  };
}

type CawStyle = 'alarm' | 'contact' | 'roost';
function crowCaws(rng: PresentationRng, k: number, style: CawStyle): SynthPlan {
  const n = style === 'alarm' ? rng.int(3, 6) : style === 'roost' ? rng.int(4, 9) : rng.int(1, 3);
  const caws: { t: number; f: number; d: number }[] = [];
  let t = 0;
  for (let i = 0; i < n; i++) {
    const d = style === 'alarm' ? rng.range(0.18, 0.26) : rng.range(0.25, 0.4);
    caws.push({ t, f: rng.range(style === 'roost' ? 480 : 560, style === 'alarm' ? 760 : 700), d });
    t += d + (style === 'alarm' ? rng.range(0.06, 0.14) : style === 'roost' ? rng.range(-0.1, 0.5) : rng.range(0.2, 0.45));
    t = Math.max(t, caws[i]!.t + 0.05);
  }
  const last = caws[n - 1]!;
  return {
    dur: last.t + last.d + 0.05,
    build(g, out, t0) {
      for (const c of caws) {
        const s = t0 + c.t;
        const o1 = g.osc('sawtooth', c.f);
        const o2 = g.osc('sawtooth', c.f * 1.031); // beating gives the rough, harsh texture
        for (const o of [o1, o2]) {
          o.frequency.setValueAtTime(o.frequency.value, s);
          o.frequency.linearRampToValueAtTime(o.frequency.value * 0.86, s + c.d);
        }
        const f1 = g.filter('bandpass', 1150, 3);
        const f2 = g.filter('bandpass', 1950, 4);
        const e = g.gain();
        env(e.gain, s, 0.7 * k, 0.025, c.d);
        o1.connect(f1).connect(e);
        o2.connect(f2).connect(e);
        e.connect(out);
        o1.start(s);
        o2.start(s);
        o1.stop(s + c.d + 0.02);
        o2.stop(s + c.d + 0.02);
      }
    },
  };
}

type Syllable = { kind: 'whistle' | 'gurgle' | 'chuck'; t: number; d: number; f: number; f2: number };
function mynaSyllables(rng: PresentationRng, n: number, spacing: [number, number]): Syllable[] {
  const out: Syllable[] = [];
  let t = 0;
  for (let i = 0; i < n; i++) {
    const r = rng.next();
    const kind = r < 0.45 ? 'whistle' : r < 0.8 ? 'gurgle' : 'chuck';
    const d = kind === 'chuck' ? rng.range(0.02, 0.04) : rng.range(0.07, 0.18);
    const f = kind === 'chuck' ? rng.range(2500, 3600) : rng.range(1400, 3200);
    out.push({ kind, t, d, f, f2: f * rng.range(0.7, 1.4) });
    t += d + rng.range(spacing[0], spacing[1]);
  }
  return out;
}

function mynaVoice(rng: PresentationRng, k: number, style: 'contact' | 'roost' | 'alarm'): SynthPlan {
  if (style === 'alarm') {
    const n = rng.int(4, 8);
    const bursts = Array.from({ length: n }, (_, i) => ({ t: i * rng.range(0.08, 0.11), d: rng.range(0.05, 0.075), f: rng.range(2300, 3000), off: rng.range(0, 1.6) }));
    const last = bursts[n - 1]!;
    return {
      dur: last.t + last.d + 0.05,
      build(g, out, t0, noise) {
        for (const b of bursts) {
          const s = t0 + b.t;
          const nz = g.noise(noise.white, s, b.d, b.off);
          const bp = g.filter('bandpass', b.f, 2.2);
          const e = g.gain();
          env(e.gain, s, 1.4 * k, 0.005, b.d);
          nz.connect(bp).connect(e).connect(out);
        }
      },
    };
  }
  const syl = style === 'roost' ? mynaSyllables(rng, rng.int(10, 22), [0.02, 0.12]) : mynaSyllables(rng, rng.int(2, 5), [0.06, 0.22]);
  const last = syl[syl.length - 1]!;
  return {
    dur: last.t + last.d + 0.06,
    build(g, out, t0, noise) {
      for (const s of syl) {
        const st = t0 + s.t;
        const e = g.gain();
        if (s.kind === 'chuck') {
          const nz = g.noise(noise.white, st, s.d, s.f / 3000);
          const bp = g.filter('bandpass', s.f, 3);
          env(e.gain, st, 0.9 * k, 0.003, s.d);
          nz.connect(bp).connect(e).connect(out);
          continue;
        }
        const o = g.osc('sine', s.f);
        o.frequency.setValueAtTime(s.f, st);
        o.frequency.exponentialRampToValueAtTime(s.f2, st + s.d);
        if (s.kind === 'gurgle') {
          const fm = g.osc('sine', 35 + (s.f % 25));
          const fg = g.gain(s.f * 0.12);
          fm.connect(fg).connect(o.frequency);
          fm.start(st);
          fm.stop(st + s.d + 0.02);
        }
        env(e.gain, st, 0.32 * k, 0.012, s.d);
        o.connect(e).connect(out);
        o.start(st);
        o.stop(st + s.d + 0.02);
      }
    },
  };
}

function jackalHowl(rng: PresentationRng, k: number): SynthPlan {
  // rising wail, wavering hold, falling end with broken yips. Guess: start 0.5-0.65 kHz, rise x1.5-1.7.
  const f = rng.range(500, 650);
  const rise = rng.range(1.5, 1.7);
  const hold = rng.range(0.8, 1.6);
  const yips = rng.int(2, 6);
  const yipTimes = Array.from({ length: yips }, () => rng.range(0.07, 0.16));
  const main = 0.6 + hold + 0.6;
  let yt = main + 0.1;
  const ys = yipTimes.map((gap) => {
    const s = yt;
    yt += gap + 0.08;
    return s;
  });
  const vib = rng.range(4.5, 6.5);
  return {
    dur: yt + 0.1,
    build(g, out, t0) {
      const o = g.osc('triangle', f);
      const p = o.frequency;
      p.setValueAtTime(f, t0);
      p.exponentialRampToValueAtTime(f * rise, t0 + 0.6);
      p.linearRampToValueAtTime(f * rise * 0.95, t0 + 0.6 + hold);
      p.exponentialRampToValueAtTime(f * 1.05, t0 + main);
      const lfo = g.osc('sine', vib);
      const lg = g.gain(f * 0.02);
      lfo.connect(lg).connect(p);
      const h = g.osc('sine', f * 2);
      const hg = g.gain(0.25);
      h.frequency.setValueAtTime(f * 2, t0);
      h.frequency.exponentialRampToValueAtTime(f * rise * 2, t0 + 0.6);
      h.frequency.linearRampToValueAtTime(f * rise * 1.9, t0 + 0.6 + hold);
      h.frequency.exponentialRampToValueAtTime(f * 2.1, t0 + main);
      const lp = g.filter('lowpass', 2200);
      const e = g.gain();
      e.gain.setValueAtTime(0.00001, t0);
      e.gain.linearRampToValueAtTime(0.55 * k, t0 + 0.35);
      e.gain.setValueAtTime(0.5 * k, t0 + 0.6 + hold);
      e.gain.exponentialRampToValueAtTime(0.00001, t0 + main);
      o.connect(lp);
      h.connect(hg).connect(lp);
      lp.connect(e).connect(out);
      for (const n of [o, lfo, h]) {
        n.start(t0);
        n.stop(t0 + main + 0.02);
      }
      for (const s of ys) {
        const y = g.osc('triangle', f * rng.range(1.7, 2.1));
        const ye = g.gain();
        env(ye.gain, t0 + s, 0.4 * k, 0.01, 0.08);
        y.connect(ye).connect(out);
        y.start(t0 + s);
        y.stop(t0 + s + 0.1);
      }
    },
  };
}

function hareScream(rng: PresentationRng, k: number): SynthPlan {
  const n = rng.int(1, 2);
  const parts = Array.from({ length: n }, (_, i) => ({ t: i * rng.range(0.7, 1), d: rng.range(0.4, 0.7), f: rng.range(1100, 1500) }));
  const last = parts[n - 1]!;
  return {
    dur: last.t + last.d + 0.05,
    build(g, out, t0) {
      for (const x of parts) {
        const s = t0 + x.t;
        const o = g.osc('sawtooth', x.f);
        const v = g.osc('sine', rng.range(24, 34));
        const vg = g.gain(x.f * 0.04);
        v.connect(vg).connect(o.frequency);
        const bp = g.filter('bandpass', 2000, 1.8);
        const e = g.gain();
        e.gain.setValueAtTime(0.00001, s);
        e.gain.linearRampToValueAtTime(0.7 * k, s + 0.03);
        e.gain.exponentialRampToValueAtTime(0.00001, s + x.d);
        o.connect(bp).connect(e).connect(out);
        for (const m of [o, v]) {
          m.start(s);
          m.stop(s + x.d + 0.02);
        }
      }
    },
  };
}

function scuffle(rng: PresentationRng, k: number): SynthPlan {
  const total = rng.range(0.8, 1.6);
  const bursts: { t: number; d: number; f: number; off: number }[] = [];
  for (let t = 0; t < total; t += rng.range(0.03, 0.14)) bursts.push({ t, d: rng.range(0.02, 0.08), f: rng.range(500, 1600), off: rng.range(0, 1.5) });
  return {
    dur: total + 0.12,
    build(g, out, t0, noise) {
      for (const b of bursts) {
        const s = t0 + b.t;
        const nz = g.noise(noise.pink, s, b.d, b.off);
        const bp = g.filter('bandpass', b.f, 1.2);
        const e = g.gain();
        env(e.gain, s, 1.2 * k * (1 - (b.t / total) * 0.6), 0.004, b.d);
        nz.connect(bp).connect(e).connect(out);
      }
    },
  };
}

export function planCall(id: CallId, rng: PresentationRng, intensity: number): SynthPlan {
  switch (id) {
    case 'chital-alarm-bark':
      return chitalBark(rng, intensity);
    case 'boar-alarm-snort':
      return boarSnort(rng, intensity);
    case 'boar-forage-grunt':
      return boarGrunt(rng, intensity);
    case 'crow-alarm-caws':
      return crowCaws(rng, intensity, 'alarm');
    case 'crow-contact-caw':
      return crowCaws(rng, intensity, 'contact');
    case 'crow-roost-chorus':
      return crowCaws(rng, intensity, 'roost');
    case 'myna-alarm-rasp':
      return mynaVoice(rng, intensity, 'alarm');
    case 'myna-contact':
      return mynaVoice(rng, intensity, 'contact');
    case 'myna-roost-chatter':
      return mynaVoice(rng, intensity, 'roost');
    case 'jackal-chorus-howl':
      return jackalHowl(rng, intensity);
    case 'hare-distress-scream':
      return hareScream(rng, intensity);
    case 'kill-scuffle':
      return scuffle(rng, intensity);
  }
}

// ---------------------------------------------------------------------------------------------- movement & weather

export function planMovement(kind: MovementKind, rng: PresentationRng, intensity: number, vegetation = 0, hooved = false, wingHz = 6): SynthPlan {
  switch (kind) {
    case 'footfall': {
      const d = rng.range(0.03, 0.06);
      const veg = rng.range(0.08, 0.15);
      const off = rng.range(0, 1.6);
      const lpF = 180 + 500 * intensity + rng.range(-40, 40);
      return {
        dur: Math.max(d, veg * vegetation > 0 ? veg : 0) + 0.04,
        build(g, out, t0, noise) {
          const nz = g.noise(noise.pink, t0, d, off);
          const lp = g.filter('lowpass', lpF, 0.9);
          const e = g.gain();
          env(e.gain, t0, 0.9 * intensity, 0.003, d);
          nz.connect(lp).connect(e).connect(out);
          if (hooved) {
            const c = g.noise(noise.white, t0, 0.012, off + 0.3);
            const bp = g.filter('bandpass', 1500, 2.5);
            const ce = g.gain();
            env(ce.gain, t0, 0.35 * intensity, 0.001, 0.012);
            c.connect(bp).connect(ce).connect(out);
          }
          if (vegetation > 0.05) {
            const r = g.noise(noise.white, t0, veg, off + 0.7);
            const hp = g.filter('highpass', 2600, 0.7);
            const re = g.gain();
            env(re.gain, t0, 0.25 * intensity * vegetation, 0.01, veg);
            r.connect(hp).connect(re).connect(out);
          }
        },
      };
    }
    case 'splash': {
      const d = rng.range(0.15, 0.3);
      const off = rng.range(0, 1.6);
      const f = rng.range(800, 1800);
      return {
        dur: d + 0.05,
        build(g, out, t0, noise) {
          const nz = g.noise(noise.white, t0, d, off);
          const bp = g.filter('bandpass', f, 0.9);
          const e = g.gain();
          env(e.gain, t0, 0.9 * intensity, 0.005, d);
          nz.connect(bp).connect(e).connect(out);
        },
      };
    }
    case 'takeoff':
    case 'wingbeat': {
      const d = kind === 'takeoff' ? rng.range(0.45, 0.8) : rng.range(0.12, 0.2);
      const off = rng.range(0, 1.6);
      return {
        dur: d + 0.05,
        build(g, out, t0, noise) {
          const nz = g.noise(noise.pink, t0, d, off);
          const bp = g.filter('bandpass', rng.range(450, 900), 0.8);
          const am = g.gain(0.5);
          const lfo = g.osc('sine', wingHz * rng.range(0.9, 1.1));
          const lg = g.gain(0.5);
          lfo.connect(lg).connect(am.gain);
          const e = g.gain();
          env(e.gain, t0, (kind === 'takeoff' ? 1.0 : 0.5) * intensity, 0.02, d);
          nz.connect(bp).connect(am).connect(e).connect(out);
          lfo.start(t0);
          lfo.stop(t0 + d + 0.02);
        },
      };
    }
  }
}

export function planThunder(rng: PresentationRng, intensity: number, distM: number): SynthPlan {
  const len = rng.range(3, 6);
  // Lightning is not rendered in the audio lab, so there is no flash-to-bang delay; distance only darkens the rumble.
  const cutoff = Math.max(120, 900 - distM * 0.14);
  const off = rng.range(0, 1);
  return {
    dur: len + 0.1,
    build(g, out, t0, noise) {
      const s = t0;
      const nz = g.noise(noise.pink, s, len, off, 0.5);
      const lp = g.filter('lowpass', cutoff, 0.6);
      const e = g.gain();
      e.gain.setValueAtTime(0.00001, s);
      e.gain.linearRampToValueAtTime(1.6 * intensity, s + 0.25);
      e.gain.setTargetAtTime(0.9 * intensity, s + 0.4, 0.4);
      e.gain.exponentialRampToValueAtTime(0.00001, s + len);
      nz.connect(lp).connect(e).connect(out);
    },
  };
}

// ---------------------------------------------------------------------------------------------- bed buffers

/** Stereo decorrelated noise. colour: 'white' | 'pink' (Kellet) | 'brown'. */
export function makeNoise(ctx: BaseAudioContext, seconds: number, colour: 'white' | 'pink' | 'brown', rng: PresentationRng): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, br = 0;
    for (let i = 0; i < len; i++) {
      const w = rng.next() * 2 - 1;
      if (colour === 'white') d[i] = w * 0.5;
      else if (colour === 'pink') {
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      } else {
        br = (br + 0.02 * w) / 1.02;
        d[i] = br * 3.5;
      }
    }
    // equal-power crossfade of the loop seam over 0.25 s so the wrap is not a click
    const x = Math.floor(ctx.sampleRate * 0.25);
    for (let i = 0; i < x; i++) {
      const a = i / x;
      d[i] = d[i]! * Math.sin((a * Math.PI) / 2) + d[len - x + i]! * Math.cos((a * Math.PI) / 2);
    }
  }
  return buf;
}

/**
 * A chorus layer of stridulating insects / calling frogs rendered into a buffer. Each individual has its own
 * carrier, pulse pattern, rate jitter, level and stereo position, so the texture is not a single tone.
 * Two layers with different, non-commensurate lengths are played together: the combined pattern only repeats
 * after lcm(len1, len2) (several minutes).
 */
export type ChorusKind = 'cricket' | 'cicada' | 'frog';
export function makeChorus(ctx: BaseAudioContext, kind: ChorusKind, seconds: number, individuals: number, rate: number, rng: PresentationRng): AudioBuffer {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * seconds);
  const buf = ctx.createBuffer(2, len, sr);
  const L = buf.getChannelData(0);
  const R = buf.getChannelData(1);
  const TAU = Math.PI * 2;
  for (let n = 0; n < individuals; n++) {
    const pan = rng.range(-0.9, 0.9);
    const gl = Math.cos(((pan + 1) * Math.PI) / 4);
    const gr = Math.sin(((pan + 1) * Math.PI) / 4);
    const level = rng.range(0.3, 1) * (kind === 'frog' ? 0.6 : 0.35);
    if (kind === 'cricket') {
      const fc = rng.range(3800, 5200);
      const period = 1 / (rate * rng.range(0.88, 1.12));
      const pulses = rng.int(2, 4);
      let t = rng.range(0, period);
      while (t < seconds) {
        for (let p = 0; p < pulses; p++) {
          const s0 = Math.floor((t + p * 0.026) * sr);
          const pl = Math.floor(0.016 * sr);
          for (let i = 0; i < pl && s0 + i < len; i++) {
            const e = Math.sin((Math.PI * i) / pl);
            const v = Math.sin((TAU * fc * (s0 + i)) / sr) * e * level;
            L[s0 + i]! += v * gl;
            R[s0 + i]! += v * gr;
          }
        }
        t += period * rng.range(0.95, 1.05);
      }
    } else if (kind === 'cicada') {
      const fc = rng.range(4200, 6800);
      const am = rng.range(110, 210);
      let t = rng.range(0, 6);
      while (t < seconds) {
        const dur = rng.range(3, 9);
        const s0 = Math.floor(t * sr);
        const sl = Math.floor(dur * sr);
        for (let i = 0; i < sl && s0 + i < len; i++) {
          const ph = i / sl;
          const swell = Math.min(1, ph * 4) * Math.min(1, (1 - ph) * 3);
          const pulse = 0.5 + 0.5 * Math.sin((TAU * am * (s0 + i)) / sr);
          const v = (Math.sin((TAU * fc * (s0 + i)) / sr) * 0.6 + (rng.next() * 2 - 1) * 0.4) * pulse * swell * level * 0.6;
          L[s0 + i]! += v * gl;
          R[s0 + i]! += v * gr;
        }
        t += dur + rng.range(2, 10);
      }
    } else {
      const fc = rng.range(320, 900);
      const pr = rng.range(18, 40);
      let t = rng.range(0, 2);
      while (t < seconds) {
        const np = rng.int(4, 14);
        for (let p = 0; p < np; p++) {
          const s0 = Math.floor((t + p / pr) * sr);
          const pl = Math.floor(0.6 * sr / pr);
          for (let i = 0; i < pl && s0 + i < len; i++) {
            const e = Math.sin((Math.PI * i) / pl) ** 2;
            const ph = (TAU * fc * (s0 + i)) / sr;
            const v = (Math.sin(ph) + 0.4 * Math.sin(2 * ph) + 0.2 * Math.sin(3 * ph)) * e * level * 0.5;
            L[s0 + i]! += v * gl;
            R[s0 + i]! += v * gr;
          }
        }
        t += np / pr + rng.range(0.5, 3.5) / Math.max(0.3, rate);
      }
    }
  }
  return buf;
}
