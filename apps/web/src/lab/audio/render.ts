/**
 * Offline recording of a listening scenario: the REAL simulation drives the REAL soundscape graph, rendered with an
 * OfflineAudioContext (the lab's only use of a second context type; the live lab uses the game's AudioContext).
 *
 * The frame loop mirrors the game at 1x: 20 audio frames per real second, the simulation stepped in 0.1 s ticks
 * via an accumulator. All randomness is seeded (simulation seed + presentation seed), so the same build renders the
 * same samples (checked by the browser gate). Output: stereo 48 kHz float buffer + a cue sheet of every voice and
 * every routing decision with its cause, distance and direction.
 */
import { EcoSoundscape, type Cue } from '../../audio/eco/EcoSoundscape';
import { EcoAudioObserver, FrameBuilder, worldSampler } from '../../audio/eco/observation';
import { prepareScenario, type AudioScenario } from '../../audio/eco/scenarios';

export const SAMPLE_RATE = 48000;
const FPS = 20;
const TICK = 0.1;
/** Scheduling window for just-in-time offline rendering, seconds (a multiple of the 128-frame quantum at 48 kHz). */
const WINDOW = 0.48;

export interface Recording {
  scenario: string;
  seconds: number;
  sampleRate: number;
  buffer: AudioBuffer;
  cues: Cue[];
  meta: {
    seed: number;
    title: string;
    note: string;
    conditions: ReturnType<typeof prepareScenario>['conditions'];
    listener: { x: number; y: number; z: number; yaw: number };
    expected: ReturnType<typeof prepareScenario>['expected'];
    simTickStart: number;
    simTickEnd: number;
    simHashEnd: number;
    counters: EcoSoundscape['counters'];
    route: Record<string, number>;
    poolPeak: number;
    releasedDuringRender: number;
    prepareMs: number;
    scheduleMs: number;
    renderMs: number;
    /** Real-time factor of the offline render (audio seconds per wall second). */
    renderSpeed: number;
    sampleHash: string;
  };
}

export interface RenderOptions {
  seconds?: number;
  stateCalls?: boolean;
  movement?: boolean;
  eventCalls?: boolean;
  beds?: boolean;
  presentationSeed?: number;
  panningModel?: PanningModelType;
}

export async function renderScenario(sc: AudioScenario, o: RenderOptions = {}): Promise<Recording> {
  const t0 = performance.now();
  const prep = prepareScenario(sc);
  const t1 = performance.now();
  const seconds = o.seconds ?? sc.seconds;
  const ctx = new OfflineAudioContext(2, Math.ceil(SAMPLE_RATE * seconds), SAMPLE_RATE);
  // same master chain as AudioEngine: master gain (0.7 default volume) -> compressor -> destination
  const master = ctx.createGain();
  master.gain.value = 0.7;
  const comp = ctx.createDynamicsCompressor();
  master.connect(comp).connect(ctx.destination);
  const sim = prep.sim;
  const sampler = worldSampler(sim);
  const scape = new EcoSoundscape(
    { ctx, destination: master },
    { seed: o.presentationSeed ?? sc.seed * 101 + 7, sampler, panningModel: o.panningModel ?? 'HRTF', eventCalls: o.eventCalls ?? true, planner: { stateCalls: o.stateCalls ?? false, movement: o.movement ?? true, beds: o.beds ?? true } },
  );
  const cues: Cue[] = [];
  scape.onCue = (c) => cues.push(c);
  const observer = new EcoAudioObserver(sim, (e) => scape.ingest(e));
  const fb = new FrameBuilder(sim);
  const startTick = sim.tick;
  let acc = 0;
  const frames = Math.floor(seconds * FPS);
  let next = 0;
  // Just-in-time scheduling, like the live lab: frames are scheduled one WINDOW ahead from sample-accurate suspend
  // points. Scheduling the whole recording up front kept every future voice connected (and processed) from t=0,
  // which made render cost grow with the square of the voice count (a walking herd rendered at 0.8x real time).
  const scheduleUntil = (tEnd: number): void => {
    for (; next < frames && next / FPS < tEnd; next++) {
      const t = next / FPS;
      acc += (1 / FPS) * sc.simRate;
      while (acc >= TICK - 1e-9) {
        sim.step(TICK);
        acc -= TICK;
      }
      scape.frame(fb.build(prep.listener, 1 / FPS, t, sc.simRate), t);
    }
  };
  let released = 0;
  scheduleUntil(WINDOW);
  for (let k = 1; k * WINDOW < seconds; k++) {
    const t = k * WINDOW;
    void ctx.suspend(t).then(() => {
      released += scape.releaseEnded(t);
      scheduleUntil(t + WINDOW);
      return ctx.resume();
    });
  }
  const t2 = performance.now();
  const buffer = await ctx.startRendering();
  observer.dispose();
  const t3 = performance.now();
  const tel = scape.telemetry();
  scape.dispose();
  return {
    scenario: sc.id, seconds, sampleRate: SAMPLE_RATE, buffer, cues,
    meta: {
      seed: sc.seed, title: sc.title, note: prep.note, conditions: prep.conditions, listener: prep.listener, expected: prep.expected,
      simTickStart: startTick, simTickEnd: sim.tick, simHashEnd: sim.stateHash(),
      counters: tel.counters, route: tel.route, poolPeak: tel.poolPeak, releasedDuringRender: released,
      prepareMs: Math.round(t1 - t0), scheduleMs: Math.round(t2 - t1), renderMs: Math.round(t3 - t2), // renderMs includes the windowed scheduling

      renderSpeed: Math.round((seconds / ((t3 - t2) / 1000)) * 10) / 10,
      sampleHash: hashBuffer(buffer),
    },
  };
}

