import { test, expect, type Page } from '@playwright/test';
import { enter, frames, g } from './helpers';

// Opt-in visual evidence for issue #31 (not part of `npm run test:e2e`):
//   npx playwright test --project=maternal-capture --trace off
// Normal game route. Each scene places real animal records (cloned from animals of the same species) at an open spot
// near the camera; nothing is animated by script after that: what is shown is the simulation's own state. Screenshots:
// test-artifacts/maternal/*.png; the simulation state at each capture: maternal.json.

const OUT = 'test-artifacts/maternal';

/** Stage a scene in the page: returns ids. Runs inside the page; `spec` lists animals relative to an open spot. */
async function stageScene(page: Page, spec: { key: string; sp: number; dx: number; dz: number; age: 'adult' | number; sex?: 0 | 1; motherOf?: string; o?: Record<string, unknown> }[]): Promise<Record<string, number>> {
  return page.evaluate((spec) => {
    const G = window.__untamed; const sim = G.sim;
    const R = 1440;
    // an open dry spot near the middle of the valley, away from water and ruins
    let X = 0; let Z = 0;
    outer: for (let z = 300; z < R - 300; z += 31) for (let x = 300; x < R - 300; x += 31) {
      for (let dz = -30; dz <= 30; dz += 10) for (let dx = -30; dx <= 30; dx += 10) if (sim.valley.waterDepth(x + dx, z + dz, sim.env.stage) > -0.3 || sim.valley.blocked(x + dx, z + dz, 1)) continue outer;
      X = x; Z = z; break outer;
    }
    // clear the stage: other animals within 120 m move away (they keep their identity; only their position changes)
    for (const a of sim.animals) if (a.alive && Math.hypot(a.x - X, a.z - Z) < 120) { a.x = a.px = a.x + 400 > R - 20 ? a.x - 400 : a.x + 400; }
    const ids: Record<string, number> = {};
    for (const s of spec) {
      const proto = sim.animals.find((a: { sp: number; alive: boolean }) => a.sp === s.sp && a.alive);
      const a = { ...proto, id: sim.nextId++, alive: true, x: X + s.dx, z: Z + s.dz, px: X + s.dx, pz: Z + s.dz, tx: X + s.dx, tz: Z + s.dz, alt: 0, speed: 0, want: 0, beh: 0, timer: 0.5, hunger: 0.3, thirst: 0.2, health: 1, energy: 0.8, stamina: 1, fear: 0, pregnantH: 0, cooldownH: 0, mother: 0, young: 0, controlled: false, group: sim.nextId++, homeX: X + s.dx, homeZ: Z + s.dz, off: false, transit: 0, sex: s.sex ?? 0, age: s.age === 'adult' ? 400 : s.age, ...(s.o ?? {}) };
      sim.animals.push(a); sim.byId.set(a.id, a); ids[s.key] = a.id;
    }
    for (const s of spec) if (s.motherOf) { const m = sim.byId.get(ids[s.key]); const y = sim.byId.get(ids[s.motherOf]); y.mother = m.id; y.group = m.group; m.young = y.id; }
    G.cam.x = X - 18; G.cam.z = Z - 18;
    return { ...ids, X, Z };
  }, spec);
}

async function look(page: Page, id: number, name: string, report: Record<string, unknown>, extra: (G: unknown) => unknown = () => null): Promise<void> {
  await g(page, (G) => G.setSpeed(0));
  await page.evaluate((i) => { const G = window.__untamed; G.select(i); G.following = true; }, id);
  await frames(page, 120);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  report[name] = await page.evaluate(([i, f]) => {
    const G = window.__untamed; const sim = G.sim;
    const names = ['Idle', 'Wandering', 'Foraging', 'Seeking water', 'Drinking', 'Resting', 'Fleeing', 'Seeking mate', 'Stalking', 'Chasing', 'Approaching carrion', 'Feeding', 'Roosting', 'Following mother', 'Rejoining the herd', 'Alert', 'Defending young', 'Hiding'];
    const near = sim.animals.filter((a: { alive: boolean; x: number; z: number }) => a.alive && Math.hypot(a.x - sim.byId.get(i).x, a.z - sim.byId.get(i).z) < 40).map((a: { id: number; sp: number; beh: number; x: number; z: number; fear: number }) => ({ id: a.id, sp: a.sp, beh: names[a.beh], x: +a.x.toFixed(1), z: +a.z.toFixed(1), fear: +a.fear.toFixed(2) }));
    return { tick: sim.tick, near, interactions: { ...sim.interactions }, extra: f };
  }, [id, extra(null)] as const);
  await g(page, (G) => G.setSpeed(1));
}

