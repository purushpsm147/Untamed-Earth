import { defineConfig } from '@playwright/test';

/**
 * Headless Chromium has no GPU here, so WebGL runs on SwiftShader (software).
 * Functional results are valid; frame rates are NOT representative of real hardware.
 */
const gl = { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-precise-memory-info', '--js-flags=--expose-gc'] };

export default defineConfig({
  timeout: 240_000,
  workers: 1,
  outputDir: 'test-artifacts/playwright',
  reporter: [['list'], ['json', { outputFile: 'test-artifacts/playwright/results.json' }]],
  snapshotPathTemplate: 'tests/visual/baseline/{arg}{ext}',
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.03, threshold: 0.2, animations: 'disabled' } },
  use: { baseURL: 'http://localhost:4173', trace: 'retain-on-failure', screenshot: 'only-on-failure', launchOptions: gl, viewport: { width: 1280, height: 720 } },
  webServer: { command: 'npm run preview', url: 'http://localhost:4173', reuseExistingServer: true, timeout: 60_000 },
  projects: [
    { name: 'smoke', testMatch: 'tests/e2e/smoke.spec.ts' },
    { name: 'gameplay', testMatch: 'tests/e2e/gameplay.spec.ts' },
    { name: 'reliability', testMatch: 'tests/e2e/reliability.spec.ts' },
    // UX-01 Living Valley V1 experience (Social Lens persistence, documentary cuts, observer, chital cues, onboarding)
    { name: 'experience', testMatch: 'tests/e2e/experience.spec.ts' },
    // unedited capture of the documentary walk-through (test-artifacts/playwright/.../video.webm)
    { name: 'documentary', testMatch: 'tests/e2e/documentary.spec.ts', use: { video: 'on' } },
    // opt-in guided player journey with video (docs/JOURNEY.md; not in npm run test:e2e)
    { name: 'journey', testMatch: 'tests/e2e/journey.spec.ts', use: { video: 'on' } },
    // opt-in visual evidence for movement modes (not in npm run test:e2e)
    { name: 'locomotion-capture', testMatch: 'tests/e2e/locomotion-capture.spec.ts', use: { video: 'on' } },
  ],
});
