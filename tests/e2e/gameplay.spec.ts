import { expect, test } from '@playwright/test';
import { PLACES, enter, g, hold, watch } from './helpers';

test.describe('gameplay scenarios', () => {
  test('observer camera: every direction, every area, terrain clearance and bounds', async ({ page }) => {
    const p = watch(page);
    await enter(page);
    await g(page, (G) => G.debugCam(760, 640, 12, 0, 0));
    const pos = (): Promise<{ x: number; y: number; z: number; yaw: number; pitch: number; ground: number }> => g(page, (G) => G.debugCamera());
    const moved = async (keys: string[]): Promise<{ dx: number; dy: number; dz: number }> => {
      const a = await pos();
      await hold(page, keys, 700);
      const b = await pos();
      return { dx: b.x - a.x, dy: b.y - a.y, dz: b.z - a.z };
    };
    // yaw 0 looks along +z; screen-right is -x
    // magnitudes are frame-rate dependent on the software renderer, so assert direction, dominance of the
    // intended axis, and a minimum of real movement
    const w = await moved(['KeyW']);
    expect(w.dz).toBeGreaterThan(1);
    expect(Math.abs(w.dx)).toBeLessThan(w.dz * 0.2);
    expect((await moved(['KeyS'])).dz).toBeLessThan(-1);
    const d = await moved(['KeyD']);
    expect(d.dx).toBeLessThan(-1);
    expect(Math.abs(d.dz)).toBeLessThan(-d.dx * 0.2);
    expect((await moved(['KeyA'])).dx).toBeGreaterThan(1);
    expect((await moved(['Space'])).dy).toBeGreaterThan(1);
    expect((await moved(['KeyQ'])).dy).toBeLessThan(-0.5);
    const slow = (await moved(['KeyW'])).dz;
    const fast = (await moved(['ShiftLeft', 'KeyW'])).dz;
    expect(fast).toBeGreaterThan(slow * 2);
    // mouse drag turns the view
    const before = await pos();
    await page.mouse.move(640, 400);
    await page.mouse.down();
    await page.mouse.move(840, 330, { steps: 6 });
    await page.mouse.up();
    const after = await pos();
    expect(Math.abs(after.yaw - before.yaw)).toBeGreaterThan(0.3);
    expect(after.pitch).toBeGreaterThan(before.pitch);
    // the camera cannot be pushed under the ground or out of the region
    await g(page, (G) => G.debugCam(40, 40, 3, 3.9, -1.2));
    await hold(page, ['ShiftLeft', 'KeyW'], 2500);
    const edge = await pos();
    expect(edge.x).toBeGreaterThanOrEqual(4);
    expect(edge.z).toBeGreaterThanOrEqual(4);
    expect(edge.y).toBeGreaterThanOrEqual(edge.ground + 1.2);
    // all four areas are reachable and identified by the HUD
    for (const [name, [x, z, up, yaw, pitch, label]] of Object.entries(PLACES)) {
      await g(page, new Function('G', `G.debugCam(${x},${z},${up},${yaw},${pitch})`) as never);
      await page.waitForTimeout(900);
      await expect(page.locator('#clockSub'), name).toContainText(label);
      const c = await pos();
      expect(c.y, name).toBeGreaterThanOrEqual(c.ground + 1.2);
      expect((await g(page, (G) => G.debugGfx())).chunks, name).toBeGreaterThan(8);
    }
    expect(p.errors).toEqual([]);
  });

  test('wildlife: walk, run, graze, drink, rest, sense and escape a predator, release', async ({ page }) => {
    const p = watch(page);
    await enter(page);
    await page.click('#modes button[data-mode="wildlife"]');
    const deer = (): Promise<any> => g(page, (G) => G.debugAnimal()); // eslint-disable-line @typescript-eslint/no-explicit-any
    const d0 = await deer();
    expect(d0.controlled).toBe(true);
    const identity = { id: d0.id, sex: d0.sex, group: d0.group, mother: d0.mother };
    // fixture: open meadow, a known appetite
    await g(page, (G) => {
      const a = G.sim.byId.get(G.controlled);
      Object.assign(a, { x: 800, z: 660, px: 800, pz: 660, hunger: 0.6, thirst: 0.6, stamina: 1, energy: 0.5 });
      G.cam.yaw = 0;
    });
    await page.waitForTimeout(400);
    // walk
    // speeds are checked against simulated time (ticks x 0.1 s), which is what the animal actually experienced
    const tick = (): Promise<number> => g(page, (G) => G.sim.tick as number);
    let a = await deer();
    let t0 = await tick();
    await hold(page, ['KeyW'], 2000);
    let b = await deer();
    const walkSpeed = Math.hypot(b.x - a.x, b.z - a.z) / (((await tick()) - t0) * 0.1);
    expect(walkSpeed).toBeGreaterThan(1.3); // chital walk 1.3 m/s; the player's brisk walk is 1.6x
    expect(walkSpeed).toBeLessThan(2.6);
    expect(b.stamina).toBeCloseTo(1, 1);
    // run: several times faster, and it costs stamina
    a = b;
    t0 = await tick();
    await hold(page, ['ShiftLeft', 'KeyW'], 2000);
    b = await deer();
    const runSpeed = Math.hypot(b.x - a.x, b.z - a.z) / (((await tick()) - t0) * 0.1);
    expect(runSpeed).toBeGreaterThan(walkSpeed * 3);
    expect(runSpeed).toBeLessThan(13.5);
    expect(b.stamina).toBeLessThan(0.995);
    // the drawn deer stands on the ground
    expect(Math.abs(b.rendered - b.ground)).toBeLessThan(1.2);
    // graze: hunger falls and the forage comes out of the cell
    await g(page, (G) => G.setSpeed(10));
    const cellVeg = (): Promise<{ veg: number; h: number }> => g(page, (G) => { const d = G.sim.byId.get(G.controlled); const c = G.sim.env.cellIndex(d.x, d.z); return { veg: G.sim.env.veg[c] as number, h: G.sim.env.timeH as number }; });
    const v0 = await cellVeg();
    a = await deer();
    // graze until at least 0.4 simulated hours have passed, however fast this machine renders
    await page.keyboard.down('KeyE');
    await expect.poll(async () => (await cellVeg()).h - v0.h, { timeout: 60_000 }).toBeGreaterThan(0.4);
    await page.keyboard.up('KeyE');
    b = await deer();
    const v1 = await cellVeg();
    const perHour = (b.hunger - a.hunger) / (v1.h - v0.h);
    // model: a chital eats 2.2 kg/day in ~7 h of feeding, i.e. about -0.07 hunger/h on good forage, against +0.02/h metabolism
    expect(perHour).toBeLessThan(-0.02);
    expect(perHour).toBeGreaterThan(-0.09);
    expect(v1.veg).toBeLessThan(v0.veg); // and the forage came out of the cell
    // drinking does nothing on dry land...
    a = await deer();
    await hold(page, ['KeyF'], 800);
    expect((await deer()).thirst).toBeGreaterThanOrEqual(a.thirst);
    // ...and works at the water's edge
    await g(page, (G) => {
      const d = G.sim.byId.get(G.controlled);
      const s = G.sim.env.findWater(d.x, d.z, 900);
      Object.assign(d, { x: s.x, z: s.z, px: s.x, pz: s.z });
    });
    await expect(page.locator('#wildPrompt')).toContainText('F: drink', { timeout: 5000 });
    a = await deer();
    await hold(page, ['KeyF'], 2500);
    b = await deer();
    expect(b.thirst).toBeLessThan(a.thirst - 0.05);
    // rest: toggled with R, recovers energy, cancelled by moving
    await g(page, (G) => { const d = G.sim.byId.get(G.controlled); Object.assign(d, { x: 800, z: 660, px: 800, pz: 660, energy: 0.3 }); });
    await page.keyboard.press('KeyR');
    await page.waitForTimeout(3000);
    b = await deer();
    expect(b.beh).toBe(5);
    expect(b.energy).toBeGreaterThan(0.3);
    await g(page, (G) => G.setSpeed(1));
    // stand up first: a resting animal detects threats only half the time per check (lower vigilance, by design),
    // which made this step flaky. An alert deer detects a jackal 6 m away on its next check (every 2-4 s).
    await hold(page, ['KeyW'], 300);
    await expect.poll(async () => (await deer()).beh).not.toBe(5);
    // a predator close by is perceived (not scripted): fear rises, the HUD warns, and running opens the gap
    await g(page, (G) => {
      const d = G.sim.byId.get(G.controlled);
      const j = G.sim.animals.find((o: any) => o.sp === 2 && o.age > 60); // eslint-disable-line @typescript-eslint/no-explicit-any
      Object.assign(j, { x: d.x + 6, z: d.z, px: d.x + 6, pz: d.z, hunger: 0, beh: 5, timer: 9999, speed: 0 });
      d.stamina = 1;
      G.cam.yaw = -Math.PI / 2; // face away from the jackal (which is at +x)
      (window as any).__jackal = j.id; // eslint-disable-line @typescript-eslint/no-explicit-any
    });
    await expect.poll(async () => (await deer()).fear, { timeout: 8000 }).toBeGreaterThan(0.3);
    await expect(page.locator('#wildPrompt')).toContainText('Predator');
    await hold(page, ['ShiftLeft', 'KeyW'], 2500);
    const gap = await g(page, (G) => { const d = G.sim.byId.get(G.controlled); const j = G.sim.byId.get((window as any).__jackal); return Math.hypot(d.x - j.x, d.z - j.z) as number; }); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(gap).toBeGreaterThan(18);
    // release: same individual, state carried over, autonomy resumes
    const pre = await deer();
    await page.keyboard.press('KeyX');
    await expect.poll(() => g(page, (G) => ({ mode: G.mode, controlled: G.controlled, following: G.following }))).toEqual({ mode: 'observer', controlled: 0, following: true });
    await page.waitForTimeout(4500);
    const post = await g(page, (G) => G.debugAnimal(G.selected));
    expect({ id: post.id, sex: post.sex, group: post.group, mother: post.mother }).toEqual(identity);
    expect(post.controlled).toBe(false);
    expect(post.age).toBeGreaterThan(pre.age);
    expect(Math.abs(post.hunger - pre.hunger)).toBeLessThan(0.1);
    expect(p.errors).toEqual([]);
  });

  test('select by clicking, follow a moving animal, Social Lens shows only real relationships', async ({ page }) => {
    const p = watch(page);
    await enter(page);
    // pause first: a walking deer leaves the screen centre between "stop following" and the click (CI flake)
    await g(page, (G) => G.setSpeed(0));
    expect(await g(page, (G) => G.debugFollow('chital', 6))).toBe(true);
    await page.waitForTimeout(800);
    const id = await g(page, (G) => G.selected);
    await g(page, (G) => { G.following = false; G.select(0); });
    await expect(page.locator('#inspect')).toBeHidden();
    await page.waitForTimeout(300); // let a frame render without the selection
    // click where that deer actually is on screen
    const at = await page.evaluate((id) => {
      const G = (window as unknown as { __untamed: any }).__untamed; // eslint-disable-line @typescript-eslint/no-explicit-any
      const v = G.engine.animals.pos.get(id).clone().project(G.engine.camera);
      const r = G.engine.canvas.getBoundingClientRect();
      return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
    }, id);
    await page.mouse.click(at.x, at.y);
    await expect(page.locator('#inspect')).toBeVisible();
    await g(page, (G) => G.setSpeed(1));
    const picked = await g(page, (G) => G.selected);
    const same = await g(page, (G) => { const a = G.sim.byId.get(G.selected); return a.sp as number; });
    expect(same).toBe(0);
    expect(picked).toBeGreaterThan(0);
    void id;
    // lens content matches simulation state
    const truth = await g(page, (G) => {
      const a = G.sim.byId.get(G.selected);
      return { n: G.sim.animals.filter((o: any) => o.alive && o.group === a.group && o.sp === a.sp).length as number, mother: a.mother as number }; // eslint-disable-line @typescript-eslint/no-explicit-any
    });
    await expect(page.locator('#insSocial')).toContainText(truth.n > 1 ? `herd of ${truth.n}` : 'alone');
    await expect(page.locator('#insSocial')).toContainText(truth.mother ? `#${truth.mother}` : 'founding animal');
    await page.click('#insGroup');
    await expect(page.locator('#insGroup')).toHaveClass(/on/);
    // follow: the camera tracks the animal as it travels (accelerated so it covers ground and crosses chunks)
    await page.keyboard.press('KeyG');
    await g(page, (G) => G.setSpeed(10));
    const track: number[] = [];
    const start = await g(page, (G) => { const a = G.sim.byId.get(G.selected); return { x: a.x as number, z: a.z as number }; });
    let travelled = 0;
    for (let i = 0; i < 12; i++) {
      await page.waitForTimeout(1000);
      const s = await g(page, (G) => { const a = G.sim.byId.get(G.selected); const c = G.debugCamera(); return a && a.alive ? { d: Math.hypot(a.x - c.x, a.z - c.z), x: a.x as number, z: a.z as number, below: c.y < c.ground } : null; });
      if (!s) break; // it died; legitimate
      track.push(s.d);
      travelled = Math.max(travelled, Math.hypot(s.x - start.x, s.z - start.z));
      expect(s.below).toBe(false);
    }
    expect(Math.max(...track)).toBeLessThan(40);
    expect(await g(page, (G) => G.selected)).toBe(picked);
    test.info().annotations.push({ type: 'followed-distance-m', description: travelled.toFixed(1) });
    expect(p.errors).toEqual([]);
  });

  test('experiment: levers reach the simulation, time acceleration works, reset is exact', async ({ page }) => {
    const p = watch(page);
    await enter(page, { seed: 9 });
    const initial = await g(page, (G) => ({ day: G.sim.env.timeH / 24, n: G.sim.animals.length as number }));
    await page.click('#modes button[data-mode="experiment"]');
    await page.selectOption('#exMode', 'drought');
    await page.locator('#exRain').fill('0');
    await page.locator('#exVeg').fill('0.5');
    await page.selectOption('#exSpecies', 'jackal');
    await page.locator('#exFert').fill('2');
    await page.click('#exCull');
    const s = await g(page, (G) => ({ p: G.sim.env.params, f: G.sim.fertility[2] as number, jackals: G.sim.population(2) as number, exp: G.sim.deaths[2][6] as number }));
    expect(s.p).toEqual({ rainMult: 0, vegGrowthMult: 0.5, weatherMode: 'drought' });
    expect(s.f).toBe(2);
    expect(s.jackals).toBe(0);
    expect(s.exp).toBeGreaterThan(0);
    const m0 = await g(page, (G) => ({ m: G.sim.env.meanMoisture as number, day: G.sim.env.timeH / 24 }));
    await page.click('#speeds button[data-speed="1000"]');
    await page.waitForTimeout(12_000);
    const m1 = await g(page, (G) => ({ m: G.sim.env.meanMoisture as number, day: G.sim.env.timeH / 24, rain: G.sim.env.rain as number }));
    expect(m1.day).toBeGreaterThan(m0.day + 1.5); // days in seconds: acceleration is extra simulation, not faster animation
    expect(m1.m).toBeLessThan(m0.m - 0.05); // the drought dries the soil
    expect(m1.rain).toBe(0);
    await page.click('#speeds button[data-speed="0"]');
    const t = await g(page, (G) => G.sim.tick as number);
    await page.waitForTimeout(1000);
    expect(await g(page, (G) => G.sim.tick as number)).toBe(t); // pause really pauses
    // the population chart has drawn something
    const ink = await page.evaluate(() => {
      const cv = document.getElementById('chartPop') as HTMLCanvasElement;
      const d = cv.getContext('2d')!.getImageData(0, 0, cv.width, cv.height).data;
      let n = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i]! > 0) n++;
      return n;
    });
    expect(ink).toBeGreaterThan(500);
    // reset from the same seed returns to the same initial world
    await page.fill('#exSeed', '9');
    await page.click('#exReset');
    await expect(page.locator('#hud')).toBeVisible({ timeout: 120_000 });
    const r = await g(page, (G) => ({ day: G.sim.env.timeH / 24, n: G.sim.animals.length as number, mode: G.sim.env.params.weatherMode as string, seed: G.sim.seed as number }));
    expect(r.seed).toBe(9);
    expect(Math.abs(r.day - initial.day)).toBeLessThan(0.05);
    expect(Math.abs(r.n - initial.n)).toBeLessThanOrEqual(3);
    expect(r.mode).toBe('natural');
    expect(p.errors).toEqual([]);
  });

  test('save, close, reopen: the restored world is the saved world', async ({ page, context }) => {
    const p = watch(page);
    await enter(page, { seed: 5 });
    await g(page, (G) => G.setSpeed(100));
    await page.waitForTimeout(5000);
    await g(page, (G) => { G.setSpeed(0); G.debugCam(900, 500, 20, 1.0, -0.3); });
    const saved = await g(page, (G) => ({ hash: G.sim.stateHash() as number, n: G.sim.animals.length as number, day: G.sim.env.timeH / 24, births: G.sim.births as number[] }));
    await page.keyboard.press('Escape');
    await page.click('#mSave');
    await expect(page.locator('#mSaveInfo')).toContainText('Saved', { timeout: 15_000 });
    await page.close();
    const page2 = await context.newPage();
    const p2 = watch(page2);
    await page2.goto('/?qa=1');
    await expect(page2.locator('#btnContinue')).toBeVisible({ timeout: 15_000 });
    await expect(page2.locator('#btnContinue')).toContainText('seed 5');
    await page2.click('#btnContinue');
    await expect(page2.locator('#hud')).toBeVisible({ timeout: 120_000 });
    const loaded = await g(page2, (G) => ({ hash: G.sim.stateHash() as number, n: G.sim.animals.length as number, day: G.sim.env.timeH / 24, births: G.sim.births as number[], cam: G.debugCamera() }));
    expect(loaded.hash).toBe(saved.hash);
    expect(loaded.n).toBe(saved.n);
    expect(loaded.day).toBe(saved.day);
    expect(loaded.births).toEqual(saved.births);
    expect(Math.round(loaded.cam.x)).toBe(900);
    // in-game Load restores the same slot too
    await g(page2, (G) => G.setSpeed(100));
    await page2.waitForTimeout(2500);
    await page2.keyboard.press('Escape');
    await page2.click('#mLoad');
    await expect(page2.locator('#loading')).toBeHidden({ timeout: 120_000 });
    await expect(page2.locator('#hud')).toBeVisible({ timeout: 120_000 });
    expect(await g(page2, (G) => G.sim.env.timeH / 24)).toBeLessThan(saved.day + 0.3);
    expect([...p.errors, ...p2.errors]).toEqual([]);
  });

  test('graphics quality changes at runtime without leaking GPU objects or touching the simulation', async ({ page }) => {
    const p = watch(page);
    await enter(page, { qa: true });
    const hash0 = await g(page, (G) => G.sim.stateHash() as number);
    const geo: Record<string, number[]> = {};
    for (let round = 0; round < 3; round++) {
      for (const q of ['medium', 'high', 'low']) {
        await page.keyboard.press('Escape');
        await page.selectOption('#mQuality', q);
        await page.click('#mResume');
        await page.waitForTimeout(3500);
        const s = await g(page, (G) => G.debugGfx());
        expect(s.quality).toBe(q);
        expect(s.auto).toBe(false);
        expect(s.calls).toBeGreaterThan(5);
        (geo[q] ??= []).push(s.geometries);
      }
    }
    // the same preset at the same place settles to the same number of GPU geometries each time
    for (const q of Object.keys(geo)) expect(Math.max(...geo[q]!) - Math.min(...geo[q]!), `${q}: ${geo[q]}`).toBeLessThanOrEqual(6);
    expect(await g(page, (G) => G.sim.stateHash() as number)).toBe(hash0); // rendering quality never alters ecology
    expect(p.errors).toEqual([]);
  });

  test('repeated chunk traversal loads and unloads terrain without accumulating geometry', async ({ page }) => {
    const p = watch(page);
    await enter(page, { qa: true });
    const counts: number[] = [];
    for (let i = 0; i < 4; i++) {
      await g(page, (G) => G.debugPath([[200, 200], [1250, 300], [1250, 1250], [200, 1250], [200, 200]], 420, 15));
      await page.waitForTimeout(2500);
      const s = await g(page, (G) => G.debugGfx());
      counts.push(s.geometries);
      expect(s.chunks).toBeGreaterThan(8);
    }
    // counts wobble by a few chunks depending on where the last frame landed; a leak would grow every lap
    expect(Math.max(...counts) - Math.min(...counts), String(counts)).toBeLessThanOrEqual(14);
    expect(counts[3]! - counts[0]!, String(counts)).toBeLessThanOrEqual(10);
    expect(p.errors).toEqual([]);
  });

  test('every panel opens and closes, by mouse and keyboard', async ({ page }) => {
    const p = watch(page);
    await enter(page);
    const vis = (id: string): Promise<boolean> => page.locator(id).isVisible();
    await page.click('#btnStats');
    expect(await vis('#stats')).toBe(true);
    await page.click('#statsClose');
    expect(await vis('#stats')).toBe(false);
    // keyboard actions are consumed on the next rendered frame, so wait for the effect
    await page.keyboard.press('KeyT');
    await expect(page.locator('#stats')).toBeVisible();
    await page.keyboard.press('KeyT');
    await expect(page.locator('#stats')).toBeHidden();
    await page.keyboard.press('F3');
    await expect(page.locator('#diag')).toContainText('fps');
    await page.keyboard.press('F3');
    await expect(page.locator('#diag')).toBeHidden();
    await page.click('#btnMenu');
    expect(await vis('#menu')).toBe(true);
    const tick = await g(page, (G) => G.sim.tick as number);
    await page.waitForTimeout(800);
    expect(await g(page, (G) => G.sim.tick as number)).toBe(tick); // the menu pauses the world
    await page.locator('#mMusic').fill('0.4');
    await page.check('#mMotion');
    // Tab is left to the browser so menus are keyboard-navigable: focus must move to another control
    const f0 = await page.evaluate(() => document.activeElement?.id ?? '');
    await page.keyboard.press('Tab');
    const f1 = await page.evaluate(() => document.activeElement?.id ?? document.activeElement?.tagName ?? '');
    expect(f1).not.toBe(f0);
    // a focused slider or checkbox must not swallow Escape (regression: it used to)
    await page.locator('#mVolume').focus();
    await page.keyboard.press('Escape');
    await expect(page.locator('#menu')).toBeHidden();
    // ...nor the movement keys once back in the world
    await page.click('#modes button[data-mode="experiment"]');
    await page.locator('#exRain').focus();
    const before = await g(page, (G) => G.debugCamera());
    await hold(page, ['KeyW'], 900);
    const after = await g(page, (G) => G.debugCamera());
    expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeGreaterThan(0.5);
    expect(await g(page, (G) => G.sim.env.params.rainMult as number)).toBe(1); // and W did not move the slider
    await page.click('#modes button[data-mode="observer"]');
    for (const m of ['experiment', 'observer', 'curiosity', 'observer', 'wildlife', 'observer']) {
      await page.click(`#modes button[data-mode="${m}"]`);
      await page.waitForTimeout(200);
      expect(await vis('#experiment')).toBe(m === 'experiment');
      expect(await vis('#curio')).toBe(m === 'curiosity');
      expect(await vis('#wild')).toBe(m === 'wildlife');
    }
    await g(page, (G) => G.setSpeed(1));
    await page.keyboard.press('BracketRight');
    await expect.poll(() => g(page, (G) => G.speed)).toBe(10);
    await page.keyboard.press('BracketLeft');
    await expect.poll(() => g(page, (G) => G.speed)).toBe(1);
    await page.keyboard.press('BracketLeft');
    await expect.poll(() => g(page, (G) => G.speed)).toBe(0);
    await page.keyboard.press('KeyM');
    // nothing in the HUD promises a feature that is not there: every visible button does something or is disabled
    const dead = await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('#hud button, #menu button')].filter((b) => !b.id && !b.dataset.mode && !b.dataset.speed && !b.dataset.hold && !b.dataset.act && !b.dataset.toggle).map((b) => b.textContent));
    expect(dead).toEqual([]);
    expect(p.errors).toEqual([]);
  });

  test('Curiosity Mode: finds subjects, holds them, skips on request, yields instantly, and never alters the ecosystem', async ({ page }) => {
    const p = watch(page);
    await enter(page);
    await g(page, (G) => G.debugCam(800, 640, 10, 1, -0.1));
    const cam0 = await g(page, (G) => G.debugCamera());
    await page.keyboard.press('KeyV');
    await expect(page.locator('#curio')).toBeVisible();
    await expect.poll(() => g(page, (G) => G.debugCuriosity().key), { timeout: 8000 }).not.toBeNull();
    const first = await g(page, (G) => G.debugCuriosity());
    await expect(page.locator('#cuCaption')).toBeVisible();
    await expect(page.locator('#cuFact')).toContainText('Simulated:');
    // comfort: sample the camera every 100 ms; no teleports, bounded speed, never underground
    let maxStep = 0;
    let prev = await g(page, (G) => G.debugCamera());
    let total = 0;
    for (let i = 0; i < 60; i++) {
      await page.waitForTimeout(100);
      const c = await g(page, (G) => G.debugCamera());
      const d = Math.hypot(c.x - prev.x, c.y - prev.y, c.z - prev.z);
      maxStep = Math.max(maxStep, d);
      total += d;
      expect(c.y).toBeGreaterThanOrEqual(c.ground + 1.2);
      prev = c;
    }
    expect(total).toBeGreaterThan(1); // it does go somewhere
    expect(maxStep).toBeLessThan(25); // < 55 m/s cap with generous slack for slow frames
    expect((await g(page, (G) => G.debugCuriosity())).switches - first.switches).toBeLessThanOrEqual(1); // no restless cutting inside the minimum dwell
    // skip
    const k1 = (await g(page, (G) => G.debugCuriosity())).key;
    await page.keyboard.press('KeyN');
    await expect.poll(() => g(page, (G) => G.debugCuriosity().key), { timeout: 6000 }).not.toBe(k1);
    // pause holds the camera still; captions can be hidden
    await page.click('#cuPause');
    const pa = await g(page, (G) => G.debugCamera());
    await page.waitForTimeout(800);
    const pb = await g(page, (G) => G.debugCamera());
    expect(Math.hypot(pb.x - pa.x, pb.z - pa.z)).toBeLessThan(0.01);
    await page.click('#cuPause');
    await page.click('#cuCaptions');
    await expect(page.locator('#cuCaption')).toBeHidden();
    // the director only observes: no animal is controlled, and the world kept running
    const st = await g(page, (G) => ({ controlled: G.controlled, anyControlled: G.sim.animals.some((a: any) => a.controlled) as boolean, tick: G.sim.tick as number })); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(st.controlled).toBe(0);
    expect(st.anyControlled).toBe(false);
    expect(st.tick).toBeGreaterThan(20);
    // any manual input returns control immediately, from where the autopilot was
    const auto = await g(page, (G) => G.debugCamera());
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(300);
    await page.keyboard.up('KeyW');
    const manual = await g(page, (G) => ({ mode: G.mode, c: G.debugCamera() }));
    expect(manual.mode).toBe('observer');
    expect(Math.hypot(manual.c.x - auto.x, manual.c.z - auto.z)).toBeLessThan(15);
    void cam0;
    // Observe -> Follow -> Become from the autopilot's current subject
    await page.keyboard.press('KeyV');
    await expect.poll(() => g(page, (G) => G.mode), { timeout: 8000 }).toBe('curiosity');
    await expect.poll(() => g(page, (G) => G.debugCuriosity().key), { timeout: 8000 }).toMatch(/^(animal|event|scenic):/);
    await g(page, (G) => { // point the director at an adult deer so "Become" is offered (QA fixture via the public focus API)
      const d = G.sim.animals.find((a: any) => a.sp === 0 && a.age > 70); // eslint-disable-line @typescript-eslint/no-explicit-any
      (G as any).curiosity.focus(d.id); // eslint-disable-line @typescript-eslint/no-explicit-any
    });
    await expect(page.locator('#cuBecome')).toBeVisible({ timeout: 4000 });
    await page.click('#cuBecome');
    const became = await g(page, (G) => ({ mode: G.mode, controlled: G.controlled, sp: G.sim.byId.get(G.controlled)?.sp as number }));
    expect(became.mode).toBe('wildlife');
    expect(became.sp).toBe(0);
    expect(p.errors).toEqual([]);
  });

  test('seeded random interaction: 80 actions, invariants hold after each', async ({ page }, info) => {
    const p = watch(page);
    const SEED = 20261115;
    await enter(page, { seed: 3 });
    let s = SEED;
    const rnd = (): number => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
    const pick = <T,>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)]!;
    const log: string[] = [];
    const actions: Record<string, () => Promise<void>> = {
      move: async () => hold(page, [pick(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'KeyQ'])], 150 + rnd() * 400),
      sprint: async () => hold(page, ['ShiftLeft', pick(['KeyW', 'KeyA', 'KeyD'])], 300),
      drag: async () => { await page.mouse.move(300 + rnd() * 600, 250 + rnd() * 300); await page.mouse.down(); await page.mouse.move(300 + rnd() * 600, 250 + rnd() * 300, { steps: 4 }); await page.mouse.up(); },
      click: async () => page.mouse.click(200 + rnd() * 800, 200 + rnd() * 400),
      wheel: async () => page.mouse.wheel(0, pick([-240, 240])),
      key: async () => page.keyboard.press(pick(['KeyG', 'KeyP', 'KeyX', 'KeyE', 'KeyF', 'KeyR', 'KeyT', 'Tab', 'F3', 'KeyV', 'KeyN', 'BracketLeft', 'BracketRight', 'KeyH', 'Escape', 'KeyM'])),
      mode: async () => { if (await page.locator('#menu').isHidden()) await page.click(`#modes button[data-mode="${pick(['observer', 'wildlife', 'experiment', 'curiosity'])}"]`); },
      speed: async () => { if (await page.locator('#menu').isHidden()) await page.click(`#speeds button[data-speed="${pick(['0', '1', '10', '100', '1000'])}"]`); },
      teleport: async () => { const x = 60 + rnd() * 1300; const z = 60 + rnd() * 1300; await page.evaluate(([x, z]) => window.__untamed.debugCam(x!, z!, 8, 1, -0.2), [x, z]); },
      quality: async () => { await page.evaluate((q) => { const el = document.getElementById('mQuality') as HTMLSelectElement; el.value = q; el.dispatchEvent(new Event('change')); }, pick(['low', 'medium'])); },
    };
    const names = Object.keys(actions);
    try {
      for (let i = 0; i < 80; i++) {
        const name = pick(names);
        log.push(`${i}:${name}`);
        await actions[name]!();
        const st = await g(page, (G) => {
          const c = G.debugCamera();
          const d = G.debugState();
          const bad = G.sim.animals.filter((a: any) => !Number.isFinite(a.x + a.z + a.hunger + a.health) || a.health <= 0).length as number; // eslint-disable-line @typescript-eslint/no-explicit-any
          return { c, d, bad, ctl: G.sim.animals.filter((a: any) => a.controlled).length as number, gc: G.controlled }; // eslint-disable-line @typescript-eslint/no-explicit-any
        });
        expect(Number.isFinite(st.c.x + st.c.y + st.c.z + st.c.yaw + st.c.pitch), log.join(' ')).toBe(true);
        expect(st.c.y, log.join(' ')).toBeGreaterThanOrEqual(st.c.ground + 0.3);
        expect(st.bad, log.join(' ')).toBe(0);
        expect(st.ctl, log.join(' ')).toBe(st.gc ? 1 : 0); // exactly the animal the game thinks it controls
        expect(await page.locator('#fatal').isHidden(), log.join(' ')).toBe(true);
        expect(p.errors, log.join(' ')).toEqual([]);
      }
    } finally {
      await info.attach('action-log', { body: `seed ${SEED}\n${log.join('\n')}`, contentType: 'text/plain' });
    }
  });
});
