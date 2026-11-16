import * as THREE from 'three';
import { clamp01 } from '@untamed/core';
import { Simulation } from '@untamed/ecology';
import { AnimalView } from './AnimalView';
import { GrassView } from './GrassView';
import { buildLandmarks } from './landmarks';
import { QUALITY, QualityName, QualityPreset } from './quality';
import { FpsTarget, GovernorStats, QualityChange, QualityGovernor } from './qualityGovernor';
import { ScatterView } from './ScatterView';
import { shared } from './shared';
import { Sky } from './Sky';
import { TerrainView } from './TerrainView';
import { WaterView } from './WaterView';
import { WeatherFx } from './WeatherFx';

export class GraphicsError extends Error {}

/**
 * One WebGLRenderer per canvas for the lifetime of the page.
 * Worlds are restarted on the same canvas, i.e. the same GL context. three.js does not delete all of its own
 * context objects in WebGLRenderer.dispose() (three scratch framebuffers and four placeholder textures were
 * measured leaking per renderer), so a renderer per world would grow the context without bound. Reusing the
 * renderer makes a restart release exactly what the world allocated: see tests/e2e/reliability.spec.ts.
 */
const renderers = new WeakMap<HTMLCanvasElement, THREE.WebGLRenderer>();
function acquireRenderer(canvas: HTMLCanvasElement): THREE.WebGLRenderer {
  let r = renderers.get(canvas);
  if (r) return r;
  try {
    r = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  } catch (e) {
    throw new GraphicsError(`WebGL2 could not be initialised (${e instanceof Error ? e.message : String(e)}).`);
  }
  if (!r.capabilities.isWebGL2) {
    r.dispose();
    throw new GraphicsError('This browser does not provide WebGL2.');
  }
  renderers.set(canvas, r);
  return r;
}

/** What the GL context reports about the graphics device. Strings may be masked by the browser. */
export function probeGraphics(canvas: HTMLCanvasElement): { renderer: string; vendor: string; maxTextureSize: number } {
  const gl = acquireRenderer(canvas).getContext();
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const str = (unmasked: number | undefined, masked: number): string => String((unmasked ? gl.getParameter(unmasked) : null) ?? gl.getParameter(masked) ?? '');
  return { renderer: str(ext?.UNMASKED_RENDERER_WEBGL, gl.RENDERER), vendor: str(ext?.UNMASKED_VENDOR_WEBGL, gl.VENDOR), maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number };
}

/**
 * Owns the WebGL renderer and every view. Views read simulation state; nothing here writes to it.
 * The only renderer-specific types that escape this module are the camera and picking results,
 * which keeps a future WebGPU backend a contained change.
 */
