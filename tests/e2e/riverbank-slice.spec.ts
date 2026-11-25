import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

/**
 * VIS-01 riverbank slice evidence (opt-in project `riverbank-slice`; not part of npm run test:e2e).
 *
 * Runs on SwiftShader (CPU) in this environment: images are valid for composition/anatomy/colour review; every
 * timing here is SOFTWARE rasteriser time and says nothing about GPU frame rates.
 *
 *   npx playwright test --project=riverbank-slice                       # lifecycle + capture matrix
 *   RIVERBANK_VIDEO=1 npx playwright test --project=riverbank-slice -g video   # frame-stepped videos (needs ffmpeg)
 */
const OUT = 'test-artifacts/riverbank';
type Api = { settle: (n?: number) => Promise<number>; info: () => Record<string, unknown>; perf: (n: number) => unknown; frame: (dt: number, step: boolean, follow?: boolean) => void };
declare global {
  interface Window { __slice: Api; __sliceRestart: () => Promise<Api>; __studio: { frame: (dt: number) => void } }
}

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error' && !/GPU stall due to ReadPixels/.test(t)) errors.push(t);
    if (/THREE\.WebGLProgram|Shader Error|computeBoundingSphere\(\): Computed radius is NaN/.test(t)) errors.push(t);
  });
  return errors;
}

async function openSlice(page: Page, q: string): Promise<void> {
  await page.goto(`/?slice=riverbank&${q}`);
  await page.waitForFunction(() => !!window.__slice, null, { timeout: 120_000 });
  await page.evaluate(() => window.__slice.settle(500));
}

test.describe('riverbank slice (VIS-01, SwiftShader)', () => {
  test.setTimeout(3_600_000);

  test('GPU lifecycle: restarts release what the slice allocated; shaders compile cleanly', async ({ page }) => {
    const errors = watchErrors(page);
    await openSlice(page, 'scene=evening&shot=hero&mode=natural&quality=high');
    const mem = async (): Promise<{ geometries: number; textures: number; programs: number }> => page.evaluate(() => {
      const i = window.__slice.info() as { gl: { geometries: number; textures: number; programs: number } };
      return i.gl;
    });
    const first = await mem();
    const cycles: unknown[] = [first];
    for (let c = 0; c < 3; c++) {
      await page.evaluate(async () => { const a = await window.__sliceRestart(); await a.settle(500); });
      const m = await mem();
      cycles.push(m);
      // the shared renderer's live geometry/texture counts return to the same level after every restart
      expect(m.geometries).toBe(first.geometries);
      expect(m.textures).toBe(first.textures);
      expect(m.programs).toBeLessThanOrEqual(first.programs);
    }
    mkdirSync(OUT, { recursive: true });
    writeFileSync(`${OUT}/lifecycle.json`, JSON.stringify({ cycles, errors }, null, 2));
    expect(errors).toEqual([]);
  });

  test('capture matrix: same seed, time, weather and camera; baseline vs natural at 720p and 1080p', async ({ browser }) => {
    mkdirSync(OUT, { recursive: true });
    const metrics: Record<string, unknown> = {};
    const shots: [string, string][] = [['evening', 'hero'], ['evening', 'vista'], ['evening', 'side'], ['morning', 'hero'], ['morning', 'vista']];
    for (const [w, h] of [[1280, 720], [1920, 1080]] as const) {
      for (const [scene, shot] of shots) {
        for (const mode of ['baseline', 'natural']) {
          const page = await browser.newPage({ viewport: { width: w, height: h } });
          const errors = watchErrors(page);
          await openSlice(page, `scene=${scene}&shot=${shot}&mode=${mode}&quality=high`);
          const name = `${scene}-${shot}-${mode}-${h}p`;
          await page.screenshot({ path: `${OUT}/${name}.png` });
          const info = await page.evaluate(() => window.__slice.info());
          const perf = await page.evaluate(() => window.__slice.perf(12));
          metrics[name] = { info, perfSoftwareRasteriserMs: perf, errors };
          expect(errors, name).toEqual([]);
          await page.close();
        }
      }
    }
    writeFileSync(`${OUT}/metrics.json`, JSON.stringify({ renderer: 'SwiftShader (CPU). Timings are NOT GPU performance.', metrics }, null, 2));
  });

  test('video: frame-stepped gameplay (live simulation, camera follows the hero) and studio gaits', async ({ browser }) => {
    test.skip(!process.env.RIVERBANK_VIDEO, 'set RIVERBANK_VIDEO=1');
    mkdirSync(OUT, { recursive: true });
    const seconds = Number(process.env.RIVERBANK_SECONDS ?? 8);
    const fps = 24;
    for (const mode of ['baseline', 'natural']) {
      const dir = `${OUT}/frames-${mode}`;
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(dir, { recursive: true });
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
      // morning hero: the herd is on the move on the bank (evening hero animals are mostly stationary drinkers)
      await openSlice(page, `scene=morning&shot=hero&mode=${mode}&quality=high`);
      for (let i = 0; i < seconds * fps; i++) {
        await page.evaluate((dt) => window.__slice.frame(dt, true, true), 1 / fps);
        await page.screenshot({ path: `${dir}/${String(i).padStart(4, '0')}.png` });
      }
      await page.close();
      execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-framerate', String(fps), '-i', `${dir}/%04d.png`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '24', `${OUT}/gameplay-morning-hero-${mode}.mp4`]);
    }
    // studio: walk, trot, gallop, graze, lie (side view) — the gait cycles at a readable size
    const studio = `${OUT}/frames-studio`;
    rmSync(studio, { recursive: true, force: true });
    mkdirSync(studio, { recursive: true });
    let k = 0;
    for (const [pose, view, stag, secs] of [['walk', 'side', 1, 3], ['trot', 'side', 0, 2], ['gallop', 'side', 1, 2], ['walk', 'three', 0, 2], ['graze', 'three', 0, 2], ['lie', 'three', 1, 2]] as const) {
      const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
      await page.goto(`/?slice=studio&pose=${pose}&view=${view}&stag=${stag}`);
      await page.waitForFunction(() => !!window.__studio, null, { timeout: 60_000 });
      await page.evaluate(() => { for (let i = 0; i < 30; i++) window.__studio.frame(1 / 30); });
      for (let i = 0; i < secs * fps; i++) {
        await page.evaluate((dt) => window.__studio.frame(dt), 1 / fps);
        await page.screenshot({ path: `${studio}/${String(k++).padStart(4, '0')}.png` });
      }
      await page.close();
    }
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-framerate', String(fps), '-i', `${studio}/%04d.png`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '22', `${OUT}/studio-gaits.mp4`]);
  });
});
