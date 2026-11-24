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
    // unedited capture of the documentary walk-through (test-artifacts/playwright/.../video.webm)
    { name: 'documentary', testMatch: 'tests/e2e/documentary.spec.ts', use: { video: 'on' } },
    // opt-in visual evidence for movement modes (not in npm run test:e2e)
    { name: 'locomotion-capture', testMatch: 'tests/e2e/locomotion-capture.spec.ts', use: { video: 'on' } },
    // AUD-01 soundscape lab gates; the browser must refuse audio without a user gesture
    { name: 'audio', testMatch: 'tests/e2e/audio-lab.spec.ts', use: { launchOptions: { args: [...gl.args, '--autoplay-policy=user-gesture-required'] } } },
    // opt-in: renders the review recordings to test-artifacts/audio (npm run audio:render)
    { name: 'audio-render', testMatch: 'tests/e2e/audio-render.spec.ts', timeout: 900_000 },
  ],
});
