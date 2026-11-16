import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as THREE from 'three';
import { ChitalPrototypeV4 } from '../../apps/web/src/experiments/naturalism/ChitalPrototypeV4';

const EVIDENCE = path.resolve(process.cwd(), 'docs/evidence/slice1-v4');
const SHOTS = ['riverbank_vista', 'chital_closeup'] as const;
const COMPARISONS = [
  { label: 'baseline', variant: 'v3', mode: 'baseline' },
  { label: 'v3', variant: 'v3', mode: 'naturalistic' },
  { label: 'v4', variant: 'v4', mode: 'naturalistic' },
] as const;

test.describe('V4 skinned chital — opt-in, isolated renderer experiment', () => {
  test.setTimeout(12 * 60_000);
  test.beforeAll(() => fs.mkdirSync(EVIDENCE, { recursive: true }));

  test('skin body is a closed indexed manifold; material attributes are complete', () => {
    const rig = new ChitalPrototypeV4(150, 'stag');
    try {
      const geo = rig.skinnedBody.geometry;
      const idx = geo.index!;
      expect(idx).toBeTruthy();
      const edges = new Map<string, number>();
      for (let i = 0; i < idx.count; i += 3) {
        const v = [idx.getX(i), idx.getX(i + 1), idx.getX(i + 2)];
        for (let e = 0; e < 3; e++) {
          const a = Math.min(v[e], v[(e + 1) % 3]);
          const b = Math.max(v[e], v[(e + 1) % 3]);
          const key = `${a}:${b}`;
          edges.set(key, (edges.get(key) ?? 0) + 1);
        }
      }
      const openEdges = [...edges.values()].filter(n => n !== 2);
      expect(openEdges, 'Every body triangle edge must be paired (caps and seam)').toHaveLength(0);
      let checked = 0;
      rig.root.traverse((obj) => {
        if (!(obj instanceof THREE.Mesh)) return;
        if (obj.material === rig.skinnedBody.material) {
          expect(obj.geometry.getAttribute('aBodyPos'), `pelage on ${obj.name || obj.type} lacks aBodyPos`).toBeTruthy();
          checked++;
        }
      });
      expect(checked).toBeGreaterThan(6);
      const skin = rig.skinnedBody.skeleton;
      expect(skin.bones.length).toBe(8);
      expect(skin.boneInverses.length).toBe(8);
      expect(skin.bones.every(b => Number.isFinite(b.matrixWorld.elements[12]))).toBe(true);
    } finally {
      rig.dispose();
    }
  });

  test('new GLSL source has no descending literal smoothstep edges', () => {
    const code = fs.readFileSync(
      path.resolve(process.cwd(), 'apps/web/src/experiments/naturalism/ChitalPrototypeV4.ts'),
      'utf8',
    );
    const re = /smoothstep\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,/g;
    const matches = [...code.matchAll(re)];
    expect(matches.length).toBeGreaterThanOrEqual(10);
    for (const m of matches) {
      expect(Number(m[1]), `reversed smoothstep ${m[0]}`).toBeLessThan(Number(m[2]));
    }
  });

  test('baseline, V3 and V4 render through one live scene and renderer at 720p/1080p', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', m => { if (m.type() === 'error' || /THREE.WebGLProgram/.test(m.text())) errors.push(m.text()); });
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('/?slice=1&variant=v4&mode=naturalistic', { waitUntil: 'load' });
    await expect(page.locator('#natural-slice-panel')).toBeVisible({ timeout: 90_000 });

    const cases: Record<string, unknown> = {};
    for (const vp of [
      { tag: '720p', width: 1280, height: 720 },
      { tag: '1080p', width: 1920, height: 1080 },
    ]) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      for (const shot of SHOTS) {
        for (const item of COMPARISONS) {
          await page.evaluate(({ variant, mode, shot, width, height }) => {
            const app = window.__naturalSlice;
            if (!app) throw Error('Original /?slice=1 renderer was not mounted');
            app.resize(width, height);
            app.v3.setVariant(variant);
            app.selectShot(shot);
            app.setMode(mode);
          }, { ...item, shot, width: vp.width, height: vp.height });
          // A short functional shader smoke, NOT a physical GPU benchmark.
          await page.evaluate(() => new Promise<void>(resolve => {
            let count = 0;
            const frame = () => { if (++count === 8) resolve(); else requestAnimationFrame(frame); };
            requestAnimationFrame(frame);
          }));
          const diag = await page.evaluate(() => window.__SLICE1_DIAGNOSTICS__);
          expect(diag).toBeTruthy();
          expect(diag!.variant).toBe(item.variant);
          expect(diag!.activeChitalCount).toBeGreaterThan(0);
          expect(Number.isFinite(diag!.maxStanceHoofErrorMeters)).toBe(true);
          expect(Number.isFinite(diag!.maxStanceFootHorizontalErrorMeters)).toBe(true);
          const file = `${shot}-${item.label}-${vp.tag}.png`;
          await page.screenshot({ path: path.join(EVIDENCE, file), fullPage: false });
          cases[`${shot}_${vp.tag}_${item.label}`] = { ...diag, screenshot: file };
        }
      }
    }
    fs.writeFileSync(path.join(EVIDENCE, 'functional-smoke.json'), JSON.stringify({
      note: 'SwiftShader functional render only; grounding ≤5mm and motion acceptance not established by this smoke.',
      cases, errors,
    }, null, 2));
    expect(errors).toEqual([]);
  });
});
