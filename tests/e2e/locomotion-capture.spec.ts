import { test, expect } from '@playwright/test';
import { enter, frames, g } from './helpers';

// Opt-in visual evidence for Mission 2 (not part of `npm run test:e2e`):
//   npx playwright test --project=locomotion-capture --trace off
// Normal game route; the real simulation is advanced until an animal is found in each movement mode the simulation
// reports (swim, wade, flying low just after take-off); the camera follows it at 1x and a screenshot is taken. For each,
// the simulation mode and the rendered body height against water surface and ground are recorded, so the waterline is
// checked numerically as well as by eye. Screenshots: test-artifacts/locomotion/*.png, numbers: *.json.

const MODE = { Walk: 0, Wade: 1, Swim: 2, Fly: 3, Perch: 4 };
const OUT = 'test-artifacts/locomotion';

interface Found { id: number; sp: number; mode: number; alt: number; depth: number; x: number; z: number }

test('capture swimming, wading and take-off from real simulation state', async ({ page }) => {
  test.setTimeout(900_000);
  await enter(page, { quality: 'medium', seed: 1 });
  // conditions on the simulation's own state; species 4 and 5 are the flying species (crow, myna)
  const want: [string, string][] = [
    ['swim', `a.mode === ${MODE.Swim}`],
    ['wade', `a.mode === ${MODE.Wade} && a.sp < 4 && depth > 0.15`],
    ['takeoff', `a.mode === ${MODE.Fly} && a.alt > 0.5 && a.alt < 3 && a.speed > 2`],
  ];
  const report: Record<string, unknown> = {};
  for (const [name, cond] of want) {
    let found: Found | null = null;
    for (let tries = 0; tries < 400 && !found; tries++) {
      found = (await page.evaluate(`(() => {
        const G = window.__untamed; const sim = G.sim;
        G.debugStepTo(sim.tick + 50);
        let best = null; let bd = 1e18;
        for (const a of sim.animals) {
          if (!a.alive) continue;
          const depth = sim.valley.waterDepth(a.x, a.z, sim.env.stage);
          if (!(${cond})) continue;
          const d = (a.x - G.cam.x) ** 2 + (a.z - G.cam.z) ** 2;
          if (d < bd) { bd = d; best = { id: a.id, sp: a.sp, mode: a.mode, alt: a.alt, depth, x: a.x, z: a.z }; }
        }
        return best;
      })()`)) as Found | null;
    }
    expect(found, `found an animal to show (${name})`).not.toBeNull();
    const id = found!.id;
    await g(page, (G) => G.setSpeed(1));
    await page.evaluate((i) => { const G = window.__untamed; G.select(i); G.following = true; }, id);
    await frames(page, 90);
    const state = await page.evaluate((i) => {
      const G = window.__untamed;
      const a = G.debugAnimal(i);
      const sim = G.sim;
      return a ? { id: i, sp: a.sp, mode: a.mode, alt: a.alt, beh: a.beh, ground: a.ground, rendered: a.rendered, waterSurface: sim.valley.waterSurface(a.z) + sim.env.stage, depth: sim.valley.waterDepth(a.x, a.z, sim.env.stage) } : null;
    }, id);
    await page.screenshot({ path: `${OUT}/${name}.png` });
    report[name] = { found, atCapture: state };
  }
  const fs = await import('node:fs');
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 1));
});
