/**
 * Rapier feasibility vs the existing navigation (Mission 1). Usage, from the repository root:
 *   node --expose-gc --import tsx experiments/physics-rapier/run.ts [--quick] [--out file.json]
 *
 * Every mode runs the PRODUCTION Simulation. A test deer (or herd) is given a fixed goal each tick exactly as the
 * navigation unit tests do; the simulation's own steering, speed and turning produce each move. Modes differ only in
 * what happens to that move afterwards:
 *   existing          nothing (production behaviour)
 *   rapier-validate   reject the move if a deer capsule at the new position intersects a static collider
 *   rapier-kcc        Rapier's kinematic character controller corrects the proposed displacement (slide, slopes)
 *   analytic-scatter  reject the move if it ends inside a tree trunk / rock / log circle (reference: validation
 *                     without a physics engine)
 *   analytic-slide    push the deer back out to the edge of a trunk / rock / log circle (reference: sliding without a
 *                     physics engine; ~20 lines of code)
 * Rapier never decides anything and never owns time: positions it returns are written back into the simulation's
 * animal, which remains the single authoritative state (save/load, IDs and RNG are the simulation's).
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { B, SPECIES, SPECIES_INDEX, Simulation, maturityDays, type Animal } from '@untamed/ecology';
import { type Circle, scatterSolids } from './geometry';

const args = process.argv.slice(2);
const quick = args.includes('--quick');
const outI = args.indexOf('--out');
const OUT = outI >= 0 ? args[outI + 1]! : 'docs/evidence/tech-experiments/physics-feasibility.json';
const ENGINE = (process.env.RAPIER_BUILD ?? 'deterministic') as 'deterministic' | 'simd';
const SEEDS = quick ? [1] : [1, 2, 3];
const REPEATS = quick ? 1 : 3;

// ---------------------------------------------------------------- Rapier init (measured)
const tImport = performance.now();
const RAPIER = (ENGINE === 'deterministic' ? (await import('@dimforge/rapier3d-deterministic-compat')).default : (await import('@dimforge/rapier3d-compat')).default);
const importMs = performance.now() - tImport;
const rss0 = process.memoryUsage();
const tInit = performance.now();
await RAPIER.init();
const initMs = performance.now() - tInit;
const rss1 = process.memoryUsage();

/** Deer capsule: chital-sized (1.5 m body, ~1 m at the shoulder). The simulation keeps deer centres 0.6 m from walls. */
const DEER_R = 0.35;
const DEER_HALF = 0.3;
const MAX_CLIMB = Math.atan(0.95); // the navigator refuses uphill grades above 0.95
const DT = 0.1;

type Mode = 'existing' | 'rapier-validate' | 'rapier-kcc' | 'analytic-scatter' | 'analytic-slide';
const MODES: Mode[] = ['existing', 'rapier-validate', 'rapier-kcc', 'analytic-scatter', 'analytic-slide'];

interface Scenario {
  id: string;
  kind: string;
  seed: number;
  /** Single deer: start and goal. Herd scenarios use `herd`. */
  start?: { x: number; z: number };
  goal?: { x: number; z: number };
  waypoints?: { x: number; z: number }[];
  herd?: boolean;
  limitS: number;
}

// ---------------------------------------------------------------- physics world from the same geometry
interface Phys { world: InstanceType<typeof RAPIER.World>; kcc: ReturnType<InstanceType<typeof RAPIER.World>['createCharacterController']>; deer: Map<number, ReturnType<InstanceType<typeof RAPIER.World>['createCollider']>>; statics: number; buildMs: number; ys: Map<number, number> }

