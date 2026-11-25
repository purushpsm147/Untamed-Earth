/**
 * AUD-01 browser gates for the ecological soundscape lab (/?audiolab=1).
 * Headless Chromium launched with --autoplay-policy=user-gesture-required (playwright.config.ts, project 'audio').
 * Automated gates verify routing, budgets, lifecycle, autoplay handling, determinism, direction and cost.
 * They do NOT judge how anything sounds; that is the human listening review (docs/handover/AUDIO_HANDOVER.md).
 */
import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';

type Lab = {
  start(id?: string): Promise<boolean>;
  stop(): void;
  restart(id?: string): Promise<boolean>;
  state(): { context: string | null; running: boolean; liveVoices: number; fadingVoices: number; allocatedVoices: number; liveNodes: number; bedNodes: number; poolPeak: number; route: Record<string, number>; counters: Record<string, number> } | null;
  testEvent(kind: 'alarm' | 'kill', species: string, dx: number, dz: number, id: number): void;
  setToggles(t: Record<string, boolean>): void;
  simProgress(): { hash: number; ticks: number } | null;
  referenceHash(id: string, ticks: number): number;
  stepFrames(n: number): void;
  record(id: string, seconds?: number): Promise<{ meta: { sampleHash: string; renderSpeed: number; counters: Record<string, number>; expected: unknown[] }; cues: { t: number; kind: string; label: string; azimuthDeg?: number; distanceM?: number; why: string }[] }>;
  calibration(model?: string): Promise<{ azimuthDeg: number; left: number; right: number }[]>;
  frameCostMs(): number;
  diffRenders(id: string, seconds: number): Promise<{ hashA: string; hashB: string; maxAbsDiff: number; maxDiffDbfs: number; differingSamples: number; total: number }>;
};
declare global {
  interface Window {
    __audioLab: Lab;
    __acCount: number;
  }
}

const results: Record<string, unknown> = {};

async function open(page: Page): Promise<void> {
  // count every AudioContext the page constructs (OfflineAudioContext is a different constructor and is not counted)
  await page.addInitScript(() => {
    window.__acCount = 0;
    const AC = window.AudioContext;
    window.AudioContext = class extends AC {
      constructor(o?: AudioContextOptions) {
        super(o);
        window.__acCount++;
      }
    } as typeof AudioContext;
  });
  await page.goto('/?audiolab=1');
  await page.waitForFunction(() => Boolean(window.__audioLab));
}

async function startQuiet(page: Page, id = 'day-meadow-herd'): Promise<void> {
  await page.evaluate(() => window.__audioLab.setToggles({ stateCalls: false, movement: false }));
  await page.selectOption('#alScenario', id);
  await page.click('#alStart'); // a real user gesture
  await page.waitForFunction(() => window.__audioLab.state()?.running === true, null, { timeout: 60_000 });
}

