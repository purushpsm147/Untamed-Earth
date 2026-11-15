import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  CHITAL_PELAGE_FRAGMENT_PARS,
  CHITAL_PELAGE_COLOR_CHUNK,
} from '../../apps/web/src/experiments/naturalism/NaturalRiverbankLab';

const EVIDENCE_DIR = path.resolve(process.cwd(), 'docs/evidence/slice1-v3');

test.describe('PR #12 Naturalism v3 — /?slice=1 Integration, Grounding & Evidence Capture', () => {
  test.beforeAll(() => {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  });

  test('GLSL smoothstep calls strictly satisfy edge0 < edge1', () => {
    const combinedGlsl = `${CHITAL_PELAGE_FRAGMENT_PARS}\n${CHITAL_PELAGE_COLOR_CHUNK}`;
    const literalSmoothstepRegex = /smoothstep\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,/g;
    let match: RegExpExecArray | null;
    let checkedCount = 0;

    while ((match = literalSmoothstepRegex.exec(combinedGlsl)) !== null) {
      const edge0 = parseFloat(match[1]);
      const edge1 = parseFloat(match[2]);
      expect(edge0, `Invalid smoothstep(${edge0}, ${edge1}, ...): edge0 must be < edge1`).toBeLessThan(edge1);
      checkedCount++;
    }
    expect(checkedCount).toBeGreaterThanOrEqual(7);
  });

  test('Captures genuine 720p/1080p baseline-vs-refined screenshots and frame-pacing metrics on /?slice=1', async ({
    page,
  }) => {
    const resolutions = [
      { label: '720p', width: 1280, height: 720 },
      { label: '1080p', width: 1920, height: 1080 },
    ] as const;
    const presets = ['riverbank_vista', 'chital_closeup'] as const;
    const modes = ['baseline', 'naturalistic'] as const;

    const benchmarkReport: Record<string, any> = {
      capturedAtIso: new Date().toISOString(),
      userAgent: await page.evaluate(() => navigator.userAgent),
      runs: {},
    };

    for (const res of resolutions) {
      await page.setViewportSize({ width: res.width, height: res.height });

      for (const preset of presets) {
        for (const mode of modes) {
          const url = `/?slice=1&preset=${preset}&mode=${mode}`;
          await page.goto(url, { waitUntil: 'networkidle' });

          // Warm up 30 frames, then reset pacing buffer and sample 180 frames (~3s at 60Hz)
          await page.evaluate(async () => {
            const waitFrames = (n: number) =>
              new Promise<void>((resolve) => {
                let count = 0;
                const step = () => {
                  if (++count >= n) resolve();
                  else requestAnimationFrame(step);
                };
                requestAnimationFrame(step);
              });
            await waitFrames(30);
            (window as any).__SLICE1_CONTROLLER__?.resetFramePacingSamples?.();
            await waitFrames(180);
          });

          const diag = await page.evaluate(() => (window as any).__SLICE1_DIAGNOSTICS__);
          expect(diag, `Missing __SLICE1_DIAGNOSTICS__ on ${url}`).toBeTruthy();

          if (mode === 'naturalistic') {
            // Verify v3 per-hoof IK grounding (no floating/clipping > 5mm) and 2-axis slope alignment
            expect(diag.maxStanceHoofErrorMeters).toBeLessThan(0.005);
            expect(Math.abs(diag.heroPitchRad) + Math.abs(diag.heroRollRad)).toBeGreaterThan(0.001);
          }

          const screenshotName = `slice1-${preset}-${mode}-${res.label}.png`;
          const screenshotPath = path.join(EVIDENCE_DIR, screenshotName);
          await page.screenshot({ path: screenshotPath, fullPage: false });

          const runKey = `${preset}_${res.label}_${mode}`;
          benchmarkReport[runKey] = {
            screenshot: `docs/evidence/slice1-v3/${screenshotName}`,
            diagnostics: diag,
          };
        }
      }
    }

    const reportPath = path.join(EVIDENCE_DIR, 'frame-pacing-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(benchmarkReport, null, 2), 'utf8');
  });
});