test('maternal behaviour scenes from real simulation state', async ({ page }) => {
  test.setTimeout(2_400_000);
  await enter(page, { quality: 'medium', seed: 2 });
  const report: Record<string, unknown> = {};
  // daylight for the captures
  await page.evaluate(() => { const sim = window.__untamed.sim; sim.env.timeH = Math.floor(sim.env.timeH / 24) * 24 + 33; });

  // 1. a fawn settles beside its resting mother, then gets up and follows when she moves off
  const s1 = await stageScene(page, [
    { key: 'mother', sp: 0, dx: 0, dz: 0, age: 'adult', sex: 0, o: { beh: 5, energy: 0.2, timer: 30 } },
    { key: 'fawn', sp: 0, dx: 3, dz: 1, age: 4 },
  ]);
  await page.evaluate((ids) => { const sim = window.__untamed.sim; const y = sim.byId.get(ids.fawn); const m = sim.byId.get(ids.mother); y.mother = m.id; y.group = m.group; m.young = y.id; }, s1);
  await frames(page, 400);
  await look(page, s1.fawn!, '1-fawn-resting-beside-mother', report);
  await page.evaluate((ids) => { const m = window.__untamed.sim.byId.get(ids.mother); Object.assign(m, { beh: 1, tx: m.x + 40, tz: m.z + 10, timer: 20, want: 1.3, energy: 1 }); }, s1);
  await frames(page, 300);
  await look(page, s1.fawn!, '2-fawn-follows-mother', report);

  // 2. a jackal near a fawn: the mother steps between them
  const s2 = await stageScene(page, [
    { key: 'mother', sp: 0, dx: -10, dz: 0, age: 'adult', sex: 0 },
    { key: 'fawn', sp: 0, dx: 0, dz: 0, age: 4 },
    { key: 'jackal', sp: 2, dx: 15, dz: 0, age: 'adult', sex: 1, o: { hunger: 0.6 } },
  ]);
  await page.evaluate((ids) => { const sim = window.__untamed.sim; const y = sim.byId.get(ids.fawn); const m = sim.byId.get(ids.mother); y.mother = m.id; y.group = m.group; m.young = y.id; }, s2);
  await frames(page, 240);
  await look(page, s2.mother!, '3-chital-mother-defends', report);

  // 3. a sow with a piglet and a jackal: she charges, it withdraws
  const s3 = await stageScene(page, [
    { key: 'sow', sp: 1, dx: -8, dz: 0, age: 'adult', sex: 0 },
    { key: 'piglet', sp: 1, dx: 0, dz: 0, age: 3 },
    { key: 'jackal', sp: 2, dx: 13, dz: 0, age: 'adult', sex: 1, o: { hunger: 0.6 } },
  ]);
  await page.evaluate((ids) => { const sim = window.__untamed.sim; const y = sim.byId.get(ids.piglet); const m = sim.byId.get(ids.sow); y.mother = m.id; y.group = m.group; m.young = y.id; }, s3);
  await frames(page, 90);
  await look(page, s3.sow!, '4-sow-charges', report);
  await frames(page, 240);
  await look(page, s3.jackal!, '5-jackal-withdraws', report);

  // 4. a jackal watches an adult chital walking toward it
  const s4 = await stageScene(page, [
    { key: 'jackal', sp: 2, dx: 0, dz: 0, age: 'adult', sex: 1, o: { hunger: 0.1 } },
    { key: 'deer', sp: 0, dx: 22, dz: 0, age: 'adult', sex: 1, o: { beh: 1, timer: 30, want: 1.3 } },
  ]);
  await page.evaluate((ids) => { const sim = window.__untamed.sim; const d = sim.byId.get(ids.deer); d.tx = d.x - 60; d.tz = d.z; }, s4);
  await frames(page, 200);
  await look(page, s4.jackal!, '6-jackal-alert', report);

  const fs = await import('node:fs');
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(`${OUT}/maternal.json`, JSON.stringify(report, null, 2));
  const st = await page.evaluate(() => window.__untamed.sim.interactions);
  expect(st.defends).toBeGreaterThan(0);
});
