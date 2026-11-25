import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Valley, buildChunkMesh } from '@untamed/worlds';
import { TerrainView } from '../../apps/web/src/render/TerrainView';

/**
 * Worker's responses are intentionally fed out of order into the private boundary
 * to isolate stale response handling from any browser/Worker scheduling assumptions.
 */
describe('terrain streaming: stale worker response protection', () => {
  it('ignores responses from an older request generation on the same chunk', () => {
    const valley = new Valley(8);
    const terrain = new TerrainView(valley);
    const cx = 5, cz = 5;
    const key = (cx + 16) * 64 + (cz + 16);
    const chunk = { cx, cz, mesh: null, res: 0, pending: 48, pendingId: 12, want: 48, d: 0, dist: 0, live: true };
    const t = terrain as unknown as {
      chunks: Map<number, typeof chunk & { mesh: THREE.Mesh | null }>;
      apply: (result: ReturnType<typeof buildChunkMesh> & { id: number; cx: number; cz: number; res: number }) => void;
    };
    t.chunks.set(key, chunk);
    const data = buildChunkMesh(valley, cx, cz, 48);

    t.apply({ ...data, id: 11, cx, cz, res: 48 });
    expect(chunk.mesh).toBeNull();
    expect(chunk.pendingId).toBe(12);
    expect(chunk.res).toBe(0);

    t.apply({ ...data, id: 12, cx, cz, res: 48 });
    expect(chunk.mesh).not.toBeNull();
    expect(chunk.res).toBe(48);
    expect(chunk.pendingId).toBe(0);
    terrain.dispose();
  });

  it('does not apply a completed mesh if the desired LOD has changed', () => {
    const valley = new Valley(10);
    const terrain = new TerrainView(valley);
    const cx = 4, cz = 3;
    const key = (cx + 16) * 64 + (cz + 16);
    const chunk = { cx, cz, mesh: null, res: 0, pending: 6, pendingId: 9, want: 24, d: 0, dist: 0, live: true };
    const t = terrain as unknown as {
      chunks: Map<number, typeof chunk & { mesh: THREE.Mesh | null }>;
      apply: (result: ReturnType<typeof buildChunkMesh> & { id: number; cx: number; cz: number; res: number }) => void;
    };
    t.chunks.set(key, chunk);
    t.apply({ ...buildChunkMesh(valley, cx, cz, 6), id: 9, cx, cz, res: 6 });
    expect(chunk.mesh).toBeNull();
    expect(chunk.res).toBe(0);
    expect(chunk.pendingId).toBe(0);
    expect(chunk.pending).toBe(0);

    chunk.pending = 24;
    chunk.pendingId = 10;
    t.apply({ ...buildChunkMesh(valley, cx, cz, 24), id: 10, cx, cz, res: 24 });
    expect(chunk.mesh).not.toBeNull();
    expect(chunk.res).toBe(24);
    terrain.dispose();
  });
});

describe('terrain streaming: readiness diagnostics', () => {
  // Regression for CI runs 44116004501 and 45464710402: after the coarse first fill, and before the next update() sets
  // the full-detail target, every counter used to read zero although chunks near the camera were still at LOD 6.
  it('does not report settled while chunks are still at the coarse first-fill LOD', () => {
    const valley = new Valley(1);
    const terrain = new TerrainView(valley); // no Worker in Node: main-thread path, fully deterministic
    const t = terrain as unknown as { pump: () => void; queue: unknown[] };
    const cam = new THREE.Vector3(720, 30, 690);
    terrain.update(cam);
    while (t.queue.length > 0) t.pump(); // finish the coarse fill without another update()
    const coarse = terrain.debugState();
    expect(coarse.pending + coarse.inFlight + coarse.queued).toBe(0);
    expect(coarse.meshes).toBeGreaterThan(20);
    expect(coarse.mismatched).toBeGreaterThan(0); // previously 0: the false "settled" reading
    for (let i = 0; i < 50 && terrain.debugState().mismatched > 0; i++) {
      terrain.update(cam);
      while (t.queue.length > 0) t.pump();
    }
    const done = terrain.debugState();
    expect(done.mismatched).toBe(0);
    // and at that point another pass at the same camera creates no new work
    terrain.update(cam);
    const again = terrain.debugState();
    expect(again.queued + again.pending + again.mismatched).toBe(0);
    terrain.dispose();
  });
});