function buildPhys(sim: Simulation, cx: number, cz: number, R: number, solids: Circle[]): Phys {
  const t = performance.now();
  const v = sim.valley;
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  let statics = 0;
  // terrain: heightfield at 2 m over the scenario region (column-major, x outer: verified against Valley.height)
  const n = Math.ceil((2 * R) / 2);
  const size = n * 2;
  const heights = new Float32Array((n + 1) * (n + 1));
  for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) heights[i * (n + 1) + j] = v.height(cx - size / 2 + (i / n) * size, cz - size / 2 + (j / n) * size);
  world.createCollider(RAPIER.ColliderDesc.heightfield(n, n, heights, { x: size, y: 1, z: size }).setTranslation(cx, 0, cz));
  statics++;
  // buildings: the simulation's footprints, extruded to their height
  for (const b of v.buildings) {
    if ((b.x - cx) ** 2 + (b.z - cz) ** 2 > (R + 40) ** 2) continue;
    const g = v.height(b.x, b.z);
    world.createCollider(RAPIER.ColliderDesc.cuboid(b.w / 2, Math.max(1, b.h) / 2 + 5, b.d / 2)
      .setTranslation(b.x, g + Math.max(1, b.h) / 2 - 5, b.z).setRotation({ x: 0, y: Math.sin(b.rot / 2), z: 0, w: Math.cos(b.rot / 2) }));
    statics++;
  }
  // scatter solids: trunks, snags, rocks, logs (the simulation ignores these)
  for (const c of solids) {
    const g = v.height(c.x, c.z);
    world.createCollider(RAPIER.ColliderDesc.cylinder(c.h / 2 + 0.5, c.r).setTranslation(c.x, g + c.h / 2 - 0.5, c.z));
    statics++;
  }
  const kcc = world.createCharacterController(0.02);
  kcc.setSlideEnabled(true);
  kcc.setMaxSlopeClimbAngle(MAX_CLIMB);
  kcc.setMinSlopeSlideAngle(Math.atan(1.3));
  kcc.enableSnapToGround(0.6);
  kcc.enableAutostep(0.3, 0.2, false);
  world.step();
  return { world, kcc, deer: new Map(), statics, buildMs: performance.now() - t, ys: new Map() };
}

function deerCollider(P: Phys, sim: Simulation, a: Animal): ReturnType<Phys['world']['createCollider']> {
  let c = P.deer.get(a.id);
  if (!c) {
    const y = sim.valley.height(a.x, a.z) + DEER_HALF + DEER_R + 0.03;
    c = P.world.createCollider(RAPIER.ColliderDesc.capsule(DEER_HALF, DEER_R).setTranslation(a.x, y, a.z));
    P.deer.set(a.id, c);
    P.ys.set(a.id, y);
  }
  return c;
}

/** Does a deer capsule centred over (x, z) intersect any static collider (terrain excluded)? */
function capsuleHits(P: Phys, sim: Simulation, a: Animal, x: number, z: number): boolean {
  const y = sim.valley.height(x, z) + DEER_HALF + DEER_R + 0.05;
  let hit = false;
  const shape = new RAPIER.Capsule(DEER_HALF, DEER_R);
  const self = P.deer.get(a.id);
  P.world.intersectionsWithShape({ x, y, z }, { x: 0, y: 0, z: 0, w: 1 }, shape, (c) => {
    if (c === self || c.shape.type === RAPIER.ShapeType.HeightField) return true;
    if ([...P.deer.values()].includes(c)) return true; // other deer are not walls for validation
    hit = true;
    return false;
  });
  return hit;
}

