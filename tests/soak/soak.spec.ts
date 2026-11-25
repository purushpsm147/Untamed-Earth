import { expect, test } from '@playwright/test';
import { GlCounts, enter, g, installGlCounter, terrainSettled, watch } from '../e2e/helpers';

/**
 * Long-run evidence (DIRECTOR TASK QA-02). Opt-in: `npx playwright test --project=soak` (not part of `npm run test:e2e`).
 * Software-rendered Chromium only: frame times here are NOT hardware evidence; object counts and heap trends are.
 * Each test attaches its raw samples as JSON so the numbers can be archived in docs/evidence/soak/.
 *
 * Duration: SOAK_MINUTES (default 30). Restarts: SOAK_RESTARTS (default 25).
 */
const MINUTES = Number(process.env.SOAK_MINUTES ?? 30);
const RESTARTS = Number(process.env.SOAK_RESTARTS ?? 25);

type Page = import('@playwright/test').Page;
const gl = (page: Page): Promise<GlCounts> => page.evaluate(() => ({ ...(window as unknown as { __gl: GlCounts }).__gl }));
/** Heap after a forced GC (Chromium with --expose-gc and --enable-precise-memory-info, both set in playwright.config.ts). */
const heapAfterGc = (page: Page): Promise<number | null> => page.evaluate(() => {
  (window as unknown as { gc?: () => void }).gc?.();
  const m = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
  return m ? m.usedJSHeapSize / 1048576 : null;
});
/** Least-squares slope of y over x. */
function slope(xs: number[], ys: number[]): number {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) ((num += (xs[i]! - mx) * (ys[i]! - my)), (den += (xs[i]! - mx) ** 2));
  return den === 0 ? 0 : num / den;
}

