import { clamp } from '@untamed/core';
import { Animal, B, SPECIES, Simulation, maturityDays } from '@untamed/ecology';
import type { AnimalSnapshotView } from '../curiosity/CuriosityDirector';
import { CuriosityDirector, WorldQueryView, WorldSnapshotView } from '../curiosity/CuriosityDirector';
import { YEAR_DAYS } from '@untamed/environment';
import { SocialChronicle, chronicleTime, describeEntry } from './SocialChronicle';

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

  /** Optional Social Lens history, for "earlier" continuity lines in captions (read-only). */
  chronicle: SocialChronicle | null = null;
  private readonly find = (id: number): Animal | undefined => this.sim.byId.get(id);

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

  /** Body length in metres: species adult length scaled by growth (juveniles are smaller). */
  private readonly sizeOf = (a: AnimalSnapshotView): number => {
    const full = this.sim.byId.get(a.id);
    const sp = SPECIES[a.sp];
    if (!full || !sp) return 1.5;
    return sp.length * (0.42 + 0.58 * this.sim.growth(full, sp));
  };

  private snapshot(): WorldSnapshotView {
    const s = this.sim;
    return { tick: s.tick, animals: s.animals, env: s.env, world: this.world, sizeOf: this.sizeOf, find: this.find };
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

  /** Scene opacity from the director (1 visible, 0 black during a cut). */
  get fade(): number {
    return this.director.isActive() ? this.director.getPose().fadeAlpha : 1;
  }

  /**
   * Caption lines: [what, simulated fact, why this shot / continuity]. Every value is read from the simulation, the
   * Social Lens history (which records real events) or the director's own decision; nothing is invented.
   */
  caption(): [string, string, string] | null {
    const t = this.director.getCurrentTarget();
    if (!t) return null;
    const env = this.sim.env;
    const pct = (v: number): string => `${Math.round(clamp(v, 0, 1) * 100)}%`;
    const nm = (sp: number): string => SPECIES[sp]!.name.split(' (')[0]!.toLowerCase();
    const why = this.whyLine(t);
    if (t.kind === 'scenic') {
      const fact = t.key.includes('wetland') || t.key.includes('river')
        ? `Simulated: river stage ${env.stage >= 0 ? '+' : ''}${env.stage.toFixed(2)} m, mean soil moisture ${Math.round(env.meanMoisture * 100)}%.`
        : `Simulated: ${env.weather}, ${env.temperature.toFixed(0)} °C, wind ${env.wind.toFixed(0)} m/s.`;
      return [t.reason, fact, why];
    }
    if (t.kind === 'group' && t.groupId != null) {
      // tally the group's real members now (bounded: one pass, only on caption refresh)
      let n = 0;
      let sp = -1;
      const counts = new Map<string, number>();
      let young = 0;
      for (const a of this.sim.animals) {
        if (!a.alive || a.group !== t.groupId) continue;
        if (sp < 0) sp = a.sp;
        if (a.sp !== sp) continue;
        n++;
        const b = behaviourWord(a.beh);
        counts.set(b, (counts.get(b) ?? 0) + 1);
        if (a.mother && a.age < 0.4 * matDays(a.sp)) young++;
      }
      if (n === 0 || sp < 0) return null;
      const s = SPECIES[sp]!;
      const parts = [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([k, v]) => `${v} ${k}`);
      return [`${s.name}: ${s.groupNoun} of ${n}`, `Simulated: ${parts.join(', ')}${young ? `; ${young} young` : ''}; spread over about ${Math.round((t.radius ?? 0) * 2)} m.`, why];
    }
    const a = this.subjectAnimal();
    if (!a) return t.eventType ? [`Recent event: ${t.eventType}`, 'Simulated: the animal involved is no longer here.', why] : null;
    const sp = SPECIES[a.sp]!;
    let fact: string;
    switch (a.beh) {
      case B.Drink: fact = `Drinking; hydration is back to ${pct(1 - a.thirst)}.`; break;
      case B.SeekWater: fact = `Heading for water; hydration ${pct(1 - a.thirst)}.`; break;
      case B.Forage: fact = `Foraging; ${pct(1 - a.hunger)} fed, forage here at ${pct(env.vegFrac(env.cellIndex(a.x, a.z)))} of capacity.`; break;
      case B.Flee: fact = `Fleeing a detected threat; fear ${pct(a.fear)}, sprint stamina ${pct(a.stamina)}.`; break;
      case B.Stalk: case B.Chase: {
        const prey = this.sim.byId.get(a.targetId);
        const dist = prey ? ` ${Math.round(Math.hypot(prey.x - a.x, prey.z - a.z))} m away` : '';
        fact = `${a.beh === B.Stalk ? 'Stalking' : 'Chasing'} ${prey ? `a ${nm(prey.sp)} (#${prey.id})${dist}` : 'prey'}; ${pct(1 - a.hunger)} fed, stamina ${pct(a.stamina)}.`;
        break;
      }
      case B.Feed: fact = `Feeding on a carcass; ${pct(1 - a.hunger)} fed.`; break;
      case B.SeekCarrion: fact = 'Approaching a carcass it has detected.'; break;
      case B.Rest: case B.Roost: fact = `Resting; energy ${pct(a.energy)}.`; break;
      case B.SeekMate: fact = 'Approaching a receptive female.'; break;
      case B.Follow: fact = 'Dependent young staying close to its mother.'; break;
      case B.Regroup: fact = 'Rejoining its group.'; break;
      default: fact = `Moving within its home range; ${pct(1 - a.hunger)} fed, ${pct(1 - a.thirst)} hydrated.`;
    }
    if (t.kind === 'event' && t.eventType) {
      const ago = Math.max(0, Math.round(this.director.clock - (t.eventAtSec ?? this.director.clock)));
      const ev = t.eventType === 'kill' ? 'made a kill' : t.eventType === 'birth' ? 'gave birth' : t.eventType === 'alarm' ? 'raised the alarm' : t.eventType;
      fact = `It ${ev} ${ago < 2 ? 'just now' : `${ago} s ago`}. ${fact}`;
    }
    const mat = matDays(a.sp);
    const stage = a.age < mat * 0.4 ? 'juvenile' : a.age < mat ? 'subadult' : 'adult';
    return [`${sp.name} · ${stage} ${a.sex ? 'male' : 'female'} #${a.id}`, `Simulated: ${fact}`, why || `Species note: ${sp.note}`];
  }

  /** "Why this shot" plus one earlier event from the Social Lens history, when it adds continuity. */
  private whyLine(t: NonNullable<ReturnType<CuriosityDirector['getCurrentTarget']>>): string {
    const parts: string[] = [];
    if (t.link) parts.push(`Continuing the story: ${t.link}.`);
    else if (t.why === 'event') parts.push('Why this shot: something just happened here.');
    else if (t.why === 'group') parts.push('Why this shot: the group is the subject.');
    else if (t.why === 'activity') parts.push('Why this shot: the most active subject nearby.');
    else if (t.why === 'scenic') parts.push('Nothing notable nearby: a quiet look at the valley.');
    const id = t.animalId;
    if (this.chronicle && id !== null && t.kind !== 'group') {
      const hist = this.chronicle.entriesFor(id);
      const last = hist.length ? hist[hist.length - 1] : undefined;
      if (last && last.kind !== 'alarm') parts.push(`Earlier (${chronicleTime(last.t, YEAR_DAYS)}): ${describeEntry(last)}.`);
    }
    return parts.join(' ');
  }
}

const matDays = (sp: number): number => maturityDays(SPECIES[sp]!);

function behaviourWord(beh: number): string {
  switch (beh) {
    case B.Forage: return 'grazing or foraging';
    case B.Rest: case B.Roost: return 'resting';
    case B.Drink: return 'drinking';
    case B.SeekWater: return 'heading to water';
    case B.Flee: return 'fleeing';
    case B.Follow: return 'following their mothers';
    case B.Regroup: return 'regrouping';
    case B.SeekMate: return 'courting';
    default: return 'moving';
  }
}
