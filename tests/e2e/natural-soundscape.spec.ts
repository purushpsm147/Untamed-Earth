import { expect, test } from '@playwright/test';

test('soundscape requires a gesture, attenuates with distance, mutes, and disposes', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto('/?soundscape=1');
  await expect(page.locator('#soundscape-demo-panel')).toBeVisible({ timeout: 60_000 });
  const telemetry = () => page.evaluate(() => window.__soundscapeDemo?.soundscape.getTelemetry());
  expect((await telemetry())?.started).toBe(false);

  await page.locator('#snd-start').click();
  await expect.poll(async () => (await telemetry())?.started, { timeout: 20_000 }).toBe(true);
  const nearGain = (await telemetry())?.riverGain ?? 0;
  expect(nearGain).toBeGreaterThan(0);

  await page.locator('#snd-dist').fill('140');
  await expect.poll(async () => (await telemetry())?.riverGain ?? 1, { timeout: 5_000 })
    .toBeLessThan(nearGain);
  await page.locator('#snd-mute').click();
  await expect.poll(async () => (await telemetry())?.muted).toBe(true);
  await page.locator('#snd-call-chital').click();
  await expect.poll(async () => (await telemetry())?.recentCalls.some(c => c.kind === 'chital_alarm')).toBe(true);
  await page.locator('#snd-mute').click();
  expect((await telemetry())?.muted).toBe(false);

  await page.evaluate(() => window.__soundscapeDemo?.dispose());
  await expect(page.locator('#soundscape-demo-panel')).toHaveCount(0);
  expect(errors).toEqual([]);
});
