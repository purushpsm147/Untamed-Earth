import * as THREE from 'three';
import { clamp, hashString } from '@untamed/core';
import { Animal, BEHAVIOR_NAMES, DEATH_CAUSES, SAVE_VERSION, SPECIES, SimSnapshot, Simulation, SpeciesId, lifeDays, maturityDays, weanDays } from '@untamed/ecology';
import { SEASONS, WeatherMode, YEAR_DAYS } from '@untamed/environment';
import { SaveStore, openEnvelope, sealEnvelope } from '@untamed/persistence';
import { REGION_SIZE } from '@untamed/worlds';
import { AudioEngine } from '../audio/AudioEngine';
import { Input } from '../input/Input';
import { Engine } from '../render/Engine';
import { QUALITY_ORDER, QualityName } from '../render/quality';
import { FpsTarget, FramePacer } from '../render/qualityGovernor';
import { drawChart } from '../ui/chart';
import { Curiosity } from './Curiosity';

export type Mode = 'observer' | 'wildlife' | 'experiment' | 'curiosity';
export interface SaveData {
  worldId: string;
  sim: SimSnapshot;
  cam: { x: number; y: number; z: number; yaw: number; pitch: number };
}
/** Graphics start-up decision: an explicit player choice, or Auto from the hardware assessment. */
export interface GraphicsChoice {
  initial: QualityName;
  /** Highest preset Auto may use. Equal to `initial` for a manual choice. */
  ceiling: QualityName;
  auto: boolean;
  /** Frame-rate target; 0 renders at the display's own rate. */
  fps: FpsTarget | 0;
  /** Why Auto started where it did, and what the GPU calls itself (shown in diagnostics only). */
  basis: string;
  gpu: string;
}
export const SAVE_FORMAT = 'untamed-earth';
export const SAVE_SLOT = 'slot1';

const SPEEDS = [0, 1, 10, 100, 1000];
/** Kinetic seconds per simulation tick at each time multiplier: coarser steps at high acceleration. */
const TICK_DT: Record<number, number> = { 1: 0.1, 10: 0.25, 100: 1, 1000: 2 };
const SP_COLORS = ['#f2a65a', '#9aa5b1', '#f4d35e', '#7bd389', '#6aa9ff', '#ef6f6c'];
const WEATHER_ICON: Record<string, string> = { clear: 'Clear', cloudy: 'Overcast', rain: 'Rain', storm: 'Thunderstorm' };
const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

export function parseSeed(text: string): number {
  const t = text.trim();
  return /^\d+$/.test(t) ? Number(t) >>> 0 : hashString(t || 'valley');
}

export function toast(msg: string, error = false): void {
  const d = document.createElement('div');
  d.textContent = msg;
  if (error) d.className = 'err';
  $('toasts').appendChild(d);
  setTimeout(() => d.remove(), error ? 9000 : 4000);
}

function meters(el: HTMLElement, rows: [string, number, string][]): void {
  if (el.children.length !== rows.length) {
    el.innerHTML = rows.map(() => '<div class="meter"><span></span><div class="bar"><div></div></div><span></span></div>').join('');
  }
  rows.forEach(([label, v, color], i) => {
    const m = el.children[i]!;
    m.children[0]!.textContent = label;
    const bar = m.children[1]!.firstElementChild as HTMLElement;
    bar.style.width = `${Math.round(clamp(v, 0, 1) * 100)}%`;
    bar.style.background = color;
    m.children[2]!.textContent = `${Math.round(clamp(v, 0, 1) * 100)}%`;
  });
}

export class Game {
  readonly engine: Engine;
  readonly curiosity: Curiosity;
  highlightGroup = 0;
  captions = true;
  mode: Mode = 'observer';
  speed = 1;
  menuOpen = false;
  selected = 0;
  following = false;
  controlled = 0;
  /** Ticks actually simulated per real second (diagnostics; reveals when 1000x is CPU-bound). */
  achievedRate = 1;
  ready = false;
  private readonly cam = { x: 770, y: 30, z: 640, yaw: 2.2, pitch: -0.12, fly: 14, dist: 9 };
  /** Curiosity Mode look-at point (the camera eases toward subjects rather than snapping). */
  private readonly look = { x: 0, y: 0, z: 0 };
  /** Bounded record of notable events seen this session, for the Social Lens. Not simulation state. */
  private readonly sessionLog: { day: number; ids: number[]; text: string }[] = [];
  private frozenTime: number | null = null;
  /** QA/profiling: artificial main-thread work per rendered frame (ms), to test quality degradation and recovery. */
  debugLoadMs = 0;
  private perf: { frame: number[]; sim: number[]; render: number[] } | null = null;
  private simAcc = 0;
  private time = 0;
  private last = 0;
  private raf = 0;
  private uiT = 0;
  private chartT = 0;
  private saveT = 0;
  private tickMs = 0;
  private kineticDone = 0;
  private rateT = 0;
  private fps = 60;
  private restToggle = false;
  private camSpeed = 0;
  private prevNow = 0;
  private lastTick = 0;
  private disposed = false;
  private readonly ray = new THREE.Raycaster();
  private readonly unsub: (() => void)[] = [];
  private readonly store = new SaveStore();
  private readonly abort = new AbortController();
  readonly pacer = new FramePacer();
  private lastRaf = 0;

