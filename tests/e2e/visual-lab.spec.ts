import * as fs from 'node:fs';
import * as path from 'node:path';
import { expect, test } from '@playwright/test';
import type { LabFullSuiteReport } from '../../apps/web/src/lab/VisualLabScene';

test('visual lab renders 5 fixed-seed presets, compiles baseline & enhanced shaders cleanly, benchmarks p50/p95, captures PNGs, and disposes resources', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/?lab=1');

  await expect(page.locator('#visual-lab-panel')).toBeVisible({ timeout: 30_000 });

  const report = await page.evaluate((): LabFullSuiteReport => {
    const lab = window.__visualLab;
    if (!lab) throw new Error('window.__visualLab was not mounted');
    return lab.runFullSuite(8, 30);
  });

  expect(report.seed).toBe(150);
  expect(report.shaderDiagnostics.length).toBeGreaterThan(0);
  for (const diag of report.shaderDiagnostics) {
    expect(diag.compiled, `Shader ${diag.name} (${diag.mode}) failed to compile/link`).toBe(true);
    expect(diag.vertexLog).toBe('');
    expect(diag.fragmentLog).toBe('');
    expect(diag.programLog).toBe('');
  }
  expect(report.allShadersClean).toBe(true);

  // Verify all 5 presets x 2 modes = 10 benchmark records and 10 non-empty PNG screenshots
  expect(report.benchmarks).toHaveLength(10);
  const outDir = path.resolve(process.cwd(), 'test-results', 'visual-lab');
  fs.mkdirSync(outDir, { recursive: true });

  for (const b of report.benchmarks) {
    expect(b.sampleFrames).toBe(30);
    expect(b.p50Ms).toBeGreaterThan(0);
    expect(b.p95Ms).toBeGreaterThanOrEqual(b.p50Ms);
    expect(b.drawCallsPerFrame).toBeGreaterThan(3);
    expect(b.trianglesPerFrame).toBeGreaterThan(1000);

    const key = `${b.presetId}_${b.mode}`;
    const dataUrl = report.screenshots[key];
    expect(dataUrl).toBeDefined();
    expect(dataUrl!.startsWith('data:image/png;base64,')).toBe(true);

    const base64 = dataUrl!.replace(/^data:image\/png;base64,/, '');
    const buf = Buffer.from(base64, 'base64');
    expect(buf.byteLength).toBeGreaterThan(5000);
    fs.writeFileSync(path.join(outDir, `${key}.png`), buf);
  }

  // Save structured JSON report (without raw base64 strings) for engineering review
  const { screenshots: _omitted, ...summaryReport } = report;
  fs.writeFileSync(
    path.join(outDir, 'visual-lab-report.json'),
    JSON.stringify(summaryReport, null, 2),
  );

  // Verify idempotent disposal zeroes out lab-owned geometry/texture memory
  const afterDispose = await page.evaluate(() => {
    const lab = window.__visualLab!;
    lab.dispose();
    lab.dispose(); // idempotent second call
    return {
      geometries: lab.renderer.info.memory.geometries,
      textures: lab.renderer.info.memory.textures,
    };
  });

  expect(afterDispose.geometries).toBe(0);
  expect(afterDispose.textures).toBe(0);
  expect(errors).toEqual([]);
});
