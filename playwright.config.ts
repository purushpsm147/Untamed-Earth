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
    { name: 'naturalism', testMatch: 'tests/e2e/naturalism-ab.spec.ts' },
    { name: 'naturalism-v3', testMatch: 'tests/e2e/slice1-naturalism-ab.spec.ts' },
  ],
});
