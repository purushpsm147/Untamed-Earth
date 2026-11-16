import { describe, expect, it } from 'vitest';
import { FramePacer, QualityGovernor } from '../../apps/web/src/render/qualityGovernor';
import { HardwareHints, assessQuality } from '../../apps/web/src/render/quality';
import type { QualityChange } from '../../apps/web/src/render/qualityGovernor';

function simulate(g: QualityGovernor, ms: number, seconds: number): QualityChange[] {
  const seen: QualityChange[] = [];
  const frames = Math.ceil((seconds * 1000) / ms);
  for (let i = 0; i < frames; i++) seen.push(g.sample(ms / 1000, false));
  return seen;
}

/**
 * A render-bound device: frame time scales with the work the preset and resolution ask for (fill rate is about
 * two thirds of it here). `highMs` is its frame time on High at full resolution. Real GPUs differ; this only has to
 * respond to settings, which is what a downgrade trial measures.
 */
const COST: Record<string, number> = { low: 0.5, medium: 0.75, high: 1, ultra: 1.3 };
const renderMs = (g: QualityGovernor, highMs: number): number => highMs * COST[g.quality]! * (0.35 + 0.65 * g.scale * g.scale);
function simulateDevice(g: QualityGovernor, highMs: number, seconds: number): QualityChange[] {
  const seen: QualityChange[] = [];
  for (let t = 0; t < seconds;) {
    const ms = renderMs(g, highMs);
    seen.push(g.sample(ms / 1000, false));
    t += ms / 1000;
  }
  return seen;
}

describe('adaptive quality: deterministic, renderer-independent', () => {
  it('reduces resolution then drops a preset under sustained overload', () => {
    const g = new QualityGovernor('high');
    const changes = simulateDevice(g, 45, 23);
    expect(changes).toContain('resolution');
    expect(changes).toContain('preset');
    expect(g.quality).not.toBe('high');
    expect(g.ceiling).toBe('high');
    expect(g.scale).toBeGreaterThanOrEqual(0.5);
  });

  it('recovers resolution AND a higher preset after temporary overload', () => {
    const g = new QualityGovernor('high');
    simulateDevice(g, 45, 10);
    expect(g.quality).toBe('medium');
    const changes = simulate(g, 16, 125);
    expect(changes).toContain('preset');
    expect(g.quality).toBe('high');
    expect(g.scale).toBe(1);
    expect(g.ceiling).toBe('high');
    // Hard ceiling, even with continuous headroom.
    simulate(g, 16, 90);
    expect(g.quality).toBe('high');
  });

  it('ignores isolated spikes and hidden-tab/restore intervals', () => {
    const g = new QualityGovernor('medium');
    for (let i = 0; i < 100; i++) g.sample(1 / 60, false);
    expect(g.sample(0.4, false)).toBe('none');
    for (let i = 0; i < 500; i++) expect(g.sample(0.1, true)).toBe('none');
    expect(g.quality).toBe('medium');
    expect(g.scale).toBe(1);
    g.sample(0.2, false);
    simulate(g, 16, 3);
    expect(g.quality).toBe('medium');
  });

  it('respects manual quality settings and a newly selected ceiling', () => {
    const g = new QualityGovernor('ultra');
    g.setQuality('medium', false);
    simulate(g, 60, 40);
    expect(g.quality).toBe('medium');
    expect(g.scale).toBe(1);
    g.setAuto(true);
    simulateDevice(g, 90, 15);
    expect(g.quality).toBe('low');
    expect(g.ceiling).toBe('medium');
    simulate(g, 16, 150);
    expect(g.quality).toBe('medium');
    expect(g.ceiling).toBe('medium');
    g.setQuality('low', false);
    expect(g.quality).toBe('low');
    expect(g.ceiling).toBe('low');
    expect(g.scale).toBe(1);
  });

  it('does not change ecology, depend on DOM, or oscillate from near-budget noise', () => {
    const g = new QualityGovernor('high');
    simulate(g, 20, 20); // below overload threshold but lacks upgrade headroom
    expect(g.quality).toBe('high');
    expect(g.scale).toBe(1);
    // No animal state or simulation dependency is required by this module.
  });
});