// ---------------------------------------------------------------- scenario construction from the real valley
function buildScenarios(seed: number): Scenario[] {
  const sim = new Simulation(seed);
  const v = sim.valley;
  const out: Scenario[] = [];
  const free = (x: number, z: number): boolean => v.inBounds(x, z, 20) && !v.blocked(x, z, 1.5) && v.waterDepth(x, z, 0) < -0.3;
  // 1. around the three largest building footprints
  const big = [...v.buildings].filter((b) => b.kind !== 'tower').sort((p, q) => q.w * q.d - p.w * p.d).slice(0, 3);
  big.forEach((b, i) => {
    const nx = Math.sin(b.rot);
    const nz = Math.cos(b.rot);
    const s = { x: b.x - nx * (b.d / 2 + 14), z: b.z - nz * (b.d / 2 + 14) };
    const g = { x: b.x + nx * (b.d / 2 + 14), z: b.z + nz * (b.d / 2 + 14) };
    if (free(s.x, s.z) && free(g.x, g.z)) out.push({ id: `s${seed}-building-${i}`, kind: '1-building-footprint', seed, start: s, goal: g, limitS: 120 });
  });
  // 2. narrow passages: nearest building pairs with a 2-8 m gap between footprints; cross through the gap
  const pairs: { a: (typeof v.buildings)[number]; b: (typeof v.buildings)[number]; gap: number }[] = [];
  for (let i = 0; i < v.buildings.length; i++) for (let j = i + 1; j < v.buildings.length; j++) {
    const A = v.buildings[i]!;
    const Bb = v.buildings[j]!;
    const d = Math.hypot(A.x - Bb.x, A.z - Bb.z);
    const gap = d - (Math.max(A.w, A.d) + Math.max(Bb.w, Bb.d)) / 2;
    if (gap > 2 && gap < 8) pairs.push({ a: A, b: Bb, gap });
  }
  pairs.sort((p, q) => p.gap - q.gap).slice(0, 3).forEach((p, i) => {
    const mx = (p.a.x + p.b.x) / 2;
    const mz = (p.a.z + p.b.z) / 2;
    const ax = p.b.x - p.a.x;
    const az = p.b.z - p.a.z;
    const L = Math.hypot(ax, az);
    const px = -az / L;
    const pz = ax / L;
    const s = { x: mx - px * 22, z: mz - pz * 22 };
    const g = { x: mx + px * 22, z: mz + pz * 22 };
    if (free(s.x, s.z) && free(g.x, g.z)) out.push({ id: `s${seed}-gap-${i}`, kind: '2-narrow-passage', seed, start: s, goal: g, limitS: 90 });
  });
  // 3. slopes: a point with a cliff (grade > 1.2 over 4 m) and a traversable slope (0.35-0.6); goal 30 m upslope
  let cliff: Scenario | null = null;
  let slope: Scenario | null = null;
  const freeEdge = (x: number, z: number): boolean => v.inBounds(x, z, 12) && !v.blocked(x, z, 1.5) && v.waterDepth(x, z, 0) < -0.3;
  for (let k = 0; k < 20000 && (!cliff || !slope); k++) {
    const x = 15 + ((k * 97) % 1500);
    const z = 15 + ((k * 61) % 1500);
    if (!freeEdge(x, z)) continue;
    for (let d = 0; d < 8; d++) {
      const ang = (d * Math.PI) / 4;
      const h0 = v.height(x, z);
      const h4 = v.height(x + Math.sin(ang) * 4, z + Math.cos(ang) * 4);
      const grade = (h4 - h0) / 4;
      const g = { x: x + Math.sin(ang) * 30, z: z + Math.cos(ang) * 30 };
      if (!freeEdge(g.x, g.z)) continue;
      if (!cliff && grade > 1.2) cliff = { id: `s${seed}-cliff`, kind: '3-cliff', seed, start: { x, z }, goal: g, limitS: 120 };
      if (!slope && grade > 0.35 && grade < 0.6) slope = { id: `s${seed}-slope`, kind: '3-traversable-slope', seed, start: { x, z }, goal: g, limitS: 90 };
    }
  }
  if (cliff) out.push(cliff);
  if (slope) out.push(slope);
  // 4. riverbank: from shallow water to dry ground, and across the river
  {
    const z = 400 + seed * 150;
    const rx = v.riverX(z);
    let wet = rx;
    while (v.waterDepth(wet, z, 0) > 0.35) wet += 1;
    let dry = wet;
    while (v.waterDepth(dry, z, 0) > -0.4) dry += 1;
    out.push({ id: `s${seed}-bank`, kind: '4-wet-to-dry', seed, start: { x: wet, z }, goal: { x: dry + 20, z }, limitS: 60 });
    let far = rx;
    while (v.waterDepth(far, z, 0) > -0.4) far -= 1;
    out.push({ id: `s${seed}-crossing`, kind: '4-river-crossing', seed, start: { x: dry + 10, z }, goal: { x: far - 10, z }, limitS: 120 });
  }
  // 5. herd escape among obstacles (largest chital herd, jackal close)
  out.push({ id: `s${seed}-herd-escape`, kind: '5-herd-escape', seed, herd: true, limitS: 60 });
  // 6. repeated steering: a loop of waypoints threading the settlement's buildings, three laps
  {
    const c = big[0]!;
    const wp: { x: number; z: number }[] = [];
    for (let k = 0; k < 8; k++) {
      const ang = (k / 8) * Math.PI * 2;
      for (let r = 26; r < 60; r += 2) {
        const x = c.x + Math.sin(ang) * r;
        const z = c.z + Math.cos(ang) * r;
        if (free(x, z)) {
          wp.push({ x, z });
          break;
        }
      }
    }
    if (wp.length >= 6) out.push({ id: `s${seed}-loop`, kind: '6-repeated-steering', seed, start: wp[wp.length - 1]!, waypoints: [...wp, ...wp, ...wp], limitS: 600 });
  }
  // 7. through dense forest: straight 80 m line with the most trunks on it
  {
    let best: Scenario | null = null;
    let bestN = -1;
    for (let k = 0; k < 300; k++) {
      const x = 100 + ((k * 131) % 1300);
      const z = 100 + ((k * 89) % 1300);
      if (v.sample(x, z).forest < 0.7 || !free(x, z)) continue;
      const g = { x: x + 80, z: z + 20 };
      if (!free(g.x, g.z)) continue;
      const solids = scatterSolids(v, (x + g.x) / 2, (z + g.z) / 2, 50).filter((c) => segDist(c, x, z, g.x, g.z) < c.r + DEER_R);
      if (solids.length > bestN) {
        bestN = solids.length;
        best = { id: `s${seed}-forest`, kind: '7-irregular-geometry-forest', seed, start: { x, z }, goal: g, limitS: 120 };
      }
    }
    if (best) out.push(best);
  }
  return out;
}

