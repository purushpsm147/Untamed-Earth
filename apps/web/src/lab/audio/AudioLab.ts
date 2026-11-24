/**
 * /?audiolab=1 — the ecological soundscape lab (AUD-01). Opt-in, lazy-loaded, no WebGL.
 *
 * Live mode attaches the soundscape to the game's ONE AudioContext and master bus (AudioEngine.host), created on
 * the Start click (user gesture). The world is a real seeded simulation prepared by a listening scenario; a 2D map
 * shows the listener, real animals and each sound as it starts, so a reviewer can match what they hear to its cause.
 * "Record" renders the same scenario offline (reproducible) and downloads WAV + cue sheet.
 */
import { SPECIES, type Simulation } from '@untamed/ecology';
import type { AudioEngine } from '../../audio/AudioEngine';
import { EcoSoundscape, type Cue } from '../../audio/eco/EcoSoundscape';
import { EcoAudioObserver, FrameBuilder, worldSampler } from '../../audio/eco/observation';
import type { ListenerPose } from '../../audio/eco/acoustics';
import { AUDIO_SCENARIOS, prepareScenario, type AudioScenario } from '../../audio/eco/scenarios';
import { encodeWav, renderCalibration, renderScenario, type Recording } from './render';

const TICK: Record<number, number> = { 1: 0.1, 10: 0.25, 100: 1 };
const COLORS = ['#f2a65a', '#9aa5b1', '#f4d35e', '#7bd389', '#6aa9ff', '#ef6f6c'];

interface LiveSession {
  sim: Simulation;
  scape: EcoSoundscape;
  observer: EcoAudioObserver;
  fb: FrameBuilder;
  listener: ListenerPose;
  scenario: AudioScenario;
  startTick: number;
  realTime: number;
  acc: number;
  flashes: { x: number; z: number; t: number; label: string }[];
}

export interface AudioLabApi {
  start(id?: string): Promise<boolean>;
  stop(): void;
  restart(id?: string): Promise<boolean>;
  state(): { context: string | null; running: boolean; liveVoices: number; fadingVoices: number; allocatedVoices: number; liveNodes: number; bedNodes: number; poolPeak: number; route: Record<string, number>; counters: Record<string, number> } | null;
  /** TEST HARNESS ONLY: route a synthetic event through the router as if the simulation had emitted it. Never used by the lab UI. */
  testEvent(kind: 'alarm' | 'kill', species: string, dx: number, dz: number, animalId: number): void;
  setRate(r: number): void;
  setToggles(t: Partial<{ eventCalls: boolean; stateCalls: boolean; movement: boolean; beds: boolean }>): void;
  /** Hash and ticks advanced since the scenario start, read in one call (the live loop keeps running). */
  simProgress(): { hash: number; ticks: number } | null;
  /** The same scenario stepped `ticks` x 0.1 s with NO audio attached: the determinism reference. */
  referenceHash(id: string, ticks: number): number;
  stepFrames(n: number): void;
  record(id: string, seconds?: number, opts?: import('./render').RenderOptions): Promise<Omit<Recording, 'buffer'> & { channels: number; length: number }>;
  recordWav(id: string, seconds?: number): Promise<{ meta: Recording['meta']; cues: Cue[]; wavBase64: string }>;
  calibration(model?: PanningModelType): Promise<Awaited<ReturnType<typeof renderCalibration>>['channelRms']>;
  frameCostMs(): number;
  /** Render a scenario twice and compare sample by sample: max |a-b| and its level in dBFS. */
  diffRenders(id: string, seconds: number): Promise<{ hashA: string; hashB: string; maxAbsDiff: number; maxDiffDbfs: number; differingSamples: number; total: number }>;
  engine: AudioEngine;
}

