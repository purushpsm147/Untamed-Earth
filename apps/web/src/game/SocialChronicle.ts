import type { Animal, SimEvent, Simulation } from '@untamed/ecology';
import { SPECIES, maturityDays, weanDays } from '@untamed/ecology';

/**
 * Social Lens history: a bounded, persistent record of what actually happened to individual animals.
 *
 * Sources (nothing else is recorded, nothing is invented):
 * - `Simulation.events` (birth, death, kill, alarm), read-only;
 * - low-frequency observation of state the simulation already holds: group id changes (an animal left or joined a
 *   group), weaning and maturity crossings (age against the species' own thresholds);
 * - player possession and release (game state, labelled as such).
 *
 * The chronicle is presentation state. It never writes to the simulation, it does not take part in the simulation
 * hash, and it is saved next to the simulation snapshot (SaveData.chronicle) so the Social Lens shows the same history
 * after save/load. Bounded: at most `perAnimal` entries per animal and `maxAnimals` animals (the dead first, then the
 * least recently updated, are forgotten first).
 */

export type ChronicleKind = 'born' | 'gave-birth' | 'killed' | 'was-killed' | 'died' | 'alarm' | 'left-group' | 'joined-group' | 'weaned' | 'matured' | 'possessed' | 'released' | 'mother-died';

export interface ChronicleEntry {
  /** Simulation time in game hours (env.timeH) when it happened, or when the change was first noticed. */
  t: number;
  kind: ChronicleKind;
  /** The other animal involved (prey, predator, mother, ...), 0 = none. */
  other: number;
  /** Species index of the other animal, -1 = none. */
  osp: number;
  /** Count (young born), group id (group changes) or 0. */
  n: number;
  /** Cause of death, if any. */
  cause: string;
  /** True when the change was noticed by periodic observation (time is "by", not "at"). */
  noticed: boolean;
}

export interface ChronicleSnapshot {
  v: 1;
  /** [animal id, species index, alive?, entries]. */
  animals: [number, number, boolean, ChronicleEntry[]][];
  /** Last observed [id, group, stage] (stage: 0 dependent, 1 weaned, 2 mature), so changes are not re-reported. */
  seen: [number, number, number][];
}

interface Record {
  sp: number;
  alive: boolean;
  touched: number;
  entries: ChronicleEntry[];
}

const KINDS: ReadonlySet<string> = new Set<ChronicleKind>(['born', 'gave-birth', 'killed', 'was-killed', 'died', 'alarm', 'left-group', 'joined-group', 'weaned', 'matured', 'possessed', 'released', 'mother-died']);

export class SocialChronicle {
  private readonly records = new Map<number, Record>();
  private readonly seen = new Map<number, { group: number; stage: number }>();
  private seq = 0;
  private scanT = 0;
  private unsub: (() => void) | null = null;

  constructor(private readonly sim: Simulation, readonly perAnimal = 12, readonly maxAnimals = 800) {}

  /** Start listening to the simulation (once). */
  attach(): void {
    if (this.unsub) return;
    this.unsub = this.sim.events.on((e) => this.onEvent(e));
    // establish the baseline so the first scan does not report every founding animal's group as a change
    if (this.seen.size === 0) this.scan(true);
  }

  dispose(): void {
    this.unsub?.();
    this.unsub = null;
  }

  /** Number of animals with a history, and total entries (diagnostics, tests). */
  stats(): { animals: number; entries: number; seen: number } {
    let entries = 0;
    for (const r of this.records.values()) entries += r.entries.length;
    return { animals: this.records.size, entries, seen: this.seen.size };
  }

  entriesFor(id: number): readonly ChronicleEntry[] {
    return this.records.get(id)?.entries ?? [];
  }

  /** Species index and life status of an animal the chronicle knows about (it may no longer be in the simulation). */
  known(id: number): { sp: number; alive: boolean } | null {
    const r = this.records.get(id);
    return r ? { sp: r.sp, alive: r.alive } : null;
  }

  /** How an animal died, if the chronicle saw it. */
  deathOf(id: number): ChronicleEntry | null {
    const r = this.records.get(id);
    if (!r) return null;
    for (let i = r.entries.length - 1; i >= 0; i--) {
      const e = r.entries[i]!;
      if (e.kind === 'died' || e.kind === 'was-killed') return e;
    }
    return null;
  }

  private now(): number {
    return this.sim.env.timeH;
  }

