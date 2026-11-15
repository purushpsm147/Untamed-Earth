import { clamp } from '@untamed/core';
import { Animal, B, SPECIES, SimEvent, Simulation } from '@untamed/ecology';
import { Candidate, Director } from './curiosityDirector';

/** Intrinsic interest of what an animal is doing right now. */
const BEHAVIOUR_INTEREST: Record<number, [number, string]> = {
  [B.Chase]: [9, 'chase'], [B.Stalk]: [8, 'stalk'], [B.Flee]: [6, 'flee'], [B.Feed]: [6, 'feed'], [B.SeekCarrion]: [4.5, 'scavenge'],
  [B.Drink]: [4.5, 'drink'], [B.SeekMate]: [4.5, 'courtship'], [B.Follow]: [4.2, 'young'], [B.Forage]: [3, 'forage'],
  [B.Roost]: [2.2, 'roost'], [B.SeekWater]: [2.5, 'to-water'], [B.Wander]: [1.6, 'wander'], [B.Rest]: [1.4, 'rest'], [B.Idle]: [1.2, 'idle'],
};
const SPECIES_RARITY = [1, 1.15, 1.5, 1.1, 0.9, 0.9];

export interface CameraPose {
  x: number; y: number; z: number;
  /** Look-at point. */
  tx: number; ty: number; tz: number;
}

/**
 * Documentary autopilot. Reads simulation state and already-emitted events; never writes to
 * the simulation. Candidate generation is budgeted (a rotating sample of animals at ~0.7 Hz),
 * while the camera rig interpolates every frame.
 */
export class Curiosity {
  readonly director = new Director();
  paused = false;
  reducedMotion = false;
  /** Why the current subject was picked: shown in the caption and asserted by tests. */
  tag = '';
  private readonly events: { e: SimEvent; t: number }[] = [];
  private readonly unsub: () => void;
  private cursor = 0;
  private thinkT = 99;
  private now = 0;
  private orbit = 0;
  private skipNext = false;
  private readonly places: Candidate[];

  constructor(private readonly sim: Simulation) {
    // bounded event inbox: the director consumes what the ecosystem already reports
    this.unsub = sim.events.on((e) => {
      if (e.type === 'death') return;
      this.events.push({ e, t: this.now });
      if (this.events.length > 24) this.events.shift();
    });
    const v = sim.valley;
    const place = (key: string, x: number, z: number, base: number): Candidate => ({ key: `p:${key}`, kind: 'place', id: 0, x, z, base, tag: `scenic:${key}` });
    const bridge = v.wrecks.find((w) => w.kind === 'bridge');
    const tower = v.buildings.find((b) => b.kind === 'tower');
    const hall = v.buildings.find((b) => b.kind === 'hall');
    this.places = [
      ...(bridge ? [place('bridge', bridge.x, bridge.z, 2.6)] : []),
      ...(tower ? [place('tower', tower.x, tower.z, 2.4)] : []),
      ...(hall ? [place('hall', hall.x, hall.z, 2.2)] : []),
      ...(v.pools[0] ? [place('leachate', v.pools[0].x, v.pools[0].z, 2.2)] : []),
      place('wetland', 700, 1150, 2.4),
      place('river', v.riverX(820), 820, 2.0),
    ];
  }

  dispose(): void {
    this.unsub();
  }
  skip(): void {
    this.skipNext = true;
    this.thinkT = 99;
  }
  get subject(): Candidate | null {
    return this.director.current;
  }
  subjectAnimal(): Animal | null {
    const c = this.director.current;
    if (!c || c.kind !== 'animal') return null;
    const a = this.sim.byId.get(c.id);
    return a && a.alive ? a : null;
  }