export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(62, 1, 0.25, 3000);
  readonly sky = new Sky();
  readonly terrain: TerrainView;
  readonly scatter: ScatterView;
  readonly grass: GrassView;
  readonly water: WaterView;
  readonly animals: AnimalView;
  readonly weather: WeatherFx;
  quality: QualityPreset;
  readonly governor: QualityGovernor;
  /** The governor only samples once the world is ready: loading frames are not representative. */
  private adapting = false;
  get auto(): boolean {
    return this.governor.auto;
  }
  /** Turning Auto off returns to exactly the preset the player chose (the ceiling) at full resolution. */
  set auto(value: boolean) {
    if (value === this.governor.auto) return;
    if (value) this.governor.setAuto(true);
    else this.setQuality(this.governor.ceiling, false);
  }
  get resScale(): number {
    return this.governor.scale;
  }
  get qualityCeiling(): QualityName {
    return this.governor.ceiling;
  }
  get frameMs(): number {
    return this.governor.frameMs;
  }
  onQualityChange: (() => void) | null = null;
  private readonly fog = new THREE.FogExp2(0x9ab0c0, 0.002);
  private thunderCb: (() => void) | null = null;
  private readonly landmarks: THREE.Mesh;
  private disposed = false;
  private nextFlash = 5;

  /** @param ceiling highest preset Auto may climb to (defaults to the starting preset). */
  constructor(readonly canvas: HTMLCanvasElement, private readonly sim: Simulation, quality: QualityName, ceiling: QualityName = quality) {
    this.renderer = acquireRenderer(canvas);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.scene.fog = this.fog;
    this.governor = new QualityGovernor(quality, ceiling);
    this.quality = QUALITY[quality];

    const valley = sim.valley;
    this.terrain = new TerrainView(valley);
    this.scatter = new ScatterView(valley);
    this.grass = new GrassView(valley, sim.env, QUALITY[quality].grassCount);
    this.water = new WaterView(valley);
    this.animals = new AnimalView(sim);
    this.weather = new WeatherFx(QUALITY.ultra.rain);
    const lm = new THREE.Mesh(buildLandmarks(valley), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0.05, flatShading: true }));
    lm.castShadow = true;
    lm.receiveShadow = true;
    this.landmarks = lm;
    this.scene.add(this.sky.mesh, this.sky.sun, this.sky.sun.target, this.sky.hemi, this.terrain.group, this.scatter.group, this.grass.group,
      this.water.mesh, this.water.pools, this.animals.group, this.weather.rain, lm);
    this.applyQuality();
    this.resize();
  }

  /** Start adapting to measured frame times, beginning with a short bounded calibration. Call when the world is ready. */
  beginAdaptation(): void {
    this.adapting = true;
    this.governor.beginCalibration();
  }
  setFpsTarget(fps: FpsTarget): void {
    this.governor.setTarget(fps);
  }

  setQuality(name: QualityName, auto = this.auto): void {
    this.governor.setQuality(name, auto);
    this.quality = QUALITY[name];
    this.applyQuality();
    this.onQualityChange?.();
  }

  private applyQuality(): void {
    const q = this.quality;
    this.terrain.viewDist = q.viewDist;
    this.camera.far = q.viewDist * 1.5 + 300;
    this.camera.updateProjectionMatrix();
    this.scatter.vegDist = q.vegDist;
    this.scatter.treeHiDist = q.treeHiDist;
    this.scatter.shadows = q.shadowMap > 0;
    this.scatter.invalidate();
    this.grass.dist = q.grassDist;
    this.grass.setMax(q.grassCount);
    this.weather.setDensity(q.rain);
    const sun = this.sky.sun;
    sun.castShadow = q.shadowMap > 0;
    if (q.shadowMap > 0) {
      if (sun.shadow.mapSize.x !== q.shadowMap) {
        sun.shadow.mapSize.set(q.shadowMap, q.shadowMap);
        sun.shadow.map?.dispose();
        sun.shadow.map = null;
      }
      const c = sun.shadow.camera;
      c.left = c.bottom = -q.shadowDist;
      c.right = c.top = q.shadowDist;
      c.near = 50;
      c.far = 800;
      c.updateProjectionMatrix();
      sun.shadow.bias = -0.0004;
      sun.shadow.normalBias = 0.5 * (q.shadowDist / 100);
    }
    this.applyResolution();
  }

  private applyResolution(): void {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.quality.pixelRatio) * this.resScale);
  }

  resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  onThunder(cb: () => void): void {
    this.thunderCb = cb;
  }

  /**
   * Renderer-independent quality decisions can be tested without a WebGL context.
   * The governor retains the initial/user quality ceiling across automatic downgrades.
   */
  private adapt(dt: number): void {
    if (!this.adapting) return;
    this.applyChange(this.governor.sample(dt, document.hidden));
  }

  private applyChange(changed: QualityChange): void {
    if (changed === 'none') return;
    if (changed === 'preset') {
      this.quality = QUALITY[this.governor.quality];
      this.applyQuality();
    } else {
      this.applyResolution();
    }
    this.onQualityChange?.();
  }

  /**
   * QA: drive the governor with a synthetic frame-time trace through the same path real frames take, so a
   * test can check that its decisions really change renderer settings. Real sampling stops for good once
   * this is used, so the trace is the only evidence the governor sees.
   */
  debugFeed(frameMs: number, seconds: number, model: 'constant' | 'render' = 'constant'): { changes: string[]; quality: QualityName; scale: number; pixelRatio: number; viewDist: number; vegDist: number; shadows: boolean; stats: GovernorStats } {
    this.adapting = false;
    const changes: string[] = [];
    // 'render': a render-bound device whose frame time follows preset and resolution (relative to where it starts);
    // 'constant': frame time rendering settings cannot change (e.g. main-thread work)
    const cost = (): number => ({ low: 0.5, medium: 0.75, high: 1, ultra: 1.3 }[this.governor.quality]) * (0.35 + 0.65 * this.governor.scale ** 2);
    const c0 = cost();
    for (let t = 0; t < seconds * 1000;) {
      const ms = model === 'render' ? (frameMs * cost()) / c0 : frameMs;
      t += ms;
      const c = this.governor.sample(ms / 1000, false);
      if (c !== 'none') {
        this.applyChange(c);
        changes.push(`${c}:${this.governor.quality}@${this.governor.scale}`);
      }
    }
    return { changes, quality: this.quality.name, scale: this.governor.scale, pixelRatio: this.renderer.getPixelRatio(), viewDist: this.terrain.viewDist, vegDist: this.scatter.vegDist, shadows: this.sky.sun.castShadow, stats: this.governor.stats };
  }

  frame(dtReal: number, alpha: number, time: number, selected: number, simRate: number, highlightGroup = 0): void {
    const env = this.sim.env;
    const cam = this.camera.position;
    this.adapt(dtReal);
    shared.uTime.value = time;
    shared.uWind.value = env.wind;
    shared.uDry.value = clamp01((0.5 - env.meanMoisture) / 0.4) * 0.85 + clamp01(0.5 - env.totalVeg / env.totalCap) * 0.3;
    shared.uWet.value = clamp01(env.rain / 4);
    // lightning: only in storms, only at watchable time rates
    if (env.weather === 'storm' && simRate > 0 && simRate <= 10) {
      this.nextFlash -= dtReal;
      if (this.nextFlash <= 0) {
        this.nextFlash = 4 + Math.random() * 14;
        this.sky.flash = 1;
        this.thunderCb?.();
      }
    }
    this.sky.update(env, this.camera, time, this.quality.shadowDist);
    this.renderer.toneMappingExposure = this.sky.exposure;
    this.fog.color.copy(this.sky.fogColor);
    this.fog.density = this.sky.fogDensity(env, this.quality.viewDist);
    this.renderer.setClearColor(this.sky.fogColor);
    this.terrain.update(cam);
    this.scatter.update(this.camera);
    this.grass.update(cam, env.timeH);
    const day = env.daylight();
    this.water.update(env.stage, env.rain, this.sky, this.quality.waterDetail, day);
    this.animals.update(cam, alpha, dtReal, time, Math.min(this.quality.viewDist, 900), selected, highlightGroup);
    this.weather.update(cam, env.rain, env.wind, env.windDir, day);
    this.renderer.render(this.scene, this.camera);
  }

  info(): { calls: number; triangles: number; geometries: number; textures: number } {
    const i = this.renderer.info;
    return { calls: i.render.calls, triangles: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures };
  }

  /** A Game can be restarted repeatedly on the same canvas; every owner must release its resources. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.thunderCb = null;
    this.onQualityChange = null;
    this.terrain.dispose();
    this.scatter.dispose();
    this.grass.dispose();
    this.water.dispose();
    this.animals.dispose();
    this.weather.dispose();
    this.sky.dispose();
    this.landmarks.geometry.dispose();
    const materials = Array.isArray(this.landmarks.material) ? this.landmarks.material : [this.landmarks.material];
    for (const material of materials) material.dispose();
    this.scene.clear();
    // the renderer itself is shared across worlds (see acquireRenderer); drop only what refers to this scene
    this.renderer.renderLists.dispose();
    this.renderer.setRenderTarget(null);
    this.renderer.info.reset();
  }
}
