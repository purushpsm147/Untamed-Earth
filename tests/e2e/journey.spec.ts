import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { frames, g, hold, watch } from './helpers';

/**
 * Guided player journey (docs/JOURNEY.md): the valley's existing capabilities in one sitting, recorded on video.
 * Nothing is scripted in the world: the scenario fixes only seed, time and the starting camera; every animal, event
 * and caption comes from the running simulation. The script only presses the keys a player would press.
 *
 * Default: compressed (~5 min of wall time). JOURNEY_FULL=1 holds each stage for its documented duration (~14 min).
 * Opt-in project (not part of npm run test:e2e): npm run journey
 */
const FULL = !!process.env.JOURNEY_FULL;
const hold_s = (fullS: number, shortS: number): number => (FULL ? fullS : shortS) * 1000;
const OUT = 'test-artifacts/journey';

test('guided journey through the Living Valley', async ({ page, context }) => {
  test.setTimeout(FULL ? 40 * 60_000 : 20 * 60_000);
  mkdirSync(OUT, { recursive: true });
  const p = watch(page);
  const log: Record<string, unknown>[] = [];
  const t0 = Date.now();
  const stage = async (name: string, data: Record<string, unknown> = {}): Promise<void> => {
    const shot = `${OUT}/${String(log.length + 1).padStart(2, '0')}-${name}.png`;
    await page.screenshot({ path: shot });
    const st = await g(page, (G) => ({ mode: G.mode, tick: G.sim.tick as number, day: +(G.sim.env.timeH / 24).toFixed(3), speed: G.speed }));
    log.push({ stage: name, atS: Math.round((Date.now() - t0) / 1000), ...st, ...data, screenshot: shot });
  };

  // 1. Arrival (documented 0:00-1:30): fixed afternoon by the river meadow, herd in view, first-run field guide
  await page.goto('/?scenario=documentary');
  await page.selectOption('#startQuality', 'low');
  await page.click('#btnNew');
  await expect(page.locator('#hud')).toBeVisible({ timeout: 180_000 });
  await expect(page.locator('#coach')).toBeVisible();
  await stage('arrival', { guide: await page.locator('#coachText').innerText() });
  await hold(page, ['KeyJ'], 900);
  await hold(page, ['KeyL'], 1800);
  await hold(page, ['KeyJ'], 900);
  await hold(page, ['KeyW'], 1200);
  await page.waitForTimeout(hold_s(60, 4));

  // 2. Look closer (1:30-3:00): select the deer drawn largest, read its Social Lens, ring its group, double-click follow
  const id = await g(page, (G) => {
    let best = 0;
    let bh = 0;
    for (const a of G.sim.animals) {
      if (!a.alive || a.sp !== 0) continue;
      const pr = (G as any).debugProject(a.id); // eslint-disable-line @typescript-eslint/no-explicit-any
      if (pr && pr.inFrame && pr.heightFrac > bh) ((bh = pr.heightFrac), (best = a.id));
    }
    return best;
  });
  expect(id).toBeGreaterThan(0);
  const at = await page.evaluate((id) => {
    const G = (window as any).__untamed; // eslint-disable-line @typescript-eslint/no-explicit-any
    const v = G.engine.animals.pos.get(id).clone().project(G.engine.camera);
    const r = G.engine.canvas.getBoundingClientRect();
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
  }, id);
  await page.mouse.dblclick(at.x, at.y);
  await expect.poll(() => g(page, (G) => G.selected), { timeout: 10_000 }).toBeGreaterThan(0);
  const watched = await g(page, (G) => G.selected);
  await page.click('#insGroup');
  await page.waitForTimeout(hold_s(40, 4));
  await stage('social-lens', { selected: watched, lens: await page.locator('#insSocial').innerText() });
  await page.waitForTimeout(hold_s(40, 3));

  // 3. Curiosity Mode (3:00-6:00): the documentary director picks real subjects; captions explain why
  await page.keyboard.press('KeyV');
  await expect(page.locator('#curio')).toBeVisible();
  const curiosity: Record<string, unknown>[] = [];
  const cEnd = Date.now() + hold_s(180, 45);
  while (Date.now() < cEnd) {
    await page.waitForTimeout(FULL ? 15_000 : 5_000);
    const cu = await g(page, (G) => G.debugCuriosity());
    const cap = await page.locator('#cuCaption').isVisible() ? await page.locator('#cuCaption').innerText() : '';
    curiosity.push({ atS: Math.round((Date.now() - t0) / 1000), key: cu.key, why: cu.why, style: cu.style, cuts: cu.cuts, caption: cap });
  }
  await stage('curiosity', { samples: curiosity });

  // 4. Become a chital (6:00-9:00): from the director's subject if it is a deer, else the watched deer
  await page.keyboard.press('KeyV'); // back to Observer
  await expect.poll(() => g(page, (G) => G.mode)).toBe('observer');
  await page.evaluate((id) => { const G = (window as any).__untamed; G.select(id); }, watched); // eslint-disable-line @typescript-eslint/no-explicit-any
  await page.keyboard.press('KeyP');
  await expect.poll(() => g(page, (G) => G.mode)).toBe('wildlife');
  await page.waitForTimeout(1500);
  await stage('wildlife-arrive', { sense: await page.locator('#wildSense').innerText() });
  await hold(page, ['KeyW'], hold_s(20, 4));
  await hold(page, ['KeyE'], hold_s(30, 5));
  await stage('wildlife-graze', { status: await page.locator('#wildStatus').innerText(), bars: await page.locator('#wildBars').innerText() });
  await hold(page, ['KeyW', 'ShiftLeft'], hold_s(10, 2));
  await page.keyboard.press('KeyR');
  await page.waitForTimeout(hold_s(40, 4));
  await stage('wildlife-rest', { status: await page.locator('#wildStatus').innerText() });
  const lived = await g(page, (G) => G.controlled);
  await page.keyboard.press('KeyX');
  await expect.poll(() => g(page, (G) => G.mode)).toBe('observer');

  // 5. Time and the ecosystem (9:00-11:00): accelerate, watch evening fall, open the charts
  await page.keyboard.press('KeyX'); // stop following
  await g(page, (G) => G.setSpeed(100));
  await page.keyboard.press('KeyT');
  await page.waitForTimeout(hold_s(100, 25));
  await stage('time-and-charts', { clock: await page.locator('#clockMain').innerText(), sub: await page.locator('#clockSub').innerText() });
  await g(page, (G) => G.setSpeed(1));

  // 6. Experiment (11:00-13:00): a drought, with the charts showing what the simulation does with it
  await page.click('#modes button[data-mode="experiment"]');
  await page.selectOption('#exMode', 'drought');
  await g(page, (G) => G.setSpeed(1000));
  await page.waitForTimeout(hold_s(90, 25));
  await stage('experiment-drought', { table: await page.locator('#statTable').innerText() });
  await page.selectOption('#exMode', 'natural');
  await g(page, (G) => G.setSpeed(1));
  await page.click('#modes button[data-mode="observer"]');

  // 7. Persistence (13:00-14:30): save, close, Continue, and the deer's history remembers being lived as
  await page.keyboard.press('Escape');
  await page.click('#mSave');
  await expect(page.locator('#mSaveInfo')).toContainText('Saved', { timeout: 15_000 });
  await page.close();
  const page2 = await context.newPage();
  const p2 = watch(page2);
  await page2.goto('/?qa=1');
  await page2.click('#btnContinue');
  await expect(page2.locator('#hud')).toBeVisible({ timeout: 180_000 });
  await page2.evaluate((id) => (window as any).__untamed.select(id), lived); // eslint-disable-line @typescript-eslint/no-explicit-any
  const alive = await page2.evaluate((id) => !!(window as any).__untamed.sim.byId.get(id)?.alive, lived); // eslint-disable-line @typescript-eslint/no-explicit-any
  if (alive) {
    await expect(page2.locator('#insSocial')).toContainText('you began living as this animal');
    await expect(page2.locator('#insSocial')).toContainText('you released it');
  }
  await frames(page2, 3);
  await page2.screenshot({ path: `${OUT}/${String(log.length + 1).padStart(2, '0')}-restored-history.png` });
  log.push({ stage: 'restored-history', atS: Math.round((Date.now() - t0) / 1000), lived, alive, lens: alive ? await page2.locator('#insSocial').innerText() : 'animal died after release (legitimate)' });

  test.info().annotations.push({ type: 'journey', description: JSON.stringify({ full: FULL, totalS: Math.round((Date.now() - t0) / 1000), stages: log }) });
  console.log(JSON.stringify({ full: FULL, totalS: Math.round((Date.now() - t0) / 1000), stages: log }, null, 1));
  expect([...p.errors, ...p2.errors]).toEqual([]);
});
