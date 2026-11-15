import * as THREE from 'three';
import { clamp01 } from '@untamed/core';
import { Simulation } from '@untamed/ecology';
import { AnimalView } from './AnimalView';
import { GrassView } from './GrassView';
import { buildLandmarks } from './landmarks';
import { QUALITY, QUALITY_ORDER, QualityName, QualityPreset } from './quality';
import { ScatterView } from './ScatterView';
import { shared } from './shared';
import { Sky } from './Sky';
import { TerrainView } from './TerrainView';
import { WaterView } from './WaterView';
import { WeatherFx } from './WeatherFx';

export class GraphicsError extends Error {}

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
  auto = true;
  resScale = 1;
  frameMs = 16.7;
  onQualityChange: (() => void) | null = null;
  private slowT = 0;
  private fastT = 0;
  private upWait = 8;
  private sinceRaise = 99;
  private readonly fog = new THREE.FogExp2(0x9ab0c0, 0.002);
  private thunderCb: (() => void) | null = null;
  private nextFlash = 5;

  constructor(readonly canvas: HTMLCanvasElement, private readonly sim: Simulation, quality: QualityName) {
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    } catch (e) {
      throw new GraphicsError(`WebGL2 could not be initialised (${e instanceof Error ? e.message : String(e)}).`);
    }
    if (!this.renderer.capabilities.isWebGL2) throw new GraphicsError('This browser does not provide WebGL2.');
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.scene.fog = this.fog;
    this.quality = QUALITY[quality];

    const valley = sim.valley;
    this.terrain = new TerrainView(valley);
    this.scatter = new ScatterView(valley);
    this.grass = new GrassView(valley, sim.env, QUALITY.ultra.grassCount);
    this.water = new WaterView(valley);
    this.animals = new AnimalView(sim);
    this.weather = new WeatherFx(QUALITY.ultra.rain);
    const lm = new THREE.Mesh(buildLandmarks(valley), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0.05, flatShading: true }));
    lm.castShadow = true;
    lm.receiveShadow = true;
    this.scene.add(this.sky.mesh, this.sky.sun, this.sky.sun.target, this.sky.hemi, this.terrain.group, this.scatter.group, this.grass.mesh,
      this.water.mesh, this.water.pools, this.animals.group, this.weather.rain, lm);
    this.applyQuality();
    this.resize();
  }

  setQuality(name: QualityName, auto = this.auto): void {
    this.quality = QUALITY[name];
    this.auto = auto;
    this.resScale = 1;
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
   * Resolution-first adaptation with smoothing and hysteresis: frame time is an exponential
   * average, changes need sustained evidence, and failed upgrades back off exponentially.
   */
  private adapt(dt: number): void {
    if (dt > 0.25 || document.hidden) return;
    this.frameMs += (dt * 1000 - this.frameMs) * 0.06;
    if (!this.auto) return;
    const budget = this.quality.name === 'low' ? 36 : 21;
    this.sinceRaise += dt;
    if (this.frameMs > budget) {
      this.slowT += dt;
      this.fastT = 0;
    } else {
      this.slowT = Math.max(0, this.slowT - dt * 0.5);
      if (this.frameMs < 17.8) this.fastT += dt;
    }
    if (this.slowT > 1.5) {
      this.slowT = 0;
      if (this.sinceRaise < 5) this.upWait = Math.min(180, this.upWait * 2);
      if (this.resScale > 0.55) {
        this.resScale = Math.max(0.5, this.resScale - 0.1);
        this.applyResolution();
      } else {
        const i = QUALITY_ORDER.indexOf(this.quality.name);
        if (i > 0) {
          this.quality = QUALITY[QUALITY_ORDER[i - 1]!];
          this.resScale = 0.8;
          this.applyQuality();
        }
      }
      this.onQualityChange?.();
    } else if (this.fastT > this.upWait && this.resScale < 1) {
      this.fastT = 0;
      this.sinceRaise = 0;
      this.resScale = Math.min(1, this.resScale + 0.1);
      this.applyResolution();
      this.onQualityChange?.();
    }
  }

  frame(dtReal: number, alpha: number, time: number, selected: number, simRate: number): void {
    const env = this.sim.env;
    const cam = this.camera.position;
    this.adapt(dtReal);
    shared.uTime.value = time;
    shared.uWind.value = env.wind;
    shared.uDry.value = clamp01((0.5 - env.meanMoisture) / 0.4) * 0.85 + clamp01(0.5 - env.totalVeg / env.totalCap) * 0.3;
    shared.uWet.value = clamp01(env.rain / 4);
    // lightning: only in storms, only at watchable time rates
    if (env.weather === 'storm' && simRate <= 10) {
      this.nextFlash -= dtReal;
      if (this.nextFlash <= 0) {
        this.nextFlash = 4 + Math.random() * 14;
        this.sky.flash = 1;
        this.thunderCb?.();
      }
    }
    this.sky.update(env, this.camera, time, this.quality.shadowDist);
    this.fog.color.copy(this.sky.fogColor);
    this.fog.density = this.sky.fogDensity(env, this.quality.viewDist);
    this.renderer.setClearColor(this.sky.fogColor);
    this.terrain.update(cam);
    this.scatter.update(this.camera);
    this.grass.update(cam, env.timeH);
    const day = env.daylight();
    this.water.update(env.stage, env.rain, this.sky, this.quality.waterDetail, day);
    this.animals.update(cam, alpha, dtReal, time, Math.min(this.quality.viewDist, 900), selected);
    this.weather.update(cam, env.rain, env.wind, env.windDir, day);
    this.renderer.render(this.scene, this.camera);
  }

  info(): { calls: number; triangles: number; geometries: number } {
    const i = this.renderer.info;
    return { calls: i.render.calls, triangles: i.render.triangles, geometries: i.memory.geometries };
  }

  dispose(): void {
    this.terrain.dispose();
    this.scatter.dispose();
    this.renderer.dispose();
  }
}
