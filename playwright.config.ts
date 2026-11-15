import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/e2e',
  // Running two software-WebGL scenes simultaneously makes metrics incomparable
  // and can starve the unrelated ecology smoke test.
  workers: 1,
  timeout: 120000,
  use: { baseURL: 'http://localhost:4173', trace: 'off', launchOptions: { args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] } },
  webServer: { command: 'npm run preview', url: 'http://localhost:4173', reuseExistingServer: true, timeout: 60000 },
});