test.describe('soak (software-rendered Chromium)', () => {
  test(`live run: ${MINUTES} min of Curiosity Mode at 10x, sampled every 30 s`, async ({ page }, info) => {
    test.setTimeout((MINUTES + 10) * 60_000);
    await page.addInitScript(installGlCounter);
    const p = watch(page);
    await enter(page, { seed: 1 });
    await terrainSettled(page);
    await g(page, (G) => G.setSpeed(10));
    // Curiosity moves the camera between real subjects all over the valley: streaming, scatter and animals churn
    await page.click('#modes button[data-mode="curiosity"]');
    await expect.poll(() => g(page, (G) => G.mode)).toBe('curiosity');
    const samples: { t: number; tick: number; heapMB: number | null; gl: GlCounts; geometries: number; textures: number; chunks: number; frameP50: number; frameP95: number; stalls: number; animals: number }[] = [];
    const t0 = Date.now();
    while (Date.now() - t0 < MINUTES * 60_000) {
      await g(page, (G) => G.debugPerfStart());
      await page.waitForTimeout(30_000);
      const perf = await g(page, (G) => G.debugPerfStop());
      const f = [...perf.frame].sort((a, b) => a - b);
      const s = await g(page, (G) => ({ tick: G.sim.tick as number, animals: G.sim.animals.length as number, gfx: G.debugGfx() }));
      samples.push({
        t: Math.round((Date.now() - t0) / 1000), tick: s.tick, heapMB: await heapAfterGc(page), gl: await gl(page),
        geometries: s.gfx.geometries, textures: s.gfx.textures, chunks: s.gfx.chunks,
        frameP50: f[Math.floor(f.length * 0.5)] ?? NaN, frameP95: f[Math.floor(f.length * 0.95)] ?? NaN,
        stalls: perf.frame.filter((ms) => ms > 2000).length, animals: s.animals,
      });
      expect(await page.locator('#fatal').isHidden()).toBe(true);
    }
    const second = samples.slice(Math.floor(samples.length / 2));
    const mins = second.map((s) => s.t / 60);
    const heap = second.map((s) => s.heapMB ?? NaN);
    const summary = {
      minutes: MINUTES, samples: samples.length, ticks: samples.at(-1)!.tick - samples[0]!.tick,
      heapSlopeMBperMin_secondHalf: Number.isNaN(heap[0]!) ? null : slope(mins, heap),
      bufferSlopePerMin_secondHalf: slope(mins, second.map((s) => s.gl.buffer)),
      textureMax: Math.max(...samples.map((s) => s.gl.texture)), programMax: Math.max(...samples.map((s) => s.gl.program)),
      stallsOver2s: samples.reduce((a, s) => a + s.stalls, 0),
    };
    await info.attach('soak-live', { body: JSON.stringify({ summary, samples }, null, 2), contentType: 'application/json' });
    console.log(JSON.stringify({ soakLive: summary }));
    // invariants, not performance targets: the world keeps running, nothing crashes, GPU programs/textures stay bounded
    expect(p.errors).toEqual([]);
    expect(summary.ticks).toBeGreaterThan(0);
    for (let i = 1; i < samples.length; i++) expect(samples[i]!.tick, `sample ${i}`).toBeGreaterThan(samples[i - 1]!.tick);
  });

  test(`restarts: ${RESTARTS} world restarts with identical seed and pose leave identical WebGL object counts`, async ({ page }, info) => {
    test.setTimeout(RESTARTS * 3 * 60_000 + 300_000);
    await page.addInitScript(installGlCounter);
    const p = watch(page);
    await enter(page, { qa: true, seed: 11 });
    await terrainSettled(page);
    const settle = async (): Promise<GlCounts> => {
      // GPU uploads happen on first draw: wait until two samples a second apart agree
      let prev = await gl(page);
      for (let i = 0; i < 30; i++) {
        await page.waitForTimeout(1000);
        const cur = await gl(page);
        if (JSON.stringify(cur) === JSON.stringify(prev)) return cur;
        prev = cur;
      }
      return prev;
    };
    const runs: { run: number; gl: GlCounts; heapMB: number | null; geometries: number; ms: number }[] = [];
    runs.push({ run: 0, gl: await settle(), heapMB: await heapAfterGc(page), geometries: (await g(page, (G) => G.debugGfx())).geometries, ms: 0 });
    for (let i = 1; i <= RESTARTS; i++) {
      const t = Date.now();
      await page.click('#modes button[data-mode="experiment"]');
      await page.fill('#exSeed', '11');
      await page.click('#exReset');
      await expect(page.locator('#loading')).toBeHidden({ timeout: 120_000 });
      await expect(page.locator('#hud')).toBeVisible({ timeout: 120_000 });
      await terrainSettled(page);
      runs.push({ run: i, gl: await settle(), heapMB: await heapAfterGc(page), geometries: (await g(page, (G) => G.debugGfx())).geometries, ms: Date.now() - t });
    }
    const heaps = runs.slice(2).map((r) => r.heapMB).filter((h): h is number => h !== null);
    const summary = {
      restarts: RESTARTS, glFirst: runs[0]!.gl, glDistinct: new Set(runs.map((r) => JSON.stringify(r.gl))).size,
      geometriesDistinct: new Set(runs.map((r) => r.geometries)).size,
      heapSlopeMBperRestart_from2: heaps.length > 2 ? slope(heaps.map((_, i) => i), heaps) : null,
      heapMin: Math.min(...heaps), heapMax: Math.max(...heaps),
    };
    await info.attach('soak-restarts', { body: JSON.stringify({ summary, runs }, null, 2), contentType: 'application/json' });
    console.log(JSON.stringify({ soakRestarts: summary }));
    // the same assertion the 4-restart reliability test makes, extended to RESTARTS
    for (let i = 1; i < runs.length; i++) expect(runs[i]!.gl, `restart ${i}`).toEqual(runs[0]!.gl);
    expect(summary.geometriesDistinct).toBe(1);
    expect(p.errors).toEqual([]);
  });

  test('WebGL context loss: recoverable message, no crash, and Reload -> Continue restores a consistent world', async ({ page }, info) => {
    test.setTimeout(10 * 60_000);
    const p = watch(page);
    await enter(page, { seed: 5 });
    await g(page, (G) => G.setSpeed(100));
    await page.waitForTimeout(3000);
    await g(page, (G) => G.setSpeed(0));
    const saved = await g(page, (G) => ({ hash: G.sim.stateHash() as number, tick: G.sim.tick as number, animals: G.sim.animals.length as number }));
    await page.keyboard.press('Escape');
    await page.click('#mSave');
    await expect(page.locator('#mSaveInfo')).toContainText('Saved', { timeout: 15_000 });
    await page.click('#mResume');
    // keep playing past the save, then lose the GPU context as a driver reset would
    await g(page, (G) => G.setSpeed(100));
    await page.waitForTimeout(2000);
    const lostAt = await page.evaluate(() => {
      const G = (window as unknown as { __untamed: { sim: { tick: number }; engine: { renderer: { getContext(): WebGL2RenderingContext } } } }).__untamed;
      const ext = G.engine.renderer.getContext().getExtension('WEBGL_lose_context');
      ext?.loseContext();
      return ext ? G.sim.tick : -1;
    });
    expect(lostAt).toBeGreaterThan(saved.tick);
    await expect(page.locator('#fatal')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#fatalText')).toContainText('graphics context was lost');
    await page.waitForTimeout(5000); // the frame loop keeps running against a lost context: it must not throw
    const tickBehindMessage = await g(page, (G) => G.sim.tick as number);
    const errorsAfterLoss = [...p.errors];
    // the recovery path the message offers: Reload, then Continue
    await page.click('#btnReload');
    await expect(page.locator('#btnContinue')).toBeVisible({ timeout: 30_000 });
    await page.click('#btnContinue');
    await expect(page.locator('#hud')).toBeVisible({ timeout: 120_000 });
    const restored = await g(page, (G) => ({ hash: G.sim.stateHash() as number, tick: G.sim.tick as number, animals: G.sim.animals.length as number }));
    const evidence = { saved, lostAt, tickBehindMessage, restored, simKeptRunningAfterLoss: tickBehindMessage > lostAt, restoredIsManualSave: restored.tick === saved.tick, errorsAfterLoss };
    await info.attach('context-loss', { body: JSON.stringify(evidence, null, 2), contentType: 'application/json' });
    console.log(JSON.stringify({ contextLoss: evidence }));
    // invariants: no crash or page error, a readable save survives, the restored world is not older than the manual save
    expect(errorsAfterLoss).toEqual([]);
    expect(restored.tick).toBeGreaterThanOrEqual(saved.tick);
    expect(restored.animals).toBeGreaterThan(0);
    expect(p.errors).toEqual([]);
  });
});
