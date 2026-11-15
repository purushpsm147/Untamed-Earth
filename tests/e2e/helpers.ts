import { Page, expect } from '@playwright/test';

/** The subset of the in-page Game object the tests use (see Game.ts "QA instrumentation"). */
export interface G {
  sim: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  cam: { x: number; y: number; z: number; yaw: number; pitch: number };
  mode: string; speed: number; selected: number; following: boolean; controlled: number;
  setSpeed(n: number): void; setMode(m: string): void; select(id: number): void;
  debugState(): { day: number; animals: number; pops: number[]; tick: number; fps: number; calls: number; mode: string; controlled: number; chunks: number };
  debugCam(x: number, z: number, above: number, yaw: number, pitch: number): void;
  debugFollow(id: string, dist?: number): boolean;
  debugAnimal(id?: number): any; // eslint-disable-line @typescript-eslint/no-explicit-any
  debugCamera(): { x: number; y: number; z: number; yaw: number; pitch: number; ground: number; speed: number };
  debugGfx(): { quality: string; ceiling: string; auto: boolean; resScale: number; frameMs: number; fpsTarget: number; divisor: number; refreshMs: number; calibrating: boolean; gpu: string; basis: string; calls: number; triangles: number; geometries: number; textures: number; chunks: number; heapMB: number | null };
  debugStepTo(tick: number): number;
  engine: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  debugCuriosity(): { key: string | null; tag: string; switches: number; paused: boolean };
  debugTerrain(): { chunks: number; meshes: number; mismatched: number; pending: number; inFlight: number; queued: number; worker: boolean; applied: number; stale: number; superseded: number; workerFailures: number };
  debugFreeze(t: number | null): void; debugLuma(): { mean: number; std: number }; debugGrounding(): { max: number; n: number };
  debugPath(points: [number, number][], speed: number, above?: number): Promise<void>;
  debugPerfStart(): void; debugPerfStop(): { frame: number[]; sim: number[]; render: number[] };
}
declare global {
  interface Window { __untamed: G }
}

export interface Problems { errors: string[] }

/** Collects page errors and console errors; tests assert this stays empty. */
export function watch(page: Page): Problems {
  const p: Problems = { errors: [] };
  page.on('pageerror', (e) => p.errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') p.errors.push(`console: ${m.text()}`);
  });
  return p;
}

export async function enter(page: Page, opts: { quality?: string; seed?: number | string; qa?: boolean; settings?: Record<string, unknown> } = {}): Promise<void> {
  // saved preferences are injected before the app reads them
  if (opts.settings) await page.addInitScript((st) => localStorage.setItem('untamed.settings', JSON.stringify(st)), opts.settings);
  await page.goto(opts.qa ? '/?qa=1' : '/');
  await page.selectOption('#startQuality', opts.quality ?? 'low');
  await page.fill('#seed', String(opts.seed ?? 1));
  await page.click('#btnNew');
  await expect(page.locator('#hud')).toBeVisible({ timeout: 120_000 });
}

export const g = <T>(page: Page, fn: (game: G) => T): Promise<T> => page.evaluate(`(${fn.toString()})(window.__untamed)`) as Promise<T>;

/** Resolve after n animation frames have been rendered (input held or tapped before this is guaranteed applied). */
export async function frames(page: Page, n = 2): Promise<void> {
  await page.evaluate((n) => new Promise<void>((res) => {
    let left = n;
    const tick = (): void => (--left <= 0 ? res() : void requestAnimationFrame(tick));
    requestAnimationFrame(tick);
  }), n);
}

export async function hold(page: Page, keys: string[], ms: number): Promise<void> {
  for (const k of keys) await page.keyboard.down(k);
  await page.waitForTimeout(ms);
  for (const k of keys.reverse()) await page.keyboard.up(k);
}

/** Named viewpoints in the four MVP areas (seed-independent layout). */
export const PLACES: Record<string, [number, number, number, number, number, RegExp]> = {
  forest: [300, 700, 6, 1.2, -0.1, /Forest/],
  river: [628, 640, 8, 3.1, -0.3, /Meadow|Forest|Wetland/],
  settlement: [1000, 450, 8, 1.2, -0.2, /Settlement/],
  dump: [1085, 1005, 10, 0.6, -0.25, /Waste dump/],
  wetland: [700, 1180, 6, 3.3, -0.15, /Wetland/],
};

export interface GlCounts { buffer: number; texture: number; program: number; shader: number; vao: number; framebuffer: number; renderbuffer: number }

/**
 * Init script: counts live WebGL objects by wrapping create and delete calls on the context prototype.
 * This measures what the page actually holds on the GPU side, independent of three.js bookkeeping.
 */
export function installGlCounter(): void {
  const live: Record<string, number> = { buffer: 0, texture: 0, program: 0, shader: 0, vao: 0, framebuffer: 0, renderbuffer: 0 };
  const P = WebGL2RenderingContext.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
  const wrap = (create: string, del: string, key: string): void => {
    const c = P[create]!;
    const d = P[del]!;
    P[create] = function (this: unknown, ...a: unknown[]) {
      const r = c.apply(this, a);
      if (r) live[key]!++;
      return r;
    };
    P[del] = function (this: unknown, o: unknown) {
      if (o) live[key]!--;
      return d.call(this, o);
    };
  };
  wrap('createBuffer', 'deleteBuffer', 'buffer');
  wrap('createTexture', 'deleteTexture', 'texture');
  wrap('createProgram', 'deleteProgram', 'program');
  wrap('createShader', 'deleteShader', 'shader');
  wrap('createVertexArray', 'deleteVertexArray', 'vao');
  wrap('createFramebuffer', 'deleteFramebuffer', 'framebuffer');
  wrap('createRenderbuffer', 'deleteRenderbuffer', 'renderbuffer');
  (window as unknown as { __gl: Record<string, number> }).__gl = live;
}

/** Wait until terrain streaming has nothing outstanding and every in-range chunk is at its wanted LOD. */
export async function terrainSettled(page: Page, timeout = 90_000): Promise<void> {
  await expect.poll(async () => {
    const t = await g(page, (G) => G.debugTerrain());
    return t.mismatched + t.pending + t.inFlight + t.queued;
  }, { timeout, intervals: [500] }).toBe(0);
}
