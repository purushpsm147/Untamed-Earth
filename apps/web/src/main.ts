import './style.css';
import { SAVE_VERSION } from '@untamed/ecology';
import { SaveStore, openEnvelope } from '@untamed/persistence';
import { AudioEngine } from './audio/AudioEngine';
import { Game, GraphicsChoice, SAVE_FORMAT, SAVE_SLOT, SaveData, parseSeed, toast } from './game/Game';
import { CLASSIFICATION_LABEL, WORLDS, getWorld } from './game/worldRegistry';
import { Input } from './input/Input';
import { GraphicsError, probeGraphics } from './render/Engine';
import { QUALITY_ORDER, QualityName, assessQuality, readHardwareHints } from './render/quality';
import { FpsTarget } from './render/qualityGovernor';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const params = new URLSearchParams(location.search);
const profiling = params.has('profile');
/** ?scenario=documentary: fixed seed, time and camera for repeatable reviews (src/scenario/documentary.ts). */
const documentary = params.get('scenario') === 'documentary';
/** ?boundary=open: experimental open valley boundary for a new world (issue #29; default closed). */
const openBoundary = params.get('boundary') === 'open';
// the WebGL object counter must wrap the context before the first one is created
let glCounts: (() => import('./profile/glCounter').GlCounts) | null = null;
if (profiling) glCounts = (await import('./profile/glCounter')).installGlCounter();
const canvas = $<HTMLCanvasElement>('view');
const input = new Input(canvas, $('stick'));
const audio = new AudioEngine();
let game: Game | null = null;
/** Called once each time a world becomes ready (used by the profiler to sequence restarts). */
let onReady: ((g: Game) => void) | null = null;

interface Settings {
  quality?: QualityName;
  auto?: boolean;
  volume?: number;
  muted?: boolean;
  music?: number;
  reducedMotion?: boolean;
  fps?: FpsTarget | 0;
}
function readSettings(): Settings {
  try {
    return JSON.parse(localStorage.getItem('untamed.settings') ?? '{}') as Settings;
  } catch {
    return {};
  }
}

function fatal(msg: string): void {
  input.enabled = false;
  $('fatalText').textContent = msg;
  $('fatal').classList.remove('hidden');
  $('loading').classList.add('hidden');
}

let worldId = WORLDS[0]!.id;
// the destination list is rendered from the registry; the shell knows nothing else about worlds
$('library').innerHTML = WORLDS.map((w, i) =>
  `<button class="world${i === 0 ? ' on' : ''}" role="radio" aria-checked="${i === 0}" data-world="${w.id}"><em>${CLASSIFICATION_LABEL[w.classification]}</em><b>${w.name}</b><span>${w.tagline} · ${w.areaKm2} km² · ${w.creatures.length} species</span></button>`).join('');
document.querySelectorAll<HTMLButtonElement>('.world').forEach((b) => b.addEventListener('click', () => {
  worldId = b.dataset.world!;
  document.querySelectorAll<HTMLButtonElement>('.world').forEach((o) => {
    o.classList.toggle('on', o === b);
    o.setAttribute('aria-checked', String(o === b));
  });
  $<HTMLInputElement>('seed').value = String(getWorld(worldId)!.defaultSeed);
}));

