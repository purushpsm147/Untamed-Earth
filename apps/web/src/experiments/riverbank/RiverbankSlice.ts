/**
 * Riverbank vertical slice harness — EXPERIMENT, loaded only with `/?slice=riverbank`.
 *
 * Baseline and naturalistic modes render the SAME production Engine on the SAME simulation state, seed, weather,
 * time of day and camera pose. The naturalistic mode only swaps/patches presentation views (see naturalEnvironment.ts
 * and NaturalChitalView.ts). Nothing writes to the simulation; the camera moves, animals are never placed.
 *
 * URL: /?slice=riverbank&scene=evening|morning|midday&shot=hero|vista|side&mode=baseline|natural&quality=high
 * Automation hook: window.__slice (see SliceApi).
 */
import * as THREE from 'three';
import { SPECIES, Simulation, behaviorFamily } from '@untamed/ecology';
import { WORLDS, getWorld } from '../../game/worldRegistry';
import { Engine } from '../../render/Engine';
import { QualityName } from '../../render/quality';
import { NaturalChitalView } from './NaturalChitalView';
import { NaturalEnvironment } from './naturalEnvironment';

/** Fixed scenes: seed plus a time of day reached by ordinary simulation from tick 0 (1 s steps). Weather follows the seed. */
export const SCENES = {
  evening: { seed: 2, hour: 17.5, note: 'clear, golden hour; chital drinking at the river (seed 2 = documentary seed)' },
  morning: { seed: 6, hour: 8.0, note: 'clear morning; chital on the bank' },
  midday: { seed: 6, hour: 11.0, note: 'clear late morning, high sun' },
} as const;
export type SceneId = keyof typeof SCENES;
export type ShotId = 'hero' | 'vista' | 'side';
export type Mode = 'baseline' | 'natural';

export interface ShotPose { x: number; y: number; z: number; tx: number; ty: number; tz: number; fov: number; hero: number }

export interface SliceApi {
  ready: Promise<void>;
  /** Render one frame. stepSim advances the simulation like Game at speed 1 (0.1 s ticks, interpolated). */
  frame(dt: number, stepSim: boolean, follow?: boolean): void;
  info(): Record<string, unknown>;
  settle(maxFrames?: number): Promise<number>;
  /**
   * Frame timing over n frames (simulation frozen): `submit` = CPU time of the frame call (scene + post submission);
   * `complete` = the same plus a 1-pixel readPixels fence, which waits for the GPU (or software rasteriser) to finish.
   */
  perf(n: number): { submit: Stats; complete: Stats };
  dispose(): void;
}

const TICK = 0.1;

export interface Stats { n: number; p50: number; p95: number; max: number; mean: number }
function stats(v: number[]): Stats {
  const s = [...v].sort((a, b) => a - b);
  const q = (f: number): number => s[Math.min(s.length - 1, Math.floor(f * s.length))]!;
  return { n: s.length, p50: q(0.5), p95: q(0.95), max: s[s.length - 1]!, mean: s.reduce((a, b) => a + b, 0) / s.length };
}

/** Advance a fresh world to the scene hour with the same fixed 1 s step the documentary scenario uses. */
export function advanceTo(sim: Simulation, hour: number): void {
  const target = Math.floor(sim.env.timeH / 24) * 24 + hour;
  while (sim.env.timeH < target - 1e-9) sim.step(1);
}

/** Hero: a drinking chital if any, otherwise the chital on dry ground closest to the river. Deterministic. */
export function pickHero(sim: Simulation): number {
  let best = -1;
  let bestScore = Infinity;
  for (const a of sim.animals) {
    if (!a.alive || SPECIES[a.sp]!.id !== 'chital') continue;
    const wd = sim.valley.waterDepth(a.x, a.z, sim.env.stage);
    const riverD = Math.abs(a.x - sim.valley.riverX(a.z));
    const score = (behaviorFamily(a) === 'drink' ? 0 : 1000) + (wd > 0.05 ? 500 : 0) + riverD + (a.age < 200 ? 50 : 0);
    if (score < bestScore) { bestScore = score; best = a.id; }
  }
  return best;
}