  private add(id: number, sp: number, e: Omit<ChronicleEntry, 't' | 'noticed'> & { t?: number; noticed?: boolean }): void {
    let r = this.records.get(id);
    if (!r) {
      if (this.records.size >= this.maxAnimals) this.evict();
      r = { sp, alive: true, touched: 0, entries: [] };
      this.records.set(id, r);
    }
    r.touched = ++this.seq;
    const entry: ChronicleEntry = { t: e.t ?? this.now(), kind: e.kind, other: e.other, osp: e.osp, n: e.n, cause: e.cause, noticed: e.noticed ?? false };
    // collapse repeats (an alarm every few seconds is one episode)
    const last = r.entries[r.entries.length - 1];
    if (last && last.kind === entry.kind && last.other === entry.other && entry.t - last.t < 0.5 && (entry.kind === 'alarm' || entry.kind === 'possessed' || entry.kind === 'released')) return;
    r.entries.push(entry);
    if (r.entries.length > this.perAnimal) {
      // keep the first entry (birth / first record) as an anchor, drop the oldest after it
      r.entries.splice(r.entries[0]!.kind === 'born' ? 1 : 0, 1);
    }
  }

  private evict(): void {
    let victim = -1;
    let best = Infinity;
    for (const [id, r] of this.records) {
      // the dead go first; among equals, the least recently updated
      const rank = (r.alive ? 1e12 : 0) + r.touched;
      if (rank < best) {
        best = rank;
        victim = id;
      }
    }
    if (victim >= 0) this.records.delete(victim);
  }

  private onEvent(e: SimEvent): void {
    const sim = this.sim;
    switch (e.type) {
      case 'birth': {
        this.add(e.id, e.sp, { kind: 'gave-birth', other: 0, osp: -1, n: e.n, cause: '' });
        // the young were just appended to the population with this mother
        let found = 0;
        for (let i = sim.animals.length - 1; i >= 0 && found < e.n; i--) {
          const c = sim.animals[i]!;
          if (c.mother === e.id && c.age === 0) {
            found++;
            this.add(c.id, c.sp, { kind: 'born', other: e.id, osp: e.sp, n: 0, cause: '' });
            this.seen.set(c.id, { group: c.group, stage: 0 });
          }
        }
        break;
      }
      case 'kill': {
        const pred = sim.byId.get(e.predator);
        this.add(e.predator, pred?.sp ?? 2, { kind: 'killed', other: e.prey, osp: e.sp, n: 0, cause: '' });
        this.add(e.prey, e.sp, { kind: 'was-killed', other: e.predator, osp: pred?.sp ?? 2, n: 0, cause: 'predation' });
        this.markDead(e.prey);
        break;
      }
      case 'death': {
        // a predation death is followed at once by its kill event, which records both sides
        if (e.cause !== 'predation') {
          this.add(e.id, e.sp, { kind: 'died', other: 0, osp: -1, n: 0, cause: e.cause });
          this.markDead(e.id);
        }
        // dependent young learn nothing, but their history notes the loss of their mother
        for (const c of sim.animals) {
          if (c.alive && c.mother === e.id && c.age < weanDays(SPECIES[c.sp]!) * 1.5) this.add(c.id, c.sp, { kind: 'mother-died', other: e.id, osp: e.sp, n: 0, cause: e.cause });
        }
        break;
      }
      case 'alarm':
        this.add(e.id, e.sp, { kind: 'alarm', other: 0, osp: -1, n: 0, cause: '' });
        break;
    }
  }

  private markDead(id: number): void {
    const r = this.records.get(id);
    if (r) r.alive = false;
    this.seen.delete(id);
  }

  private stage(a: Animal): number {
    const sp = SPECIES[a.sp]!;
    return a.age >= maturityDays(sp) ? 2 : a.age >= weanDays(sp) ? 1 : 0;
  }

  /**
   * Observe group changes and life-stage crossings. Bounded O(n) pass, called at a low rate (every `everyS` real
   * seconds of play). Reports only transitions between two observations, labelled "noticed".
   */
  tick(dt: number, everyS = 1): void {
    this.scanT += dt;
    if (this.scanT < everyS) return;
    this.scanT = 0;
    this.scan(false);
  }

  private scan(baseline: boolean): void {
    const alive = new Set<number>();
    for (const a of this.sim.animals) {
      if (!a.alive) continue;
      alive.add(a.id);
      const st = this.stage(a);
      const prev = this.seen.get(a.id);
      if (!prev) {
        this.seen.set(a.id, { group: a.group, stage: st });
        continue;
      }
      if (!baseline) {
        if (prev.group !== a.group) {
          this.add(a.id, a.sp, { kind: 'left-group', other: 0, osp: -1, n: prev.group, cause: '', noticed: true });
          this.add(a.id, a.sp, { kind: 'joined-group', other: 0, osp: -1, n: a.group, cause: '', noticed: true });
        }
        if (st > prev.stage) {
          if (prev.stage === 0 && st >= 1) this.add(a.id, a.sp, { kind: 'weaned', other: 0, osp: -1, n: 0, cause: '', noticed: true });
          if (st === 2) this.add(a.id, a.sp, { kind: 'matured', other: 0, osp: -1, n: 0, cause: '', noticed: true });
        }
      }
      prev.group = a.group;
      prev.stage = st;
    }
    // forget animals that are gone (bounded by the living population)
    for (const id of this.seen.keys()) if (!alive.has(id)) this.seen.delete(id);
  }

