import { expect, test } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

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

  // Playwright fill() is not supported for range inputs; fire the browser's input event.
  await page.locator('#snd-dist').evaluate((node) => {
    const slider = node as HTMLInputElement;
    slider.value = '140';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  });
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

test('soundscape exports a valid 48-second stereo 44.1 kHz PCM audition', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/?soundscape=1');
  const downloadPromise = page.waitForEvent('download', { timeout: 165_000 });
  await page.locator('#snd-export').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('untamed-earth-soundscape-audition.wav');
  const local = await download.path();
  expect(local).toBeTruthy();
  const bytes = await readFile(local!);
  expect(bytes.toString('ascii', 0, 4)).toBe('RIFF');
  expect(bytes.toString('ascii', 8, 12)).toBe('WAVE');
  expect(bytes.readUInt16LE(22)).toBe(2);
  expect(bytes.readUInt32LE(24)).toBe(44100);
  expect(bytes.readUInt16LE(34)).toBe(16);
  expect(bytes.length).toBe(44 + 48 * 44100 * 2 * 2);
  const outputDir = path.resolve(process.cwd(), 'test-results', 'soundscape');
  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, 'untamed-earth-soundscape-audition.wav'), bytes);
});