function lineClear(sim: Simulation, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): boolean {
  for (let i = 1; i < 24; i++) {
    const t = i / 24;
    const x = x0 + (x1 - x0) * t;
    const z = z0 + (z1 - z0) * t;
    if (sim.valley.height(x, z) > y0 + (y1 - y0) * t - 0.15) return false;
  }
  return true;
}

/**
 * Camera for a shot, derived from where the hero is (the camera moves; animals do not). Candidates on a ring around
 * the hero; must be on dry ground with clear terrain line of sight; prefers the river behind the subject.
 */
export function shotPose(sim: Simulation, heroId: number, shot: ShotId): ShotPose {
  const a = sim.animals.find((q) => q.id === heroId)!;
  const v = sim.valley;
  const dist = shot === 'hero' ? 11 : shot === 'side' ? 6.5 : 30;
  const eye = shot === 'vista' ? 2.6 : shot === 'hero' ? 1.15 : 0.95;
  const fov = shot === 'hero' ? 26 : shot === 'side' ? 30 : 48;
  const hy = v.height(a.x, a.z) + 0.65;
  const riverDir = Math.sign(v.riverX(a.z) - a.x) || 1;
  let best: ShotPose | null = null;
  let bestScore = -Infinity;
  for (let k = 0; k < 48; k++) {
    const ang = (k / 48) * Math.PI * 2;
    const cx = a.x + Math.sin(ang) * dist;
    const cz = a.z + Math.cos(ang) * dist;
    if (v.waterDepth(cx, cz, sim.env.stage) > -0.15) continue;
    const gy = v.height(cx, cz);
    const cy = gy + eye;
    if (!lineClear(sim, cx, cy, cz, a.x, hy, a.z)) continue;
    // looking toward the river from the dry side; side shot prefers a profile view of the animal
    const toHeroX = (a.x - cx) / dist;
    let score = toHeroX * riverDir * 2;
    if (shot === 'side') score += 2 * Math.abs(Math.sin(ang - a.heading));
    if (shot === 'vista') score += Math.abs(Math.cos(ang)) * 1.5; // look along the river reach
    score -= Math.abs(gy - v.height(a.x, a.z)) * 0.2;
    if (score > bestScore) { bestScore = score; best = { x: cx, y: cy, z: cz, tx: a.x, ty: hy, tz: a.z, fov, hero: heroId }; }
  }
  if (!best) throw new Error(`no valid ${shot} camera around chital ${heroId}`);
  return best;
}

