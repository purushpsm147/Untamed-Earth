import type { Game } from '../game/Game';
import type { QualityName } from '../render/quality';
import type { GlCounts } from './glCounter';

/**
 * Self-running performance protocol, opened with `?profile=1` (add `&short=1` for a quick pass).
 * It measures what this browser on this device actually does; nothing is estimated. Results stay in the page
 * (download / copy); nothing is sent anywhere.
 */
export interface ProfileHooks {
  game: () => Game | null;
  /** Restart the world with the same seed and wait until it is ready. */
  restart: () => Promise<Game>;
  gl: () => GlCounts;
}

interface Stats { frames: number; fps: number; p50: number; p95: number; p99: number; worst: number; spikesOver50ms: number; simMs: number; renderMs: number }

const pct = (xs: number[], p: number): number => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))]!;
};
const round = (v: number, d = 2): number => Math.round(v * 10 ** d) / 10 ** d;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const heapMB = (): number | null => {
  const m = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
  return m ? round(m.usedJSHeapSize / 1048576, 1) : null;
};
/** A loop through all four areas, used for every preset so runs are comparable. */
const ROUTE: [number, number][] = [[760, 640], [1000, 450], [1085, 1005], [700, 1180], [420, 700], [640, 470], [760, 640]];

function summarize(p: { frame: number[]; sim: number[]; render: number[] }): Stats {
  const f = p.frame.slice(5).filter((x) => x > 0 && x < 2000); // drop the first frames after a settings change
  const total = f.reduce((a, b) => a + b, 0);
  return {
    frames: f.length, fps: round(f.length / (total / 1000), 1), p50: round(pct(f, 0.5)), p95: round(pct(f, 0.95)), p99: round(pct(f, 0.99)),
    worst: round(Math.max(...f)), spikesOver50ms: f.filter((x) => x > 50).length,
    simMs: round(p.sim.reduce((a, b) => a + b, 0) / Math.max(1, p.sim.length), 3), renderMs: round(p.render.reduce((a, b) => a + b, 0) / Math.max(1, p.render.length), 2),
  };
}

export async function runProfile(h: ProfileHooks, short: boolean, log: (line: string) => void): Promise<Record<string, unknown>> {
  const sec = (s: number): number => (short ? Math.max(4, s / 4) : s) * 1000;
  let g = h.game()!;
  const report: Record<string, unknown> = {
    tool: 'Untamed Earth ?profile=1', version: 1, startedAt: new Date().toISOString(), short,
    device: {
      userAgent: navigator.userAgent, gpu: g.debugGfx().gpu, assessment: g.debugGfx().basis,
      viewport: [innerWidth, innerHeight], devicePixelRatio: devicePixelRatio, cores: navigator.hardwareConcurrency ?? null,
      deviceMemoryGB: (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null,
      heapApi: heapMB() !== null ? 'performance.memory (Chromium only, JS heap only; not GPU memory)' : 'unavailable in this browser',
    },
    notes: 'Frame times are requestAnimationFrame intervals with the frame-rate target set to uncapped. GPU memory cannot be measured from a web page.',
  };
  g.setFps(0); // uncapped, so frame times show what the device can do rather than the pacing target
  g.setSpeed(1);

  // 1. fixed presets on the same route
  const presets: Record<string, unknown> = {};
  for (const q of ['low', 'medium', 'high'] as QualityName[]) {
    log(`Preset ${q}: flying the fixed route…`);
    g.engine.setQuality(q, false);
    await sleep(sec(4)); // let streaming and shader compilation settle
    g.debugPerfStart();
    await g.debugPath(ROUTE, short ? 160 : 60, 14);
    const st = summarize(g.debugPerfStop());
    const gfx = g.debugGfx();
    presets[q] = { ...st, drawCalls: gfx.calls, triangles: gfx.triangles, geometries: gfx.geometries, heapMB: heapMB() };
    log(`  ${q}: p50 ${st.p50} ms, p95 ${st.p95} ms, ${st.fps} fps`);
  }
  report.presets = presets;

  // 2. Auto from the assessment, then the recovery test
  log('Auto: starting from the hardware assessment…');
  g.engine.setQuality('high', true);
  g.engine.beginAdaptation();
  const timeline: unknown[] = [];
  const t0 = performance.now();
  const track = async (ms: number, phase: string): Promise<void> => {
    const end = performance.now() + ms;
    while (performance.now() < end) {
      const x = g.debugGfx();
      timeline.push({ t: round((performance.now() - t0) / 1000, 1), phase, quality: x.quality, scale: x.resScale, frameMs: round(x.frameMs, 1) });
      await sleep(1000);
    }
  };
  g.debugCam(760, 640, 12, 2.2, -0.12);
  await track(sec(30), 'auto-settle');
  const settled = g.debugGfx();
  log(`  settled at ${settled.quality} ${Math.round(settled.resScale * 100)}%`);
  log('Recovery: adding an artificial 30 ms of work per frame, then removing it…');
  g.debugLoadMs = 30;
  await track(sec(25), 'loaded');
  const loaded = g.debugGfx();
  g.debugLoadMs = 0;
  await track(sec(90), 'recovering');
  const recovered = g.debugGfx();
  report.auto = {
    settled: { quality: settled.quality, scale: settled.resScale }, underLoad: { quality: loaded.quality, scale: loaded.resScale },
    afterRecovery: { quality: recovered.quality, scale: recovered.resScale },
    recoveredToSettled: recovered.quality === settled.quality && recovered.resScale >= settled.resScale - 0.001,
    // the artificial load is main-thread work: lowering graphics cannot help, so Auto should keep (or restore) quality
    keptQualityUnderLoad: loaded.quality === settled.quality && loaded.resScale >= settled.resScale - 0.001,
    // measured downgrade trials (did a downgrade cut frame time?), not a CPU/GPU classification
    governor: g.engine.governor.stats, timeline,
  };
  log(`  under load ${loaded.quality} ${Math.round(loaded.resScale * 100)}%, after ${recovered.quality} ${Math.round(recovered.resScale * 100)}%`);
  const gs = g.engine.governor.stats;
  log(`  downgrade trials ${gs.trials}: helped ${gs.helped}, rolled back ${gs.rolledBack}`);

  // 3. memory and GPU objects across restarts (same seed, Low, same pose)
  log('Restarts: 5 x same world…');
  g.engine.setQuality('low', false);
  const restarts: unknown[] = [];
  for (let i = 0; i <= 5; i++) {
    if (i > 0) g = await h.restart();
    g.setFps(0);
    g.engine.setQuality('low', false);
    g.debugCam(760, 640, 12, 2.2, -0.12);
    await sleep(sec(6));
    (window as unknown as { gc?: () => void }).gc?.();
    await sleep(500);
    restarts.push({ run: i, heapMB: heapMB(), gl: h.gl(), geometries: g.debugGfx().geometries });
    log(`  run ${i}: heap ${heapMB() ?? 'n/a'} MB, buffers ${h.gl().buffer}, textures ${h.gl().texture}`);
  }
  report.restarts = restarts;
  report.finishedAt = new Date().toISOString();
  return report;
}
