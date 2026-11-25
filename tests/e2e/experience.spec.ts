import { expect, test } from '@playwright/test';
import { enter, frames, g, hold, watch } from './helpers';

/**
 * UX-01 Living Valley V1 experience: persistent Social Lens history, documentary cuts, observer easing and follow
 * glide, chital perception feedback, onboarding and accessibility. Software-rendered Chromium (functional only).
 */
test.describe('Living Valley V1 experience', () => {
  test('Social Lens history is recorded from real events and survives save, close and Continue', async ({ page, context }) => {
    const p = watch(page);
    await enter(page, { seed: 3 });
    await g(page, (G) => G.setSpeed(1000));
    // wait for a living animal with at least one non-alarm history entry (births, group changes, maturity...)
    let id = 0;
    await expect.poll(async () => {
      id = await g(page, (G) => {
        const c = (G as any).chronicle; // eslint-disable-line @typescript-eslint/no-explicit-any
        for (const a of G.sim.animals) if (a.alive && c.entriesFor(a.id).some((e: any) => e.kind !== 'alarm')) return a.id as number; // eslint-disable-line @typescript-eslint/no-explicit-any
        return 0;
      });
      return id;
    }, { timeout: 120_000, intervals: [1000] }).toBeGreaterThan(0);
    await g(page, (G) => G.setSpeed(0));
    await page.evaluate((id) => (window as any).__untamed.select(id), id); // eslint-disable-line @typescript-eslint/no-explicit-any
    await expect(page.locator('#insSocial')).toContainText('History');
    const before = await page.locator('#insSocial .hist').allInnerTexts();
    expect(before.length).toBeGreaterThan(0);
    // every line shown corresponds to a stored entry (nothing composed outside the record)
    const stored = await page.evaluate((id) => (window as any).__untamed.chronicle.entriesFor(id).length as number, id); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(before.length).toBeLessThanOrEqual(stored);
    const snap = await g(page, (G) => JSON.stringify((G as any).chronicle.snapshot())); // eslint-disable-line @typescript-eslint/no-explicit-any
    await page.keyboard.press('Escape');
    await page.click('#mSave');
    await expect(page.locator('#mSaveInfo')).toContainText('Saved', { timeout: 15_000 });
    await page.close();

    const page2 = await context.newPage();
    const p2 = watch(page2);
    await page2.goto('/?qa=1');
    await page2.click('#btnContinue');
    await expect(page2.locator('#hud')).toBeVisible({ timeout: 120_000 });
    expect(await g(page2, (G) => JSON.stringify((G as any).chronicle.snapshot()))).toBe(snap); // eslint-disable-line @typescript-eslint/no-explicit-any
    await page2.evaluate((id) => (window as any).__untamed.select(id), id); // eslint-disable-line @typescript-eslint/no-explicit-any
    await expect(page2.locator('#insSocial')).toContainText('History');
    expect(await page2.locator('#insSocial .hist').allInnerTexts()).toEqual(before);
    expect([...p.errors, ...p2.errors]).toEqual([]);
  });

  test('Curiosity in the documentary scenario: real subject, honest captions, cuts only on black, fade restored on exit', async ({ page }) => {
    const p = watch(page);
    await page.addInitScript(() => localStorage.setItem('untamed.coach', 'done'));
    await page.goto('/?scenario=documentary');
    await page.selectOption('#startQuality', 'low');
    await page.click('#btnNew');
    await expect(page.locator('#hud')).toBeVisible({ timeout: 180_000 });
    const hash0 = await g(page, (G) => G.sim.tick as number);
    await page.keyboard.press('KeyV');
    await expect.poll(() => g(page, (G) => G.debugCuriosity().key), { timeout: 10_000 }).not.toBeNull();
    let prev = await g(page, (G) => G.debugCamera());
    let rel = (await g(page, (G) => G.debugCuriosity())).relocations;
    const relStart = rel;
    let sawFade = false;
    let bigSteps = 0;
    for (let i = 0; i < 80; i++) {
      await page.waitForTimeout(100);
      const [c, cu, op, capShown] = await g(page, (G) => [G.debugCamera(), G.debugCuriosity(), Number(document.getElementById('fade')!.style.opacity || 0), !document.getElementById('cuCaption')!.classList.contains('hidden')] as const);
      const d = Math.hypot(c.x - prev.x, c.z - prev.z);
      if (op > 0.9) sawFade = true;
      if (d > 25) {
        bigSteps++;
        expect(cu.relocations, 'a jump happened without a cut').toBeGreaterThan(rel);
      }
      if (op > 0.99) expect(capShown, 'a caption was shown over a black frame').toBe(false); // captions wait for the new picture
      expect(c.y).toBeGreaterThanOrEqual(c.ground + 1.2);
      prev = c;
      rel = cu.relocations;
    }
    const cu = await g(page, (G) => G.debugCuriosity());
    test.info().annotations.push({ type: 'curiosity', description: JSON.stringify({ ...cu, bigSteps, sawFade }) });
    // a relocation observed during sampling must have been covered by the black overlay
    if (cu.relocations > relStart) expect(sawFade).toBe(true);
    // captions: a named subject, a "Simulated:" fact and a reason, all present
    await expect(page.locator('#cuCaption')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#cuFact')).toContainText('Simulated:');
    await expect(page.locator('#cuNote')).toHaveText(/Why this shot|Continuing the story|quiet look|Species note/);
    expect(await page.locator('#cuWhat').innerText()).not.toMatch(/Wildlife #\d+ \(/); // no internal debug labels
    // leaving Curiosity always restores the picture
    await page.click('#cuExit');
    await expect.poll(() => page.evaluate(() => Number(document.getElementById('fade')!.style.opacity || 0))).toBe(0);
    expect(await g(page, (G) => G.sim.animals.some((a: any) => a.controlled) as boolean)).toBe(false); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(await g(page, (G) => G.sim.tick as number)).toBeGreaterThan(hash0);
    expect(p.errors).toEqual([]);
  });

  test('observer flight eases in and out; double-click follows; follow glides instead of snapping', async ({ page }) => {
    const p = watch(page);
    await enter(page);
    await g(page, (G) => { G.setSpeed(0); G.debugCam(800, 640, 12, 1, -0.1); });
    await frames(page, 3);
    // ease out: after the key is released the camera coasts briefly, then stops
    await page.keyboard.down('KeyW');
    await expect.poll(async () => (await g(page, (G) => G.debugCamera())).speed, { timeout: 20_000 }).toBeGreaterThan(0);
    await page.waitForTimeout(600);
    await page.keyboard.up('KeyW');
    await frames(page, 1);
    const a = await g(page, (G) => G.debugCamera());
    await frames(page, 2);
    const b = await g(page, (G) => G.debugCamera());
    await page.waitForTimeout(1500);
    await frames(page, 2);
    const c = await g(page, (G) => G.debugCamera());
    await frames(page, 3);
    const d = await g(page, (G) => G.debugCamera());
    expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeGreaterThan(0); // still coasting just after release
    expect(Math.hypot(d.x - c.x, d.z - c.z)).toBeLessThan(0.01); // and settled
    // double-click a deer where it is drawn: selects and follows
    expect(await g(page, (G) => G.debugFollow('chital', 7))).toBe(true);
    await page.waitForTimeout(800);
    const id = await g(page, (G) => G.selected);
    await g(page, (G) => { G.following = false; });
    await page.waitForTimeout(300);
    const at = await page.evaluate((id) => {
      const G = (window as any).__untamed; // eslint-disable-line @typescript-eslint/no-explicit-any
      const v = G.engine.animals.pos.get(id).clone().project(G.engine.camera);
      const r = G.engine.canvas.getBoundingClientRect();
      return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
    }, id);
    await page.mouse.dblclick(at.x, at.y);
    await expect.poll(() => g(page, (G) => G.following), { timeout: 10_000 }).toBe(true);
    expect(await g(page, (G) => G.selected)).toBe(id);
    // follow glide: engaging from far away moves the camera progressively (no single-frame snap)
    await g(page, (G) => { G.following = false; G.debugCam(G.sim.byId.get(G.selected).x + 60, G.sim.byId.get(G.selected).z + 60, 25, 1, -0.2); });
    await frames(page, 3);
    const far = await g(page, (G) => G.debugCamera());
    // sample the camera on every rendered frame (slow software frames make polling from the test too coarse)
    await page.evaluate(() => {
      const G = (window as any).__untamed; // eslint-disable-line @typescript-eslint/no-explicit-any
      const out: { x: number; z: number; f: boolean }[] = [];
      (window as any).__track = out; // eslint-disable-line @typescript-eslint/no-explicit-any
      const t0 = performance.now();
      const tick = (): void => {
        const c = G.debugCamera();
        out.push({ x: c.x, z: c.z, f: G.following });
        if (performance.now() - t0 < 6000) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await page.keyboard.press('KeyG');
    await expect.poll(() => g(page, (G) => G.following)).toBe(true);
    await page.waitForTimeout(6500);
    const track = await page.evaluate(() => (window as any).__track as { x: number; z: number; f: boolean }[]); // eslint-disable-line @typescript-eslint/no-explicit-any
    const fol = track.filter((t) => t.f);
    let maxStep = 0;
    for (let i = 1; i < fol.length; i++) maxStep = Math.max(maxStep, Math.hypot(fol[i]!.x - fol[i - 1]!.x, fol[i]!.z - fol[i - 1]!.z));
    const first = track.findIndex((t) => t.f);
    const total = Math.hypot(fol[fol.length - 1]!.x - far.x, fol[fol.length - 1]!.z - far.z);
    test.info().annotations.push({ type: 'follow-glide', description: JSON.stringify({ frames: fol.length, maxStep, total, firstStep: first > 0 ? Math.hypot(track[first]!.x - track[first - 1]!.x, track[first]!.z - track[first - 1]!.z) : null }) });
    expect(fol.length).toBeGreaterThan(3);
    // no single frame covers most of the way (a snap would be one ~80 m step)
    expect(maxStep).toBeLessThan(total * 0.6);
    const near = await g(page, (G) => { const s = G.sim.byId.get(G.selected); const c = G.debugCamera(); return Math.hypot(s.x - c.x, s.z - c.z); });
    expect(near).toBeLessThan(15);
    expect(p.errors).toEqual([]);
  });

  test('living as a chital: perception-derived cues match the deer\'s own state; toggle actions option', async ({ page }) => {
    const p = watch(page);
    await enter(page, { settings: { toggleActions: true } });
    await g(page, (G) => G.debugFollow('chital', 7));
    await page.keyboard.press('KeyP');
    await expect(page.locator('#wild')).toBeVisible();
    await expect(page.locator('#wildSense')).toContainText('Herd');
    await expect(page.locator('#wildSense')).toContainText('Water');
    const truth = await g(page, (G) => {
      const w = G.sim.byId.get(G.controlled);
      const n = G.sim.animals.filter((o: any) => o.alive && o !== w && o.sp === w.sp && o.group === w.group).length as number; // eslint-disable-line @typescript-eslint/no-explicit-any
      return { n, water: Number.isFinite(w.waterX) as boolean };
    });
    await expect(page.locator('#wildSense')).toContainText(truth.n > 0 ? `${truth.n} others` : 'alone');
    await expect(page.locator('#wildSense')).toContainText(truth.water ? /remembered|is here/ : /knows no drinking place/);
    await expect(page.locator('#wildStatus')).not.toBeEmpty();
    // toggle option: a tap of E keeps grazing until E again or a move
    await page.keyboard.press('KeyE');
    await expect.poll(() => g(page, (G) => G.sim.control.action as string | null)).toBe('eat');
    await page.waitForTimeout(500);
    expect(await g(page, (G) => G.sim.control.action as string | null)).toBe('eat');
    await page.keyboard.press('KeyE');
    await expect.poll(() => g(page, (G) => G.sim.control.action as string | null)).toBe(null);
    await hold(page, ['KeyW'], 400);
    await page.keyboard.press('KeyX');
    await expect.poll(() => g(page, (G) => G.mode)).toBe('observer');
    expect(p.errors).toEqual([]);
  });

  test('first-run field guide, hints and accessibility semantics', async ({ page }) => {
    const p = watch(page);
    await page.goto('/');
    await page.selectOption('#startQuality', 'low');
    await page.click('#btnNew');
    await expect(page.locator('#hud')).toBeVisible({ timeout: 120_000 });
    // a first visit shows the guide (information only) and a context hint line
    await expect(page.locator('#coach')).toBeVisible();
    await expect(page.locator('#coachStep')).toHaveText('1/5');
    await expect(page.locator('#hints')).toContainText('click an animal');
    // the guide advances when the player does the thing (moving and looking)
    await hold(page, ['KeyW'], 600);
    await hold(page, ['KeyL'], 400);
    await expect(page.locator('#coachStep')).toHaveText('2/5');
    // ARIA: mode and speed buttons expose pressed state; captions and ticker are live regions
    await expect(page.locator('#modes button[data-mode="observer"]')).toHaveAttribute('aria-pressed', 'true');
    await page.click('#speeds button[data-speed="10"]');
    await expect(page.locator('#speeds button[data-speed="10"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#speeds button[data-speed="1"]')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#ticker')).toHaveAttribute('aria-live', 'polite');
    await expect(page.locator('#cuCaption')).toHaveAttribute('aria-live', 'polite');
    await expect(page.locator('#speeds button[data-speed="0"]')).toHaveAttribute('aria-label', 'Pause simulation');
    // menu is a dialog and takes keyboard focus
    await page.keyboard.press('Escape');
    await expect(page.locator('#menu')).toHaveAttribute('role', 'dialog');
    await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe('mResume');
    // larger text and hints preferences persist
    await page.check('#mLarge');
    await expect(page.locator('body')).toHaveClass(/large/);
    await page.uncheck('#mHints');
    await page.click('#mResume');
    await expect(page.locator('#hints')).toBeHidden();
    // Hide tips is remembered across reloads; the menu can bring the guide back
    await page.click('#coachClose');
    await expect(page.locator('#coach')).toBeHidden();
    await page.reload();
    await page.selectOption('#startQuality', 'low');
    await page.click('#btnNew');
    await expect(page.locator('#hud')).toBeVisible({ timeout: 120_000 });
    await expect(page.locator('body')).toHaveClass(/large/);
    await page.waitForTimeout(600);
    await expect(page.locator('#coach')).toBeHidden();
    await page.keyboard.press('Escape');
    await page.click('#mTips');
    await expect(page.locator('#coach')).toBeVisible();
    expect(p.errors).toEqual([]);
  });

  test('WebGL context loss stops the world: no ticks at 100x, no autosave, explicit save keeps the moment of loss (UX-02)', async ({ page, context }) => {
    const p = watch(page);
    await enter(page, { seed: 4 });
    const slot = (pg: typeof page): Promise<{ tick: number } | null> => pg.evaluate(() => new Promise((res) => {
      const req = indexedDB.open('untamed-earth', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('saves');
      req.onsuccess = () => {
        const tx = req.result.transaction('saves', 'readonly');
        const get = tx.objectStore('saves').get('slot1');
        get.onsuccess = () => { const v = get.result as { data?: { sim?: { tick: number } } } | undefined; req.result.close(); res(v?.data?.sim ? { tick: v.data.sim.tick } : null); };
        get.onerror = () => res(null);
      };
      req.onerror = () => res(null);
    }));
    expect(await slot(page)).toBeNull(); // fresh profile: nothing saved yet
    await g(page, (G) => G.setSpeed(100));
    await expect.poll(() => g(page, (G) => G.sim.tick as number), { timeout: 30_000 }).toBeGreaterThan(200);
    // the browser loses the GPU context (same event a driver reset produces)
    await page.evaluate(() => (window as any).__untamed.engine.renderer.getContext().getExtension('WEBGL_lose_context').loseContext()); // eslint-disable-line @typescript-eslint/no-explicit-any
    await expect(page.locator('#fatal')).toBeVisible({ timeout: 10_000 });
    const t0 = await g(page, (G) => G.sim.tick as number);
    await page.waitForTimeout(3000);
    const after = await g(page, (G) => ({ tick: G.sim.tick as number, speed: G.speed, lost: (G as any).contextLost as boolean })); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(after.tick).toBe(t0); // the world stopped at the loss, even at 100x
    expect(after.speed).toBe(100); // the player's chosen speed is preserved, not rewritten
    expect(after.lost).toBe(true);
    await expect(page.locator('#btnSaveLost')).toBeVisible();
    // automatic saves are blocked: leaving the page or hiding the tab must not write the post-loss world
    await page.evaluate(() => { window.dispatchEvent(new Event('pagehide')); document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForTimeout(1000);
    expect(await slot(page)).toBeNull();
    // an explicit save stores exactly the moment of loss
    await page.click('#btnSaveLost');
    await expect(page.locator('#btnSaveLost')).toHaveText('Saved', { timeout: 15_000 });
    expect((await slot(page))!.tick).toBe(t0);
    // and Continue restores it, paused at the same tick, with a working context
    await page.close();
    const page2 = await context.newPage();
    const p2 = watch(page2);
    await page2.goto('/?qa=1');
    await page2.click('#btnContinue');
    await expect(page2.locator('#hud')).toBeVisible({ timeout: 120_000 });
    expect(await g(page2, (G) => G.sim.tick as number)).toBe(t0);
    expect(await g(page2, (G) => (G as any).contextLost as boolean)).toBe(false); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect([...p.errors, ...p2.errors]).toEqual([]);
  });
});