test.describe('ecological soundscape lab', () => {
  test.afterAll(() => {
    fs.mkdirSync('test-artifacts/audio', { recursive: true });
    fs.writeFileSync('test-artifacts/audio/gates.json', JSON.stringify(results, null, 2));
  });

  test('autoplay: no AudioContext before the gesture; exactly one, running, after it; restarts reuse it', async ({ page }) => {
    await open(page);
    expect(await page.evaluate(() => window.__acCount)).toBe(0);
    expect(await page.evaluate(() => window.__audioLab.state())).toBeNull();
    await startQuiet(page);
    expect(await page.evaluate(() => [window.__acCount, window.__audioLab.state()!.context])).toEqual([1, 'running']);
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.__audioLab.restart('night-wetland'));
      await page.waitForFunction(() => window.__audioLab.state()?.running === true, null, { timeout: 60_000 });
    }
    expect(await page.evaluate(() => window.__acCount)).toBe(1);
    await page.click('#alStop');
    const s = await page.evaluate(() => window.__audioLab.state());
    expect(s).toMatchObject({ running: false, context: 'running' });
    results.autoplay = { contextsAfter3Restarts: 1 };
  });

  test('routing: one real-event alarm -> one voice, disconnected after it ends; unsupported species stay silent', async ({ page }) => {
    await open(page);
    await startQuiet(page);
    const base = await page.evaluate(() => window.__audioLab.state()!);
    expect(base.liveNodes).toBe(base.bedNodes);
    await page.evaluate(() => window.__audioLab.testEvent('alarm', 'chital', 25, 10, 900001));
    await page.waitForFunction(() => window.__audioLab.state()!.counters.eventCalls === 1);
    const during = await page.evaluate(() => window.__audioLab.state()!);
    expect(during.liveVoices).toBe(1);
    expect(during.liveNodes).toBeGreaterThan(base.bedNodes);
    await page.evaluate(() => window.__audioLab.testEvent('alarm', 'hare', 10, 0, 900002));
    await page.waitForFunction(() => (window.__audioLab.state()!.route.unsupported ?? 0) >= 1);
    // a chital bark series lasts < 3.5 s; wait for 'ended' (+0.3 s tail) to disconnect every node of the voice
    await page.waitForFunction(() => window.__audioLab.state()!.allocatedVoices === 0, null, { timeout: 10_000 });
    const after = await page.evaluate(() => window.__audioLab.state()!);
    expect(after.liveNodes).toBe(after.bedNodes);
    expect(after.counters.eventCalls).toBe(1);
    results.routing = { bedNodes: base.bedNodes, nodesDuringOneCall: during.liveNodes, nodesAfter: after.liveNodes, route: after.route };
  });

  test('voice budget: 40 simultaneous alarms never exceed the call cap; nodes return to the bed baseline', async ({ page }) => {
    await open(page);
    await startQuiet(page);
    await page.evaluate(() => {
      for (let i = 0; i < 40; i++) window.__audioLab.testEvent('alarm', i % 2 ? 'chital' : 'crow', Math.cos(i) * (20 + i * 3), Math.sin(i) * (20 + i * 3), 910000 + i);
    });
    await page.waitForFunction(() => (window.__audioLab.state()!.counters.eventCalls ?? 0) + (window.__audioLab.state()!.counters.rejected ?? 0) > 0);
    const s = await page.evaluate(() => window.__audioLab.state()!);
    // active (audible, not being stolen) voices never exceed the cap; stolen ones fade out over 50 ms (AUDIO_INTEGRATION.md 6)
    expect(s.liveVoices).toBeLessThanOrEqual(8);
    expect(s.poolPeak).toBeLessThanOrEqual(8);
    await page.waitForFunction(() => window.__audioLab.state()!.fadingVoices === 0, null, { timeout: 1000 });
    await page.waitForFunction(() => window.__audioLab.state()!.allocatedVoices === 0, null, { timeout: 15_000 });
    const end = await page.evaluate(() => window.__audioLab.state()!);
    expect(end.liveNodes).toBe(end.bedNodes);
    results.voiceBudget = { offered: 40, played: s.counters.eventCalls, rejected: s.counters.rejected, merged: s.route.merged, peakVoices: s.poolPeak, fadingAtSample: s.fadingVoices };
  });

  test('audio observes only: simulation hash with the full soundscape running equals the no-audio reference', async ({ page }) => {
    await open(page);
    await page.selectOption('#alScenario', 'dawn-riverbank');
    await page.click('#alStart');
    await page.waitForFunction(() => window.__audioLab.state()?.running === true, null, { timeout: 60_000 });
    await page.evaluate(() => window.__audioLab.stepFrames(600));
    const p = (await page.evaluate(() => window.__audioLab.simProgress()))!;
    expect(p.ticks).toBeGreaterThan(250);
    const ref = await page.evaluate(([t]) => window.__audioLab.referenceHash('dawn-riverbank', t!), [p.ticks]);
    expect(p.hash).toBe(ref);
    results.determinism = { ticks: p.ticks, hash: p.hash, reference: ref };
  });

  test('direction: a source on the listener\'s right is louder in the right channel (HRTF and equal-power)', async ({ page }) => {
    await open(page);
    const out: Record<string, unknown> = {};
    for (const model of ['HRTF', 'equalpower']) {
      const r = await page.evaluate((m) => window.__audioLab.calibration(m), model);
      const at = (a: number) => r.find((x) => x.azimuthDeg === a)!;
      expect(at(90).right).toBeGreaterThan(at(90).left * 1.5);
      expect(at(-90).left).toBeGreaterThan(at(-90).right * 1.5);
      expect(Math.abs(at(0).left - at(0).right) / at(0).left).toBeLessThan(0.15);
      out[model] = r.map((x) => ({ az: x.azimuthDeg, lrDb: Math.round(20 * Math.log10(x.left / x.right) * 10) / 10 }));
    }
    results.direction = out;
  });

  test('offline recording is reproducible and contains the real event at the predicted time and direction', async ({ page }) => {
    await open(page);
    // Chromium sums a node's inputs in a run-dependent order, so two renders differ by float rounding only
    // (measured ~1e-7, about -123 dBFS). Gate: every sample within 1e-5 (-100 dBFS, below 16-bit resolution).
    const diff = await page.evaluate(() => window.__audioLab.diffRenders('predator-alarm', 60));
    expect(diff.maxAbsDiff).toBeLessThan(1e-5);
    const a = await page.evaluate(() => window.__audioLab.record('predator-alarm'));
    // The look-ahead (same engine) chose the event the listener was placed for: 45 m away, 45 degrees right.
    // Determinism is per JS engine, so which event that is differs between Node and Chromium; check against it.
    const expected = a.meta.expected as { t: number; kind: string; species: string; d: number }[];
    const target = expected.find((e) => e.d === 45);
    expect(target, JSON.stringify(expected)).toBeTruthy();
    const calls = a.cues.filter((c) => c.kind === 'event-call');
    const hit = calls.find((c) => Math.abs(c.t - target!.t) < 0.25);
    expect(hit, JSON.stringify({ expected, calls })).toBeTruthy();
    expect(Math.abs(hit!.azimuthDeg! - 45)).toBeLessThan(10);
    // no invented calls: every event call is at the time of a real simulation event (alarm or kill)
    for (const c of calls) expect(expected.some((e) => Math.abs(e.t - c.t) < 0.25), JSON.stringify(c)).toBe(true);
    expect(a.meta.renderSpeed).toBeGreaterThan(1);
    results.recording = { reproducibility: diff, renderSpeedX: a.meta.renderSpeed, target, hit, eventCalls: calls.length, expected };
  });

  test('cost: live frame cost with every layer on stays inside the 2 ms budget (software container)', async ({ page }) => {
    await open(page);
    await page.selectOption('#alScenario', 'dusk-roost');
    await page.click('#alStart');
    await page.waitForFunction(() => window.__audioLab.state()?.running === true, null, { timeout: 60_000 });
    await page.waitForTimeout(8000);
    const ms = await page.evaluate(() => window.__audioLab.frameCostMs());
    const s = await page.evaluate(() => window.__audioLab.state()!);
    results.cost = { frameMsEwma: Math.round(ms * 1000) / 1000, liveVoices: s.liveVoices, peak: s.poolPeak, counters: s.counters };
    expect(ms).toBeLessThan(2);
  });
});
