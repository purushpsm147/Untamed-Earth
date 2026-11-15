import { describe, expect, it } from 'vitest';
import {
  CuriosityDirector,
  type AnimalSnapshotView,
  type SimEventLike,
  type WorldSnapshotView,
} from '../../apps/web/src/curiosity/CuriosityDirector';
import { Valley } from '@untamed/worlds';

function makeWorld(overrides?: {
  size?: number;
  heightFn?: (x: number, z: number) => number;
  buildings?: Array<{ x: number; z: number; w: number; d: number; h: number }>;
}) {
  return {
    size: overrides?.size ?? 1440,
    height:
      overrides?.heightFn ??
      ((x: number, z: number) => 10 + Math.sin(x * 0.01) * 2 + Math.cos(z * 0.01) * 2),
    waterSurface: () => 8,
    buildings: overrides?.buildings ?? [],
  };
}

function makeSnapshot(
  animals: AnimalSnapshotView[] = [],
  overrides?: {
    tick?: number;
    weather?: 'clear' | 'cloudy' | 'rain' | 'storm';
    heightFn?: (x: number, z: number) => number;
    buildings?: Array<{ x: number; z: number; w: number; d: number; h: number }>;
  },
): WorldSnapshotView {
  return {
    tick: overrides?.tick ?? 1,
    animals,
    env: {
      timeH: 10,
      weather: overrides?.weather ?? 'clear',
      cloud: 0.2,
      rain: 0,
      wind: 2,
      stage: 0,
    },
    world: makeWorld({
      heightFn: overrides?.heightFn,
      buildings: overrides?.buildings,
    }),
  };
}

function makeAnimal(partial: Partial<AnimalSnapshotView> & { id: number }): AnimalSnapshotView {
  return {
    sp: 0,
    x: 700,
    z: 500,
    alt: 0,
    heading: 0,
    speed: 2,
    beh: 2,
    alive: true,
    ...partial,
  };
}

