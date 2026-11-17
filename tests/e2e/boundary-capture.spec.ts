import { test, expect, type Page } from '@playwright/test';
import { enter, frames, g } from './helpers';

// Opt-in visual evidence for the open valley boundary (issue #29, owner decision 4; not part of `npm run test:e2e`):
//   npx playwright test --project=boundary-capture --trace off
// Normal game route with ?boundary=open. The real simulation is advanced until an animal is actually walking in through
// the transit corridor (entry) and out of it (exit); the simulation is paused at that moment (rendering continues), the
// camera follows it, and a screenshot is taken; then the simulation resumes and a second screenshot is taken. For each,
// the rendered body height is compared with the exact terrain height at the animal (the corridor lies outside the
// region). Pursuit: a jackal chasing a hare into the corridor is staged from real animals (positions only; everything
// after that is the simulation). Screenshots: test-artifacts/boundary/*.png, numbers: boundary.json. Video: Playwright.

const OUT = 'test-artifacts/boundary';

interface Seen { id: number; sp: number; x: number; z: number; transit: number; beh: number }

async function findTransit(page: Page, transit: number, maxTries: number): Promise<Seen | null> {
  for (let i = 0; i < maxTries; i++) {
    const f = (await page.evaluate(`(() => {
      const G = window.__untamed; const sim = G.sim;
      G.debugStepTo(sim.tick + 40);
      const R = 1440;
      for (const a of sim.animals) {
        if (!a.alive || a.transit !== ${transit}) continue;
        const out = Math.max(-a.x, -a.z, a.x - R, a.z - R);
        if (out < 6 || out > 20) continue; // well inside the corridor, outside the region
        return { id: a.id, sp: a.sp, x: a.x, z: a.z, transit: a.transit, beh: a.beh };
      }
      return null;
    })()`)) as Seen | null;
    if (f) return f;
  }
  return null;
}

async function state(page: Page, id: number): Promise<Record<string, number | boolean | null>> {
  return page.evaluate((i) => {
    const G = window.__untamed;
    const a = G.debugAnimal(i);
    if (!a) return { gone: true } as Record<string, number | boolean | null>;
    return { id: i, x: a.x, z: a.z, transit: a.transit ?? 0, off: !!a.off, beh: a.beh, exactGround: a.ground, rendered: a.rendered, tick: G.sim.tick };
  }, id);
}

async function capture(page: Page, name: string, id: number, report: Record<string, unknown>): Promise<void> {
  // pause: the simulation stops, rendering continues
  await g(page, (G) => G.setSpeed(0));
  await page.evaluate((i) => { const G = window.__untamed; G.select(i); G.following = true; }, id);
  await frames(page, 150);
  const paused1 = await state(page, id);
  await page.screenshot({ path: `${OUT}/${name}-paused.png` });
  await frames(page, 90);
  const paused2 = await state(page, id);
  // resume at 1x and let the crossing continue
  await g(page, (G) => G.setSpeed(1));
  await frames(page, 360);
  const resumed = await state(page, id);
  await page.screenshot({ path: `${OUT}/${name}-resumed.png` });
  report[name] = { paused1, paused2, resumed };
  const fs = await import('node:fs');
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(`${OUT}/${name}.json`, JSON.stringify(report[name], null, 2));
  expect(paused2.x, `${name}: paused simulation does not move the animal`).toBe(paused1.x);
  expect(paused2.tick).toBe(paused1.tick);
  expect(resumed.gone || resumed.off || resumed.x !== paused1.x || resumed.z !== paused1.z, `${name}: the crossing continues after resume`).toBe(true);
}

test('open boundary: entry, exit, pursuit and pause/resume from real simulation state', async ({ page }) => {
  test.setTimeout(2_400_000);
  await enter(page, { quality: 'medium', seed: 3, query: '/?boundary=open' });
  expect(await g(page, (G) => G.sim.boundary.open)).toBe(true);
  const report: Record<string, unknown> = {};

  const entry = await findTransit(page, 1, 600);
  expect(entry, 'an animal entering through the corridor').not.toBeNull();
  await capture(page, 'entry', entry!.id, report);

  const exit = await findTransit(page, -1, 600);
  expect(exit, 'an animal leaving through the corridor').not.toBeNull();
  await capture(page, 'exit', exit!.id, report);
});

