import { clamp } from '@untamed/core';
import { Animal, B, SPECIES, Simulation } from '@untamed/ecology';
import { CuriosityDirector, WorldQueryView, WorldSnapshotView } from '../curiosity/CuriosityDirector';

export interface CameraPose {
  x: number; y: number; z: number;
  /** Look-at point. */
  tx: number; ty: number; tz: number;
}

/** Highest point of a ruin the camera must clear (towers carry a tank, collapsed houses grow a tree). */
function topHeight(b: Simulation['valley']['buildings'][number]): number {
  if (b.kind === 'tower') return b.h + 5;
  if (b.collapse > 0.45) return b.h + 0.6 + 4.6;
  return b.h + 2;
}

/**
 * Curiosity Mode in the game: a thin, read-only adapter between the live simulation and the documentary
 * director (curiosity/CuriosityDirector.ts, by Gemini with GPT-6's safety fixes).
 *
 * - Ecological events reach the director through Simulation.events only; nothing is written back.
 * - World queries use the cached heightfield so candidate scoring stays cheap; the game still clamps the
 *   camera against exact terrain afterwards.
 * - Captions state only values the simulation holds, plus a clearly labelled species-level note.
 */
export class Curiosity {
  readonly director = new CuriosityDirector();
  paused = false;
  private _reduced = false;
  private readonly unsub: () => void;
  private readonly world: WorldQueryView;

  constructor(private readonly sim: Simulation) {
    const v = sim.valley;
    const buildings = v.buildings.map((b) => ({ x: b.x, z: b.z, w: b.w, d: b.d, rot: b.rot, h: topHeight(b), collapse: 0 }));
    this.world = { size: v.size, height: (x, z) => v.heightFast(x, z), waterSurface: (z) => v.waterSurface(z), buildings };
    this.unsub = sim.events.on((e) => this.director.pushEvent(e));
  }

  get reducedMotion(): boolean {
    return this._reduced;
  }
  set reducedMotion(on: boolean) {
    this._reduced = on;
    this.director.setReducedMotion(on);
  }
  /** Why the current subject was picked (diagnostics and tests). */
  get tag(): string {
    return this.director.getCurrentTarget()?.reason ?? '';
  }
  /** The current subject; null whenever the autopilot is not running (the director remembers its last one). */
  get subject(): { key: string } | null {
    return this.director.isActive() ? this.director.getCurrentTarget() : null;
  }

  private snapshot(): WorldSnapshotView {
    const s = this.sim;
    return { tick: s.tick, animals: s.animals, env: s.env, world: this.world };
  }

  start(pose: CameraPose): void {
    this.paused = false;
    this.director.start({ x: pose.x, y: pose.y, z: pose.z, lookX: pose.tx, lookY: pose.ty, lookZ: pose.tz });
  }
  stop(): void {
    this.director.interrupt();
  }
  skip(): void {
    this.director.skip(this.snapshot());
  }
  /** Point the autopilot at a particular animal (QA fixture and future "watch this one" control). */
  focus(id: number): boolean {
    return this.director.focus(this.snapshot(), id);
  }
  dispose(): void {
    this.unsub();
    this.director.reset();
  }

  subjectAnimal(): Animal | null {
    if (!this.director.isActive()) return null;
    const id = this.director.getCurrentTarget()?.animalId;
    if (id === null || id === undefined) return null;
    const a = this.sim.byId.get(id);
    return a && a.alive ? a : null;
  }

  /** Advance the director and return the camera pose it wants. */
  update(dt: number, current: CameraPose): CameraPose {
    if (this.paused) return current;
    if (!this.director.isActive()) this.start(current);
    this.director.update(this.snapshot(), dt);
    const p = this.director.getPose();
    return { x: p.x, y: p.y, z: p.z, tx: p.lookX, ty: p.lookY, tz: p.lookZ };
  }

  /** Caption lines: [what, simulated fact, species note]. Only states things the simulation actually holds. */
  caption(): [string, string, string] | null {
    const t = this.director.getCurrentTarget();
    if (!t) return null;
    if (t.kind === 'scenic') {
      const env = this.sim.env;
      const fact = t.key.includes('wetland') || t.key.includes('river')
        ? `Simulated: river stage ${env.stage >= 0 ? '+' : ''}${env.stage.toFixed(2)} m, mean soil moisture ${Math.round(env.meanMoisture * 100)}%.`
        : '';
      return [t.reason, fact, ''];
    }
    const a = this.subjectAnimal();
    if (!a) return t.eventType ? [`Recent event: ${t.eventType}`, '', ''] : null;
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