function start(seed: number, save?: SaveData): void {
  const st = readSettings();
  const world = getWorld(save?.worldId ?? worldId);
  if (!world) {
    fatal(`This save belongs to a world ("${save?.worldId}") that this build does not include.`);
    return;
  }
  const choice = $<HTMLSelectElement>('startQuality').value;
  game?.dispose();
  game = null;
  input.enabled = false;
  $('start').classList.add('hidden');
  $('menu').classList.add('hidden');
  $('hud').classList.add('hidden');
  $('loading').classList.remove('hidden');
  $('loadText').textContent = 'Growing the valley…';
  $('loadBar').style.width = '5%';
  // let the loading card paint before the synchronous world build
  setTimeout(async () => {
    try {
      // Initial hardware assessment: capability hints plus what the GL context says about the GPU. Hints are
      // approximate by nature; the runtime governor corrects the choice from measured frame times.
      const gpu = probeGraphics(canvas);
      const assessed = assessQuality(readHardwareHints(gpu.renderer));
      let gfx: GraphicsChoice;
      if (choice !== 'auto') {
        // an explicit preset is a manual override: fixed quality, no adaptation
        gfx = { initial: choice as QualityName, ceiling: choice as QualityName, auto: false, fps: st.fps ?? assessed.fps, basis: 'chosen manually', gpu: gpu.renderer };
      } else {
        // Auto: a ceiling the player set earlier while in Auto is respected; otherwise the assessment's.
        const ceiling = st.auto !== false && st.quality ? st.quality : assessed.ceiling;
        const initial = QUALITY_ORDER[Math.min(QUALITY_ORDER.indexOf(ceiling), QUALITY_ORDER.indexOf(assessed.initial))]!;
        gfx = { initial, ceiling, auto: true, fps: st.fps ?? assessed.fps, basis: assessed.reasons.join('; '), gpu: gpu.renderer };
      }
      const sim = await world.load(seed, save?.sim);
      if (openBoundary && !save && sim.tick === 0) sim.configureBoundary({ open: true });
      let scene: import('./scenario/documentary').DocumentaryStart | null = null;
      if (documentary && !save && seed === (await import('./scenario/documentary')).DOCUMENTARY.seed) {
        const d = await import('./scenario/documentary');
        $('loadText').textContent = 'Letting the afternoon pass…';
        d.advanceToScenario(sim);
        scene = d.documentaryPose(sim);
      }
      game = new Game(canvas, sim, world.id, gfx, input, audio, { fatal, restart: start }, save);
      if (scene) {
        game.setCameraPose(scene.pose);
        (window as unknown as { __scenario: unknown }).__scenario = scene;
      }
      game.curiosity.reducedMotion = st.reducedMotion ?? window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      $<HTMLInputElement>('mMotion').checked = game.curiosity.reducedMotion;
    } catch (e) {
      console.error(e);
      fatal(e instanceof GraphicsError
        ? `${e.message} Untamed Earth needs WebGL2: try a current version of Chrome, Edge, Firefox or Safari, and make sure hardware acceleration is enabled.`
        : `The world could not be created: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    (window as unknown as { __untamed: Game }).__untamed = game;
    const g = game;
    const t0 = performance.now();
    // watchdog: a slow device may legitimately take a long time, so only a stall (no progress) is an error
    let best = -1;
    let bestAt = t0;
    const poll = (): void => {
      if (game !== g) return;
      const p = g.loadProgress();
      $('loadBar').style.width = `${Math.round(5 + p * 95)}%`;
      $('loadText').textContent = 'Raising terrain…';
      if (p > 0.97 && performance.now() - t0 > 400) {
        $('loading').classList.add('hidden');
        $('hud').classList.remove('hidden');
        g.ready = true;
        g.engine.beginAdaptation();
        // ?qa=1 starts paused at tick 0 so automated screenshots and benchmarks begin from an identical state
        if (new URLSearchParams(location.search).has('qa')) g.setSpeed(0);
        input.enabled = true;
        if (audio.error) toast(audio.error, true);
        onReady?.(g);
      } else if (p > best) {
        best = p;
        bestAt = performance.now();
        setTimeout(poll, 100);
      } else if (performance.now() - bestAt > 25000) fatal('Terrain generation has stalled. Reload and try the Low graphics preset.');
      else setTimeout(poll, 100);
    };
    poll();
  }, 30);
}

if (documentary) {
  void import('./scenario/documentary').then((d) => {
    $<HTMLInputElement>('seed').value = String(d.DOCUMENTARY.seed);
    $('startNote').textContent = `Documentary scenario: seed ${d.DOCUMENTARY.seed}, day 34 at ${Math.floor(d.DOCUMENTARY.hour)}:${String(Math.round((d.DOCUMENTARY.hour % 1) * 60)).padStart(2, '0')}, camera on the largest chital herd. Nothing is scripted after that.`;
  });
}

const st = readSettings();
// Restore an explicit manual preset on the start screen; otherwise Auto is selected.
$<HTMLSelectElement>('startQuality').value = st.auto === false && st.quality ? st.quality : 'auto';
audio.setVolume(st.volume ?? 0.7);
audio.muted = st.muted ?? false;
$<HTMLInputElement>('mVolume').value = String(st.volume ?? 0.7);
audio.setMusic(st.music ?? 0);
$<HTMLInputElement>('mMusic').value = String(st.music ?? 0);

$('btnNew').addEventListener('click', () => {
  audio.start();
  start(parseSeed($<HTMLInputElement>('seed').value));
});
$('btnReload').addEventListener('click', () => location.reload());

// offer "Continue" only if a readable save exists; storage problems are reported, not fatal
const store = new SaveStore();
store.get<unknown>(SAVE_SLOT).then((raw) => {
  if (!raw) return;
  try {
    const data = openEnvelope<SaveData>(raw, SAVE_FORMAT, SAVE_VERSION);
    data.worldId ??= WORLDS[0]!.id; // saves from before the world library
    const b = $('btnContinue');
    b.classList.remove('hidden');
    b.textContent = `Continue (seed ${data.sim.seed}, day ${Math.floor(data.sim.env.timeH / 24)})`;
    b.addEventListener('click', () => {
      audio.start();
      start(data.sim.seed, data);
    });
  } catch (e) {
    $('startNote').textContent = `Saved world ignored: ${e instanceof Error ? e.message : String(e)}`;
  }
}).catch((e: unknown) => {
  $('startNote').textContent = `Saving is unavailable: ${e instanceof Error ? e.message : String(e)} You can still play.`;
});

window.addEventListener('error', (e) => {
  if (game && !$('hud').classList.contains('hidden')) console.error(e.error);
});

// ---------------------------------------------------------------- ?profile=1
if (profiling) {
  const panel = document.createElement('div');
  panel.id = 'profilePanel';
  panel.style.cssText = 'position:fixed;left:12px;top:64px;z-index:30;max-width:460px;max-height:70vh;overflow:auto;background:rgba(10,14,12,.88);color:#cfe3b6;font:12px/1.5 ui-monospace,monospace;padding:10px 12px;border-radius:8px;white-space:pre-wrap';
  panel.textContent = 'Profiling: press "Enter the valley" (Auto is fine). The run takes about 5 minutes; keep this tab visible.\n';
  document.body.appendChild(panel);
  const log = (l: string): void => {
    panel.textContent += l + '\n';
    console.log('[profile]', l);
  };
  let firstReady = true;
  onReady = (g) => {
    if (!firstReady) return;
    firstReady = false;
    void (async () => {
      const { runProfile } = await import('./profile/ProfileRunner');
      const seed = g.sim.seed;
      const report = await runProfile({
        game: () => game,
        gl: () => glCounts!(),
        restart: () => new Promise<Game>((resolve) => {
          onReady = (ng) => resolve(ng);
          start(seed);
        }),
      }, params.has('short'), log);
      onReady = null;
      (window as unknown as { __profile: unknown }).__profile = report;
      const json = JSON.stringify(report, null, 2);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      a.download = `untamed-earth-profile-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
      a.textContent = 'Download report (JSON)';
      a.style.cssText = 'display:inline-block;margin:6px 8px 0 0;color:#b9d98a';
      const copy = document.createElement('button');
      copy.textContent = 'Copy report';
      copy.onclick = () => void navigator.clipboard?.writeText(json);
      log('Done.');
      panel.append(a, copy);
    })().catch((e: unknown) => log(`Profiling failed: ${e instanceof Error ? e.message : String(e)}`));
  };
}
