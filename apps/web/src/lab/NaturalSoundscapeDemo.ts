/**
 * NaturalSoundscapeDemo — Interactive Browser Audition & Spatial Soundscape Demo
 * for Untamed Earth (Assignment D).
 *
 * Mounts via `/?soundscape=1` without modifying production `AudioEngine.ts` or `Game.ts`.
 * Lets the listener audition:
 * - River proximity distance slider (1 m riverbank edge -> 160 m forest ridge)
 * - Wind & canopy leaf-rustle intensity
 * - Time of day (Dawn Bird Chorus -> Midday -> Dusk Cricket/Jackal Chorus -> Night)
 * - Weather transitions (Clear -> Light Rain -> Monsoon Storm)
 * - Simulation-driven 3D spatial calls (`chital_alarm`, `myna_song`, `crow_caw`, `jackal_howl`)
 *   sourced from actual `Simulation(150)` wildlife coordinates around the riverbank.
 */

import { SPECIES, Simulation } from '@untamed/ecology';
import { NaturalSoundscape, type NaturalAudioInput } from './NaturalSoundscape';

export class NaturalSoundscapeDemoApp {
  readonly sim: Simulation;
  readonly soundscape = new NaturalSoundscape();
  private rafId = 0;
  private lastT = performance.now();
  private disposed = false;

  private riverDistM = 6;
  private windSpeed = 2.8;
  private rainRate = 0;
  private daylight = 0.78;
  private forestWeight = 0.82;

  private statusEl: HTMLElement | null = null;

  constructor(seed = 150) {
    this.sim = new Simulation(seed);
    for (let i = 0; i < 10; i++) this.sim.step(0.25);
  }

  private buildAudioInput(): NaturalAudioInput {
    const z = 620;
    const rx = this.sim.valley.riverX(z);
    const ry = this.sim.valley.waterSurface(z) + this.sim.env.stage;
    const lx = rx - this.riverDistM;
    const ly = this.sim.valley.height(lx, z) + 1.6;

    const nearby = this.sim.animals
      .filter((a) => a.alive && Math.hypot(a.x - lx, a.z - z) < 180)
      .slice(0, 24)
      .map((a) => ({
        id: a.id,
        species: SPECIES[a.sp]!.id,
        x: a.x,
        y: this.sim.valley.height(a.x, a.z) + a.alt,
        z: a.z,
        beh: a.beh,
        fear: a.fear,
      }));

    return {
      listenerX: lx,
      listenerY: ly,
      listenerZ: z,
      forwardX: 1,
      forwardY: 0,
      forwardZ: 0,
      riverX: rx,
      riverY: ry,
      riverZ: z,
      forestWeight: this.forestWeight,
      windSpeed: this.windSpeed,
      windDir: 0.7,
      rainRate: this.rainRate,
      daylight: this.daylight,
      simRate: 1,
      nearbyAnimals: nearby,
    };
  }

