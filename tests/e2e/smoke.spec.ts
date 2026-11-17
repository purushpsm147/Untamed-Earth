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
  const a = await state(page);
  await page.waitForTimeout(4000);
  const s1 = await state(page);
  expect(s1.tick).toBeGreaterThan(a.tick + 20);
  // The wall-clock rate achieved depends on the machine (software-rendered CI is slow), so this floor is loose;
  // the HUD reports requested vs achieved rate.
  expect(s1.day).toBeGreaterThan(s0.day + 0.01);
  // HOW time accelerates is hardware-independent and is asserted exactly: at 100x every tick is a coarse 1 s
  // step (one game-minute), ten times the 1x step. Acceleration is more simulation per step, not faster animation.
  const minutesPerTick = ((s1.day - a.day) * 1440) / (s1.tick - a.tick);
  expect(minutesPerTick).toBeGreaterThan(0.95);
  expect(minutesPerTick).toBeLessThan(1.05);

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

test('Observer has independent yaw, pitch, bank/roll and optical zoom without touching ecology', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?qa=1');
  await page.selectOption('#startQuality', 'low');
  await page.click('#btnNew');
  await expect(page.locator('#hud')).toBeVisible({ timeout: 90_000 });
  const read = (): Promise<{ yaw: number; pitch: number; roll: number; fov: number; hash: number }> => page.evaluate(() => {
    const G = (window as unknown as { __untamed: {
      debugCamera(): { yaw: number; pitch: number; roll: number; fov: number };
      sim: { stateHash(): number };
    } }).__untamed;
    return { ...G.debugCamera(), hash: G.sim.stateHash() };
  });
  const before = await read();
  expect(before.roll).toBe(0);
  expect(before.fov).toBe(62);

  await page.keyboard.down('KeyL');
  try {
    await expect.poll(async () => (await read()).yaw, { timeout: 20_000 }).toBeGreaterThan(before.yaw + 0.08);
  } finally {
    await page.keyboard.up('KeyL');
  }
  const turned = await read();
  await page.keyboard.down('KeyI');
  try {
    await expect.poll(async () => (await read()).pitch, { timeout: 20_000 }).toBeGreaterThan(turned.pitch + 0.08);
  } finally {
    await page.keyboard.up('KeyI');
  }
  await page.keyboard.down('KeyU');
  try {
    await expect.poll(async () => (await read()).roll, { timeout: 20_000 }).toBeGreaterThan(0.08);
  } finally {
    await page.keyboard.up('KeyU');
  }
  const banked = await read();
  expect(banked.yaw).toBeGreaterThan(before.yaw);
  expect(banked.pitch).toBeGreaterThan(before.pitch);

  // Alt+wheel changes optical field of view, whereas ordinary wheel still adjusts fly speed.
  await page.evaluate(() => {
    document.getElementById('view')!.dispatchEvent(new WheelEvent('wheel', {
      deltaY: -100, altKey: true, bubbles: true, cancelable: true,
    }));
  });
  await expect.poll(async () => (await read()).fov, { timeout: 20_000 }).toBeLessThan(62);
  expect((await read()).hash).toBe(before.hash);

  // B levels the camera and resets optical zoom without snapping its direction.
  const aiming = await read();
  await page.keyboard.press('KeyB');
  await expect.poll(async () => (await read()).roll, { timeout: 20_000 }).toBe(0);
  expect((await read()).fov).toBe(62);
  expect((await read()).yaw).toBeCloseTo(aiming.yaw, 3);
  expect((await read()).pitch).toBeCloseTo(aiming.pitch, 3);
  expect((await read()).hash).toBe(before.hash);
  expect(errors).toEqual([]);
});

test('opt-in camera culling retains visible animals and leaves paused ecology untouched', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?qa=1&animalCulling=B');
  await page.selectOption('#startQuality', 'low'); // no shadows: camera-only pruning is measurable
  await page.click('#btnNew');
  await expect(page.locator('#hud')).toBeVisible({ timeout: 90_000 });
  const before = await page.evaluate(() => (window as unknown as { __untamed: { sim: { stateHash(): number } } }).__untamed.sim.stateHash());
  await expect.poll(() => page.evaluate(() => {
    const G = (window as unknown as { __untamed: { engine: { animals: {
      debugCulling(): { mode: string; candidates: number; rendered: number; culled: number; overflow: number }
    } } } }).__untamed;
    return G.engine.animals.debugCulling().mode;
  }), { timeout: 30_000 }).toBe('camera-shadow');
  await expect.poll(() => page.evaluate(() => {
    const G = (window as unknown as { __untamed: { engine: { animals: {
      debugCulling(): { candidates: number; rendered: number; culled: number; overflow: number }
    } } } }).__untamed;
    return G.engine.animals.debugCulling().candidates;
  }), { timeout: 30_000 }).toBeGreaterThan(0);
  const after = await page.evaluate(() => {
    const G = (window as unknown as { __untamed: {
      engine: { animals: { debugCulling(): { candidates: number; rendered: number; culled: number; overflow: number } } };
      sim: { stateHash(): number };
    } }).__untamed;
    return { ...G.engine.animals.debugCulling(), hash: G.sim.stateHash() };
  });
  expect(after.rendered).toBeLessThanOrEqual(after.candidates);
  expect(after.culled).toBeGreaterThan(0);
  expect(after.overflow).toBe(0);
  expect(after.hash).toBe(before);
  expect(errors).toEqual([]);
});