  constructor(canvas: HTMLCanvasElement, readonly sim: Simulation, readonly worldId: string, private readonly gfx: GraphicsChoice, private readonly input: Input, private readonly audio: AudioEngine,
    private readonly hooks: { fatal: (msg: string) => void; restart: (seed: number, save?: SaveData) => void }, save?: SaveData) {
    this.engine = new Engine(canvas, this.sim, gfx.initial, gfx.ceiling);
    this.curiosity = new Curiosity(this.sim);
    this.engine.auto = gfx.auto;
    this.setFps(gfx.fps);
    if (save) Object.assign(this.cam, save.cam);
    else {
      this.cam.y = this.sim.valley.height(this.cam.x, this.cam.z) + 9;
    }
    this.engine.onThunder(() => this.audio.thunder());
    this.engine.onQualityChange = () => this.refreshMenu();
    this.bindUi();
    this.unsub.push(this.sim.events.on((e) => {
      this.logEvent(e);
      if (this.speed > 10) return;
      const name = SPECIES[e.sp]!.name.split(' (')[0]!.toLowerCase();
      const near = (e.x - this.cam.x) ** 2 + (e.z - this.cam.z) ** 2 < 350 * 350;
      if (e.type === 'kill') this.ticker(`A jackal has killed a ${name}.`);
      else if (e.type === 'birth' && near) this.ticker(e.n > 1 ? `${e.n} ${name} young were born nearby.` : `A ${name} was born nearby.`);
      else if (e.type === 'death' && near && (e.cause === 'starvation' || e.cause === 'dehydration')) this.ticker(`A ${name} died of ${e.cause}.`);
      else if (e.type === 'alarm' && near && e.sp === 0) this.audio.alarm(0.8);
      if (e.type === 'death' && e.id === this.controlled) {
        toast(`The deer you were living as has died (${e.cause}).`);
        this.setMode('observer');
      }
    }));
    canvas.addEventListener('webglcontextlost', (ev) => {
      ev.preventDefault();
      this.hooks.fatal('The graphics context was lost (the GPU driver reset or ran out of memory). Reload to continue; your last autosave is intact.');
    }, { signal: this.abort.signal });
    window.addEventListener('resize', () => this.engine.resize(), { signal: this.abort.signal });
    window.addEventListener('pagehide', () => void this.save(true), { signal: this.abort.signal });
    // Hidden-tab policy: browsers stop animation frames for hidden tabs, so rendering AND the simulation pause.
    // Nothing is fast-forwarded on return. Progress is saved on the way out, audio is suspended, and the
    // quality governor discards evidence from before the pause.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (this.ready) void this.save(true);
        this.audio.setSuspended(true);
      } else {
        this.last = performance.now();
        this.lastRaf = this.last;
        this.engine.governor.resume();
        this.audio.setSuspended(false);
      }
    }, { signal: this.abort.signal });
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  private logEvent(e: import('@untamed/ecology').SimEvent): void {
    const day = this.sim.env.timeH / 24;
    const nm = (sp: number): string => SPECIES[sp]!.name.split(' (')[0]!.toLowerCase();
    let entry: { day: number; ids: number[]; text: string } | null = null;
    if (e.type === 'kill') entry = { day, ids: [e.predator, e.prey], text: `killed a ${nm(e.sp)}` };
    else if (e.type === 'birth') entry = { day, ids: [e.id], text: e.n > 1 ? `gave birth to ${e.n} young` : 'gave birth' };
    else if (e.type === 'alarm') entry = { day, ids: [e.id], text: 'took fright at a predator' };
    if (!entry) return;
    const last = this.sessionLog[this.sessionLog.length - 1];
    if (last && last.text === entry.text && last.ids[0] === entry.ids[0] && day - last.day < 0.02) return;
    this.sessionLog.push(entry);
    if (this.sessionLog.length > 300) this.sessionLog.splice(0, 100);
  }

  // ---------------------------------------------------------------- UI wiring
  private on(id: string, ev: string, fn: (e: Event) => void): void {
    $(id).addEventListener(ev, fn, { signal: this.abort.signal });
  }

  private bindUi(): void {
    const sig = { signal: this.abort.signal };
    document.querySelectorAll<HTMLButtonElement>('#modes button').forEach((b) => b.addEventListener('click', () => this.setMode(b.dataset.mode as Mode), sig));
    document.querySelectorAll<HTMLButtonElement>('#speeds button').forEach((b) => b.addEventListener('click', () => this.setSpeed(Number(b.dataset.speed)), sig));
    this.on('btnStats', 'click', () => this.toggleStats());
    this.on('statsClose', 'click', () => this.toggleStats(false));
    this.on('btnMenu', 'click', () => this.setMenu(true));
    this.on('mResume', 'click', () => this.setMenu(false));
    this.on('mSave', 'click', () => void this.save(false));
    this.on('mLoad', 'click', () => void this.load());
    this.on('mNew', 'click', () => {
      const s = prompt('Seed for the new world (number or word):', String(this.sim.seed + 1));
      if (s !== null) this.hooks.restart(parseSeed(s));
    });
    // With Auto on, the preset chosen here is the ceiling the governor may climb back to; with Auto off it is fixed.
    this.on('mQuality', 'change', (e) => {
      this.engine.setQuality((e.target as HTMLSelectElement).value as QualityName, this.engine.auto);
      this.storeSettings();
    });
    this.on('mFps', 'change', (e) => {
      this.setFps(Number((e.target as HTMLSelectElement).value) as FpsTarget | 0);
      this.storeSettings();
    });
    this.on('mAuto', 'change', (e) => {
      this.engine.auto = (e.target as HTMLInputElement).checked;
      this.storeSettings();
    });
    this.on('mDiag', 'change', (e) => $('diag').classList.toggle('hidden', !(e.target as HTMLInputElement).checked));
    this.on('mVolume', 'input', (e) => {
      this.audio.setVolume(Number((e.target as HTMLInputElement).value));
      this.storeSettings();
    });
    this.on('mMute', 'change', (e) => {
      this.audio.setMuted((e.target as HTMLInputElement).checked);
      this.storeSettings();
    });
    this.on('insClose', 'click', () => this.select(0));
    this.on('insFollow', 'click', () => this.toggleFollow());
    this.on('insControl', 'click', () => this.takeControl(this.selected));
    this.on('wildRelease', 'click', () => this.setMode('observer'));
    this.on('insGroup', 'click', () => {
      const a = this.sim.byId.get(this.selected);
      this.highlightGroup = this.highlightGroup ? 0 : (a?.group ?? 0);
      this.uiT = 99;
    });
    this.on('cuPause', 'click', () => {
      this.curiosity.paused = !this.curiosity.paused;
      this.uiT = 99;
    });
    this.on('cuSkip', 'click', () => this.curiosity.skip());
    this.on('cuFollow', 'click', () => this.leaveCuriosity(true, false));
    this.on('cuBecome', 'click', () => this.leaveCuriosity(true, true));
    this.on('cuCaptions', 'click', () => {
      this.captions = !this.captions;
      this.uiT = 99;
    });
    this.on('cuExit', 'click', () => this.setMode('observer'));
    this.on('mMotion', 'change', (e) => {
      this.curiosity.reducedMotion = (e.target as HTMLInputElement).checked;
      this.storeSettings();
    });
    this.on('mMusic', 'input', (e) => {
      this.audio.setMusic(Number((e.target as HTMLInputElement).value));
      this.storeSettings();
    });

    // experiment panel: every control writes straight into simulation parameters
    const p = this.sim.env.params;
    const rain = $<HTMLInputElement>('exRain');
    const veg = $<HTMLInputElement>('exVeg');
    const fert = $<HTMLInputElement>('exFert');
    const spSel = $<HTMLSelectElement>('exSpecies');
    spSel.innerHTML = SPECIES.map((s) => `<option value="${s.id}">${s.name}</option>`).join('');
    const sync = (): void => {
      rain.value = String(p.rainMult);
      veg.value = String(p.vegGrowthMult);
      $<HTMLSelectElement>('exMode').value = p.weatherMode;
      fert.value = String(this.sim.fertility[spSel.selectedIndex]);
      $('exRainOut').textContent = `${Math.round(p.rainMult * 100)}%`;
      $('exVegOut').textContent = `${Math.round(p.vegGrowthMult * 100)}%`;
      $('exFertOut').textContent = `${Math.round(this.sim.fertility[spSel.selectedIndex]! * 100)}%`;
    };
    $<HTMLInputElement>('exSeed').value = String(this.sim.seed);
    sync();
    this.on('exRain', 'input', () => ((p.rainMult = Number(rain.value)), sync()));
    this.on('exVeg', 'input', () => ((p.vegGrowthMult = Number(veg.value)), sync()));
    this.on('exMode', 'change', (e) => ((p.weatherMode = (e.target as HTMLSelectElement).value as WeatherMode), sync()));
    this.on('exSpecies', 'change', sync);
    this.on('exFert', 'input', () => ((this.sim.fertility[spSel.selectedIndex] = Number(fert.value)), sync()));
    this.on('exAdd', 'click', () => {
      const n = this.sim.addAnimals(spSel.value as SpeciesId, 10);
      toast(`Introduced ${n} ${SPECIES[spSel.selectedIndex]!.name.toLowerCase()}.`);
    });
    this.on('exCull', 'click', () => {
      const n = this.sim.cull(spSel.value as SpeciesId, 10);
      toast(`Removed ${n} ${SPECIES[spSel.selectedIndex]!.name.toLowerCase()}.`);
    });
    this.on('exReset', 'click', () => this.hooks.restart(parseSeed($<HTMLInputElement>('exSeed').value)));

    // touch buttons
    document.querySelectorAll<HTMLButtonElement>('#touch button').forEach((b) => {
      const hold = b.dataset.hold;
      if (hold) {
        const set = (down: boolean) => (e: Event) => {
          e.preventDefault();
          if (hold === 'up') this.input.touchY = down ? 1 : 0;
          else if (hold === 'down') this.input.touchY = down ? -1 : 0;
          else this.input.hold(hold as 'eat' | 'drink', down);
        };
        b.addEventListener('pointerdown', set(true), sig);
        b.addEventListener('pointerup', set(false), sig);
        b.addEventListener('pointerleave', set(false), sig);
      } else if (b.dataset.toggle === 'fast') {
        b.addEventListener('click', () => this.input.setTouchFast(b.classList.toggle('on')), sig);
      } else if (b.dataset.act) b.addEventListener('click', () => this.input.trigger(b.dataset.act as 'rest'), sig);
    });
    $('legend').innerHTML = SPECIES.map((s, i) => `<span><i style="background:${SP_COLORS[i]}"></i>${s.name.split(' (')[0]}</span>`).join('');
    this.refreshMenu();
    this.refreshButtons();
  }

  private storeSettings(): void {
    try {
      localStorage.setItem('untamed.settings', JSON.stringify({
        quality: this.engine.qualityCeiling, auto: this.engine.auto, volume: Number($<HTMLInputElement>('mVolume').value), muted: this.audio.muted,
        music: Number($<HTMLInputElement>('mMusic').value), reducedMotion: this.curiosity.reducedMotion, fps: this.pacer.target,
      }));
    } catch {
      /* settings simply won't persist */
    }
  }

  private refreshMenu(): void {
    $<HTMLSelectElement>('mQuality').value = this.engine.auto ? this.engine.qualityCeiling : this.engine.quality.name;
    $<HTMLInputElement>('mAuto').checked = this.engine.auto;
    $<HTMLInputElement>('mMute').checked = this.audio.muted;
    $<HTMLSelectElement>('mFps').value = String(this.pacer.target);
    const now = this.engine.quality.name;
    $('mGfxInfo').textContent = `Now: ${now[0]!.toUpperCase()}${now.slice(1)} at ${Math.round(this.engine.resScale * 100)}% resolution · view ${this.engine.quality.viewDist} m`;
  }

  /** Frame-rate target: paces rendering and tells the governor what "holding the frame rate" means. */
  setFps(fps: FpsTarget | 0): void {
    this.pacer.target = fps;
    this.engine.setFpsTarget(fps === 0 ? 60 : fps);
  }

  private refreshButtons(): void {
    document.querySelectorAll<HTMLButtonElement>('#modes button').forEach((b) => b.classList.toggle('on', b.dataset.mode === this.mode));
    document.querySelectorAll<HTMLButtonElement>('#speeds button').forEach((b) => b.classList.toggle('on', Number(b.dataset.speed) === this.speed));
    $('experiment').classList.toggle('hidden', this.mode !== 'experiment');
    $('wild').classList.toggle('hidden', this.mode !== 'wildlife');
    $('curio').classList.toggle('hidden', this.mode !== 'curiosity');
    $('touch').classList.toggle('hidden', !this.input.touch);
    document.querySelectorAll<HTMLElement>('.wildOnly').forEach((b) => b.classList.toggle('hidden', this.mode !== 'wildlife'));
    $('insFollow').classList.toggle('on', this.following);
    $('insFollow').textContent = this.following ? 'Stop following' : 'Follow';
  }

  private ticker(msg: string): void {
    const now = performance.now();
    if (now - this.lastTick < 1500) return;
    this.lastTick = now;
    const t = $('ticker');
    const d = document.createElement('div');
    d.textContent = msg;
    t.replaceChildren(d);
  }

  // ---------------------------------------------------------------- state changes
  setSpeed(s: number): void {
    this.speed = s;
    this.simAcc = 0;
    this.refreshButtons();
  }

  setMenu(open: boolean): void {
    this.menuOpen = open;
    $('menu').classList.toggle('hidden', !open);
    if (open) {
      if (this.input.captured) this.input.toggleCapture();
      this.refreshMenu();
    }
  }

  toggleStats(show?: boolean): void {
    const el = $('stats');
    el.classList.toggle('hidden', show === undefined ? undefined : !show);
    $('btnStats').classList.toggle('on', !el.classList.contains('hidden'));
    this.chartT = 99;
  }

  select(id: number): void {
    this.selected = id;
    if (!id) this.following = false;
    $('inspect').classList.toggle('hidden', !id || this.mode === 'wildlife' || this.mode === 'curiosity');
    if (!id) this.highlightGroup = 0;
    else if (this.highlightGroup) this.highlightGroup = this.sim.byId.get(id)?.group ?? 0;
    this.refreshButtons();
    this.uiT = 99;
  }

  toggleFollow(): void {
    if (!this.selected) return;
    this.following = !this.following;
    if (this.following) {
      const a = this.sim.byId.get(this.selected);
      this.cam.dist = a && SPECIES[a.sp]!.mass < 5 ? 4 : 9;
    }
    this.refreshButtons();
  }

  takeControl(id: number): void {
    let a = this.sim.byId.get(id);
    if (!a || !a.alive || !SPECIES[a.sp]!.playable) {
      // nearest playable animal to the camera
      let best = 1e18;
      a = undefined;
      for (const o of this.sim.animals) {
        if (!o.alive || !SPECIES[o.sp]!.playable || o.age < maturityDays(SPECIES[o.sp]!) * 0.5) continue;
        const d = (o.x - this.cam.x) ** 2 + (o.z - this.cam.z) ** 2;
        if (d < best) {
          best = d;
          a = o;
        }
      }
    }
    if (!a) {
      toast('There are no spotted deer left to live as.', true);
      return;
    }
    this.controlled = a.id;
    this.selected = a.id;
    this.following = false;
    this.restToggle = false;
    this.sim.setControlled(a.id);
    this.mode = 'wildlife';
    this.cam.dist = 7;
    if (this.speed > 10 || this.speed === 0) this.setSpeed(1);
    $('inspect').classList.add('hidden');
    this.refreshButtons();
  }

  setMode(m: Mode): void {
    if (m === 'wildlife') {
      this.takeControl(this.selected);
      return;
    }
    if (this.controlled) {
      // hand the animal back to its own decision-making; its state is untouched
      this.sim.setControlled(null);
      this.controlled = 0;
      this.following = true;
    }
    if (this.mode === 'curiosity' && m !== 'curiosity') {
      // keep looking where the autopilot was looking, so handing back control is seamless
      const dx = this.look.x - this.cam.x;
      const dy = this.look.y - this.cam.y;
      const dz = this.look.z - this.cam.z;
      this.cam.yaw = Math.atan2(dx, dz);
      this.cam.pitch = clamp(Math.atan2(dy, Math.hypot(dx, dz)), -1.4, 1.4);
      this.curiosity.stop();
    }
    if (m === 'curiosity' && this.mode !== 'curiosity') {
      const cp = Math.cos(this.cam.pitch);
      this.look.x = this.cam.x + Math.sin(this.cam.yaw) * cp * 30;
      this.look.y = this.cam.y + Math.sin(this.cam.pitch) * 30;
      this.look.z = this.cam.z + Math.cos(this.cam.yaw) * cp * 30;
      this.curiosity.start({ x: this.cam.x, y: this.cam.y, z: this.cam.z, tx: this.look.x, ty: this.look.y, tz: this.look.z });
      this.following = false;
      if (this.input.captured) this.input.toggleCapture();
      if (this.speed > 10 || this.speed === 0) this.setSpeed(1);
    }
    this.mode = m;
    if (m === 'experiment') this.toggleStats(true);
    this.select(m === 'curiosity' ? 0 : this.selected);
  }

  /** Leave the autopilot, optionally keeping its subject: Observe -> Select -> Follow -> Become. */
  private leaveCuriosity(keepSubject: boolean, become: boolean): void {
    const a = keepSubject ? this.curiosity.subjectAnimal() : null;
    this.setMode('observer');
    if (!a) return;
    this.select(a.id);
    if (become && SPECIES[a.sp]!.playable) this.takeControl(a.id);
    else if (!this.following) this.toggleFollow();
  }

  // ---------------------------------------------------------------- persistence
  async save(silent: boolean): Promise<void> {
    try {
      const data: SaveData = { worldId: this.worldId, sim: this.sim.snapshot(), cam: { x: this.cam.x, y: this.cam.y, z: this.cam.z, yaw: this.cam.yaw, pitch: this.cam.pitch } };
      await this.store.put(SAVE_SLOT, sealEnvelope(data, SAVE_FORMAT, SAVE_VERSION, Date.now()));
      $('mSaveInfo').textContent = `Saved ${new Date().toLocaleTimeString()} (day ${this.sim.env.day})`;
      if (!silent) toast('World saved to this browser.');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      $('mSaveInfo').textContent = `Not saved: ${msg}`;
      if (!silent) toast(`Could not save: ${msg}`, true);
    }
  }

  async load(): Promise<void> {
    try {
      const raw = await this.store.get<unknown>(SAVE_SLOT);
      if (!raw) {
        toast('There is no saved world yet.', true);
        return;
      }
      const data = openEnvelope<SaveData>(raw, SAVE_FORMAT, SAVE_VERSION);
      data.worldId ??= this.worldId;
      this.hooks.restart(0, data);
    } catch (e) {
      toast(`Could not load: ${e instanceof Error ? e.message : String(e)}`, true);
    }
  }

  // ---------------------------------------------------------------- frame
  private handleActions(): void {
    const i = this.input;
    if (i.pressed('pause')) {
      if (this.menuOpen) this.setMenu(false);
      else if (this.input.captured) this.input.toggleCapture();
      else this.setMenu(true);
    }
    if (i.pressed('diag')) {
      const d = $('diag');
      d.classList.toggle('hidden');
      $<HTMLInputElement>('mDiag').checked = !d.classList.contains('hidden');
    }
    if (i.pressed('mute')) {
      this.audio.setMuted(!this.audio.muted);
      this.storeSettings();
      toast(this.audio.muted ? 'Sound off' : 'Sound on');
    }
    if (this.menuOpen) return;
    if (i.pressed('stats')) this.toggleStats();
    if (i.pressed('curiosity')) this.setMode(this.mode === 'curiosity' ? 'observer' : 'curiosity');
    if (i.pressed('skip') && this.mode === 'curiosity') this.curiosity.skip();
    if (i.pressed('help')) this.setMenu(true);
    if (i.pressed('capture') && this.mode !== 'wildlife') this.input.toggleCapture();
    if (i.pressed('speedUp')) this.setSpeed(SPEEDS[Math.min(SPEEDS.length - 1, SPEEDS.indexOf(this.speed) + 1)]!);
    if (i.pressed('speedDown')) this.setSpeed(SPEEDS[Math.max(0, SPEEDS.indexOf(this.speed) - 1)]!);
    if (i.pressed('follow')) this.toggleFollow();
    if (i.pressed('control')) this.takeControl(this.selected);
    if (i.pressed('release')) {
      if (this.controlled) this.setMode('observer');
      else if (this.following) this.toggleFollow();
    }
    if (i.pressed('rest')) this.restToggle = !this.restToggle;
    if (i.click && this.mode !== 'wildlife' && this.mode !== 'curiosity') {
      this.ray.setFromCamera(new THREE.Vector2(i.click.x, i.click.y), this.engine.camera);
      const a = this.engine.animals.pick(this.ray.ray, 400);
      this.select(a ? a.id : this.following ? this.selected : 0);
    }
  }

  private updateCamera(dt: number): void {
    const c = this.cam;
    const i = this.input;
    const v = this.sim.valley;
    if (this.mode === 'curiosity') {
      // any deliberate input hands control straight back to the player
      if (Math.hypot(i.moveX, i.moveZ) > 0.2 || Math.abs(i.moveY) > 0.2 || Math.abs(i.lookX) + Math.abs(i.lookY) > 0.004 || i.click) {
        this.setMode('observer');
      } else {
        // the director plans a path clear of ruins (rotated footprints, roof clearance) and caps speed
        const pose = this.curiosity.update(dt, { x: c.x, y: c.y, z: c.z, tx: this.look.x, ty: this.look.y, tz: this.look.z });
        c.x = clamp(pose.x, 4, REGION_SIZE - 4);
        c.z = clamp(pose.z, 4, REGION_SIZE - 4);
        c.y = Math.max(pose.y, Math.max(v.height(c.x, c.z), v.waterSurface(c.z) + this.sim.env.stage) + 1.4);
        this.look.x = pose.tx;
        this.look.y = pose.ty;
        this.look.z = pose.tz;
        this.engine.camera.position.set(c.x, c.y, c.z);
        this.engine.camera.lookAt(this.look.x, this.look.y, this.look.z);
        return;
      }
    }
    c.yaw += i.lookX;
    c.pitch = clamp(c.pitch + i.lookY, -1.5, 1.5);
    const cp = Math.cos(c.pitch);
    const fx = Math.sin(c.yaw) * cp;
    const fy = Math.sin(c.pitch);
    const fz = Math.cos(c.yaw) * cp;
    const camera = this.engine.camera;
    const target = this.controlled || (this.following ? this.selected : 0);
    const ta = target ? this.sim.byId.get(target) : undefined;
    if (ta && ta.alive) {
      // orbit camera around the animal
      c.dist = clamp(c.dist * (1 + i.zoom * 0.12), 1.5, 60);
      const p = this.engine.animals.pos.get(ta.id);
      const tx = p ? p.x : ta.x;
      const ty = p ? p.y : v.height(ta.x, ta.z) + ta.alt + 0.8;
      const tz = p ? p.z : ta.z;
      c.pitch = clamp(c.pitch, -1.3, 0.5);
      c.x = tx - fx * c.dist;
      c.y = ty + 0.5 - fy * c.dist;
      c.z = tz - fz * c.dist;
      const floor = Math.max(v.height(c.x, c.z), v.waterSurface(c.z) + this.sim.env.stage) + 0.4;
      if (c.y < floor) c.y = floor;
      camera.position.set(c.x, c.y, c.z);
      camera.lookAt(tx, ty + 0.5, tz);
      if (this.controlled) {
        const m = Math.hypot(i.moveX, i.moveZ);
        let mx = 0;
        let mz = 0;
        if (m > 0.15) {
          const yx = Math.sin(c.yaw);
          const yz = Math.cos(c.yaw);
          mx = (yx * i.moveZ - yz * i.moveX) / m;
          mz = (yz * i.moveZ + yx * i.moveX) / m;
          this.restToggle = false;
        }
        this.sim.control = { mx, mz, run: i.fast, action: i.isHeld('eat') ? 'eat' : i.isHeld('drink') ? 'drink' : this.restToggle ? 'rest' : null };
      }
      return;
    }
    if (target) {
      // the followed animal is gone
      this.following = false;
      if (!this.sim.byId.get(this.selected)?.alive) this.select(0);
    }
    // free flight
    if (i.zoom) c.fly = clamp(c.fly * (1 - i.zoom * 0.15), 2, 160);
    const sp = c.fly * (i.fast ? 3.5 : 1) * dt;
    // free-flight speed commanded this frame (m/s), for diagnostics and frame-rate-independent tests
    this.camSpeed = (Math.hypot(i.moveX, i.moveZ, i.moveY) > 0 ? sp / Math.max(dt, 1e-6) : 0);
    const ox = c.x;
    const oz = c.z;
    c.x += (fx * i.moveZ - Math.cos(c.yaw) * i.moveX) * sp;
    c.z += (fz * i.moveZ + Math.sin(c.yaw) * i.moveX) * sp;
    // ruins are solid below roof height: slide along whichever axis is still free
    if (v.blocked(c.x, c.z, 0.7) && c.y < v.heightFast(c.x, c.z) + 7.5 && !v.blocked(ox, oz, 0.7)) {
      if (!v.blocked(c.x, oz, 0.7)) c.z = oz;
      else if (!v.blocked(ox, c.z, 0.7)) c.x = ox;
      else ((c.x = ox), (c.z = oz));
    }
    c.y += (fy * i.moveZ + i.moveY) * sp;
    c.x = clamp(c.x, 4, REGION_SIZE - 4);
    c.z = clamp(c.z, 4, REGION_SIZE - 4);
    const floor = Math.max(v.height(c.x, c.z), v.waterSurface(c.z) + this.sim.env.stage) + 1.3;
    c.y = clamp(c.y, floor, 420);
    camera.position.set(c.x, c.y, c.z);
    camera.lookAt(c.x + fx, c.y + fy, c.z + fz);
  }

  private frame = (now: number): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    // frame pacing: on displays faster than the chosen target, only every n-th callback renders
    const rafDelta = now - this.lastRaf;
    this.lastRaf = now;
    if (!this.pacer.tick(rafDelta)) return;
    try {
      // long frames are clamped (tab switches, hitches) but slow devices still advance in real time down to 4 fps
      const dt = Math.min(0.25, (now - this.last) / 1000);
      this.last = now;
      this.time = this.frozenTime ?? this.time + dt;
      this.fps += (1 / Math.max(dt, 1e-3) - this.fps) * 0.05;
      this.input.poll(dt);
      this.handleActions();

      // --- fixed-timestep simulation, decoupled from rendering ---
      let alpha = 1;
      if (this.speed > 0 && !this.menuOpen && this.ready) {
        const tick = TICK_DT[this.speed]!;
        this.simAcc += dt * this.speed;
        this.sim.focus = this.cam;
        const t0 = performance.now();
        let n = 0;
        // simulation budget scales with the frame interval, so a slow GPU does not starve time acceleration:
        // 9 ms at 60 fps, up to 45% of a long frame (capped at 70 ms)
        const budget = Math.min(70, Math.max(9, dt * 450));
        while (this.simAcc >= tick && performance.now() - t0 < budget) {
          this.sim.step(tick);
          this.simAcc -= tick;
          n++;
        }
        if (n > 0) this.tickMs += ((performance.now() - t0) / n - this.tickMs) * 0.1;
        if (this.perf) this.perf.sim.push(performance.now() - t0);
        this.kineticDone += n * tick;
        // if the CPU cannot sustain the requested rate, drop the backlog rather than spiral
        if (this.simAcc > tick * 4) this.simAcc = 0;
        alpha = this.speed <= 10 ? this.simAcc / tick : 1;
      }
      this.rateT += dt;
      if (this.rateT >= 1) {
        this.achievedRate = this.kineticDone / this.rateT;
        this.kineticDone = 0;
        this.rateT = 0;
      }
      if (this.debugLoadMs > 0) {
        const until = performance.now() + this.debugLoadMs;
        while (performance.now() < until) { /* deliberate busy wait (profiling only) */ }
      }
      this.updateCamera(dt);
      const r0 = performance.now();
      this.engine.frame(dt, alpha, this.time, this.selected, this.speed, this.highlightGroup);
      if (this.perf) {
        this.perf.frame.push(now - this.prevNow);
        this.perf.render.push(performance.now() - r0);
      }
      this.prevNow = now;
      this.updateAudio(dt);
      this.uiT += dt;
      if (this.uiT > 0.2) {
        this.uiT = 0;
        this.updateHud();
      }
      this.chartT += dt;
      if (this.chartT > 1 && !$('stats').classList.contains('hidden')) {
        this.chartT = 0;
        this.updateCharts();
      }
      this.saveT += dt;
      if (this.saveT > 120 && this.ready) {
        this.saveT = 0;
        void this.save(true);
      }
      this.input.endFrame();
    } catch (e) {
      this.dispose();
      this.hooks.fatal(e instanceof Error ? `${e.message}` : String(e));
      throw e;
    }
  };

  /** Fraction of terrain in view that has arrived (drives the loading bar). */
  loadProgress(): number {
    return this.engine.terrain.loaded / Math.max(1, this.engine.terrain.wanted);
  }

  private updateAudio(dt: number): void {
    const env = this.sim.env;
    const c = this.cam;
    let crows = 0;
    let mynas = 0;
    let jackals = 0;
    for (const a of this.sim.animals) {
      const d2 = (a.x - c.x) ** 2 + (a.z - c.z) ** 2;
      if (a.sp === 4 && d2 < 150 * 150) crows++;
      else if (a.sp === 5 && d2 < 120 * 120) mynas++;
      else if (a.sp === 2 && d2 < 500 * 500) jackals++;
    }
    const riverD = Math.abs(c.x - this.sim.valley.riverX(c.z));
    const high = Math.max(0, c.y - this.sim.valley.heightFast(c.x, c.z) - 10) / 120;
    this.audio.update(dt, {
      wind: env.wind * (1 + high), rain: env.rain, water: clamp(1 - riverD / 55, 0, 1) * clamp(1 - high * 3, 0, 1), day: env.daylight(),
      crows, mynas, jackals, rate: this.menuOpen ? 9999 : this.speed,
    });
  }

  private animalRows(a: Animal): [string, number, string][] {
    return [
      ['Health', a.health, '#9ccf7a'], ['Fed', 1 - a.hunger, '#e6b35c'], ['Hydrated', 1 - a.thirst, '#6fb3e0'],
      ['Rested', a.energy, '#b7a6e8'], ['Stamina', a.stamina, '#d9d9d9'], ['Fear', a.fear, '#e0705c'],
    ];
  }

  private updateHud(): void {
    const env = this.sim.env;
    const h = env.hour;
    const hh = String(Math.floor(h)).padStart(2, '0');
    const mm = String(Math.floor((h % 1) * 60)).padStart(2, '0');
    const year = Math.floor(env.day / YEAR_DAYS) + 100;
    $('clockMain').textContent = `Year ${year} · Day ${(env.day % YEAR_DAYS) + 1} · ${hh}:${mm} · ${SEASONS[env.season]}`;
    const c = env.cellIndex(this.cam.x, this.cam.z);
    const zones: [string, number][] = [['Forest', env.forest[c]!], ['Settlement ruins', env.settlement[c]!], ['Waste dump', env.dump[c]!], ['Wetland', env.wetland[c]!]];
    let zone = 'Meadow';
    let zw = 0.35;
    for (const [n, w] of zones) if (w > zw) ((zone = n), (zw = w));
    const rate = this.speed >= 100 && this.achievedRate < this.speed * 0.9 ? ` (running ${Math.round(this.achievedRate)}×)` : '';
    $('clockSub').textContent = `${WEATHER_ICON[env.weather]} · ${env.temperature.toFixed(0)}°C · wind ${env.wind.toFixed(0)} m/s · ${zone}: forage ${Math.round(env.vegFrac(c) * 100)}%, soil moisture ${Math.round(env.moisture[c]! * 100)}%${rate}`;

    const a = this.selected ? this.sim.byId.get(this.selected) : undefined;
    if (a && a.alive && this.mode !== 'wildlife') {
      const sp = SPECIES[a.sp]!;
      const mat = maturityDays(sp);
      const stage = a.age < mat * 0.4 ? 'Juvenile' : a.age < mat ? 'Subadult' : a.age > lifeDays(sp) * 0.8 ? 'Old adult' : 'Adult';
      $('insName').textContent = `${sp.name} #${a.id}`;
      $('insSci').textContent = sp.sci;
      const yrs = ((a.age / YEAR_DAYS) as number).toFixed(1);
      $('insMeta').textContent = `${stage} ${a.sex ? 'male' : 'female'}, ${yrs} yr${a.pregnantH > 0 ? ' · gravid' : ''} · ${BEHAVIOR_NAMES[a.beh]}`;
      meters($('insBars'), this.animalRows(a));
      $<HTMLButtonElement>('insControl').classList.toggle('hidden', !sp.playable);
      $('insSocial').innerHTML = this.socialLens(a).map((l) => `<div>${l}</div>`).join('');
      $('insGroup').classList.toggle('on', this.highlightGroup !== 0);
      $('insRole').textContent = sp.note;
    } else if (this.selected && this.mode !== 'wildlife' && this.mode !== 'curiosity') this.select(0);

    if (this.mode === 'curiosity') {
      const cap = this.captions ? this.curiosity.caption() : null;
      $('cuCaption').classList.toggle('hidden', !cap);
      if (cap) {
        $('cuWhat').textContent = cap[0];
        $('cuFact').textContent = cap[1];
        $('cuNote').textContent = cap[2];
      }
      const subj = this.curiosity.subjectAnimal();
      $('cuPause').textContent = this.curiosity.paused ? 'Resume' : 'Pause';
      $<HTMLButtonElement>('cuFollow').disabled = !subj;
      $('cuBecome').classList.toggle('hidden', !subj || !SPECIES[subj.sp]!.playable);
      $('cuCaptions').classList.toggle('on', this.captions);
    }

    const w = this.controlled ? this.sim.byId.get(this.controlled) : undefined;
    if (w) {
      meters($('wildBars'), this.animalRows(w));
      const water = this.sim.waterNear(w);
      const forage = env.vegFrac(env.cellIndex(w.x, w.z));
      const tips: string[] = [];
      if (w.fear > 0.3) tips.push('Predator close — run (Shift)!');
      if (water) tips.push(water === 2 ? 'F: drink (this pool smells foul)' : 'F: drink');
      tips.push(forage > 0.12 ? `E: graze (forage ${Math.round(forage * 100)}%)` : 'Grazed bare here — move on');
      tips.push(this.restToggle ? 'Resting… (move to get up)' : 'R: rest');
      $('wildPrompt').textContent = tips.join(' · ');
      $('vignette').style.opacity = String(Math.max(clamp((w.fear - 0.25) * 0.9, 0, 0.6), clamp((0.4 - w.health) * 2, 0, 0.7)));
    } else $('vignette').style.opacity = '0';

    if (!$('diag').classList.contains('hidden')) {
      const inf = this.engine.info();
      const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
      $('diag').textContent = [
        `fps ${this.fps.toFixed(0)}  frame ${this.engine.frameMs.toFixed(1)} ms`,
        `quality ${this.engine.quality.name}${this.engine.auto ? ` (auto, max ${this.engine.qualityCeiling}${this.engine.governor.calibrating ? ', calibrating' : ''})` : ''}  scale ${Math.round(this.engine.resScale * 100)}%`,
        `target ${this.pacer.target || 'display'} fps  display ~${Math.round(1000 / this.pacer.refreshMs)} Hz  render 1/${this.pacer.divisor}`,
        `gpu ${this.gfx.gpu || 'not reported'}`,
        `basis ${this.gfx.basis}`,
        `draws ${inf.calls}  tris ${(inf.triangles / 1000).toFixed(0)}k  geoms ${inf.geometries}`,
        `sim ${this.tickMs.toFixed(2)} ms/tick  rate ${this.achievedRate.toFixed(0)}×  tick ${this.sim.tick}`,
        `animals ${this.sim.animals.length}  carcasses ${this.sim.carcasses.length}`,
        mem ? `heap ${(mem.usedJSHeapSize / 1048576).toFixed(0)} MB` : 'heap n/a',
        `seed ${this.sim.seed}  pos ${this.cam.x.toFixed(0)}, ${this.cam.z.toFixed(0)}`,
      ].join('\n');
    }
  }

  /** Relationships and pressures read directly from simulation state; nothing here is invented. */
  private socialLens(a: Animal): string[] {
    const sp = SPECIES[a.sp]!;
    const out: string[] = [];
    let members = 0;
    let offspring = 0;
    let dependants = 0;
    for (const o of this.sim.animals) {
      if (!o.alive) continue;
      if (o.group === a.group && o.sp === a.sp) members++;
      if (o.mother === a.id) {
        offspring++;
        if (o.age < weanDays(sp)) dependants++;
      }
    }
    out.push(members > 1 ? `<b>Group</b> ${sp.groupNoun} of ${members}` : `<b>Group</b> alone (${sp.groupNoun})`);
    if (a.mother) {
      const m = this.sim.byId.get(a.mother);
      out.push(`<b>Mother</b> #${a.mother} ${m && m.alive ? (m.group === a.group ? '— alive, same group' : '— alive, different group') : '— no longer alive'}`);
    } else out.push('<b>Mother</b> not recorded (founding animal)');
    if (offspring) out.push(`<b>Offspring alive</b> ${offspring}${dependants ? ` (${dependants} still dependent)` : ''}`);
    const env = this.sim.env;
    const c = env.cellIndex(a.x, a.z);
    const pressures: string[] = [];
    if (a.hunger > 0.6) pressures.push('hungry');
    if (a.thirst > 0.6) pressures.push('thirsty');
    if (a.energy < 0.3) pressures.push('tired');
    if (a.fear > 0.3) pressures.push('alarmed');
    if (a.health < 0.6) pressures.push('in poor health');
    if (env.vegFrac(c) < 0.15 && sp.diet.veg > 0.5) pressures.push('on depleted forage');
    if (Number.isNaN(a.waterX)) pressures.push('knows no water source');
    out.push(`<b>Pressures</b> ${pressures.length ? pressures.join(', ') : 'none acute'}`);
    const mine = this.sessionLog.filter((e) => e.ids.includes(a.id)).slice(-3);
    for (const e of mine) out.push(`<b>Day ${Math.floor(e.day) % YEAR_DAYS + 1}</b> ${e.ids[0] === a.id ? e.text : 'was killed'}`);
    if (!mine.length) out.push('<i>No notable events observed this session.</i>');
    return out;
  }

  private updateCharts(): void {
    const hist = this.sim.history;
    if (hist.length < 2) return;
    const x0 = hist[0]!.day;
    const x1 = hist[hist.length - 1]!.day;
    drawChart($<HTMLCanvasElement>('chartPop'), SPECIES.map((_, i) => ({ color: SP_COLORS[i]!, values: hist.map((s) => s.pops[i]!) })), { x0, x1, unit: 'day' });
    drawChart($<HTMLCanvasElement>('chartEnv'), [
      { color: '#8fd16a', values: hist.map((s) => s.veg) }, { color: '#6fb3e0', values: hist.map((s) => s.moisture) },
    ], { yMax: 1, bars: hist.map((s) => s.rain), x0, x1, unit: 'day' });
    const cur = hist[hist.length - 1]!.pops;
    const short = ['pred.', 'starv.', 'thirst', 'age', 'other', 'toxic', 'exp.'];
    $('statTable').innerHTML = `<tr><th>Species</th><th>now</th><th>born</th>${short.map((s) => `<th title="${DEATH_CAUSES[short.indexOf(s)]}">${s}</th>`).join('')}</tr>` +
      SPECIES.map((s, i) => `<tr><td><i style="color:${SP_COLORS[i]}">●</i> ${s.name.split(' (')[0]}</td><td>${cur[i]}</td><td>${this.sim.births[i]}</td>${this.sim.deaths[i]!.map((d) => `<td>${d}</td>`).join('')}</tr>`).join('');
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.abort.abort();
    for (const u of this.unsub) u();
    this.curiosity.dispose();
    this.engine.dispose();
  }

  // ---------------------------------------------------------------- QA instrumentation
  /** Freeze visual time (wind, clouds, water) for repeatable screenshots; null resumes. */
  debugFreeze(t: number | null): void {
    this.frozenTime = t;
  }
  /** Mean and spread of luminance over a sparse pixel grid of a freshly rendered frame (blank-frame detection). */
  debugLuma(): { mean: number; std: number } {
    const r = this.engine.renderer;
    r.render(this.engine.scene, this.engine.camera);
    const gl = r.getContext();
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    const px = new Uint8Array(4);
    let sum = 0;
    let sq = 0;
    let n = 0;
    for (let j = 1; j < 12; j++) for (let i = 1; i < 20; i++) {
      gl.readPixels(Math.floor((w * i) / 20), Math.floor((h * j) / 12), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const l = (0.2126 * px[0]! + 0.7152 * px[1]! + 0.0722 * px[2]!) / 255;
      sum += l; sq += l * l; n++;
    }
    const mean = sum / n;
    return { mean, std: Math.sqrt(Math.max(0, sq / n - mean * mean)) };
  }
  debugGrounding(): { max: number; n: number } {
    return this.engine.animals.maxGroundError();
  }
  /** Fly the observer camera along a polyline at constant speed (deterministic benchmark paths). Resolves when done. */
  debugPath(points: [number, number][], speed: number, above = 12): Promise<void> {
    return new Promise((resolve) => {
      let seg = 0;
      let t = 0;
      let last = performance.now();
      const tick = (): void => {
        if (this.disposed) return resolve();
        const now = performance.now();
        // real elapsed time (capped), so a scripted route takes the same wall time however slow the renderer is
        const dt = Math.min(0.5, (now - last) / 1000);
        last = now;
        const a = points[seg]!;
        const b = points[seg + 1]!;
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        t += (speed * dt) / len;
        if (t >= 1) {
          t = 0;
          seg++;
          if (seg >= points.length - 1) return resolve();
        }
        const p = points[seg]!;
        const q = points[seg + 1]!;
        const x = p[0] + (q[0] - p[0]) * t;
        const z = p[1] + (q[1] - p[1]) * t;
        this.debugCam(x, z, above, Math.atan2(q[0] - p[0], q[1] - p[1]), -0.15);
        requestAnimationFrame(tick);
      };
      tick();
    });
  }
  debugPerfStart(): void {
    this.perf = { frame: [], sim: [], render: [] };
  }
  debugPerfStop(): { frame: number[]; sim: number[]; render: number[] } {
    const p = this.perf ?? { frame: [], sim: [], render: [] };
    this.perf = null;
    return p;
  }
  /** Full state of one animal (default: the controlled or selected one), plus what it is standing on. */
  debugAnimal(id = this.controlled || this.selected): (Animal & { ground: number; rendered: number | null; water: number; forage: number; blocked: boolean }) | null {
    const a = this.sim.byId.get(id);
    if (!a) return null;
    const v = this.sim.valley;
    const p = this.engine.animals.pos.get(a.id);
    return { ...a, ground: v.height(a.x, a.z), rendered: p ? p.y : null, water: this.sim.waterNear(a), forage: this.sim.env.vegFrac(this.sim.env.cellIndex(a.x, a.z)), blocked: v.blocked(a.x, a.z, 0) };
  }
  debugCamera(): { x: number; y: number; z: number; yaw: number; pitch: number; ground: number; speed: number } {
    return { x: this.cam.x, y: this.cam.y, z: this.cam.z, yaw: this.cam.yaw, pitch: this.cam.pitch, ground: this.sim.valley.height(this.cam.x, this.cam.z), speed: this.camSpeed };
  }
  /** Step the paused simulation to an exact tick with the standard 1x step and return its state hash. */
  debugStepTo(tick: number): number {
    this.sim.focus = this.cam;
    while (this.sim.tick < tick) this.sim.step(0.1);
    return this.sim.stateHash();
  }
  debugTerrain(): ReturnType<Engine['terrain']['debugState']> {
    return this.engine.terrain.debugState();
  }
  debugGfx(): { quality: string; ceiling: string; auto: boolean; resScale: number; frameMs: number; fpsTarget: number; divisor: number; refreshMs: number; calibrating: boolean; gpu: string; basis: string; calls: number; triangles: number; geometries: number; textures: number; chunks: number; heapMB: number | null } {
    const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
    return { quality: this.engine.quality.name, ceiling: this.engine.qualityCeiling, auto: this.engine.auto, resScale: this.engine.resScale, frameMs: this.engine.frameMs, fpsTarget: this.pacer.target, divisor: this.pacer.divisor,
      refreshMs: this.pacer.refreshMs, calibrating: this.engine.governor.calibrating, gpu: this.gfx.gpu, basis: this.gfx.basis, ...this.engine.info(), chunks: this.engine.terrain.loaded, heapMB: mem ? mem.usedJSHeapSize / 1048576 : null };
  }
  debugCuriosity(): { key: string | null; tag: string; switches: number; paused: boolean } {
    return { key: this.curiosity.subject?.key ?? null, tag: this.curiosity.tag, switches: this.curiosity.director.switches, paused: this.curiosity.paused };
  }

  /** For automated tests and debugging. */
  debugState(): { day: number; animals: number; pops: number[]; tick: number; fps: number; calls: number; mode: Mode; controlled: number; chunks: number } {
    return {
      day: this.sim.env.timeH / 24, animals: this.sim.animals.length, pops: SPECIES.map((_, i) => this.sim.population(i)), tick: this.sim.tick,
      fps: this.fps, calls: this.engine.info().calls, mode: this.mode, controlled: this.controlled, chunks: this.engine.terrain.loaded,
    };
  }
  debugCam(x: number, z: number, above: number, yaw: number, pitch: number): void {
    this.following = false;
    Object.assign(this.cam, { x, z, y: this.sim.valley.height(x, z) + above, yaw, pitch });
  }
  /** Select and follow the animal of a species nearest to the camera. */
  debugFollow(id: SpeciesId, dist = 6): boolean {
    let best: Animal | null = null;
    let bd = 1e18;
    for (const a of this.sim.animals) {
      if (SPECIES[a.sp]!.id !== id || !a.alive) continue;
      const d = (a.x - this.cam.x) ** 2 + (a.z - this.cam.z) ** 2;
      if (d < bd) ((bd = d), (best = a));
    }
    if (!best) return false;
    this.select(best.id);
    this.following = true;
    this.cam.dist = dist;
    this.refreshButtons();
    return true;
  }
  get qualityIndex(): number {
    return QUALITY_ORDER.indexOf(this.engine.quality.name);
  }
}
