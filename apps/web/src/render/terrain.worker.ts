/// <reference lib="webworker" />
import { Valley, buildChunkMesh } from '@untamed/worlds';

let valley: Valley | null = null;
self.onmessage = (e: MessageEvent<{ seed?: number; id?: number; cx: number; cz: number; res: number }>) => {
  const m = e.data;
  if (m.seed !== undefined) {
    valley = new Valley(m.seed);
    return;
  }
  if (!valley) return;
  const d = buildChunkMesh(valley, m.cx, m.cz, m.res);
  (self as unknown as Worker).postMessage({ id: m.id, cx: m.cx, cz: m.cz, res: m.res, ...d }, [d.positions.buffer, d.normals.buffer, d.colors.buffer, d.indices.buffer]);
};