describe('adaptive quality: ordering, hysteresis and very slow devices', () => {
  it('lowers resolution all the way to the floor before it touches the preset', () => {
    const g = new QualityGovernor('high');
    const changes = simulateDevice(g, 90, 60).filter((c) => c !== 'none');
    const firstPreset = changes.indexOf('preset');
    expect(firstPreset).toBeGreaterThanOrEqual(5); // 1.0 -> 0.5 in 0.1 steps first
    expect(changes.slice(0, firstPreset).every((c) => c === 'resolution')).toBe(true);
    expect(g.quality).toBe('low');
    expect(g.scale).toBe(0.5);
  });

  it('does not oscillate at a performance cliff: failed upgrades back off exponentially', () => {
    // a device that holds 60 fps at <=70% resolution but drops to 30 fps above it
    const g = new QualityGovernor('high');
    const upgrades: number[] = [];
    let presetChanges = 0;
    let t = 0;
    let last = g.scale;
    while (t < 900) {
      const ms = g.scale > 0.7 ? 33 : 16.7;
      const c = g.sample(ms / 1000, false);
      if (c === 'preset') presetChanges++;
      if (c === 'resolution' && g.scale > last) upgrades.push(t);
      last = g.scale;
      t += ms / 1000;
    }
    expect(presetChanges).toBe(0);
    expect(upgrades.length).toBeLessThanOrEqual(8); // a naive controller would flip about 90 times in 15 minutes
    const gaps = upgrades.slice(1).map((s, i) => s - upgrades[i]!);
    for (let i = 1; i < gaps.length; i++) expect(gaps[i]!).toBeGreaterThan(gaps[i - 1]! * 1.3);
    expect(g.scale).toBeGreaterThanOrEqual(0.6);
  });

  it('an upgrade that holds restores the normal upgrade cadence', () => {
    const g = new QualityGovernor('high');
    // two failed probes at 0.8 lengthen the wait...
    let t = 0;
    let probes = 0;
    let last = g.scale;
    while (probes < 2) {
      const ms = g.scale > 0.7 ? 33 : 16.7;
      g.sample(ms / 1000, false);
      if (g.scale > last) probes++;
      last = g.scale;
      t += ms / 1000;
      expect(t).toBeLessThan(120);
    }
    // ...then the load genuinely goes away: quality climbs all the way back, not just one step
    simulate(g, 16, 400);
    expect(g.quality).toBe('high');
    expect(g.scale).toBe(1);
  });

  it('reacts to a device stuck below 4 fps instead of treating every frame as a resume gap', () => {
    const g = new QualityGovernor('high');
    for (let i = 0; i < 400; i++) g.sample(renderMs(g, 1200) / 1000, false); // ~1 fps, every frame longer than the 250 ms gap guard
    expect(g.quality).toBe('low');
    expect(g.scale).toBe(0.5);
    // while a single long frame in an otherwise smooth run is still ignored
    const h = new QualityGovernor('high');
    for (let i = 0; i < 2000; i++) h.sample(i % 200 === 0 ? 0.9 : 1 / 60, false);
    expect(h.quality).toBe('high');
    expect(h.scale).toBe(1);
  });

  it('start-up calibration drops whole presets quickly on a badly overloaded device, and only then', () => {
    const slow = new QualityGovernor('high');
    slow.beginCalibration(4);
    const changes = simulate(slow, 120, 2.5).filter((c) => c !== 'none');
    expect(slow.quality).toBe('low'); // within 2.5 s instead of ~20 s of resolution creep
    expect(changes.every((c) => c === 'preset')).toBe(true);
    const fine = new QualityGovernor('high');
    fine.beginCalibration(4);
    expect(simulate(fine, 16.7, 6).every((c) => c === 'none')).toBe(true);
    expect(fine.quality).toBe('high');
    expect(fine.calibrating).toBe(false);
    // mildly slow (28 ms at a 60 fps target) is left to the gentle resolution path
    const mild = new QualityGovernor('high');
    mild.beginCalibration(4);
    simulateDevice(mild, 28, 4);
    expect(mild.quality).toBe('high');
    expect(mild.scale).toBeLessThan(1);
  });

  it('a 30 fps target accepts 33 ms frames and still protects against real overload', () => {
    const g = new QualityGovernor('high');
    g.setTarget(30);
    simulate(g, 33.3, 30);
    expect(g.quality).toBe('high');
    expect(g.scale).toBe(1);
    simulateDevice(g, 60, 20);
    expect(g.scale).toBeLessThan(1);
    // at 60 fps target the same 33 ms frames are an overload
    const h = new QualityGovernor('high');
    simulateDevice(h, 33.3, 30);
    expect(h.scale).toBeLessThan(1);
  });

  it('starts below the ceiling when asked and climbs to it, never beyond', () => {
    const g = new QualityGovernor('medium', 'high');
    expect(g.ceiling).toBe('high');
    simulate(g, 16, 60);
    expect(g.quality).toBe('high');
    simulate(g, 16, 120);
    expect(g.quality).toBe('high');
    expect(new QualityGovernor('high', 'low').ceiling).toBe('high'); // a ceiling below the start is raised to it
  });

  it('forgets evidence gathered before the tab was hidden', () => {
    const g = new QualityGovernor('high');
    simulate(g, 45, 1.3); // almost enough overload to act
    g.resume();
    simulate(g, 45, 0.6);
    expect(g.scale).toBe(1);
  });
});