describe('CuriosityDirector', () => {
  it('selects targets and plans camera poses deterministically for identical inputs', () => {
    const animals = [
      makeAnimal({ id: 1, x: 680, z: 480, beh: 2, speed: 1.5 }),
      makeAnimal({ id: 2, x: 740, z: 510, beh: 9, speed: 8.0 }),
      makeAnimal({ id: 3, x: 900, z: 800, beh: 6, speed: 6.5 }),
    ];
    const snap = makeSnapshot(animals);

    const runDirector = () => {
      const d = new CuriosityDirector();
      d.start({ x: 700, y: 30, z: 500, lookX: 700, lookY: 12, lookZ: 480 });
      d.pushEvent({ type: 'alarm', sp: 0, x: 730, z: 505 });
      const trace: Array<{
        key: string | undefined;
        pose: ReturnType<CuriosityDirector['getPose']>;
      }> = [];
      for (let i = 0; i < 30; i++) {
        const t = d.update(snap, 0.5);
        trace.push({ key: t?.key, pose: d.getPose() });
      }
      return trace;
    };

    const runA = runDirector();
    const runB = runDirector();
    expect(runA).toEqual(runB);
  });

  it('handles empty worlds gracefully with scenic fallback and finite camera coordinates', () => {
    const emptySnap = makeSnapshot([]);
    const d = new CuriosityDirector();
    d.start();

    const target = d.update(emptySnap, 0.1);
    expect(target).not.toBeNull();
    expect(target?.kind).toBe('scenic');

    const pose = d.getPose();
    expect(Number.isFinite(pose.x)).toBe(true);
    expect(Number.isFinite(pose.y)).toBe(true);
    expect(Number.isFinite(pose.z)).toBe(true);
    expect(Number.isFinite(pose.lookX)).toBe(true);
    expect(Number.isFinite(pose.lookY)).toBe(true);
    expect(Number.isFinite(pose.lookZ)).toBe(true);
  });

  it('bounds internal buffers and CPU work under heavy event and animal saturation', () => {
    const d = new CuriosityDirector({
      maxEventBuffer: 32,
      maxCandidates: 64,
      maxCooldownEntries: 128,
    });
    d.start();

    // Flood 2,000 events
    for (let i = 0; i < 2000; i++) {
      const ev: SimEventLike =
        i % 4 === 0
          ? {
              type: 'kill',
              predator: i,
              prey: i + 1,
              sp: i % 6,
              x: 200 + (i % 1000),
              z: 200 + ((i * 7) % 1000),
            }
          : {
              type: 'alarm',
              sp: i % 6,
              x: 200 + (i % 1000),
              z: 200 + ((i * 7) % 1000),
            };
      d.pushEvent(ev);
    }

    // Flood 1,500 animals
    const crowd: AnimalSnapshotView[] = [];
    for (let i = 1; i <= 1500; i++) {
      crowd.push(
        makeAnimal({ id: i, x: 100 + (i % 1200), z: 100 + ((i * 13) % 1200), beh: i % 13 }),
      );
    }
    const snap = makeSnapshot(crowd);

    for (let step = 0; step < 200; step++) {
      d.update(snap, 0.25);
    }

    const stats = d.getResourceStats();
    expect(stats.eventBufferSize).toBeLessThanOrEqual(32);
    expect(stats.cooldownSize).toBeLessThanOrEqual(128);
    expect(stats.noveltySize).toBeLessThanOrEqual(128);
  });

  it('enforces minimum observation duration and switching hysteresis to prevent target jitter', () => {
    const d = new CuriosityDirector({
      minHoldSec: 8,
      maxHoldSec: 20,
      switchHysteresis: 1.3,
    });
    d.start({ x: 700, y: 25, z: 520, lookX: 700, lookY: 10, lookZ: 500 });

    const a1 = makeAnimal({ id: 10, x: 700, z: 500, beh: 2, speed: 1 }); // forage
    const snap1 = makeSnapshot([a1]);
    const initial = d.update(snap1, 0.5);
    expect(initial?.key).toBe('animal:10');

    // A higher-scoring animal appears at t = 2s (before minHoldSec = 8s)
    const a2 = makeAnimal({ id: 20, x: 705, z: 502, beh: 9, speed: 9 }); // chase
    const snap2 = makeSnapshot([a1, a2]);
    const duringHold = d.update(snap2, 1.5);
    expect(duringHold?.key).toBe('animal:10');

    // Advance past minHoldSec (total > 8s) with a stronger kill event
    d.pushEvent({ type: 'kill', predator: 20, prey: 10, sp: 0, x: 705, z: 502 });
    let afterHold = d.update(snap2, 0.25);
    for (let i = 0; i < 30; i++) {
      afterHold = d.update(snap2, 0.25);
    }
    expect(afterHold?.key).not.toBe('animal:10');
  });

  it('switches immediately if the currently observed animal dies and never mutates snapshots', () => {
    const a1 = makeAnimal({ id: 1, x: 700, z: 500, beh: 9, speed: 6, alive: true });
    const a2 = makeAnimal({ id: 2, x: 720, z: 510, beh: 2, speed: 1, alive: true });
    const snap = makeSnapshot([a1, a2]);
    Object.freeze(snap);
    Object.freeze(snap.animals);
    Object.freeze(a1);
    Object.freeze(a2);

    const d = new CuriosityDirector({ minHoldSec: 15 });
    d.start();
    const first = d.update(snap, 0.5);
    expect(first?.animalId).toBe(1);

    // Animal 1 dies -> immediate switch despite minHoldSec = 15
    const a1Dead = makeAnimal({ id: 1, x: 700, z: 500, beh: 9, speed: 0, alive: false });
    const snapAfterDeath = makeSnapshot([a1Dead, a2]);
    const next = d.update(snapAfterDeath, 0.5);
    expect(next?.animalId).toBe(2);
  });

  it('keeps camera above terrain/water and outside building footprints, and supports manual interrupt', () => {
    const snap = makeSnapshot([makeAnimal({ id: 5, x: 1010, z: 440, beh: 2 })], {
      heightFn: () => 25,
      buildings: [{ x: 1010, z: 440, w: 30, d: 30, h: 12 }],
    });

    const d = new CuriosityDirector({ minClearanceM: 2.5, reducedMotion: true });
    d.start({ x: 1010, y: 20, z: 440, lookX: 1010, lookY: 25, lookZ: 440 });
    d.update(snap, 0.25);
    const pose = d.getPose();
    expect(pose.y).toBeGreaterThanOrEqual(27.5);

    d.interrupt();
    expect(d.isActive()).toBe(false);
    expect(d.update(snap, 0.25)).toBeNull();
  });

  it('Skip excludes the current animal even when it remains the highest-scoring target', () => {
    const d = new CuriosityDirector();
    const snap = makeSnapshot([makeAnimal({ id: 101, x: 700, z: 500, beh: 9, speed: 12 })]);
    d.start({ x: 700, y: 30, z: 500, lookX: 700, lookY: 12, lookZ: 500 });
    const first = d.update(snap, 0.25);
    expect(first?.key).toBe('animal:101');
    const second = d.skip(snap);
    expect(second).not.toBeNull();
    expect(second?.key).not.toBe(first?.key);
    expect(second?.kind).toBe('scenic');
  });

  it('Skip moves between scenic targets in an empty world and does nothing when inactive', () => {
    const d = new CuriosityDirector();
    const snap = makeSnapshot([]);
    expect(d.skip(snap)).toBeNull();
    d.start();
    const first = d.update(snap, 0.1);
    const next = d.skip(snap);
    expect(next?.key).not.toBe(first?.key);
  });

  it('escapes vertically when initial camera position is inside a building below its roof', () => {
    const b = { x: 1010, z: 440, w: 30, d: 30, h: 12, rot: 0.4 };
    const snap = makeSnapshot([makeAnimal({ id: 5, x: b.x, z: b.z, beh: 2 })], {
      heightFn: () => 25,
      buildings: [b],
    });
    const d = new CuriosityDirector({ minClearanceM: 2.5, reducedMotion: true });
    d.start({ x: b.x, y: 20, z: b.z, lookX: b.x, lookY: 25, lookZ: b.z });
    d.update(snap, 0.25);
    expect(d.getPose().y).toBeGreaterThanOrEqual(39.5);
  });

  it('keeps the camera clear while crossing a rotated building footprint from outside', () => {
    const b = { x: 1000, z: 500, w: 35, d: 24, h: 18, rot: Math.PI / 4 };
    const snap = makeSnapshot([makeAnimal({ id: 7, x: 1010, z: 500, beh: 9, speed: 5 })], {
      heightFn: () => 10,
      buildings: [b],
    });
    const d = new CuriosityDirector({ minClearanceM: 2.5 });
    d.start({ x: 970, y: 15, z: 500, lookX: 1010, lookY: 12, lookZ: 500 });
    const roof = 30.5;
    let old = d.getPose();
    for (let i = 0; i < 100; i++) {
      d.update(snap, 0.2);
      const pose = d.getPose();
      const dx = pose.x - b.x, dz = pose.z - b.z;
      // Valley.blocked() convention (the game's real footprints)
      const lx = dx * Math.cos(b.rot) - dz * Math.sin(b.rot);
      const lz = dx * Math.sin(b.rot) + dz * Math.cos(b.rot);
      const within = Math.abs(lx) < b.w / 2 + 2 && Math.abs(lz) < b.d / 2 + 2;
      if (within) expect(pose.y).toBeGreaterThanOrEqual(roof - 1e-6);
      // Any horizontal progress across a building requires the *previous* camera
      // to be above the roof as well, preventing tunnelling through its walls.
      if (within && (pose.x !== old.x || pose.z !== old.z)) {
        expect(old.y).toBeGreaterThanOrEqual(roof - 1e-6);
      }
      old = pose;
    }
    expect(d.getPose().x).toBeGreaterThan(970);
  });

  it('uses the same rotated footprints as the game: never inside a real Valley building below its roof', () => {
    const valley = new Valley(1);
    const rotated = valley.buildings.filter((b) => b.kind !== 'tower' && Math.abs(Math.sin(2 * b.rot)) > 0.3 && b.w / b.d > 1.3);
    expect(rotated.length).toBeGreaterThan(2);
    const world = { size: valley.size, height: (x: number, z: number) => valley.height(x, z), waterSurface: (z: number) => valley.waterSurface(z), buildings: valley.buildings };
    for (const b of rotated.slice(0, 6)) {
      const snap: WorldSnapshotView = { tick: 1, animals: [makeAnimal({ id: 1, x: b.x, z: b.z, beh: 9, speed: 5 })], env: makeSnapshot().env, world };
      const d = new CuriosityDirector({ minClearanceM: 2.5 });
      // start low, 40 m away, so the approach has to cross the footprint
      const sx = b.x - 40, sz = b.z;
      d.start({ x: sx, y: valley.height(sx, sz) + 3, z: sz, lookX: b.x, lookY: valley.height(b.x, b.z), lookZ: b.z });
      for (let i = 0; i < 150; i++) {
        d.update(snap, 0.1);
        const p = d.getPose();
        if (valley.blocked(p.x, p.z, 0)) expect(p.y, `building at ${b.x.toFixed(0)},${b.z.toFixed(0)}`).toBeGreaterThan(valley.height(b.x, b.z) + b.h * (1 - b.collapse * 0.4));
      }
    }
  });

  it('caps camera speed for comfort, slower still with reduced motion', () => {
    for (const reduced of [false, true]) {
      const d = new CuriosityDirector({ reducedMotion: reduced });
      const snap = makeSnapshot([makeAnimal({ id: 3, x: 1300, z: 1300, beh: 9, speed: 10 })]);
      d.start({ x: 100, y: 40, z: 100, lookX: 110, lookY: 12, lookZ: 110 });
      let prev = d.getPose();
      let max = 0;
      for (let i = 0; i < 200; i++) {
        d.update(snap, 1 / 30);
        const p = d.getPose();
        max = Math.max(max, Math.hypot(p.x - prev.x, p.z - prev.z) * 30);
        prev = p;
      }
      expect(max).toBeLessThanOrEqual((reduced ? 22 : 55) + 1e-6);
      expect(max).toBeGreaterThan(reduced ? 15 : 40); // and it does travel
    }
  });

  it('follows the animal named by birth and alarm events, not just the spot where they happened', () => {
    const d = new CuriosityDirector();
    const mother = makeAnimal({ id: 42, x: 600, z: 600, beh: 1, speed: 1 });
    d.start({ x: 600, y: 30, z: 640, lookX: 600, lookY: 12, lookZ: 600 });
    d.pushEvent({ type: 'birth', sp: 0, id: 42, x: 600, z: 600, n: 1 });
    const t = d.update(makeSnapshot([mother]), 0.1);
    expect(t?.animalId).toBe(42);
    const moved = d.update(makeSnapshot([{ ...mother, x: 640, z: 610 }]), 0.1);
    expect(moved?.x).toBe(640);
  });
});
