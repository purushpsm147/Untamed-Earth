import { expect, test } from '@playwright/test';
import { g, watch } from './helpers';

/**
 * Assignment D: the repeatable documentary scenario (?scenario=documentary, src/scenario/documentary.ts).
 * Seed, time of day and camera are fixed at start; nothing is scripted afterwards. The walk-through: arrive in Observer
 * with animals in view, switch to Curiosity, interrupt it, inspect real identities, save, reload, and find the same
 * animals. Stage screenshots go to test-artifacts/documentary/ and the project records an unedited video.
 */
const shot = (n: string): { path: string } => ({ path: `test-artifacts/documentary/${n}.png` });

test('documentary scenario: observe, Curiosity, interrupt, inspect, save and reload continuity', async ({ page, context }) => {
  const p = watch(page);
  await page.goto('/?scenario=documentary&qa=1');
  await expect(page.locator('#startNote')).toContainText('Documentary scenario');
  await expect(page.locator('#seed')).toHaveValue('2');
  await page.selectOption('#startQuality', 'low');
  await page.click('#btnNew');
  await expect(page.locator('#hud')).toBeVisible({ timeout: 180_000 });

  // 1. Arrival: the fixed starting state, paused by ?qa=1 so it can be read exactly
  const start = await g(page, (G) => {
    const s = (window as unknown as { __scenario: any }).__scenario; // eslint-disable-line @typescript-eslint/no-explicit-any
    return { s, c: G.debugCamera(), tick: G.sim.tick as number, hour: G.sim.env.hour as number, weather: G.sim.env.weather as string, mode: G.mode };
  });
  expect(start.s).toBeTruthy();
  expect(start.tick).toBe(start.s.conditions.tick);
  expect(start.hour).toBeCloseTo(16.5, 1);
  expect(start.weather).toBe('clear');
  expect(start.mode).toBe('observer');
  expect(Math.hypot(start.c.x - start.s.pose.x, start.c.z - start.s.pose.z)).toBeLessThan(0.01);
  expect(start.s.herd.inSight).toBeGreaterThanOrEqual(5);
  await page.waitForTimeout(1500); // let terrain and animals finish drawing
  // measured on the rendered camera: herd deer in frame and how large they are drawn
  const drawn = await g(page, (G) => {
    const s = (window as unknown as { __scenario: any }).__scenario; // eslint-disable-line @typescript-eslint/no-explicit-any
    return G.sim.animals.filter((a: any) => a.alive && a.sp === 0 && a.group === s.herd.group) // eslint-disable-line @typescript-eslint/no-explicit-any
      .map((a: any) => (G as any).debugProject(a.id)).filter((p: any) => p && p.inFrame); // eslint-disable-line @typescript-eslint/no-explicit-any
  });
  const big = drawn.filter((p: { heightFrac: number }) => p.heightFrac > 0.06);
  expect(drawn.length).toBeGreaterThanOrEqual(5);
  expect(big.length).toBeGreaterThanOrEqual(3); // at least three deer drawn taller than 6% of the frame
  await page.waitForTimeout(1500); // let terrain and animals finish drawing
  await page.screenshot(shot('1-arrival'));

  // the world now runs on its own
  await g(page, (G) => G.setSpeed(1));
  await expect.poll(() => g(page, (G) => G.sim.tick as number), { timeout: 30_000 }).toBeGreaterThan(start.tick + 20);

  // 2. Curiosity picks a real subject
  await page.keyboard.press('KeyV');
  await expect.poll(() => g(page, (G) => G.mode)).toBe('curiosity');
  await expect.poll(() => g(page, (G) => G.debugCuriosity().key), { timeout: 15_000 }).not.toBeNull();
  await page.waitForTimeout(2500);
  await page.screenshot(shot('2-curiosity'));
  const subject = await g(page, (G) => G.debugCuriosity().key);

  // 3. Interrupt: any movement key hands the camera back immediately
  await page.keyboard.down('KeyS');
  await expect.poll(() => g(page, (G) => G.mode), { timeout: 15_000 }).toBe('observer');
  await page.keyboard.up('KeyS');

  // 4. Inspect identities: the panel shows the simulation's own record for a herd member
  const herdId = await g(page, (G) => {
    const s = (window as unknown as { __scenario: any }).__scenario; // eslint-disable-line @typescript-eslint/no-explicit-any
    // the herd deer drawn largest on screen right now (the one a viewer would point at)
    const herd = G.sim.animals.filter((x: any) => x.alive && x.sp === 0 && x.group === s.herd.group); // eslint-disable-line @typescript-eslint/no-explicit-any
    const size = (x: any): number => { const p = (G as any).debugProject(x.id); return p && p.inFrame ? p.heightFrac : 0; }; // eslint-disable-line @typescript-eslint/no-explicit-any
    const a = herd.reduce((b: any, x: any) => (size(x) > size(b) ? x : b), herd[0]); // eslint-disable-line @typescript-eslint/no-explicit-any
    G.setSpeed(0);
    G.select(a.id);
    return a.id as number;
  });
  await expect(page.locator('#inspect')).toBeVisible();
  await expect(page.locator('#insName')).toContainText(`#${herdId}`);
  await expect(page.locator('#insSci')).toContainText('Axis axis');
  const before = await g(page, (G) => {
    const a = G.debugAnimal(G.selected);
    return { hash: G.sim.stateHash() as number, a: { id: a.id, sex: a.sex, group: a.group, mother: a.mother, age: a.age, x: a.x, z: a.z, beh: a.beh, hunger: a.hunger } };
  });
  const meta = await page.locator('#insMeta').textContent();
  await page.click('#insFollow'); // frame the inspected deer (camera only)
  await page.waitForTimeout(2500);
  await page.screenshot(shot('3-inspect'));

  // 5. Save, close, reopen: the same animals with the same state
  await page.keyboard.press('Escape');
  await page.click('#mSave');
  await expect(page.locator('#mSaveInfo')).toContainText('Saved', { timeout: 15_000 });
  await page.close();
  const page2 = await context.newPage();
  const p2 = watch(page2);
  await page2.goto('/?qa=1');
  await expect(page2.locator('#btnContinue')).toContainText('seed 2', { timeout: 15_000 });
  await page2.click('#btnContinue');
  await expect(page2.locator('#hud')).toBeVisible({ timeout: 180_000 });
  const after = await g(page2, (G) => ({ hash: G.sim.stateHash() as number }));
  expect(after.hash).toBe(before.hash);
  const again = await page2.evaluate((id) => {
    const G = (window as unknown as { __untamed: any }).__untamed; // eslint-disable-line @typescript-eslint/no-explicit-any
    G.select(id);
    const a = G.debugAnimal(id);
    return { id: a.id, sex: a.sex, group: a.group, mother: a.mother, age: a.age, x: a.x, z: a.z, beh: a.beh, hunger: a.hunger };
  }, herdId);
  expect(again).toEqual(before.a);
  await expect(page2.locator('#insMeta')).toHaveText(meta ?? '');
  await page2.click('#insFollow');
  await page2.waitForTimeout(2500);
  await page2.screenshot(shot('4-reloaded'));
  // and it keeps living
  await g(page2, (G) => G.setSpeed(1));
  await expect.poll(() => g(page2, (G) => G.sim.stateHash() as number), { timeout: 30_000 }).not.toBe(before.hash);
  console.log(JSON.stringify({ scenario: start.s, drawn: drawn.map((p: { heightFrac: number }) => Math.round(p.heightFrac * 1000) / 1000), curiositySubject: subject, inspected: before.a }));
  expect(p.errors).toEqual([]);
  expect(p2.errors).toEqual([]);
});