export async function startRiverbankSlice(canvas: HTMLCanvasElement, params: URLSearchParams): Promise<SliceApi> {
  for (const id of ['start', 'menu', 'hud', 'loading']) document.getElementById(id)?.classList.add('hidden');
  const sceneId = (params.get('scene') ?? 'evening') as SceneId;
  const scene = SCENES[sceneId] ?? SCENES.evening;
  const shot = (params.get('shot') ?? 'hero') as ShotId;
  const mode = (params.get('mode') ?? 'natural') as Mode;
  const quality = (params.get('quality') ?? 'high') as QualityName;
  const world = getWorld(WORLDS[0]!.id)!;
  const sim = await world.load(scene.seed);
  advanceTo(sim, scene.hour);
  const heroId = pickHero(sim);
  const pose = shotPose(sim, heroId, shot);
  // fixed quality, no adaptation: both modes render the same preset
  const engine = new Engine(canvas, sim, quality, quality);
  const cam = engine.camera;
  cam.fov = pose.fov;
  cam.position.set(pose.x, pose.y, pose.z);
  cam.lookAt(pose.tx, pose.ty, pose.tz);
  cam.updateProjectionMatrix();
  const target = new THREE.Vector3(pose.tx, pose.ty, pose.tz);
  const camOffset = new THREE.Vector3(pose.x - pose.tx, pose.y - pose.ty, pose.z - pose.tz);
  let chital: NaturalChitalView | null = null;
  let env: NaturalEnvironment | null = null;
  if (mode === 'natural') {
    env = new NaturalEnvironment(engine, sim);
    chital = new NaturalChitalView(sim, engine.quality.shadowMap > 0);
    engine.scene.add(chital.group);
    env.hideProductionChital();
  }
  const resize = (): void => {
    engine.resize();
    cam.fov = pose.fov;
    cam.updateProjectionMatrix();
    env?.resize();
  };
  window.addEventListener('resize', resize);
  resize();
  let time = 0;
  let acc = 0;
  let alpha = 1;
  let frames = 0;
  let disposed = false;
  let sceneInfo = engine.info();
  const api: SliceApi = {
    ready: Promise.resolve(),
    frame(dt: number, stepSim: boolean, follow = false): void {
      if (disposed) return;
      time += dt;
      if (stepSim) {
        acc += dt;
        while (acc >= TICK) { sim.step(TICK); acc -= TICK; }
        alpha = acc / TICK;
      }
      if (follow) {
        const a = sim.animals.find((q) => q.id === heroId);
        if (a && a.alive) {
          const x = a.px + (a.x - a.px) * alpha;
          const z = a.pz + (a.z - a.pz) * alpha;
          const k = Math.min(1, dt * 1.5);
          target.lerp(new THREE.Vector3(x, sim.valley.height(x, z) + 0.65, z), k);
          const want = target.clone().add(camOffset);
          want.y = Math.max(want.y, sim.valley.height(want.x, want.z) + 0.8);
          cam.position.lerp(want, k);
          cam.lookAt(target);
        }
      }
      chital?.update(cam.position, alpha, dt, time, Math.min(engine.quality.viewDist, 600));
      env?.beforeFrame(dt, time);
      engine.frame(dt, alpha, time, 0, stepSim ? 1 : 0);
      sceneInfo = engine.info();
      env?.afterFrame();
      frames++;
    },
    async settle(maxFrames = 600): Promise<number> {
      // terrain streams in a worker; render (without advancing the simulation) until every wanted chunk is at its LOD
      let n = 0;
      for (; n < maxFrames; n++) {
        api.frame(1 / 30, false);
        const t = engine.terrain.debugState();
        if (n > 20 && t.mismatched === 0 && t.queued === 0 && t.inFlight === 0 && (env?.ready() ?? true)) break;
        await new Promise((r) => setTimeout(r, 0));
      }
      // let pose smoothing settle with the simulation frozen
      for (let i = 0; i < 45; i++) api.frame(1 / 30, false);
      return n;
    },
    info(): Record<string, unknown> {
      const a = sim.animals.find((q) => q.id === heroId)!;
      return {
        mode, scene: sceneId, seed: scene.seed, hour: scene.hour, shot, quality, tick: sim.tick, timeH: sim.env.timeH,
        weather: sim.env.weather, cloud: sim.env.cloud, hero: { id: heroId, x: a.x, z: a.z, behaviour: behaviorFamily(a), sex: a.sex, age: a.age },
        pose, frames, render: sceneInfo, postPass: env?.stats().post ?? false, grassInstances: engine.grass.mesh.count, chital: chital?.stats ?? null, env: env?.stats() ?? null,
        viewport: { w: canvas.clientWidth, h: canvas.clientHeight, pixelRatio: engine.renderer.getPixelRatio() },
        gpu: (() => {
          const gl = engine.renderer.getContext();
          const ext = gl.getExtension('WEBGL_debug_renderer_info');
          return String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
        })(),
        gl: { ...engine.renderer.info.memory, programs: engine.renderer.info.programs?.length ?? 0 },
      };
    },
    perf(n: number): { submit: Stats; complete: Stats } {
      const gl = engine.renderer.getContext();
      const px = new Uint8Array(4);
      const sub: number[] = [];
      const done: number[] = [];
      for (let i = 0; i < n; i++) {
        const t0 = performance.now();
        api.frame(1 / 30, false);
        const t1 = performance.now();
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        const t2 = performance.now();
        sub.push(t1 - t0);
        done.push(t2 - t0);
      }
      return { submit: stats(sub), complete: stats(done) };
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      window.removeEventListener('resize', resize);
      chital?.dispose();
      env?.dispose();
      engine.dispose();
    },
  };
  const w = window as unknown as { __slice: SliceApi; __sliceRestart: () => Promise<SliceApi> };
  w.__slice = api;
  // QA: dispose this slice and start a fresh one on the same canvas (GPU lifecycle check)
  w.__sliceRestart = async () => {
    api.dispose();
    return startRiverbankSlice(canvas, params);
  };
  return api;
}