/** FNV-1a over 16-bit quantised samples (both channels): a compact identity for reproducibility checks. */
export function hashBuffer(b: AudioBuffer): string {
  let h = 0x811c9dc5;
  for (let ch = 0; ch < b.numberOfChannels; ch++) {
    const d = b.getChannelData(ch);
    for (let i = 0; i < d.length; i++) {
      const s = Math.max(-32768, Math.min(32767, Math.round(d[i]! * 32767)));
      h ^= s & 0xff;
      h = Math.imul(h, 0x01000193);
      h ^= (s >> 8) & 0xff;
      h = Math.imul(h, 0x01000193);
    }
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Per-channel RMS and peak (dBFS), overall and in windows, for the evidence report. */
export function levels(b: AudioBuffer, windowS = 1): { rmsDb: [number, number]; peakDb: [number, number]; windows: number[] } {
  const db = (v: number) => Math.round(20 * Math.log10(Math.max(1e-9, v)) * 10) / 10;
  const rms: number[] = [];
  const peak: number[] = [];
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(Math.min(ch, b.numberOfChannels - 1));
    let s = 0, p = 0;
    for (let i = 0; i < d.length; i++) ((s += d[i]! * d[i]!), (p = Math.max(p, Math.abs(d[i]!))));
    rms.push(db(Math.sqrt(s / d.length)));
    peak.push(db(p));
  }
  const n = Math.floor(windowS * b.sampleRate);
  const L = b.getChannelData(0);
  const windows: number[] = [];
  for (let w = 0; w + n <= L.length; w += n) {
    let s = 0;
    for (let i = w; i < w + n; i++) s += L[i]! * L[i]!;
    windows.push(db(Math.sqrt(s / n)));
  }
  return { rmsDb: [rms[0]!, rms[1]!], peakDb: [peak[0]!, peak[1]!], windows };
}

/** 16-bit PCM stereo WAV. */
export function encodeWav(b: AudioBuffer): ArrayBuffer {
  const ch = 2;
  const n = b.length;
  const out = new ArrayBuffer(44 + n * ch * 2);
  const v = new DataView(out);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + n * ch * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, ch, true);
  v.setUint32(24, b.sampleRate, true);
  v.setUint32(28, b.sampleRate * ch * 2, true);
  v.setUint16(32, ch * 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, n * ch * 2, true);
  const L = b.getChannelData(0);
  const R = b.numberOfChannels > 1 ? b.getChannelData(1) : L;
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (const d of [L, R]) {
      const s = Math.max(-1, Math.min(1, d[i]!));
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      o += 2;
    }
  }
  return out;
}

/**
 * Directionality calibration (NOT ecology): identical noise bursts at azimuth 0, +90 (right), 180, -90 (left),
 * through the same PannerNode setup and listener convention as the soundscape. Used by the browser gate (right
 * burst must be louder in the right channel) and as a headphone check for human reviewers.
 */
export async function renderCalibration(panningModel: PanningModelType = 'HRTF'): Promise<{ buffer: AudioBuffer; burstsAt: { t: number; azimuthDeg: number }[]; channelRms: { azimuthDeg: number; left: number; right: number }[] }> {
  const ctx = new OfflineAudioContext(2, SAMPLE_RATE * 9, SAMPLE_RATE);
  const L = ctx.listener;
  const yaw = 0.7; // arbitrary non-axis yaw so the test is not trivially aligned with world axes
  L.positionX.value = 100;
  L.positionY.value = 10;
  L.positionZ.value = 200;
  L.forwardX.value = Math.sin(yaw);
  L.forwardY.value = 0;
  L.forwardZ.value = Math.cos(yaw);
  L.upX.value = 0;
  L.upY.value = 1;
  L.upZ.value = 0;
  const az = [0, 90, 180, -90];
  const noise = ctx.createBuffer(1, SAMPLE_RATE, SAMPLE_RATE);
  const d = noise.getChannelData(0);
  let s = 12345;
  for (let i = 0; i < d.length; i++) {
    s = (s * 1103515245 + 12345) >>> 0;
    d[i] = ((s / 4294967296) * 2 - 1) * 0.5;
  }
  const burstsAt: { t: number; azimuthDeg: number }[] = [];
  az.forEach((deg, i) => {
    const t = 0.5 + i * 2;
    const a = (deg * Math.PI) / 180;
    // world position at azimuth a: forward f=(sin yaw, cos yaw), right r=(-cos yaw, sin yaw)
    const fx = Math.sin(yaw), fz = Math.cos(yaw), rx = -Math.cos(yaw), rz = Math.sin(yaw);
    const x = 100 + 10 * (Math.cos(a) * fx + Math.sin(a) * rx);
    const z = 200 + 10 * (Math.cos(a) * fz + Math.sin(a) * rz);
    const p = ctx.createPanner();
    p.panningModel = panningModel;
    p.distanceModel = 'inverse';
    p.refDistance = 10;
    p.positionX.value = x;
    p.positionY.value = 10;
    p.positionZ.value = z;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const g = ctx.createGain();
    g.gain.value = 0.5;
    src.connect(g).connect(p).connect(ctx.destination);
    src.start(t, 0, 1);
    burstsAt.push({ t, azimuthDeg: deg });
  });
  const buffer = await ctx.startRendering();
  const channelRms = burstsAt.map(({ t, azimuthDeg }) => {
    const a = Math.floor(t * SAMPLE_RATE);
    const b = a + SAMPLE_RATE;
    const r = (ch: number) => {
      const x = buffer.getChannelData(ch);
      let q = 0;
      for (let i = a; i < b; i++) q += x[i]! * x[i]!;
      return Math.sqrt(q / (b - a));
    };
    return { azimuthDeg, left: r(0), right: r(1) };
  });
  return { buffer, burstsAt, channelRms };
}