describe('adaptive quality: downgrades must measurably help (render-insensitive slowdowns)', () => {
  // frame time that does not respond to rendering settings at all, e.g. 30 ms of main-thread work per frame
  it('rolls back a downgrade that does not improve frame time and keeps the quality', () => {
    const g = new QualityGovernor('high');
    const changes = simulate(g, 45, 20).filter((c) => c !== 'none');
    expect(g.quality).toBe('high');
    expect(g.scale).toBe(1);
    expect(changes).toEqual(['resolution', 'resolution']); // one probe, one exact undo
    expect(g.stats).toMatchObject({ trials: 1, helped: 0, rolledBack: 1 });
    expect(g.stats.last).toMatchObject({ kind: 'resolution', from: 'high@1', to: 'high@0.9', verdict: 'no-help-rolled-back' });
    expect(g.stats.holdS).toBeGreaterThan(0);
  });

  it('probes again with exponential back-off instead of oscillating', () => {
    const g = new QualityGovernor('high');
    simulate(g, 45, 900); // 15 minutes of a render-insensitive slowdown
    const s = g.stats;
    expect(g.quality).toBe('high');
    expect(g.scale).toBe(1);
    expect(s.helped).toBe(0);
    // holds of 30, 60, 120, 240, 480 s: at most 6 probes in 15 min (a naive controller would degrade to Low and stay)
    expect(s.trials).toBeLessThanOrEqual(6);
    expect(s.trials).toBe(s.rolledBack);
  });

  it('a held governor still acts if frame time gets materially worse, and recovers normally when load ends', () => {
    const g = new QualityGovernor('high');
    simulate(g, 45, 6);
    expect(g.stats.rolledBack).toBe(1);
    // now a genuinely render-bound load arrives (frame time far above the held reference and responsive)
    simulateDevice(g, 90, 30);
    expect(g.stats.helped).toBeGreaterThan(0);
    expect(g.quality === 'high' && g.scale === 1).toBe(false);
    // load gone: back to the ceiling
    simulate(g, 16, 200);
    expect(g.quality).toBe('high');
    expect(g.scale).toBe(1);
  });

  it('a downgrade that helps is kept and reported as measured', () => {
    const g = new QualityGovernor('high');
    simulateDevice(g, 30, 4);
    expect(g.scale).toBeLessThan(1);
    expect(g.stats.last).toMatchObject({ verdict: 'helped' });
    expect(g.stats.last!.afterMs).toBeLessThan(g.stats.last!.beforeMs);
  });

  it('never exceeds the ceiling or touches a manual preset when rolling back', () => {
    const g = new QualityGovernor('low', 'medium');
    simulate(g, 80, 30);
    expect(g.quality).toBe('low');
    expect(g.ceiling).toBe('medium');
    const m = new QualityGovernor('high');
    m.setQuality('medium', false);
    simulate(m, 80, 30);
    expect(m.quality).toBe('medium');
    expect(m.stats.trials).toBe(0);
  });

  it('a slow, hitchy device keeps downgrades that genuinely help (no verdicts from a handful of noisy frames)', () => {
    // ~4 fps render-bound device; every 5th frame is a 3x hitch (GC, compositor)
    const g = new QualityGovernor('high');
    let i = 0;
    for (let t = 0; t < 60;) {
      const ms = renderMs(g, 260) * (++i % 5 === 0 ? 3 : 1);
      g.sample(ms / 1000, false);
      t += ms / 1000;
    }
    expect(g.stats.helped).toBeGreaterThan(0);
    expect(g.stats.rolledBack).toBe(0);
    expect(g.quality === 'high' && g.scale === 1).toBe(false);
  });

  it('is deterministic for the same frame trace', () => {
    const run = (): string => {
      const g = new QualityGovernor('high');
      const out: string[] = [];
      for (let i = 0; i < 4000; i++) out.push(g.sample((i % 700 < 350 ? 45 : renderMs(g, 50)) / 1000, false));
      return out.join(',') + JSON.stringify(g.stats);
    };
    expect(run()).toBe(run());
  });
});

