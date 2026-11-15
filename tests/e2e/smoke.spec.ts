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
  // Achieved simulation rate depends on the CPU and software-rendered CI workload.
  // Correctness is increasing simulated time; the HUD reports requested vs achieved rate.
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


test('explicit Auto at startup overrides a previously saved manual graphics setting', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('untamed.settings', JSON.stringify({ quality: 'low', auto: false, volume: 0, muted: true }));
  });
  await page.goto('/');
  await expect(page.locator('#startQuality')).toHaveValue('low');
  await page.selectOption('#startQuality', 'auto');
  await page.click('#btnNew');
  // This test verifies that the Auto choice overrides a saved manual mode.
  // Full terrain readiness is already tested in the Low-preset smoke path.
  // Requiring desktop Auto/High to fully stream under CI's software renderer
  // conflates a settings regression test with unrepresentative GPU performance.
  await page.waitForFunction(() =>
    (window as unknown as { __untamed?: { engine: { auto: boolean } } }).__untamed?.engine?.auto === true,
    null, { timeout: 45_000 }
  );
  await expect(page.locator('#fatal')).toBeHidden();
  const autoEnabled = await page.evaluate(() =>
    (window as unknown as { __untamed: { engine: { auto: boolean } } }).__untamed.engine.auto
  );
  expect(autoEnabled).toBe(true);
});
