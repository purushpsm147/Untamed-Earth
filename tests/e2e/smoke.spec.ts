import { expect, test } from '@playwright/test';

interface Dbg { day: number; animals: number; tick: number; calls: number; mode: string; controlled: number; chunks: number }
const state = (page: import('@playwright/test').Page): Promise<Dbg> =>
  page.evaluate(() => (window as unknown as { __untamed: { debugState(): Dbg } }).__untamed.debugState());

test('boots, renders, simulates, switches modes, saves', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('/');
  await expect(page.locator('h1')).toHaveText('Untamed Earth');
  await page.selectOption('#startQuality', 'low');
  await page.click('#btnNew');
  await expect(page.locator('#hud')).toBeVisible({ timeout: 90_000 });

  const s0 = await state(page);
  expect(s0.animals).toBeGreaterThan(150);
  expect(s0.chunks).toBeGreaterThan(20);
  expect(s0.calls).toBeGreaterThan(5);

  // the world advances on its own, faster under time acceleration
  await page.click('#speeds button[data-speed="100"]');
  await page.waitForTimeout(4000);
  const s1 = await state(page);
  expect(s1.tick).toBeGreaterThan(s0.tick + 20);
  // CI runs in software-rendered Chromium; achieved acceleration varies with CPU load.
  // Advance correctness is verified here, not a guaranteed wall-clock acceleration target.
  expect(s1.day).toBeGreaterThan(s0.day + 0.01);

  // wildlife mode possesses a real deer; releasing returns to observer
  await page.click('#modes button[data-mode="wildlife"]');
  const s2 = await state(page);
  expect(s2.mode).toBe('wildlife');
  expect(s2.controlled).toBeGreaterThan(0);
  await expect(page.locator('#wild')).toBeVisible();
  await page.click('#wildRelease');
  expect((await state(page)).controlled).toBe(0);

  // experiment panel and stats
  await page.click('#modes button[data-mode="experiment"]');
  await expect(page.locator('#experiment')).toBeVisible();
  await expect(page.locator('#chartPop')).toBeVisible();
  await page.click('#exAdd');
  expect((await state(page)).animals).toBeGreaterThanOrEqual(s2.animals + 5);

  // save through the pause menu
  await page.keyboard.press('Escape');
  await expect(page.locator('#menu')).toBeVisible();
  await page.click('#mSave');
  await expect(page.locator('#mSaveInfo')).toContainText('Saved', { timeout: 10_000 });
  await page.click('#mResume');
  await page.reload();
  await expect(page.locator('#btnContinue')).toBeVisible({ timeout: 10_000 });
  expect(errors, errors.join('\n')).toEqual([]);
});


test('restarting a world disposes the old renderer-owned materials and geometry', async ({ page }) => {
  await page.goto('/');
  await page.selectOption('#startQuality', 'low');
  await page.click('#btnNew');
  await expect(page.locator('#hud')).toBeVisible({ timeout: 90_000 });

  await page.evaluate(() => {
    const w = window as unknown as { __untamed: any; __restartProbe?: { old: unknown; hits: number[] } };
    const engine = w.__untamed.engine;
    const resources = [
      engine.sky.mesh.geometry,
      engine.sky.mesh.material,
      engine.grass.mesh.geometry,
      engine.grass.mesh.material,
      engine.water.mesh.geometry,
      engine.water.mesh.material,
      engine.weather.rain.geometry,
      engine.weather.rain.material,
      engine.animals.group.children[0].geometry,
      engine.animals.group.children[0].material,
    ];
    const hits = new Array<number>(resources.length).fill(0);
    for (let i = 0; i < resources.length; i++) {
      resources[i].addEventListener('dispose', () => { hits[i]!++; });
    }
    w.__restartProbe = { old: w.__untamed, hits };
  });

  await page.click('#btnMenu');
  await expect(page.locator('#menu')).toBeVisible();
  page.once('dialog', (dialog) => { void dialog.accept('1986'); });
  await page.click('#mNew');
  await page.waitForFunction(() => {
    const w = window as unknown as { __untamed: unknown; __restartProbe?: { old: unknown } };
    return Boolean(w.__restartProbe && w.__untamed !== w.__restartProbe.old);
  });
  await expect(page.locator('#hud')).toBeVisible({ timeout: 90_000 });
  const counts = await page.evaluate(() => (window as unknown as { __restartProbe: { hits: number[] } }).__restartProbe.hits);
  expect(counts).toHaveLength(10);
  expect(counts.every((n) => n === 1), 'every old GPU resource must be disposed once').toBe(true);
});
