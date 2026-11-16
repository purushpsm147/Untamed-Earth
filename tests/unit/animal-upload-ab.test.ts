import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Simulation } from '@untamed/ecology';
import { AnimalView } from '../../apps/web/src/render/AnimalView';

function animalBatches(view: AnimalView): THREE.InstancedMesh[] {
  return view.group.children.filter(
    (object): object is THREE.InstancedMesh => object instanceof THREE.InstancedMesh && !!object.geometry.getAttribute('iAnim'),
  );
}

describe('opt-in animal instance-upload A/B experiment', () => {
  it('updates only active slots in mode B; empty batches request no upload', () => {
    const sim = new Simulation(3);
    const initialHash = sim.stateHash();
    const view = new AnimalView(sim, 'active');
    const cam = new THREE.Vector3(760, 30, 640);

    view.beginUploadSample();
    view.update(cam, 0.5, 1 / 60, 1, 2000, 0);
    const snapshot = view.debugUpload();
    expect(snapshot.mode).toBe('active');
    expect(snapshot.visible).toBeGreaterThan(0);
    expect(snapshot.dropped).toBe(0);
    for (const mesh of animalBatches(view)) {
      const anim = mesh.geometry.getAttribute('iAnim') as THREE.InstancedBufferAttribute;
      const pose = mesh.geometry.getAttribute('iPose') as THREE.InstancedBufferAttribute;
      if (mesh.count > 0) {
        expect(mesh.instanceMatrix.updateRanges).toEqual([{ start: 0, count: mesh.count * 16 }]);
        expect(anim.updateRanges).toEqual([{ start: 0, count: mesh.count * 4 }]);
        expect(pose.updateRanges).toEqual([{ start: 0, count: mesh.count * 4 }]);
      } else {
        expect(mesh.instanceMatrix.updateRanges).toEqual([]);
        expect(anim.updateRanges).toEqual([]);
        expect(pose.updateRanges).toEqual([]);
      }
    }

    view.update(new THREE.Vector3(-10000, 0, -10000), 0.5, 1 / 60, 2, 100, 0);
    expect(view.debugUpload().visible).toBe(0);
    expect(view.debugUpload().requestedBytes).toBe(0);
    for (const mesh of animalBatches(view)) {
      expect(mesh.count).toBe(0);
      expect(mesh.instanceMatrix.updateRanges).toEqual([]);
    }
    const sample = view.endUploadSample();
    expect(sample.frames).toBe(2);
    expect(sample.averageRequestedBytes).toBeGreaterThan(0);
    expect(sim.stateHash()).toBe(initialHash);
    view.dispose();
  });

  it('mode A remains the default and both modes emit bit-identical matrices and shader attributes', () => {
    const sim = new Simulation(7);
    const initialHash = sim.stateHash();
    const full = new AnimalView(sim);
    const active = new AnimalView(sim, 'active');
    const camera = new THREE.Vector3(760, 30, 640);
    full.update(camera, 0.6, 1 / 60, 5, 2000, 0);
    active.update(camera, 0.6, 1 / 60, 5, 2000, 0);

    const oldBatches = animalBatches(full);
    const newBatches = animalBatches(active);
    expect(oldBatches.length).toBe(7);
    expect(newBatches.length).toBe(oldBatches.length);
    for (let i = 0; i < oldBatches.length; i++) {
      const a = oldBatches[i]!;
      const b = newBatches[i]!;
      expect(b.count).toBe(a.count);
      expect(a.instanceMatrix.updateRanges).toEqual([]);
      expect(
        Array.from(b.instanceMatrix.array.slice(0, b.count * 16)),
      ).toEqual(Array.from(a.instanceMatrix.array.slice(0, a.count * 16)));
      for (const name of ['iAnim', 'iPose']) {
        const aa = a.geometry.getAttribute(name) as THREE.InstancedBufferAttribute;
        const bb = b.geometry.getAttribute(name) as THREE.InstancedBufferAttribute;
        expect(Array.from(bb.array.slice(0, b.count * 4))).toEqual(Array.from(aa.array.slice(0, a.count * 4))));
      }
    }
    expect(active.debugUpload().visible).toBe(full.debugUpload().visible);
    expect(active.debugUpload().requestedBytes).toBeLessThan(full.debugUpload().requestedBytes);
    expect(sim.stateHash()).toBe(initialHash);
    active.dispose();
    full.dispose();
  });
});
