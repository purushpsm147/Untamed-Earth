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
    const chunk = { cx, cz, mesh: null, res: 0, pending: 48, pendingId: 12, want: 48, d: 0 };
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
    const chunk = { cx, cz, mesh: null, res: 0, pending: 6, pendingId: 9, want: 24, d: 0 };
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