export function mountAudioLab(audio: AudioEngine): AudioLabApi {
  for (const id of ['start', 'loading', 'hud', 'menu', 'fatal', 'view']) document.getElementById(id)?.classList.add('hidden');
  const canvasView = document.getElementById('view');
  if (canvasView) canvasView.style.display = 'none';
  const root = document.createElement('main');
  root.id = 'audiolab';
  root.setAttribute('aria-label', 'Ecological soundscape lab');
  root.style.cssText = 'position:fixed;inset:0;overflow:auto;background:#0d1410;color:#e3eee6;font:13px/1.5 system-ui,sans-serif;padding:16px;z-index:50';
  root.innerHTML = `
    <h1 style="margin:0 0 4px;font-size:18px">Ecological soundscape lab <small style="color:#9fb5a6">(AUD-01, experimental)</small></h1>
    <p style="margin:0 0 10px;color:#a9bdb0;max-width:820px">A real simulation drives every sound. Calls come from simulation events (alarms, kills) or, where flagged, from an animal's current state; ambience comes from weather, time of day and habitat. All synthesis is original and procedural, and none of it has been listening-verified. Use headphones.</p>
    <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:8px">
      <label>Scenario <select id="alScenario">${AUDIO_SCENARIOS.map((s) => `<option value="${s.id}">${s.title}</option>`).join('')}</select></label>
      <button id="alStart">Start sound</button><button id="alStop" disabled>Stop</button><button id="alRecord">Record WAV (offline)</button>
      <span role="group" aria-label="Speed"><button data-rate="1" aria-pressed="true">1×</button><button data-rate="10" aria-pressed="false">10×</button><button data-rate="100" aria-pressed="false">100×</button></span>
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:12px;margin-bottom:8px">
      <label><input type="checkbox" id="alEvent" checked> Event calls</label>
      <label><input type="checkbox" id="alState" checked> State-derived calls (needs director approval)</label>
      <label><input type="checkbox" id="alMove" checked> Movement</label>
      <label><input type="checkbox" id="alBeds" checked> Ambient beds</label>
      <label>Facing <input type="range" id="alYaw" min="-180" max="180" value="0" style="width:180px"> <span id="alYawV">0°</span></label>
    </div>
    <p id="alStatus" role="status" aria-live="polite" style="color:#cfe3b8;min-height:1.5em;margin:4px 0"></p>
    <div style="display:flex;flex-wrap:wrap;gap:16px">
      <canvas id="alMap" width="360" height="360" style="background:#16211a;border:1px solid #2c3d31;border-radius:6px" aria-label="Map: listener at centre facing up, 150 m radius"></canvas>
      <pre id="alTel" style="margin:0;font:12px/1.45 ui-monospace,monospace;white-space:pre-wrap;max-width:560px"></pre>
    </div>
    <h2 style="font-size:14px;margin:12px 0 4px">What to listen for</h2><ul id="alListen" style="margin:0;color:#c6d6cb"></ul>`;
  document.body.appendChild(root);
  const $ = <T extends HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!;
  const status = (s: string) => ($('alStatus').textContent = s);
  let live: LiveSession | null = null;
  let rate = 1;
  let raf = 0;
  let last = performance.now();
  let frameMs = 0;
  const toggles = { eventCalls: true, stateCalls: true, movement: true, beds: true };

  const showListen = () => {
    const sc = AUDIO_SCENARIOS.find((s) => s.id === $<HTMLSelectElement>('alScenario').value)!;
    $('alListen').innerHTML = sc.listenFor.map((l) => `<li>${l}</li>`).join('');
  };
  showListen();
  $('alScenario').addEventListener('change', showListen);

  function stop(): void {
    cancelAnimationFrame(raf);
    raf = 0;
    if (live) {
      live.observer.dispose();
      live.scape.dispose();
      live = null;
    }
    $<HTMLButtonElement>('alStop').disabled = true;
  }

  async function start(id?: string): Promise<boolean> {
    // The gesture: AudioEngine.start() creates or resumes the ONE AudioContext.
    audio.start();
    const host = audio.host;
    if (!host) {
      status(audio.error ?? 'Audio is unavailable in this browser.');
      return false;
    }
    if (host.ctx.state !== 'running') {
      try {
        await host.ctx.resume();
      } catch {
        // reported below
      }
    }
    if (host.ctx.state !== 'running') {
      status('The browser blocked audio. Click "Start sound" again to allow it.');
      return false;
    }
    stop();
    const sc = AUDIO_SCENARIOS.find((s) => s.id === (id ?? $<HTMLSelectElement>('alScenario').value)) ?? AUDIO_SCENARIOS[0]!;
    status(`Preparing ${sc.title}…`);
    await new Promise((r) => setTimeout(r, 0));
    const prep = prepareScenario(sc);
    const scape = new EcoSoundscape(host, {
      seed: sc.seed * 101 + 7, sampler: worldSampler(prep.sim), panningModel: 'HRTF', eventCalls: toggles.eventCalls,
      planner: { stateCalls: toggles.stateCalls, movement: toggles.movement, beds: toggles.beds },
    });
    live = {
      sim: prep.sim, scape, fb: new FrameBuilder(prep.sim), listener: { ...prep.listener }, scenario: sc, startTick: prep.sim.tick, realTime: 0, acc: 0, flashes: [],
      observer: new EcoAudioObserver(prep.sim, (e) => scape.ingest(e)),
    };
    scape.onCue = (c) => {
      if (live && c.kind !== 'drop' && c.kind !== 'reject' && c.animalId) {
        const a = live.sim.byId.get(c.animalId);
        if (a) live.flashes.push({ x: a.x, z: a.z, t: live.realTime, label: c.label });
        if (live.flashes.length > 40) live.flashes.shift();
      }
    };
    $<HTMLInputElement>('alYaw').value = String(Math.round(((((prep.listener.yaw * 180) / Math.PI + 540) % 360) - 180)));
    $('alYawV').textContent = `${$<HTMLInputElement>('alYaw').value}°`;
    $<HTMLButtonElement>('alStop').disabled = false;
    status(`${sc.title}: ${prep.note}`);
    last = performance.now();
    raf = requestAnimationFrame(loop);
    return true;
  }

  function frame(dt: number): void {
    if (!live) return;
    const t0 = performance.now();
    const tick = TICK[rate] ?? 0.1;
    live.acc += dt * rate;
    let n = 0;
    while (live.acc >= tick - 1e-9 && n < 200) {
      live.sim.step(tick);
      live.acc -= tick;
      n++;
    }
    live.realTime += dt;
    live.scape.frame(live.fb.build(live.listener, dt, live.realTime, rate), live.scape.ctx.currentTime);
    frameMs += (performance.now() - t0 - frameMs) * 0.05;
  }

  function loop(now: number): void {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    frame(dt);
    draw();
    raf = requestAnimationFrame(loop);
  }

  function draw(): void {
    if (!live) return;
    const cv = $<HTMLCanvasElement>('alMap');
    const g = cv.getContext('2d');
    if (!g) return;
    const S = cv.width / 2;
    const scale = S / 150;
    const L = live.listener;
    // map rotated so the listener faces up: screen up = forward, screen right = listener's right
    const fx = Math.sin(L.yaw), fz = Math.cos(L.yaw), rx = -Math.cos(L.yaw), rz = Math.sin(L.yaw);
    const toScreen = (x: number, z: number): [number, number] => {
      const dx = x - L.x, dz = z - L.z;
      return [S + (dx * rx + dz * rz) * scale, S - (dx * fx + dz * fz) * scale];
    };
    g.clearRect(0, 0, cv.width, cv.height);
    g.strokeStyle = '#2c3d31';
    for (const r of [50, 100, 150]) {
      g.beginPath();
      g.arc(S, S, r * scale, 0, Math.PI * 2);
      g.stroke();
    }
    g.fillStyle = '#3d6f8f';
    for (let dz = -160; dz <= 160; dz += 4) {
      const z = L.z + dz;
      const [px, py] = toScreen(live.sim.valley.riverX(z), z);
      g.fillRect(px - 1.5, py - 1.5, 3, 3);
    }
    for (const a of live.sim.animals) {
      if (!a.alive) continue;
      const [px, py] = toScreen(a.x, a.z);
      if (px < 0 || py < 0 || px > cv.width || py > cv.height) continue;
      g.fillStyle = COLORS[a.sp] ?? '#fff';
      g.beginPath();
      g.arc(px, py, 2.5, 0, Math.PI * 2);
      g.fill();
    }
    g.font = '10px system-ui';
    for (const f of live.flashes) {
      const age = live.realTime - f.t;
      if (age > 3) continue;
      const [px, py] = toScreen(f.x, f.z);
      g.strokeStyle = `rgba(255,240,180,${1 - age / 3})`;
      g.beginPath();
      g.arc(px, py, 6 + age * 10, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = `rgba(255,240,180,${1 - age / 3})`;
      g.fillText(f.label, px + 8, py - 6);
    }
    g.fillStyle = '#fff';
    g.beginPath();
    g.moveTo(S, S - 9);
    g.lineTo(S - 6, S + 6);
    g.lineTo(S + 6, S + 6);
    g.fill();
    const tel = live.scape.telemetry();
    const env = live.sim.env;
    const b = tel.beds;
    const legend = SPECIES.map((s, i) => `${s.id} ${COLORS[i]}`).join(", ");
    $('alTel').textContent = [
      `Day ${Math.floor(env.timeH / 24)} ${String(Math.floor(env.hour)).padStart(2, '0')}:${String(Math.floor((env.hour % 1) * 60)).padStart(2, '0')}  ${env.weather}, ${env.temperature.toFixed(1)} °C, wind ${env.wind.toFixed(1)} m/s, rain ${env.rain.toFixed(1)} mm/h  ×${rate}`,
      `Day part: ${b?.dayPart ?? '-'}${tel.lull ? '  (lull)' : ''}`,
      `Beds  wind ${f3(b?.wind)} leaves ${f3(b?.leaves)} grass ${f3(b?.grass)} rain ${f3(b?.rain)} river ${f3(b?.river)}`,
      `      crickets ${f3(b?.insects)} @${(b?.insectChirpRate ?? 0).toFixed(1)}/s  cicadas ${f3(b?.cicadas)} frogs ${f3(b?.frogs)}`,
      `Voices ${tel.liveVoices} live (peak ${tel.poolPeak}), nodes ${tel.liveNodes} (beds ${tel.bedNodes}), frame ${frameMs.toFixed(2)} ms`,
      `Routing ${Object.entries(tel.route).map(([k, v]) => `${k} ${v}`).join(', ')}`,
      `Played  event ${tel.counters.eventCalls}, state ${tel.counters.stateCalls}, movement ${tel.counters.movement}, thunder ${tel.counters.thunder}, rejected ${tel.counters.rejected}`,
      `Species colours: ${legend}`,
      '',
      'Recent sounds (t, what, distance, direction + = right, why):',
      ...live.scape.cues.slice(-12).reverse().map((c) => `${c.t.toFixed(1).padStart(6)}  ${c.kind.padEnd(10)} ${c.label.padEnd(22)} ${c.distanceM !== undefined ? `${c.distanceM} m`.padStart(8) : ''.padStart(8)} ${c.azimuthDeg !== undefined ? `${c.azimuthDeg}°`.padStart(5) : ''.padStart(5)}  ${c.why}`),
    ].join('\n');
  }

  $('alStart').addEventListener('click', () => void start());
  $('alStop').addEventListener('click', () => {
    stop();
    status('Stopped. The shared AudioContext stays open; nothing of the soundscape remains connected.');
  });
  $('alYaw').addEventListener('input', (e) => {
    const deg = Number((e.target as HTMLInputElement).value);
    $('alYawV').textContent = `${deg}°`;
    if (live) live.listener.yaw = (deg * Math.PI) / 180;
  });
  root.querySelectorAll<HTMLButtonElement>('[data-rate]').forEach((b) =>
    b.addEventListener('click', () => {
      rate = Number(b.dataset.rate);
      root.querySelectorAll<HTMLButtonElement>('[data-rate]').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
    }),
  );
  const tog = (id: string, key: keyof typeof toggles) =>
    $(id).addEventListener('change', (e) => {
      toggles[key] = (e.target as HTMLInputElement).checked;
      status('Toggle applies on the next Start.');
    });
  tog('alEvent', 'eventCalls');
  tog('alState', 'stateCalls');
  tog('alMove', 'movement');
  tog('alBeds', 'beds');
  window.addEventListener('keydown', (e) => {
    if (!live) return;
    const L = live.listener;
    const step = 2;
    if (e.key === 'ArrowLeft') L.yaw -= 0.1;
    else if (e.key === 'ArrowRight') L.yaw += 0.1;
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const s = e.key === 'ArrowUp' ? step : -step;
      L.x += Math.sin(L.yaw) * s;
      L.z += Math.cos(L.yaw) * s;
      L.y = live.sim.valley.heightFast(L.x, L.z) + 1.7;
    } else return;
    e.preventDefault();
  });
  document.addEventListener('visibilitychange', () => audio.setSuspended(document.hidden));
  $('alRecord').addEventListener('click', async () => {
    const id = $<HTMLSelectElement>('alScenario').value;
    const sc = AUDIO_SCENARIOS.find((s) => s.id === id)!;
    status(`Rendering ${sc.title} offline (${sc.seconds} s)…`);
    const rec = await renderScenario(sc);
    download(`${id}.wav`, new Blob([encodeWav(rec.buffer)], { type: 'audio/wav' }));
    download(`${id}.cues.json`, new Blob([JSON.stringify({ meta: rec.meta, cues: rec.cues }, null, 1)], { type: 'application/json' }));
    status(`Recorded ${sc.title}: ${rec.cues.filter((c) => c.kind !== 'drop').length} sounds, sample hash ${rec.meta.sampleHash}.`);
  });

  const api: AudioLabApi = {
    start,
    stop,
    restart: async (id) => {
      stop();
      return start(id);
    },
    state: () => {
      const host = audio.host;
      if (!live) return host ? { context: host.ctx.state, running: false, liveVoices: 0, fadingVoices: 0, allocatedVoices: 0, liveNodes: 0, bedNodes: 0, poolPeak: 0, route: {}, counters: {} } : null;
      const t = live.scape.telemetry();
      return { context: host?.ctx.state ?? null, running: true, liveVoices: t.liveVoices, fadingVoices: t.fadingVoices, allocatedVoices: t.allocatedVoices, liveNodes: t.liveNodes, bedNodes: t.bedNodes, poolPeak: t.poolPeak, route: t.route, counters: t.counters };
    },
    testEvent: (kind, species, dx, dz, animalId) => {
      if (!live) return;
      const L = live.listener;
      live.scape.ingest({ kind, species: species as never, animalId, x: L.x + dx, z: L.z + dz, timeH: live.sim.env.timeH, intensity: 0.8, ...(kind === 'kill' ? { preyId: animalId + 1, preySpecies: 'hare' as const } : {}) });
    },
    setRate: (r) => (rate = r),
    setToggles: (t) => Object.assign(toggles, t),
    simProgress: () => (live ? { hash: live.sim.stateHash(), ticks: live.sim.tick - live.startTick } : null),
    referenceHash: (id, ticks) => {
      const p = prepareScenario(AUDIO_SCENARIOS.find((s) => s.id === id)!);
      for (let i = 0; i < ticks; i++) p.sim.step(0.1);
      return p.sim.stateHash();
    },
    stepFrames: (n) => {
      for (let i = 0; i < n; i++) frame(0.05);
    },
    record: async (id, seconds, opts) => {
      const sc = AUDIO_SCENARIOS.find((s) => s.id === id)!;
      const rec = await renderScenario(sc, { ...opts, seconds });
      return { scenario: rec.scenario, seconds: rec.seconds, sampleRate: rec.sampleRate, cues: rec.cues, meta: rec.meta, channels: rec.buffer.numberOfChannels, length: rec.buffer.length };
    },
    recordWav: async (id, seconds) => {
      const sc = AUDIO_SCENARIOS.find((s) => s.id === id)!;
      const rec = await renderScenario(sc, { seconds });
      return { meta: rec.meta, cues: rec.cues, wavBase64: toBase64(encodeWav(rec.buffer)) };
    },
    calibration: async (model) => (await renderCalibration(model)).channelRms,
    frameCostMs: () => frameMs,
    diffRenders: async (id, seconds) => {
      const sc = AUDIO_SCENARIOS.find((s) => s.id === id)!;
      const a = await renderScenario(sc, { seconds });
      const b = await renderScenario(sc, { seconds });
      let max = 0;
      let n = 0;
      for (let ch = 0; ch < 2; ch++) {
        const x = a.buffer.getChannelData(ch);
        const y = b.buffer.getChannelData(ch);
        for (let i = 0; i < x.length; i++) {
          const d = Math.abs(x[i]! - y[i]!);
          if (d > 0) n++;
          if (d > max) max = d;
        }
      }
      return { hashA: a.meta.sampleHash, hashB: b.meta.sampleHash, maxAbsDiff: max, maxDiffDbfs: max > 0 ? Math.round(20 * Math.log10(max) * 10) / 10 : -Infinity, differingSamples: n, total: a.buffer.length * 2 };
    },
    engine: audio,
  };
  (window as unknown as { __audioLab: AudioLabApi }).__audioLab = api;
  return api;
}

function toBase64(buf: ArrayBuffer): string {
  const u = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}

function f3(v: number | undefined): string {
  return (v ?? 0).toFixed(3);
}

function download(name: string, blob: Blob): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
