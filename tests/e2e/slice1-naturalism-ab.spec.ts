import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  CHITAL_PELAGE_FRAGMENT_PARS,
  CHITAL_PELAGE_COLOR_CHUNK,
} from '../../apps/web/src/experiments/naturalism/NaturalRiverbankLab';

const EVIDENCE_DIR = path.resolve(process.cwd(), 'docs/evidence/slice1-v3');

test.describe('PR #12 Naturalism v3 — /?slice=1 Integration, Grounding & Evidence Capture', () => {
  test.setTimeout(15 * 60_000); // CI SwiftShader can run far below physical GPU throughput
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
    // Load WebGL2 and seed 150 once: repeated 'networkidle' reloads caused the first
    // CI attempt to time out before any diagnostic or screenshot was produced.
    await page.goto('/?slice=1', { waitUntil: 'load' });
    await expect(page.locator('#natural-slice-panel')).toBeVisible({ timeout: 90_000 });

    // The rig faces local +X. A yaw of 'heading' therefore points along
    // (cos heading, -sin heading) in world X/Z. The reference close-up must
    // show the stag's and doe's faces, not the backs of their heads.
    const closeupFacing = await page.evaluate(() => {
      const app = (window as any).__naturalSlice;
      if (!app) throw new Error('Natural riverbank app not mounted');
      const shot = app.getShotCameraPose('chital_closeup');
      return app.focalAnimals.slice(0, 2).map((animal: { x: number; z: number; heading: number }) => {
        const dx = shot.cam[0] - animal.x;
        const dz = shot.cam[2] - animal.z;
        return (Math.cos(animal.heading) * dx - Math.sin(animal.heading) * dz) / Math.hypot(dx, dz);
      });
    });
    expect(closeupFacing).toHaveLength(2);
    for (const score of closeupFacing) {
      expect(score, 'Hero deer must face the documentary close-up camera').toBeGreaterThan(0.75);
    }

    const resolutions = [
      { label: '720p', width: 1280, height: 720 },
      { label: '1080p', width: 1920, height: 1080 },
    ] as const;
    const presets = ['riverbank_vista', 'chital_closeup'] as const;
    const modes = ['baseline', 'naturalistic'] as const;

    // Software WebGL screenshots are evidence of shader/rendering correctness, not GPU speed.
    // On slow SwiftShader CI, sample fewer frames while keeping the full 180-frame route
    // available for local hardware validation. Preserve the same shot and viewport matrix.
    const isCI = !!process.env.CI;
    const warmupFrames = isCI ? 8 : 30;
    const sampleFrames = isCI ? 36 : 180;
    const contactFailures: string[] = [];
    const benchmarkReport: Record<string, any> = {
      capturedAtIso: new Date().toISOString(),
      userAgent: await page.evaluate(() => navigator.userAgent),
      platform: isCI ? 'CI software renderer; performance figures not comparable to physical GPUs' : 'developer browser',
      warmupFrames,
      sampleFrames,
      runs: {},
    };

    for (const res of resolutions) {
      await page.setViewportSize({ width: res.width, height: res.height });

      for (const preset of presets) {
        for (const mode of modes) {
          const caseLabel = `${preset} / ${mode} / ${res.label}`;
          await page.evaluate(({ preset, mode, w, h }) => {
            const app = window.__naturalSlice;
            if (!app) throw new Error('Natural riverbank app was not mounted');
            app.resize(w, h);
            app.selectShot(preset);
            app.setMode(mode);
          }, { preset, mode, w: res.width, h: res.height });

          // Warm up, reset sample buffer, then collect a bounded number of browser frames.
          await page.evaluate(async ({ warmupFrames, sampleFrames }) => {
            const waitFrames = (n: number) =>
              new Promise<void>((resolve) => {
                let count = 0;
                const step = () => {
                  if (++count >= n) resolve();
                  else requestAnimationFrame(step);
                };
                requestAnimationFrame(step);
              });
            await waitFrames(warmupFrames);
            (window as any).__SLICE1_CONTROLLER__?.resetFramePacingSamples?.();
            await waitFrames(sampleFrames);
          }, { warmupFrames, sampleFrames });

          const diag = await page.evaluate(() => (window as any).__SLICE1_DIAGNOSTICS__);
          expect(diag, `Missing __SLICE1_DIAGNOSTICS__ in ${caseLabel}`).toBeTruthy();

          if (mode === 'naturalistic') {
            // Record failures instead of aborting before we can inspect the screenshot:
            // the required 5mm threshold and 2-axis alignment gate remain unchanged.
            if (!(diag.maxStanceHoofErrorMeters < 0.005)) {
              contactFailures.push(`${caseLabel}: stance error ${diag.maxStanceHoofErrorMeters} m (must be < 0.005m)`);
            }
            if (!(Math.abs(diag.heroPitchRad) + Math.abs(diag.heroRollRad) > 0.001)) {
              contactFailures.push(`${caseLabel}: expected real pitch/roll alignment`);
            }
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
    benchmarkReport.contactFailures = contactFailures;
    fs.writeFileSync(reportPath, JSON.stringify(benchmarkReport, null, 2), 'utf8');
    expect(contactFailures, 'The 5mm hoof-contact and two-axis-alignment gates must pass at every shot and resolution')
      .toEqual([]);
  });
});