  /** Player possession is game state, recorded so the Social Lens can say "you lived as this deer". */
  possessed(a: Animal): void {
    this.add(a.id, a.sp, { kind: 'possessed', other: 0, osp: -1, n: 0, cause: '' });
  }
  released(a: Animal): void {
    this.add(a.id, a.sp, { kind: 'released', other: 0, osp: -1, n: 0, cause: '' });
  }

  snapshot(): ChronicleSnapshot {
    const animals: ChronicleSnapshot['animals'] = [];
    // least recently touched first, so restoring in order preserves eviction order
    const order = [...this.records.entries()].sort((a, b) => a[1].touched - b[1].touched);
    for (const [id, r] of order) animals.push([id, r.sp, r.alive, r.entries.map((e) => ({ ...e }))]);
    const seen: ChronicleSnapshot['seen'] = [];
    for (const [id, s] of this.seen) seen.push([id, s.group, s.stage]);
    return { v: 1, animals, seen };
  }

  /**
   * Restore from a save. Malformed or foreign data is ignored entry by entry (a damaged history must never block
   * loading the world); limits are re-applied.
   */
  restore(raw: unknown): { restored: number; rejected: number } {
    this.records.clear();
    this.seen.clear();
    this.seq = 0;
    let rejected = 0;
    if (!raw || typeof raw !== 'object' || (raw as { v?: unknown }).v !== 1) return { restored: 0, rejected: raw ? 1 : 0 };
    const s = raw as Partial<ChronicleSnapshot>;
    const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
    for (const row of Array.isArray(s.animals) ? s.animals : []) {
      if (!Array.isArray(row) || !num(row[0]) || !num(row[1]) || !Array.isArray(row[3]) || row[1] < 0 || row[1] >= SPECIES.length) {
        rejected++;
        continue;
      }
      const entries: ChronicleEntry[] = [];
      for (const e of row[3] as unknown[]) {
        const o = e as Partial<ChronicleEntry>;
        if (!o || !num(o.t) || typeof o.kind !== 'string' || !KINDS.has(o.kind) || !num(o.other) || !num(o.osp) || !num(o.n)) {
          rejected++;
          continue;
        }
        entries.push({ t: o.t, kind: o.kind as ChronicleKind, other: o.other, osp: o.osp, n: o.n, cause: typeof o.cause === 'string' ? o.cause.slice(0, 24) : '', noticed: o.noticed === true });
      }
      if (!entries.length) continue;
      if (this.records.size >= this.maxAnimals) this.evict();
      this.records.set(row[0], { sp: row[1], alive: row[2] !== false, touched: ++this.seq, entries: entries.slice(-this.perAnimal) });
    }
    for (const row of Array.isArray(s.seen) ? s.seen : []) {
      if (Array.isArray(row) && num(row[0]) && num(row[1]) && num(row[2])) this.seen.set(row[0], { group: row[1], stage: row[2] });
      else rejected++;
    }
    // animals alive in the restored world but unknown to the saved baseline get a baseline now (not a "change")
    for (const a of this.sim.animals) if (a.alive && !this.seen.has(a.id)) this.seen.set(a.id, { group: a.group, stage: this.stage(a) });
    let restored = 0;
    for (const r of this.records.values()) restored += r.entries.length;
    return { restored, rejected };
  }
}

const nameOf = (sp: number): string => (SPECIES[sp] ? SPECIES[sp]!.name.split(' (')[0]!.toLowerCase() : 'animal');

/** Calendar label in the HUD's convention (Day 1-based within the 48-day year) plus clock time. */
export function chronicleTime(tH: number, yearDays: number): string {
  const day = Math.floor(tH / 24);
  const h = tH - day * 24;
  return `Day ${(day % yearDays) + 1} ${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;
}

/** One line of plain text describing an entry; every part comes from the entry (and therefore from the simulation). */
export function describeEntry(e: ChronicleEntry): string {
  const other = e.other ? `${nameOf(e.osp)} #${e.other}` : '';
  switch (e.kind) {
    case 'born': return e.other ? `born to ${other}` : 'born';
    case 'gave-birth': return e.n > 1 ? `gave birth to ${e.n} young` : 'gave birth to one young';
    case 'killed': return `killed a ${other}`;
    case 'was-killed': return `killed by a ${other}`;
    case 'died': return `died (${e.cause})`;
    case 'alarm': return 'took fright at a predator';
    case 'left-group': return `left group #${e.n}`;
    case 'joined-group': return `now in group #${e.n}`;
    case 'weaned': return 'weaned (no longer dependent)';
    case 'matured': return 'reached adulthood';
    case 'possessed': return 'you began living as this animal';
    case 'released': return 'you released it to its own decisions';
    case 'mother-died': return `lost its mother #${e.other} (${e.cause})`;
  }
}