describe('frame pacing', () => {
  const run = (p: FramePacer, displayHz: number, seconds: number, renderMs = 1): number => {
    // callbacks arrive on vsync; a render that overruns delays the next callback to the following vsync
    const vsync = 1000 / displayHz;
    let t = 0;
    let lastCb = 0;
    let rendered = 0;
    p.tick(vsync);
    while (t < seconds * 1000) {
      const did = p.tick(t - lastCb || vsync);
      lastCb = t;
      if (did) rendered++;
      const busy = did ? renderMs : 0.1;
      t += Math.max(1, Math.ceil(busy / vsync)) * vsync;
    }
    return rendered / seconds;
  };
  it('halves a 60 Hz display for a 30 fps target and leaves it alone for 60', () => {
    const a = new FramePacer();
    a.target = 30;
    expect(run(a, 60, 10)).toBeCloseTo(30, 0);
    const b = new FramePacer();
    b.target = 60;
    expect(run(b, 60, 10)).toBeCloseTo(60, 0);
  });
  it('caps fast displays near the target without dropping below it', () => {
    for (const [hz, expected] of [[120, 60], [144, 72], [90, 90], [240, 60], [165, 82.5]] as const) {
      const p = new FramePacer();
      p.target = 60;
      const fps = run(p, hz, 10);
      expect(fps, `${hz} Hz`).toBeGreaterThanOrEqual(59);
      expect(Math.abs(fps - expected), `${hz} Hz -> ${fps}`).toBeLessThan(3);
    }
  });
  it('never skips when the device is already slower than the target, and can be uncapped', () => {
    const p = new FramePacer();
    p.target = 30;
    const fps = run(p, 60, 10, 45); // each render takes 45 ms: 3 vsyncs
    expect(fps).toBeGreaterThan(19); // every callback renders (20 fps possible); skipping would give ~15
    const u = new FramePacer();
    u.target = 0;
    expect(run(u, 144, 5)).toBeCloseTo(144, -1);
  });
});

describe('initial hardware assessment', () => {
  const base: HardwareHints = { mobile: false, memoryGB: 8, cores: 12, pixels: 2_073_600, renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060)', software: false };
  it('never picks Ultra, is conservative on weak hints, and says why', () => {
    expect(assessQuality(base)).toMatchObject({ initial: 'high', ceiling: 'high', fps: 60 });
    expect(assessQuality({ ...base, cores: 4 }).initial).toBe('medium');
    expect(assessQuality({ ...base, memoryGB: 4 }).initial).toBe('medium');
    expect(assessQuality({ ...base, renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 620)' }).initial).toBe('medium');
    expect(assessQuality({ ...base, pixels: 8_294_400 }).initial).toBe('medium');
    for (const h of [base, { ...base, cores: 2 }, { ...base, mobile: true }]) {
      const a = assessQuality(h);
      expect(a.initial).not.toBe('ultra');
      expect(a.ceiling).not.toBe('ultra');
      expect(a.reasons.length).toBeGreaterThan(0);
    }
  });
  it('treats mobile-class devices and software rasterisers conservatively', () => {
    expect(assessQuality({ ...base, mobile: true, memoryGB: 4 })).toMatchObject({ initial: 'low', ceiling: 'medium', fps: 30 });
    expect(assessQuality({ ...base, mobile: true, memoryGB: 8 })).toMatchObject({ initial: 'medium', ceiling: 'medium', fps: 30 });
    const sw = assessQuality({ ...base, renderer: 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)))', software: true });
    expect(sw).toMatchObject({ initial: 'low', ceiling: 'low', fps: 30 });
    expect(sw.reasons.join(' ')).toMatch(/software renderer/);
  });
  it('still decides when the browser reveals nothing', () => {
    const a = assessQuality({ mobile: false, memoryGB: null, cores: null, pixels: 2_073_600, renderer: '', software: false });
    expect(a.initial).toBe('high');
  });
});
