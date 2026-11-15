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
    const during = await g(page, (G) => G.debugTerrain());
    expect(during.stale + during.superseded, JSON.stringify(during)).toBeGreaterThan(before.stale + before.superseded);
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
});
