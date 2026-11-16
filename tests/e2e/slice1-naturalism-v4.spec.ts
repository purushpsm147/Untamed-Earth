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
      const vertexCount = geo.getAttribute('position').count;
      // Topological closure alone can be falsely green when the cap indices
      // reference vertices never uploaded to the GPU. Guard every attribute.
      const maxIndex = Math.max(...Array.from(idx.array));
      expect(maxIndex, 'No triangle may reference a missing GPU vertex').toBeLessThan(vertexCount);
      for (const name of ['aBodyPos', 'uv', 'skinIndex', 'skinWeight']) {
        expect(geo.getAttribute(name).count, `${name} count`).toBe(vertexCount);
      }
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

  test('IK fore/aft targets agree with the actual Three.js limb rotation convention', () => {
    const rig = new ChitalPrototypeV4(150, 'stag');
    // Inspect the actual private articulation used by the rendered rig rather
    // than rewriting its algorithm as a second "test-only" implementation.
    const internal = rig as unknown as {
      upperLimbs: THREE.Group[];
      lowerLimbs: THREE.Group[];
      solveTwoBoneLimbIK: (i: number, dy: number, dz: number, hind: boolean) => void;
    };
    try {
      for (const limb of [0, 1, 2, 3]) {
        const hind = limb >= 2;
        const L1 = hind ? 0.42 : 0.39;
        const L2 = hind ? 0.44 : 0.41;
        for (const [dy, dz] of [[-0.70, -0.18], [-0.70, 0.18], [-0.72, 0.0]]) {
          internal.solveTwoBoneLimbIK(limb, dy, dz, hind);
          const upper = internal.upperLimbs[limb].rotation.x;
          const lower = internal.lowerLimbs[limb].rotation.x;
          // RotX(+theta) applied to initial (0,-L,0) yields negative Z.
          const fkY = -L1 * Math.cos(upper) - L2 * Math.cos(upper + lower);
          const fkZ = -L1 * Math.sin(upper) - L2 * Math.sin(upper + lower);
          expect(Math.abs(fkY - dy), `limb ${limb} Y target`).toBeLessThan(1e-5);
          expect(Math.abs(fkZ - dz), `limb ${limb} fore/aft target`).toBeLessThan(1e-5);
        }
      }
    } finally {
      rig.dispose();
    }
  });

  test('300-frame displacement-driven walk measures actual stance pivot errors', () => {
    const rig = new ChitalPrototypeV4(150, 'stag');
    const vertical: number[] = [];
    const horizontal: number[] = [];
    const dt = 1 / 60;
    const speed = 0.65;
    try {
      for (let frame = 0; frame < 300; frame++) {
        const t = frame * dt;
        const diagnostic = rig.update(
          {
            id: 1, x: 0, z: t * speed, heading: 0, speed,
            state: 'walk', sex: 'stag', seed: 150,
          },
          dt,
          { getHeightAt: () => 0 },
          t,
        );
        vertical.push(diagnostic.maxStanceFootErrorMeters);
        horizontal.push(diagnostic.maxStanceFootHorizontalErrorMeters);
        expect(diagnostic.footHeightsWorld.every(Number.isFinite)).toBe(true);
        expect(diagnostic.terrainHeightsWorld.every(Number.isFinite)).toBe(true);
      }
      const sort = (values: number[]) => [...values].sort((a, b) => a - b);
      const sortedVertical = sort(vertical);
      const sortedHorizontal = sort(horizontal);
      const summary = {
        type: 'flat-terrain synthetic animal motion',
        frames: 300,
        simulatedSeconds: 5,
        speedMetersPerSecond: speed,
        metric: 'hoof pivot (not geometry outsole)',
        verticalMaxMeters: sortedVertical.at(-1),
        verticalP95Meters: sortedVertical[Math.floor(sortedVertical.length * 0.95)],
        horizontalMaxMeters: sortedHorizontal.at(-1),
        horizontalP95Meters: sortedHorizontal[Math.floor(sortedHorizontal.length * 0.95)],
        caveat: 'Not a hill test, visual motion assessment, or real world autonomous-ecology sample.',
      };
      fs.writeFileSync(path.join(EVIDENCE, 'synthetic-300-frame-contact.json'), JSON.stringify(summary, null, 2));
      // The existing V3 5mm threshold is NOT relaxed. This V4 synthetic test
      // separately demands the same bound for the pivot on a flat plane.
      expect(summary.verticalMaxMeters).toBeLessThan(0.005);
      expect(summary.horizontalMaxMeters).toBeLessThan(0.005);
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