  private candidates(camX: number, camZ: number): Candidate[] {
    const out: Candidate[] = [];
    const sim = this.sim;
    const env = sim.env;
    // 1) reported events (kills, alarms, births) from the last 20 s
    while (this.events.length && this.now - this.events[0]!.t > 20) this.events.shift();
    for (const { e } of this.events) {
      const id = e.type === 'kill' ? e.predator : e.type === 'death' ? 0 : e.id;
      const a = sim.byId.get(id);
      if (!a || !a.alive) continue;
      const base = e.type === 'kill' ? 10 : e.type === 'birth' ? 7.5 : 6;
      out.push({ key: `a:${id}`, kind: 'animal', id, x: a.x, z: a.z, base, tag: e.type });
    }
    // 2) a rotating, bounded sample of animals (at most 48 per think)
    const list = sim.animals;
    const n = Math.min(48, list.length);
    for (let i = 0; i < n; i++) {
      const a = list[(this.cursor + i) % list.length]!;
      if (!a.alive) continue;
      const bi = BEHAVIOUR_INTEREST[a.beh] ?? [1, 'idle'];
      let base = bi[0] * SPECIES_RARITY[a.sp]!;
      if (a.alt > 3) base = Math.max(base, 2.6); // birds on the wing
      if (a.crowd >= 4 && a.beh === B.Forage) base += 1; // a herd grazing together
      if (a.pregnantH > 0) base += 0.3;
      out.push({ key: `a:${a.id}`, kind: 'animal', id: a.id, x: a.x, z: a.z, base, tag: a.alt > 3 ? 'flight' : bi[1] });
    }
    this.cursor = (this.cursor + n) % Math.max(1, list.length);
    // keep the incumbent in the pool so the director can compare against its live state
    const cur = this.subjectAnimal();
    if (cur && !out.some((c) => c.id === cur.id)) {
      const bi = BEHAVIOUR_INTEREST[cur.beh] ?? [1, 'idle'];
      out.push({ key: `a:${cur.id}`, kind: 'animal', id: cur.id, x: cur.x, z: cur.z, base: bi[0] * SPECIES_RARITY[cur.sp]!, tag: bi[1] });
    }
    // 3) places: more attractive in low golden light, and water draws the eye in rain
    const el = env.sunElevation();
    const golden = el > -0.05 && el < 0.3 ? 1.7 : 1;
    for (const p of this.places) {
      const wet = env.rain > 1 && (p.key === 'p:river' || p.key === 'p:wetland') ? 2.2 : 1;
      out.push({ ...p, base: p.base * golden * wet });
    }
    void camX;
    void camZ;
    return out;
  }

  /**
   * Advance the director and return where the camera should be. `pose` is the camera's
   * current pose and is eased toward the ideal framing; the caller applies collision.
   */
  update(dt: number, pose: CameraPose, ground: (x: number, z: number) => number, subjectPos: (id: number) => { x: number; y: number; z: number } | undefined): CameraPose {
    this.now += dt;
    if (this.paused) return pose;
    this.thinkT += dt;
    if (this.thinkT >= 1.5) {
      this.thinkT = 0;
      const valid = this.director.current?.kind === 'place' || this.subjectAnimal() !== null;
      const before = this.director.current?.key;
      const pick = this.director.choose(this.candidates(pose.x, pose.z), pose.x, pose.z, this.now, valid, this.skipNext);
      this.skipNext = false;
      if (pick && pick.key !== before) this.tag = pick.tag;
    }
    const c = this.director.current;
    if (!c) return pose;
    // --- ideal framing ---
    let tx = c.x;
    let tz = c.z;
    let ty = ground(tx, tz) + 2;
    let dist = 42;
    let rise = 0.32;
    const a = this.subjectAnimal();
    if (c.kind === 'animal') {
      if (!a) return pose;
      const p = subjectPos(a.id);
      tx = p ? p.x : a.x;
      tz = p ? p.z : a.z;
      ty = p ? p.y : ground(a.x, a.z) + a.alt + 0.6;
      const m = SPECIES[a.sp]!.mass;
      // a respectful distance: closer for small animals, further for anything running
      dist = (m > 20 ? 13 : m > 4 ? 10 : m > 1 ? 6.5 : 7.5) * (a.speed > SPECIES[a.sp]!.walk * 2 ? 1.6 : 1);
      rise = 0.22;
    }
    const motion = this.reducedMotion ? 0.4 : 1;
    this.orbit += dt * 0.035 * motion;
    const gap = Math.hypot(pose.x - tx, pose.z - tz);
    // approach along the current bearing, then settle into a slow orbit
    const bearing = gap > dist * 2.2 ? Math.atan2(pose.x - tx, pose.z - tz) : this.orbit;
    if (gap > dist * 2.2) this.orbit = bearing;
    let ix = tx + Math.sin(bearing) * dist;
    let iz = tz + Math.cos(bearing) * dist;
    // travelling shots climb so they clear trees and ruins
    let iy = Math.max(ty + dist * rise, ground(ix, iz) + 1.8) + Math.min(45, Math.max(0, gap - dist * 2.5) * 0.12);
    // --- ease toward it with a speed cap (comfort) ---
    const k = 1 - Math.exp(-dt * 1.1 * motion);
    const maxStep = (this.reducedMotion ? 22 : 55) * dt;
    let dx = (ix - pose.x) * k;
    let dy = (iy - pose.y) * k;
    let dz = (iz - pose.z) * k;
    const step = Math.hypot(dx, dy, dz);
    if (step > maxStep) {
      const f = maxStep / step;
      dx *= f; dy *= f; dz *= f;
    }
    const kt = 1 - Math.exp(-dt * 2.2 * motion);
    ix = pose.x + dx;
    iy = pose.y + dy;
    iz = pose.z + dz;
    return {
      x: ix, y: Math.max(iy, ground(ix, iz) + 1.6), z: iz,
      tx: pose.tx + (tx - pose.tx) * kt, ty: pose.ty + (ty - pose.ty) * kt, tz: pose.tz + (tz - pose.tz) * kt,
    };
  }

