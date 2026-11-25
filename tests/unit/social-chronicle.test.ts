import { describe, expect, it } from 'vitest';
import { SAVE_VERSION, Simulation } from '@untamed/ecology';
import { openEnvelope, sealEnvelope } from '@untamed/persistence';
import { MAX_ALARMS, SocialChronicle, describeEntry } from '../../apps/web/src/game/SocialChronicle';

/** Step a world at the 1000x tick size until the predicate holds (bounded). */
function runUntil(sim: Simulation, chron: SocialChronicle, pred: () => boolean, maxTicks = 40000): void {
  for (let i = 0; i < maxTicks && !pred(); i++) {
    sim.step(2);
    if (i % 30 === 0) chron.tick(1);
  }
}

describe('SocialChronicle (persistent Social Lens history)', () => {
  it('records only real events, with the right participants', () => {
    const sim = new Simulation(3);
    const chron = new SocialChronicle(sim);
    chron.attach();
    const seen: { type: string; ids: number[] }[] = [];
    sim.events.on((e) => {
      if (e.type === 'kill') seen.push({ type: 'kill', ids: [e.predator, e.prey] });
      if (e.type === 'birth') seen.push({ type: 'birth', ids: [e.id] });
    });
    runUntil(sim, chron, () => seen.some((s) => s.type === 'kill') && seen.some((s) => s.type === 'birth'));
    const kill = seen.find((s) => s.type === 'kill')!;
    expect(kill).toBeDefined();
    expect(chron.entriesFor(kill.ids[0]!).some((e) => e.kind === 'killed' && e.other === kill.ids[1])).toBe(true);
    expect(chron.entriesFor(kill.ids[1]!).some((e) => e.kind === 'was-killed' && e.other === kill.ids[0])).toBe(true);
    const birth = seen.find((s) => s.type === 'birth')!;
    expect(chron.entriesFor(birth.ids[0]!).some((e) => e.kind === 'gave-birth')).toBe(true);
    // every 'born' entry names a mother that really is that animal's mother
    for (const a of sim.animals) {
      for (const e of chron.entriesFor(a.id)) if (e.kind === 'born') expect(e.other).toBe(a.mother);
    }
    chron.dispose();
  });

  it('does not change the simulation: identical state hash with and without the chronicle', () => {
    const a = new Simulation(5);
    const b = new Simulation(5);
    const chron = new SocialChronicle(b);
    chron.attach();
    for (let i = 0; i < 3000; i++) {
      a.step(1);
      b.step(1);
      if (i % 10 === 0) chron.tick(1);
    }
    expect(b.stateHash()).toBe(a.stateHash());
    expect(chron.stats().entries).toBeGreaterThan(0);
  });

  it('survives save/load (structured clone of the save envelope) and continues recording', () => {
    const sim = new Simulation(3);
    const chron = new SocialChronicle(sim);
    chron.attach();
    runUntil(sim, chron, () => chron.stats().entries >= 20);
    const before = chron.snapshot();
    const env = structuredClone(sealEnvelope({ sim: sim.snapshot(), chronicle: before }, 'untamed-earth', SAVE_VERSION, 0));
    const data = openEnvelope<{ sim: ReturnType<Simulation['snapshot']>; chronicle: unknown }>(env, 'untamed-earth', SAVE_VERSION);
    const sim2 = new Simulation(3, data.sim);
    const chron2 = new SocialChronicle(sim2);
    const r = chron2.restore(data.chronicle);
    chron2.attach();
    expect(r.rejected).toBe(0);
    expect(chron2.snapshot()).toEqual(before);
    for (const [id] of before.animals) expect(chron2.entriesFor(id).map(describeEntry)).toEqual(chron.entriesFor(id).map(describeEntry));
    // the restored world keeps recording into the same history
    const n0 = chron2.stats().entries;
    runUntil(sim2, chron2, () => chron2.stats().entries > n0);
    expect(chron2.stats().entries).toBeGreaterThan(n0);
  });

  it('is bounded per animal and in total, forgetting the dead first', () => {
    const sim = new Simulation(3);
    const chron = new SocialChronicle(sim, 4, 30);
    chron.attach();
    runUntil(sim, chron, () => false, 20000);
    const st = chron.stats();
    expect(st.animals).toBeLessThanOrEqual(30);
    for (const a of chron.snapshot().animals) expect(a[3].length).toBeLessThanOrEqual(4);
    expect(st.seen).toBeLessThanOrEqual(sim.animals.filter((a) => a.alive).length);
  });

  it('ignores damaged or foreign history instead of failing the load', () => {
    const sim = new Simulation(3);
    const chron = new SocialChronicle(sim);
    expect(chron.restore(null)).toEqual({ restored: 0, rejected: 0 });
    expect(chron.restore({ v: 99 }).restored).toBe(0);
    const r = chron.restore({
      v: 1,
      animals: [
        [5, 0, true, [{ t: 10, kind: 'gave-birth', other: 0, osp: -1, n: 2, cause: '', noticed: false }, { t: 'x', kind: 'gave-birth' }, { t: 3, kind: 'invented-biography', other: 0, osp: 0, n: 0 }]],
        ['bad', 0, true, []],
        [6, 99, true, [{ t: 1, kind: 'alarm', other: 0, osp: -1, n: 0 }]],
      ],
      seen: [[5, 1, 2], ['x']],
    });
    expect(r.restored).toBe(1);
    expect(r.rejected).toBe(5);
    expect(chron.entriesFor(5).map(describeEntry)).toEqual(['gave birth to 2 young']);
  });

  it('notices group changes and life-stage transitions from state the simulation already holds', () => {
    const sim = new Simulation(3);
    const chron = new SocialChronicle(sim);
    chron.attach();
    runUntil(sim, chron, () => chron.snapshot().animals.some(([, , , es]) => es.some((e) => e.kind === 'weaned' || e.kind === 'joined-group')), 60000);
    const all = chron.snapshot().animals.flatMap(([id, , , es]) => es.map((e) => ({ id, e })));
    const noticed = all.filter(({ e }) => e.kind === 'weaned' || e.kind === 'matured' || e.kind === 'joined-group');
    expect(noticed.length).toBeGreaterThan(0);
    for (const { e } of noticed) expect(e.noticed).toBe(true);
    // a joined-group entry names the group the animal is in, or was in before a later change
    for (const { id } of all.filter(({ e }) => e.kind === 'joined-group')) {
      const a = sim.byId.get(id);
      if (a && a.alive) {
        const later = chron.entriesFor(id).filter((x) => x.kind === 'joined-group');
        expect(later[later.length - 1]!.n).toBe(a.group);
      }
    }
  });

  it('a flood of alarms never evicts possession, births or other notable entries', () => {
    const sim = new Simulation(3);
    const chron = new SocialChronicle(sim, 12);
    chron.attach();
    const deer = sim.animals.find((a) => a.sp === 0 && a.alive)!;
    chron.possessed(deer);
    chron.released(deer);
    // 200 alarm episodes, each an hour apart (not collapsed as repeats)
    for (let k = 0; k < 200; k++) {
      sim.env.timeH += 1;
      sim.events.emit({ type: 'alarm', sp: deer.sp, id: deer.id, x: deer.x, z: deer.z });
    }
    const kinds = chron.entriesFor(deer.id).map((e) => e.kind);
    expect(kinds).toContain('possessed');
    expect(kinds).toContain('released');
    expect(kinds.filter((k) => k === 'alarm').length).toBe(MAX_ALARMS);
  });

  it('a save taken between observation scans is complete: loading the paused world adds nothing', () => {
    const sim = new Simulation(3);
    const chron = new SocialChronicle(sim);
    chron.attach();
    // run until some animal is about to cross a life-stage threshold that the low-rate scan has not seen yet
    let found = false;
    for (let i = 0; i < 40000 && !found; i++) {
      sim.step(2);
      if (i % 30 === 0) chron.tick(1);
      else found = chron.stats().entries > 0 && sim.animals.some((a) => a.alive && a.mother && a.age > 0);
    }
    for (let i = 0; i < 200; i++) sim.step(2); // advance without scanning: transitions pending
    const snap = chron.snapshot();
    const sim2 = new Simulation(3, sim.snapshot());
    const chron2 = new SocialChronicle(sim2);
    chron2.restore(structuredClone(snap));
    chron2.attach();
    chron2.tick(5); // a scan on the restored, un-advanced world
    expect(chron2.snapshot()).toEqual(snap);
  });
});
