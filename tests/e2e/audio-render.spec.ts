/**
 * Renders the AUD-01 review recordings (opt-in: npm run audio:render). Not a pass/fail gate for sound quality.
 * Output: test-artifacts/audio/<scenario>.wav + .cues.json, calibration.wav; scripts/audio-evidence.sh then makes
 * compressed listening copies, spectrograms and cue sheets under docs/evidence/audio/.
 */
import { expect, test } from '@playwright/test';
import fs from 'node:fs';

const OUT = 'test-artifacts/audio';

test('render every listening scenario and the headphone calibration', async ({ page }) => {
  fs.mkdirSync(OUT, { recursive: true });
  await page.goto('/?audiolab=1');
  await page.waitForFunction(() => Boolean((window as unknown as { __audioLab?: unknown }).__audioLab));
  const ids = await page.evaluate(() => Array.from(document.querySelectorAll<HTMLOptionElement>('#alScenario option')).map((o) => o.value));
  expect(ids.length).toBeGreaterThan(0);
  const ua = await page.evaluate(() => navigator.userAgent);
  for (const id of ids) {
    const r = await page.evaluate((id) => (window as unknown as { __audioLab: { recordWav(id: string): Promise<{ meta: unknown; cues: unknown[]; wavBase64: string }> } }).__audioLab.recordWav(id), id);
    fs.writeFileSync(`${OUT}/${id}.wav`, Buffer.from(r.wavBase64, 'base64'));
    fs.writeFileSync(`${OUT}/${id}.cues.json`, JSON.stringify({ scenario: id, browser: ua, meta: r.meta, cues: r.cues }, null, 1));
  }
  const c = await page.evaluate(() => (window as unknown as { __audioLab: { calibrationWav(): Promise<{ wavBase64: string; burstsAt: unknown; channelRms: unknown }> } }).__audioLab.calibrationWav());
  fs.writeFileSync(`${OUT}/calibration.wav`, Buffer.from(c.wavBase64, 'base64'));
  fs.writeFileSync(`${OUT}/calibration.json`, JSON.stringify({ browser: ua, burstsAt: c.burstsAt, channelRms: c.channelRms }, null, 1));
});
