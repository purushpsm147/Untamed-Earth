import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Valley } from '@untamed/worlds';
import { ScatterView } from '../../apps/web/src/render/ScatterView';
import { QUALITY } from '../../apps/web/src/render/quality';

type B = { mesh: THREE.InstancedMesh; n: number; want: number };
const batches = (v: ScatterView): B[] => {
  const s = v as unknown as { hi: (B | null)[]; lo: (B | null)[] };
  return [...s.hi, ...s.lo].filter((b): b is B => b !== null);
};

describe('scatter instance buffers are sized to what the view needs', () => {
  it('grows on demand without dropping instances, and shrinks with hysteresis when the view gets smaller', () => {
    const view = new ScatterView(new Valley(1));
    const cam = new THREE.PerspectiveCamera(62, 16 / 9, 0.25, 3000);
    cam.position.set(760, 30, 640);
    cam.lookAt(800, 25, 700);
    cam.updateMatrixWorld();
    const run = (vegDist: number, treeHiDist: number): void => {
      view.vegDist = vegDist;
      view.treeHiDist = treeHiDist;
      view.invalidate();
      view.update(cam);
    };
    const preallocated = batches(view).reduce((n, b) => n + (b as unknown as { mesh: THREE.InstancedMesh }).mesh.instanceMatrix.count, 0);
    run(QUALITY.low.vegDist, QUALITY.low.treeHiDist);
    const low = view.capacity();
    for (const b of batches(view)) expect(b.n, 'nothing truncated on Low').toBe(b.want);
    run(QUALITY.ultra.vegDist, QUALITY.ultra.treeHiDist);
    const ultra = view.capacity();
    for (const b of batches(view)) expect(b.n, 'nothing truncated on Ultra').toBe(b.want);
    expect(ultra).toBeGreaterThan(low);
    // the old design allocated every kind's maximum: 118,500 instances regardless of preset
    expect(low).toBeLessThan(118_500 / 20);
    expect(preallocated).toBeLessThan(2000);
    // back to Low: capacity comes down (4x hysteresis), and a small wobble afterwards does not reallocate
    run(QUALITY.low.vegDist, QUALITY.low.treeHiDist);
    const back = view.capacity();
    expect(back).toBeLessThan(ultra);
    const meshes = batches(view).map((b) => b.mesh);
    run(QUALITY.low.vegDist * 1.1, QUALITY.low.treeHiDist);
    expect(batches(view).map((b) => b.mesh)).toEqual(meshes);
    view.dispose();
  });
});