function segDist(c: { x: number; z: number }, x0: number, z0: number, x1: number, z1: number): number {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const t = Math.max(0, Math.min(1, ((c.x - x0) * dx + (c.z - z0) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(x0 + dx * t - c.x, z0 + dz * t - c.z);
}

// ---------------------------------------------------------------- run one scenario in one mode
interface Result {
  scenario: string; kind: string; seed: number; mode: Mode; reached: boolean; timeS: number; pathM: number; straightM: number; efficiency: number;
  stuckS: number; buildingPenetrations: number; scatterPenetrations: number; cliffSteps: number; deepWaterTicks: number; deerOverlaps: number;
  ticks: number; simMsMedian: number; physMsMedian: number; physMsP95: number; physMsP99: number; physBuildMs: number; statics: number; finalHash: number; finalPos: number[];
}

function runScenario(sc: Scenario, mode: Mode): Result {
  const sim = new Simulation(sc.seed);
  const v = sim.valley;
  // participants: one adult chital (or a herd + a jackal); everything else is removed so the measurement is clean
  const adult = (a: Animal): boolean => a.age > maturityDays(SPECIES[a.sp]!) * 1.1;
  let deer: Animal[];
  let jackal: Animal | null = null;
  const center = sc.start ?? { x: 0, z: 0 };
  if (sc.herd) {
    const groups = new Map<number, Animal[]>();
    for (const a of sim.animals) if (a.sp === SPECIES_INDEX.chital) groups.set(a.group, [...(groups.get(a.group) ?? []), a]);
    deer = [...groups.values()].sort((p, q) => q.length - p.length)[0]!;
    // move the herd (identities intact) next to the settlement's buildings, where escape routes are crowded
    const b = [...v.buildings].sort((p, q) => q.w * q.d - p.w * p.d)[0]!;
    const hx = b.x + Math.sin(b.rot) * (b.d / 2 + 8);
    const hz = b.z + Math.cos(b.rot) * (b.d / 2 + 8);
    deer.forEach((a, i) => {
      const ang = (i / deer.length) * Math.PI * 2;
      let x = hx + Math.cos(ang) * 5;
      let z = hz + Math.sin(ang) * 5;
      if (v.blocked(x, z, 1)) { x = hx; z = hz; }
      Object.assign(a, { x, z, px: x, pz: z, homeX: hx, homeZ: hz, fear: 0, hunger: 0.1, thirst: 0.1, energy: 1, beh: B.Idle, timer: 0, speed: 0, want: 0 });
    });
    jackal = sim.animals.find((a) => a.sp === SPECIES_INDEX.jackal && adult(a))!;
    Object.assign(jackal, { x: hx - Math.sin(b.rot) * 14, z: hz - Math.cos(b.rot) * 14, hunger: 0.9, beh: B.Idle, timer: 0 });
    jackal.px = jackal.x;
    jackal.pz = jackal.z;
    center.x = hx;
    center.z = hz;
  } else {
    const d = sim.animals.find((a) => a.sp === SPECIES_INDEX.chital && adult(a))!;
    Object.assign(d, { x: sc.start!.x, z: sc.start!.z, px: sc.start!.x, pz: sc.start!.z, speed: 0, want: 0 });
    d.heading = Math.atan2((sc.goal ?? sc.waypoints![0]!).x - d.x, (sc.goal ?? sc.waypoints![0]!).z - d.z);
    deer = [d];
  }
  const keep = new Set([...deer.map((a) => a.id), ...(jackal ? [jackal.id] : [])]);
  sim.animals = sim.animals.filter((a) => keep.has(a.id));
  for (const id of [...sim.byId.keys()]) if (!keep.has(id)) sim.byId.delete(id);

  const R = 160;
  const solids = scatterSolids(v, center.x, center.z, R + 20);
  const usesRapier = mode === 'rapier-validate' || mode === 'rapier-kcc';
  const P = usesRapier ? buildPhys(sim, center.x, center.z, R, solids) : null;
  if (P) for (const a of deer) deerCollider(P, sim, a);
  const inSolid = (x: number, z: number): boolean => solids.some((c) => (c.x - x) ** 2 + (c.z - z) ** 2 < (c.r + DEER_R) ** 2);

  const goals = sc.waypoints ?? (sc.goal ? [sc.goal] : []);
  let gi = 0;
  const focal = deer[0]!;
  const straight = sc.herd ? 0 : goals.reduce((s, g, i) => s + Math.hypot(g.x - (i ? goals[i - 1]!.x : sc.start!.x), g.z - (i ? goals[i - 1]!.z : sc.start!.z)), 0);
  let path = 0;
  let stuck = 0;
  let bPen = 0;
  let sPen = 0;
  let cliff = 0;
  let wet = 0;
  let overlaps = 0;
  let reachedAt = -1;
  const simMs: number[] = [];
  const physMs: number[] = [];
  const ticks = Math.round(sc.limitS / DT);
  let t = 0;
  for (; t < ticks; t++) {
    if (!sc.herd) {
      const g = goals[gi]!;
      Object.assign(focal, { hunger: 0, thirst: 0, energy: 1, fear: 0, timer: 1e9, beh: B.Wander, tx: g.x, tz: g.z });
    } else if (jackal) {
      jackal.timer = 1e9; // stays put: the deer react to it, the experiment measures their escape
      Object.assign(jackal, { beh: B.Rest, speed: 0, want: 0 });
    }
    const before = deer.map((a) => ({ x: a.x, z: a.z }));
    const t0 = performance.now();
    sim.step(DT);
    simMs.push(performance.now() - t0);
    // ---- mode-specific treatment of the move the simulation just made
    const t1 = performance.now();
    deer.forEach((a, i) => {
      if (!a.alive) return;
      const b0 = before[i]!;
      if (mode === 'analytic-scatter') {
        if (inSolid(a.x, a.z) && !inSolid(b0.x, b0.z)) Object.assign(a, { x: b0.x, z: b0.z, speed: 0 });
      } else if (mode === 'analytic-slide') {
        // resolve overlap with each nearby circle by moving out along the normal (the tangential part of the move
        // survives, so the deer slides around the trunk instead of stopping); four passes for clustered trunks
        for (let pass = 0; pass < 4; pass++) {
          for (const c of solids) {
            const dx = a.x - c.x;
            const dz = a.z - c.z;
            const rr = c.r + DEER_R + 0.01;
            const d2 = dx * dx + dz * dz;
            if (d2 >= rr * rr) continue;
            const d = Math.sqrt(d2) || 1e-6;
            const nx = c.x + (dx / d) * rr;
            const nz = c.z + (dz / d) * rr;
            if (!v.blocked(nx, nz, 0.6)) {
              a.x = nx;
              a.z = nz;
            }
          }
        }
      } else if (mode === 'rapier-validate' && P) {
        if ((a.x !== b0.x || a.z !== b0.z) && capsuleHits(P, sim, a, a.x, a.z) && !capsuleHits(P, sim, a, b0.x, b0.z)) Object.assign(a, { x: b0.x, z: b0.z, speed: 0 });
      } else if (mode === 'rapier-kcc' && P) {
        const c = deerCollider(P, sim, a);
        const y0 = P.ys.get(a.id)!;
        c.setTranslation({ x: b0.x, y: y0, z: b0.z });
        const dy = v.height(a.x, a.z) - v.height(b0.x, b0.z) - 0.02;
        P.kcc.computeColliderMovement(c, { x: a.x - b0.x, y: dy, z: a.z - b0.z });
        const m = P.kcc.computedMovement();
        const nx = b0.x + m.x;
        const nz = b0.z + m.z;
        const ny = y0 + m.y;
        c.setTranslation({ x: nx, y: ny, z: nz });
        P.ys.set(a.id, ny);
        a.x = nx;
        a.z = nz;
      }
    });
    if (mode === 'analytic-slide' && deer.length > 1) {
      // deer bodies do not interpenetrate either: separate overlapping pairs symmetrically (capsule radius each)
      for (let i = 0; i < deer.length; i++) for (let j = i + 1; j < deer.length; j++) {
        const p = deer[i]!;
        const q = deer[j]!;
        const dx = q.x - p.x;
        const dz = q.z - p.z;
        const d = Math.hypot(dx, dz);
        const min = 2 * DEER_R + 0.01;
        if (d >= min || d === 0) continue;
        const push = (min - d) / 2;
        const ux = dx / d;
        const uz = dz / d;
        if (!v.blocked(p.x - ux * push, p.z - uz * push, 0.6)) { p.x -= ux * push; p.z -= uz * push; }
        if (!v.blocked(q.x + ux * push, q.z + uz * push, 0.6)) { q.x += ux * push; q.z += uz * push; }
      }
    }
    if (P && mode === 'rapier-kcc') P.world.step(); // refresh broad phase for moved deer colliders
    if (mode !== 'existing') physMs.push(performance.now() - t1);
    // ---- metrics
    deer.forEach((a, i) => {
      const b0 = before[i]!;
      const d = Math.hypot(a.x - b0.x, a.z - b0.z);
      if (a === focal) path += d;
      if (v.blocked(a.x, a.z, 0)) bPen++;
      if (inSolid(a.x, a.z)) sPen++;
      if (d > 0.01 && (v.height(a.x, a.z) - v.height(b0.x, b0.z)) / d > 1.2) cliff++;
      if (v.waterDepth(a.x, a.z, sim.env.stage) > 0.45) wet++;
      const wantsToMove = sc.herd ? a.beh === B.Flee || a.beh === B.Regroup : true;
      if (wantsToMove && d < 0.005 && a.want > 0) stuck += DT;
    });
    if (sc.herd) for (let i = 0; i < deer.length; i++) for (let j = i + 1; j < deer.length; j++) if (Math.hypot(deer[i]!.x - deer[j]!.x, deer[i]!.z - deer[j]!.z) < 2 * DEER_R - 0.02) overlaps++;
    if (!sc.herd) {
      const g = goals[gi]!;
      if (Math.hypot(focal.x - g.x, focal.z - g.z) < 2) {
        gi++;
        if (gi >= goals.length) {
          reachedAt = t;
          break;
        }
      }
    }
  }
  const pct = (a: number[], p: number): number => (a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(p * a.length))]! : 0);
  const r3 = (x: number): number => Math.round(x * 1000) / 1000;
  P?.world.free();
  return {
    scenario: sc.id, kind: sc.kind, seed: sc.seed, mode, reached: sc.herd ? true : reachedAt >= 0, timeS: r3((reachedAt >= 0 ? reachedAt + 1 : t) * DT),
    pathM: r3(path), straightM: r3(straight), efficiency: straight > 0 && reachedAt >= 0 ? r3(straight / path) : 0,
    stuckS: r3(stuck), buildingPenetrations: bPen, scatterPenetrations: sPen, cliffSteps: cliff, deepWaterTicks: wet, deerOverlaps: overlaps,
    ticks: t, simMsMedian: r3(pct(simMs, 0.5)), physMsMedian: r3(pct(physMs, 0.5)), physMsP95: r3(pct(physMs, 0.95)), physMsP99: r3(pct(physMs, 0.99)),
    physBuildMs: r3(P?.buildMs ?? 0), statics: P?.statics ?? 0, finalHash: sim.stateHash(), finalPos: deer.map((a) => r3(a.x) + r3(a.z)),
  };
}

// ---------------------------------------------------------------- geometry agreement: Rapier sees what Valley sees
function geometryAgreement(seed: number): { samples: number; agree: number; rapierOnly: number; valleyOnly: number } {
  const sim = new Simulation(seed);
  const v = sim.valley;
  const b = [...v.buildings].sort((p, q) => q.w * q.d - p.w * p.d)[0]!;
  const P = buildPhys(sim, b.x, b.z, 80, []);
  let agree = 0;
  let rOnly = 0;
  let vOnly = 0;
  const N = 4000;
  for (let i = 0; i < N; i++) {
    const x = b.x - 70 + ((i * 7919) % 1400) / 10;
    const z = b.z - 70 + ((i * 104729) % 1400) / 10;
    const inV = v.blocked(x, z, 0);
    let inR = false;
    P.world.intersectionsWithShape({ x, y: v.height(x, z) + 0.6, z }, { x: 0, y: 0, z: 0, w: 1 }, new RAPIER.Ball(0.001), (c) => {
      if (c.shape.type === RAPIER.ShapeType.HeightField) return true;
      inR = true;
      return false;
    });
    if (inV === inR) agree++;
    else if (inR) rOnly++;
    else vOnly++;
  }
  P.world.free();
  return { samples: N, agree, rapierOnly: rOnly, valleyOnly: vOnly };
}

// ---------------------------------------------------------------- main
const results: Result[] = [];
const replay: { scenario: string; mode: Mode; identical: boolean }[] = [];
const scenarios = SEEDS.flatMap(buildScenarios);
console.log(`Rapier ${ENGINE} build, import ${importMs.toFixed(0)} ms, init ${initMs.toFixed(0)} ms; ${scenarios.length} scenarios`);
for (const sc of scenarios) {
  for (const mode of MODES) {
    const runs: Result[] = [];
    for (let r = 0; r < REPEATS; r++) runs.push(runScenario(sc, mode));
    const first = runs[0]!;
    replay.push({ scenario: sc.id, mode, identical: runs.every((x) => x.finalHash === first.finalHash && JSON.stringify(x.finalPos) === JSON.stringify(first.finalPos)) });
    // timing: median over repeats of each run's median
    const med = (k: keyof Result): number => [...runs.map((x) => x[k] as number)].sort((a, b) => a - b)[Math.floor(runs.length / 2)]!;
    results.push({ ...first, simMsMedian: med('simMsMedian'), physMsMedian: med('physMsMedian'), physMsP95: med('physMsP95'), physMsP99: med('physMsP99'), physBuildMs: med('physBuildMs') });
    console.log(`${sc.id.padEnd(22)} ${mode.padEnd(16)} reached=${first.reached} t=${first.timeS}s eff=${first.efficiency} stuck=${first.stuckS}s bldg=${first.buildingPenetrations} scatter=${first.scatterPenetrations} cliff=${first.cliffSteps} overl=${first.deerOverlaps} phys=${med('physMsMedian')}ms`);
  }
}
const agreement = SEEDS.map((s) => ({ seed: s, ...geometryAgreement(s) }));
const rss2 = process.memoryUsage();
const pkg = (name: string): string => JSON.parse(readFileSync(`experiments/physics-rapier/node_modules/${name}/package.json`, 'utf8')).version;
let commit = 'unknown';
try { commit = execSync('git rev-parse HEAD').toString().trim(); } catch { /* */ }
writeFileSync(OUT, JSON.stringify({
  env: {
    label: process.env.BENCH_LABEL ?? (process.env.GITHUB_ACTIONS ? 'github-actions' : 'container'), commit, node: process.version, v8: process.versions.v8,
    cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, platform: `${os.platform()} ${os.arch()}`, date: new Date().toISOString(),
    rapier: { build: ENGINE, package: ENGINE === 'deterministic' ? '@dimforge/rapier3d-deterministic-compat' : '@dimforge/rapier3d-compat', version: pkg(ENGINE === 'deterministic' ? '@dimforge/rapier3d-deterministic-compat' : '@dimforge/rapier3d-compat') },
  },
  startup: { importMs: Math.round(importMs), initMs: Math.round(initMs), rssMB: { beforeInit: +(rss0.rss / 1048576).toFixed(1), afterInit: +(rss1.rss / 1048576).toFixed(1), end: +(rss2.rss / 1048576).toFixed(1) }, externalMB: { beforeInit: +(rss0.external / 1048576).toFixed(1), afterInit: +(rss1.external / 1048576).toFixed(1), arrayBuffers: +(rss1.arrayBuffers / 1048576).toFixed(1) } },
  capsule: { radius: DEER_R, halfHeight: DEER_HALF, maxClimbDeg: +(MAX_CLIMB * 180 / Math.PI).toFixed(1) },
  geometryAgreement: agreement, replay, results,
}, null, 1));
console.log('wrote', OUT);
