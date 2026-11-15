import './style.css';
import { SAVE_VERSION } from '@untamed/ecology';
import { SaveStore, openEnvelope } from '@untamed/persistence';
import { AudioEngine } from './audio/AudioEngine';
import { Game, SAVE_FORMAT, SAVE_SLOT, SaveData, parseSeed, toast } from './game/Game';
import { CLASSIFICATION_LABEL, WORLDS, getWorld } from './game/worldRegistry';
import { Input } from './input/Input';
import { GraphicsError } from './render/Engine';
import { QualityName, guessQuality } from './render/quality';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('view');
const input = new Input(canvas, $('stick'));
const audio = new AudioEngine();
let game: Game | null = null;

interface Settings {
  quality?: QualityName;
  auto?: boolean;
  volume?: number;
  muted?: boolean;
  music?: number;
  reducedMotion?: boolean;
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
  const quality: QualityName = choice !== 'auto' ? (choice as QualityName) : (st.quality ?? guessQuality());
  const auto = choice === 'auto' ? (st.auto ?? true) : false;
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
      const sim = await world.load(seed, save?.sim);
      game = new Game(canvas, sim, world.id, quality, auto, input, audio, { fatal, restart: start }, save);
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
        // ?qa=1 starts paused at tick 0 so automated screenshots and benchmarks begin from an identical state
        if (new URLSearchParams(location.search).has('qa')) g.setSpeed(0);
        input.enabled = true;
        if (audio.error) toast(audio.error, true);
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

const st = readSettings();
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