test('open boundary: a pursuit into the corridor (staged start, simulated outcome)', async ({ page }) => {
  test.setTimeout(1_800_000);
  await enter(page, { quality: 'medium', seed: 3, query: '/?boundary=open' });
  const report: Record<string, unknown> = {};

  // pursuit: stage positions of a real hare and jackal at a passable west-edge crossing; the rest is the simulation
  const staged = await page.evaluate(() => {
    const G = window.__untamed; const sim = G.sim;
    const H = 3; const J = 2;
    let z = 100;
    for (; z < 1340; z += 9) if (sim.crossingOk({ locomotion: { wadeDepth: 0.15, swim: 'none' } }, 7, z, false) && sim.valley.waterDepth(40, z, sim.env.stage) < -0.3) break;
    const prey = sim.animals.find((a: { alive: boolean; sp: number; age: number }) => a.alive && a.sp === H && a.age > 20);
    const pred = sim.animals.find((a: { alive: boolean; sp: number; age: number }) => a.alive && a.sp === J && a.age > 40);
    if (!prey || !pred) return null;
    Object.assign(prey, { x: 22, z, px: 22, pz: z, beh: 6, fear: 1, threatX: 60, threatZ: z, tx: -60, tz: z, timer: 60, stamina: 1 });
    Object.assign(pred, { x: 36, z, px: 36, pz: z, beh: 9, targetId: prey.id, timer: 60, stamina: 1, hunger: 0.8 });
    return { prey: prey.id, pred: pred.id, z };
  });
  expect(staged).not.toBeNull();
  await page.evaluate((s) => { const G = window.__untamed; G.cam.x = 40; G.cam.z = s!.z + 30; }, staged);
  await g(page, (G) => G.setSpeed(1));
  let pursuit: Record<string, unknown> | null = null;
  for (let i = 0; i < 40 && !pursuit; i++) {
    await frames(page, 15);
    const s = await page.evaluate((ids) => {
      const G = window.__untamed; const sim = G.sim;
      const p = sim.byId.get(ids!.prey); const j = sim.byId.get(ids!.pred);
      return { preyX: p?.x ?? null, preyTransit: p?.transit ?? 0, preyOff: !!p?.off, preyAlive: !!p?.alive, predX: j?.x ?? null, predTransit: j?.transit ?? 0, predBeh: j?.beh ?? null, captured: sim.migration.pursuitCaptured[3], escaped: sim.migration.pursuitEscaped[3] };
    }, staged);
    if (s.preyTransit === -1 && (s.predTransit === -1 || (s.predX ?? 99) < 6) && !pursuit) {
      await g(page, (G) => G.setSpeed(0));
      await page.evaluate((ids) => { const G = window.__untamed; G.select(ids!.pred); G.following = true; }, staged);
      await frames(page, 120);
      await page.screenshot({ path: `${OUT}/pursuit-in-corridor.png` });
      pursuit = { inCorridor: s };
      await g(page, (G) => G.setSpeed(1));
    }
  }
  await frames(page, 600);
  const after = await page.evaluate((ids) => {
    const G = window.__untamed; const sim = G.sim;
    return { captured: sim.migration.pursuitCaptured[3], escaped: sim.migration.pursuitEscaped[3], preyOff: !!sim.byId.get(ids!.prey)?.off, preyKnown: sim.byId.has(ids!.prey) };
  }, staged);
  await page.screenshot({ path: `${OUT}/pursuit-after.png` });
  report.pursuit = { staged, ...pursuit, after };

  const fs = await import('node:fs');
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(`${OUT}/pursuit.json`, JSON.stringify(report, null, 2));
});
