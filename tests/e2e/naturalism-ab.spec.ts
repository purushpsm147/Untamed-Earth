import * as fs from 'node:fs';
import * as path from 'node:path';
import { expect, test } from '@playwright/test';

interface PacingMetric {
  shotId: 'riverbank_vista' | 'chital_closeup';
  mode: 'baseline' | 'naturalistic';
  quality: string;
  viewport: [number, number];
  warmupFrames: number;
  sampleFrames: number;
  rafMeanMs: number;
  rafP50Ms: number;
  rafP95Ms: number;
  rafFps: number;
  rasterMeanMs: number;
  rasterP50Ms: number;
  rasterP95Ms: number;
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
  programs: number;
  meanLuma: number;
  stdLuma: number;
}

test.describe('Visual & Audio Naturalism Vertical Slice (Assignments A–E)', () => {
  test.setTimeout(600_000);

  test('renders terrain-clamped riverbank_vista and chital_closeup in baseline and naturalistic modes at 720p and 1080p', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });

    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/?slice=1');

    await expect(page.locator('#natural-slice-panel')).toBeVisible({ timeout: 60_000 });

    // 1. Verify neither shot places the camera or lookAt underground
    const poses = await page.evaluate(() => {
      const app = (window as unknown as {
        __naturalSlice: {
          getShotCameraPose(id: 'riverbank_vista' | 'chital_closeup'): {
            cam: [number, number, number];
            look: [number, number, number];
            groundAtCam: number;
            groundAtLook: number;
          };
        };
      }).__naturalSlice;
      return {
        vista: app.getShotCameraPose('riverbank_vista'),
        closeup: app.getShotCameraPose('chital_closeup'),
      };
    });

    expect(poses.vista.cam[1]).toBeGreaterThan(poses.vista.groundAtCam + 1.0);
    expect(poses.vista.look[1]).toBeGreaterThan(poses.vista.groundAtLook + 0.5);
    expect(poses.closeup.cam[1]).toBeGreaterThan(poses.closeup.groundAtCam + 0.8);
    expect(poses.closeup.look[1]).toBeGreaterThan(poses.closeup.groundAtLook + 0.4);

    const outDir = path.resolve(process.cwd(), 'test-results', 'naturalism-slice');
    fs.mkdirSync(outDir, { recursive: true });

    const metrics: PacingMetric[] = [];

    // 2. Measure & capture both shots in baseline vs naturalistic at 1280x720
    for (const shotId of ['riverbank_vista', 'chital_closeup'] as const) {
      for (const mode of ['baseline', 'naturalistic'] as const) {
        const res = await page.evaluate(
          async ({ s, m }) => {
            const app = (window as unknown as {
              __naturalSlice: {
                resize(w?: number, h?: number): void;
                measureEndToEndPacing(
                  shot: 'riverbank_vista' | 'chital_closeup',
                  mode: 'baseline' | 'naturalistic',
                  warmup: number,
                  samples: number,
                ): Promise<PacingMetric>;
                capturePngDataUrl(): string;
              };
            }).__naturalSlice;
            app.resize(1280, 720);
            const pacing = await app.measureEndToEndPacing(s, m, 6, 16);
            const png = app.capturePngDataUrl();
            return { pacing, png };
          },
          { s: shotId, m: mode },
        );

        expect(res.pacing.meanLuma).toBeGreaterThan(0.08);
        expect(res.pacing.stdLuma).toBeGreaterThan(0.03);
        metrics.push(res.pacing);

        const buf = Buffer.from(res.png.replace(/^data:image\/png;base64,/, ''), 'base64');
        expect(buf.byteLength).toBeGreaterThan(10_000);
        fs.writeFileSync(path.join(outDir, `${shotId}_${mode}_720p.png`), buf);
      }
    }

    // 3. Measure & capture 1920x1080 (1080p) scenario for both modes on `riverbank_vista`
    await page.setViewportSize({ width: 1920, height: 1080 });
    for (const mode of ['baseline', 'naturalistic'] as const) {
      const res1080 = await page.evaluate(
        async ({ m }) => {
          const app = (window as unknown as {
            __naturalSlice: {
              resize(w?: number, h?: number): void;
              measureEndToEndPacing(
                shot: 'riverbank_vista' | 'chital_closeup',
                mode: 'baseline' | 'naturalistic',
                warmup: number,
                samples: number,
              ): Promise<PacingMetric>;
              capturePngDataUrl(): string;
            };
          }).__naturalSlice;
          app.resize(1920, 1080);
          const pacing = await app.measureEndToEndPacing('riverbank_vista', m, 4, 12);
          const png = app.capturePngDataUrl();
          return { pacing, png };
        },
        { m: mode },
      );

      expect(res1080.pacing.viewport).toEqual([1920, 1080]);
      metrics.push(res1080.pacing);

      const buf = Buffer.from(res1080.png.replace(/^data:image\/png;base64,/, ''), 'base64');
      fs.writeFileSync(path.join(outDir, `riverbank_vista_${mode}_1080p.png`), buf);
    }

    fs.writeFileSync(
      path.join(outDir, 'naturalism-metrics.json'),
      JSON.stringify({ timestamp: new Date().toISOString(), metrics }, null, 2),
    );

    // 4. Verify idempotent disposal zeroes geometries & textures
    const afterDispose = await page.evaluate(() => {
      const app = (window as unknown as {
        __naturalSlice: {
          dispose(): void;
          renderer: { info: { memory: { geometries: number; textures: number } } };
        };
      }).__naturalSlice;
      app.dispose();
      app.dispose();
      return app.renderer.info.memory;
    });
    expect(afterDispose.geometries).toBe(0);
    expect(afterDispose.textures).toBe(0);

    expect(errors, errors.join('\n')).toEqual([]);
  });
});
