import { expect, test } from '@playwright/test';
import { GlCounts, enter, g, installGlCounter, terrainSettled, watch } from './helpers';

const read = (page: import('@playwright/test').Page): Promise<GlCounts> => page.evaluate(() => ({ ...(window as unknown as { __gl: GlCounts }).__gl }));
/** GPU uploads happen when an object is first drawn, so wait until two samples a second apart agree. */
async function glCounts(page: import('@playwright/test').Page): Promise<GlCounts> {
  let prev = await read(page);
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(1000);
    const cur = await read(page);
    if (JSON.stringify(cur) === JSON.stringify(prev)) return cur;
    prev = cur;
  }
  return prev;
}

test.describe('reliability: lifecycle and streaming (software-rendered Chromium)', () => {
  test('restarting the world releases its WebGL objects on the shared context', async ({ page }, info) => {
    await page.addInitScript(installGlCounter);
    const p = watch(page);
    await enter(page, { qa: true, seed: 11 });
    await terrainSettled(page);
    const runs: GlCounts[] = [await glCounts(page)];
    const three: number[] = [(await g(page, (G) => G.debugGfx())).geometries];
    for (let i = 0; i < 4; i++) {
      // same seed, same paused start, same camera: each restart should rebuild an equivalent scene
      await page.click('#modes button[data-mode="experiment"]');
      await page.fill('#exSeed', '11');
      await page.click('#exReset');
      await expect(page.locator('#loading')).toBeHidden({ timeout: 120_000 });
      await expect(page.locator('#hud')).toBeVisible({ timeout: 120_000 });
      await terrainSettled(page);
      runs.push(await glCounts(page));
      three.push((await g(page, (G) => G.debugGfx())).geometries);
    }
    await info.attach('gl-object-counts', { body: JSON.stringify({ runs, threeGeometries: three }, null, 2), contentType: 'application/json' });
    // Identical seed, pose and paused state: every restart must end with exactly the GL objects the first load had.
    // (Before the fixes: instanced-mesh buffers leaked per restart, and a renderer per world leaked 3 framebuffers
    // and 4 textures of three.js's own.)
    for (let i = 1; i < runs.length; i++) expect(runs[i], `restart ${i}: ${JSON.stringify(runs)}`).toEqual(runs[0]);
    expect(new Set(three).size, String(three)).toBe(1);
    const first = runs[0]!;
    expect(first.buffer).toBeGreaterThan(50); // sanity: the counter is really seeing the scene
    expect(p.errors).toEqual([]);
  });

  test('terrain converges after violent camera travel; stale Worker results are discarded, none applied late', async ({ page }) => {
    const p = watch(page);
    await enter(page, { qa: true });
    await terrainSettled(page);
    const before = await g(page, (G) => G.debugTerrain());
    expect(before.worker).toBe(true);
    // far faster than any player: at software-renderer frame rates the camera jumps hundreds of metres per frame,
    // so most in-flight requests are superseded before they return
    await g(page, (G) => G.debugPath([[150, 150], [1300, 250], [200, 700], [1300, 1250], [150, 1300], [700, 700], [1300, 150], [150, 150]], 900, 14));
    // Whether the flight itself outruns the Worker depends on this machine's frame rate, so also force the case
    // deterministically: dispatch requests around one point, then move the streaming focus far away in the same
    // task, before any Worker reply can be delivered. Those replies must be discarded, never applied late.
    await g(page, (G) => {
      const t = G.engine.terrain;
      t.update({ x: 1350, y: 30, z: 1350 });
      t.update({ x: 90, y: 30, z: 90 });
      t.update({ x: 1350, y: 30, z: 90 });
    });
    await expect.poll(async () => {
      const d = await g(page, (G) => G.debugTerrain());
      return d.stale + d.superseded;
    }, { timeout: 30_000 }).toBeGreaterThan(before.stale + before.superseded);
    await g(page, (G) => G.debugCam(720, 690, 10, 0.4, -0.2));
    await terrainSettled(page);
    const after = await g(page, (G) => G.debugTerrain());
    expect(after.mismatched).toBe(0);
    expect(after.meshes).toBeGreaterThan(20);
    expect(after.inFlight).toBe(0);
    // the chunk under the camera is at full detail and the ground is where the analytic terrain says it is
    const c = await g(page, (G) => G.debugCamera());
    expect(c.y).toBeGreaterThanOrEqual(c.ground + 1.2);
    const luma = await g(page, (G) => G.debugLuma());
    expect(luma.std).toBeGreaterThan(0.02); // not a blank frame
    expect(p.errors).toEqual([]);
  });

  test('terrain readiness is judged for the current camera, not the position before a teleport', async ({ page }) => {
    // Regression for CI run 44116004501 (3a0e7f9): terrainSettled() passed on counters left over from the previous,
    // already-settled camera position, then the first frame at the new position reported 97 mismatched chunks.
    const p = watch(page);
    await enter(page, { qa: true });
    await terrainSettled(page);
    // The race, made deterministic: in one task, teleport and read. No frame has run, so the reading is the old one.
    const stale = await g(page, (G) => {
      G.debugCam(1300, 1250, 10, 0.4, -0.2);
      const t = G.debugTerrain();
      return { sum: t.mismatched + t.pending + t.inFlight + t.queued, updates: t.updates };
    });
    expect(stale.sum).toBe(0); // looks settled, but describes the start position
    await terrainSettled(page);
    const after = await g(page, (G) => G.debugTerrain());
    expect(after.updates).toBeGreaterThan(stale.updates);
    expect(after.mismatched).toBe(0);
    // and it stays settled: later frames at the same camera create no new work
    await page.waitForTimeout(1500);
    const later = await g(page, (G) => G.debugTerrain());
    expect(later.updates).toBeGreaterThan(after.updates);
    expect(later.mismatched + later.pending + later.inFlight + later.queued).toBe(0);
    const c = await g(page, (G) => G.debugCamera());
    expect(Math.hypot(c.x - 1300, c.z - 1250)).toBeLessThan(1);
    expect(p.errors).toEqual([]);
  });

  test('if the terrain Worker dies during loading, the world still loads on the main thread', async ({ page }) => {
    await page.addInitScript(() => {
      const Real = window.Worker;
      // every Worker created by the page fails shortly after start-up, as if its script crashed
      window.Worker = class extends Real {
        constructor(url: string | URL, opts?: WorkerOptions) {
          super(url, opts);
          setTimeout(() => this.dispatchEvent(new ErrorEvent('error', { message: 'injected worker failure' })), 400);
        }
      } as typeof Worker;
    });
    const p = watch(page);
    await enter(page, { qa: true });
    const t = await g(page, (G) => G.debugTerrain());
    expect(t.workerFailures).toBe(1);
    expect(t.worker).toBe(false);
    expect(t.meshes).toBeGreaterThan(20);
    await terrainSettled(page, 180_000); // one chunk per frame on the main thread
    expect((await g(page, (G) => G.debugTerrain())).mismatched).toBe(0);
    await expect(page.locator('#fatal')).toBeHidden();
    expect(p.errors).toEqual([]);
  });

  test('Auto quality: assessment, real downgrade under overload, and the player keeps control', async ({ page }) => {
    const p = watch(page);
    // a previous session left a manual Low preference; choosing Auto on the start screen must override it
    await enter(page, { quality: 'auto', settings: { quality: 'low', auto: false, volume: 0, muted: true } });
    const s0 = await g(page, (G) => G.debugGfx());
    expect(s0.auto).toBe(true);
    // This machine has no GPU: the assessment must recognise the software rasteriser and start conservatively.
    expect(s0.gpu).toMatch(/SwiftShader|llvmpipe/i);
    expect(s0.basis).toMatch(/software renderer/);
    expect(s0).toMatchObject({ quality: 'low', ceiling: 'low', fpsTarget: 30 });
    // 30 fps target on a 60 Hz (emulated) display: render every second animation frame
    await expect.poll(async () => (await g(page, (G) => G.debugGfx())).divisor, { timeout: 15_000 }).toBe(2);
    // Genuine overload (software rendering cannot hold 30 fps): resolution comes down, and the renderer really uses it
    await expect.poll(async () => (await g(page, (G) => G.debugGfx())).resScale, { timeout: 60_000 }).toBeLessThan(1);
    // the downgrade is a trial measured on real frames: a verdict is recorded with real before/after medians, and the
    // renderer agrees with it (kept if it helped, undone if not). Whether a software rasteriser gains >= 5% from 10%
    // less resolution depends on the machine (CI runners differ), so the test checks consistency, not the verdict.
    await expect.poll(async () => (await g(page, (G) => G.debugGfx())).governor.last, { timeout: 90_000 }).not.toBeNull();
    const live = await g(page, (G) => ({ gfx: G.debugGfx(), ratio: G.engine.renderer.getPixelRatio() as number }));
    const last = live.gfx.governor.last!;
    expect(last.beforeMs).toBeGreaterThan(0);
    expect(last.afterMs).toBeGreaterThan(0);
    if (last.verdict === 'helped') expect(last.afterMs).toBeLessThan(last.beforeMs);
    else expect(live.gfx.governor.holdS + live.gfx.governor.trials).toBeGreaterThan(0);
    expect(live.ratio).toBeCloseTo(live.gfx.resScale, 5); // device pixel ratio is 1 here
    expect(live.gfx.quality).toBe('low'); // already on the lowest preset: only resolution can give
    // the player raises the frame-rate target and fixes the quality by hand: both are respected and persisted
    await page.keyboard.press('Escape');
    await page.selectOption('#mFps', '60');
    await page.uncheck('#mAuto');
    await page.selectOption('#mQuality', 'medium');
    await page.click('#mResume');
    const manual = await g(page, (G) => G.debugGfx());
    expect(manual).toMatchObject({ quality: 'medium', ceiling: 'medium', auto: false, resScale: 1, fpsTarget: 60 });
    await page.waitForTimeout(8000); // still overloaded, but manual means manual
    expect(await g(page, (G) => G.debugGfx())).toMatchObject({ quality: 'medium', auto: false, resScale: 1 });
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('untamed.settings') ?? '{}') as Record<string, unknown>);
    expect(saved).toMatchObject({ quality: 'medium', auto: false, fps: 60 });
    expect(p.errors).toEqual([]);
  });

  test('governor decisions drive real renderer settings, respect the ceiling, and never touch the ecosystem', async ({ page }) => {
    const p = watch(page);
    const POSE = [760, 640, 12, 0.5, -0.2] as const;
    // control: fixed Low, simulation stepped to tick 300
    await enter(page, { quality: 'low', qa: true, seed: 21 });
    const control = await g(page, (G) => { G.debugCam(760, 640, 12, 0.5, -0.2); return G.debugStepTo(300); });
    void POSE;
    // experiment: Auto with a Medium ceiling saved by the player; same seed and pose
    await page.evaluate(() => localStorage.setItem('untamed.settings', JSON.stringify({ quality: 'medium', auto: true, volume: 0, muted: true, fps: 60 })));
    await enter(page, { quality: 'auto', qa: true, seed: 21 });
    const start = await g(page, (G) => G.debugGfx());
    expect(start).toMatchObject({ auto: true, ceiling: 'medium', quality: 'low' }); // starts where the device hints say, may climb to the player's ceiling
    const half = await g(page, (G) => { G.debugCam(760, 640, 12, 0.5, -0.2); return G.debugStepTo(150); });
    // sustained headroom (synthetic 16 ms frames through the real engine): quality is restored step by step, up to the ceiling only
    const up = await g(page, (G) => G.engine.debugFeed(16, 150));
    expect(up.quality).toBe('medium');
    expect(up.scale).toBe(1);
    expect(up.changes.filter((c: string) => c.startsWith('preset'))).toEqual(['preset:medium@0.8']);
    expect(up.viewDist).toBe(700); // Medium's draw distance really applied
    expect(up.shadows).toBe(true);
    expect(up.pixelRatio).toBeCloseTo(1, 5);
    // a slowdown rendering settings cannot fix (constant 80 ms frames): the probe is measured, undone on the real
    // renderer, and quality is kept
    const cpu = await g(page, (G) => G.engine.debugFeed(80, 20, 'constant'));
    expect(cpu.changes).toEqual(['resolution:medium@0.9', 'resolution:medium@1']);
    expect(cpu).toMatchObject({ quality: 'medium', scale: 1, viewDist: 700, shadows: true });
    expect(cpu.pixelRatio).toBeCloseTo(1, 5);
    expect(cpu.stats).toMatchObject({ trials: 1, helped: 0, rolledBack: 1 });
    expect(cpu.stats.last.verdict).toBe('no-help-rolled-back');
    // sustained render-bound overload (frame time follows resolution and preset): resolution first, then the preset;
    // shadows and draw distance go with the preset. 160 ms is clearly worse than the held reference, so the hold lifts
    const down = await g(page, (G) => G.engine.debugFeed(160, 40, 'render'));
    expect(down.quality).toBe('low');
    expect(down.changes[0]).toMatch(/^resolution:medium@0\.9/);
    expect(down.changes.findIndex((c: string) => c.startsWith('preset'))).toBeGreaterThanOrEqual(5);
    expect(down.viewDist).toBe(420);
    expect(down.shadows).toBe(false);
    expect(down.pixelRatio).toBeCloseTo(down.scale, 5);
    // the menu shows the player's ceiling, the live preset is reported separately, and only the ceiling is persisted
    await page.keyboard.press('Escape');
    await expect(page.locator('#mQuality')).toHaveValue('medium');
    await expect(page.locator('#mGfxInfo')).toContainText('Now: Low');
    await page.selectOption('#mFps', '30');
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('untamed.settings') ?? '{}') as Record<string, unknown>);
    expect(saved).toMatchObject({ quality: 'medium', auto: true, fps: 30 });
    await page.click('#mResume');
    // ecology: half the run on one preset, half on others, with the governor changing settings in between
    expect(half).not.toBe(control);
    const end = await g(page, (G) => G.debugStepTo(300));
    expect(end).toBe(control);
    expect(p.errors).toEqual([]);
  });
});