  mountUI(): void {
    for (const id of ['start', 'loading', 'hud', 'menu', 'fatal']) {
      document.getElementById(id)?.classList.add('hidden');
    }

    const panel = document.createElement('div');
    panel.id = 'soundscape-demo-panel';
    panel.style.cssText =
      'position:fixed;inset:24px auto auto 24px;z-index:9999;background:rgba(12,18,15,0.95);color:#e7f1ea;padding:18px 20px;border-radius:12px;font:13px/1.5 system-ui,sans-serif;border:1px solid rgba(170,220,180,0.25);max-width:460px;box-shadow:0 12px 32px rgba(0,0,0,0.55);';

    panel.innerHTML = `
      <h2 style="margin:0 0 6px;font-size:16px;color:#cce8b5;">Untamed Earth — Spatial Environmental Soundscape Lab</h2>
      <p style="margin:0 0 12px;font-size:12px;color:#a9bdb0;">
        100% procedural Web Audio 3D HRTF spatial soundscape driven by Simulation(150). Click <b>Start Audio</b> (user gesture required) to listen.
      </p>
      <div style="display:flex;gap:8px;margin-bottom:12px;">
        <button id="snd-start" style="flex:1;padding:8px;border-radius:6px;border:1px solid #82c46c;background:#264529;color:#fff;font-weight:600;cursor:pointer;">Start Audio</button>
        <button id="snd-mute" style="padding:8px 12px;border-radius:6px;border:1px solid #4a6352;background:#1a241e;color:#fff;cursor:pointer;">Mute / Unmute</button>
      </div>
      <div style="display:grid;gap:8px;margin-bottom:12px;font-size:12px;">
        <label>River Distance (<span id="snd-dist-val">6</span> m):
          <input id="snd-dist" type="range" min="1" max="140" value="6" style="width:100%;" />
        </label>
        <label>Wind & Canopy Rustle (<span id="snd-wind-val">2.8</span> m/s):
          <input id="snd-wind" type="range" min="0" max="12" step="0.2" value="2.8" style="width:100%;" />
        </label>
        <label>Daylight (0 = Night Crickets, 1 = Morning Birds):
          <input id="snd-day" type="range" min="0" max="1" step="0.05" value="0.78" style="width:100%;" />
        </label>
        <label>Rain Intensity (<span id="snd-rain-val">0</span> mm/h):
          <input id="snd-rain" type="range" min="0" max="12" step="0.5" value="0" style="width:100%;" />
        </label>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;">
        <button id="snd-call-chital" style="padding:5px 8px;border-radius:5px;border:1px solid #5a7360;background:#1c2820;color:#dce8df;cursor:pointer;">Chital Alarm Bark</button>
        <button id="snd-call-myna" style="padding:5px 8px;border-radius:5px;border:1px solid #5a7360;background:#1c2820;color:#dce8df;cursor:pointer;">Myna Song</button>
        <button id="snd-call-crow" style="padding:5px 8px;border-radius:5px;border:1px solid #5a7360;background:#1c2820;color:#dce8df;cursor:pointer;">Crow Caw</button>
        <button id="snd-call-jackal" style="padding:5px 8px;border-radius:5px;border:1px solid #5a7360;background:#1c2820;color:#dce8df;cursor:pointer;">Dusk Jackal Howl</button>
      </div>
      <pre id="snd-telemetry" style="margin:0;padding:8px;background:rgba(0,0,0,0.45);border-radius:6px;font:11px/1.4 ui-monospace,monospace;white-space:pre-wrap;"></pre>
    `;

    document.body.appendChild(panel);
    this.statusEl = panel.querySelector('#snd-telemetry');

    panel.querySelector('#snd-start')?.addEventListener('click', () => {
      this.soundscape.start();
      this.step(0.016);
    });
    panel.querySelector('#snd-mute')?.addEventListener('click', () => {
      const next = !this.soundscape.getTelemetry().muted;
      this.soundscape.setMuted(next);
      this.step(0.016);
    });

    const bindSlider = (id: string, valId: string | null, cb: (v: number) => void): void => {
      const el = panel.querySelector<HTMLInputElement>(id);
      el?.addEventListener('input', () => {
        const v = Number(el.value);
        if (valId) {
          const span = panel.querySelector(valId);
          if (span) span.textContent = String(v);
        }
        cb(v);
      });
    };

    bindSlider('#snd-dist', '#snd-dist-val', (v) => (this.riverDistM = v));
    bindSlider('#snd-wind', '#snd-wind-val', (v) => (this.windSpeed = v));
    bindSlider('#snd-day', null, (v) => (this.daylight = v));
    bindSlider('#snd-rain', '#snd-rain-val', (v) => (this.rainRate = v));

    const triggerCall = (
      kind: 'chital_alarm' | 'myna_song' | 'crow_caw' | 'jackal_howl',
      dx: number,
      dz: number,
    ): void => {
      this.soundscape.start();
      const inp = this.buildAudioInput();
      this.soundscape.triggerSpatialVocalization(
        kind,
        inp.listenerX + dx,
        inp.listenerY + 1.2,
        inp.listenerZ + dz,
        { x: inp.listenerX, y: inp.listenerY, z: inp.listenerZ },
      );
      this.step(0.016);
    };

    panel
      .querySelector('#snd-call-chital')
      ?.addEventListener('click', () => triggerCall('chital_alarm', -12, 8));
    panel
      .querySelector('#snd-call-myna')
      ?.addEventListener('click', () => triggerCall('myna_song', 9, -6));
    panel
      .querySelector('#snd-call-crow')
      ?.addEventListener('click', () => triggerCall('crow_caw', -18, -14));
    panel
      .querySelector('#snd-call-jackal')
      ?.addEventListener('click', () => triggerCall('jackal_howl', 45, 32));

    this.startLoop();
  }

  step(dt: number): void {
    const t = this.soundscape.update(dt, this.buildAudioInput());
    if (this.statusEl) {
      const lastCall = t.recentCalls[t.recentCalls.length - 1];
      this.statusEl.textContent = [
        `AudioContext: ${t.state} (started=${t.started}, muted=${t.muted})`,
        `River Dist: ${t.riverDistanceM} m -> River Gain: ${t.riverGain}`,
        `Wind Gain: ${t.windGain} | Canopy Leaf Rustle: ${t.leafRustleGain}`,
        `Insects: ${t.insectGain} | Rain Patter: ${t.rainGain}`,
        `Last Spatial Call: ${lastCall ? `${lastCall.kind} @ ${lastCall.distanceM}m (gain ${lastCall.gain})` : 'none'}`,
      ].join('\n');
    }
  }

  startLoop(): void {
    if (this.rafId) return;
    this.lastT = performance.now();
    const tick = (now: number): void => {
      if (this.disposed) return;
      const dt = Math.min(0.1, (now - this.lastT) / 1000);
      this.lastT = now;
      this.step(dt);
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    document.getElementById('soundscape-demo-panel')?.remove();
    this.soundscape.dispose();
  }
}

declare global {
  interface Window {
    __soundscapeDemo?: NaturalSoundscapeDemoApp;
  }
}

export function mountNaturalSoundscapeDemo(seed = 150): NaturalSoundscapeDemoApp {
  window.__soundscapeDemo?.dispose();
  const app = new NaturalSoundscapeDemoApp(seed);
  app.mountUI();
  window.__soundscapeDemo = app;
  return app;
}