  /** Caption lines: [what, simulated fact, species note]. Only states things the simulation actually holds. */
  caption(): [string, string, string] | null {
    const c = this.director.current;
    if (!c) return null;
    if (c.kind === 'place') {
      const names: Record<string, [string, string]> = {
        'p:bridge': ['The old road bridge', 'Its middle span lies in the river; animals wade or swim the channel instead.'],
        'p:tower': ['Settlement water tower', 'Crows and mynas use tall structures like this as perches in the simulation.'],
        'p:hall': ['Ruined hall', 'Ruins shelter small fauna, which is why jackals and crows forage here.'],
        'p:leachate': ['Leachate pool', 'Never dries, but drinking here costs health; clean water is preferred when animals can find it.'],
        'p:wetland': ['The wetland', `Water level follows the river stage (now ${this.sim.env.stage >= 0 ? '+' : ''}${this.sim.env.stage.toFixed(2)} m).`],
        'p:river': ['The river', `Soil beside open water stays moist; mean soil moisture is ${Math.round(this.sim.env.meanMoisture * 100)}%.`],
      };
      const n = names[c.key] ?? ['A quiet place', ''];
      return [n[0], n[1] ? `Simulated: ${n[1]}` : '', ''];
    }
    const a = this.subjectAnimal();
    if (!a) return null;
    const sp = SPECIES[a.sp]!;
    const pct = (v: number): string => `${Math.round(clamp(v, 0, 1) * 100)}%`;
    const env = this.sim.env;
    let fact: string;
    switch (a.beh) {
      case B.Drink: fact = `Drinking; hydration is back to ${pct(1 - a.thirst)}.`; break;
      case B.SeekWater: fact = `Heading for water; hydration ${pct(1 - a.thirst)}.`; break;
      case B.Forage: fact = `Foraging; ${pct(1 - a.hunger)} fed, forage here at ${pct(env.vegFrac(env.cellIndex(a.x, a.z)))} of capacity.`; break;
      case B.Flee: fact = `Fleeing a detected threat; fear ${pct(a.fear)}, sprint stamina ${pct(a.stamina)}.`; break;
      case B.Stalk: case B.Chase: {
        const prey = this.sim.byId.get(a.targetId);
        fact = `${a.beh === B.Stalk ? 'Stalking' : 'Chasing'} ${prey ? `a ${SPECIES[prey.sp]!.name.split(' (')[0]!.toLowerCase()}` : 'prey'}; ${pct(1 - a.hunger)} fed, stamina ${pct(a.stamina)}.`;
        break;
      }
      case B.Feed: fact = `Feeding on a carcass; ${pct(1 - a.hunger)} fed.`; break;
      case B.SeekCarrion: fact = 'Approaching a carcass it has detected.'; break;
      case B.Rest: case B.Roost: fact = `Resting; energy ${pct(a.energy)}.`; break;
      case B.SeekMate: fact = 'Approaching a receptive female.'; break;
      case B.Follow: fact = 'Dependent young staying close to its mother.'; break;
      default: fact = `Moving within its home range; ${pct(1 - a.hunger)} fed, ${pct(1 - a.thirst)} hydrated.`;
    }
    return [`${sp.name}`, `Simulated: ${fact}`, `Species note: ${sp.note}`];
  }
}
