import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Simulation } from '@untamed/ecology';
import { AnimalView } from '../../apps/web/src/render/AnimalView';
import { AnimalVisibility } from '../../apps/web/src/render/AnimalVisibility';

function cameraAt(x = 0, z = 40): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(60, 1, 0.25, 3000);
  camera.position.set(x, 10, z);
  camera.lookAt(x, 0, 0);
  camera.updateMatrixWorld();
  return camera;
}

function lightCovering(centerX: number, centerZ: number, extent: number): THREE.DirectionalLight {
  const light = new THREE.DirectionalLight();
  light.castShadow = true;
  light.position.set(centerX, 450, centerZ + 450);
  light.target.position.set(centerX, 0, centerZ);
  const c = light.shadow.camera;
  c.left = c.bottom = -extent;
  c.right = c.top = extent;
  c.near = 0.5;
  c.far = 3000;
  c.updateProjectionMatrix();
  return light;
}

describe('animal visibility A/B: camera frustum union shadow frustum', () => {
  it('sees the camera subject and culls animals behind the camera without shadows', () => {
    const v = new AnimalVisibility();
    const camera = cameraAt();
    v.prepare(camera);
    expect(v.classify(0, 0, 0, 2)).toBe('camera');
    expect(v.classify(0, 0, 90, 2)).toBe('culled');
    expect(v.classify(0, 0, 90, 100)).toBe('camera'); // sphere intersects the frustum

    camera.position.set(100, 10, 40);
    camera.lookAt(100, 0, 0);
    v.prepare(camera);
    expect(v.classify(0, 0, 0, 2)).toBe('culled');
    expect(v.classify(100, 0, 0, 2)).toBe('camera');
  });

  it('preserves shadow-only animals and disables shadow retention with the shadow quality preset', () => {
    const v = new AnimalVisibility();
    const camera = cameraAt();
    const light = lightCovering(0, 0, 200);
    v.prepare(camera, light);
    expect(v.classify(0, 0, 0, 2)).toBe('camera');
    expect(v.classify(45, 0, 0, 2)).toBe('shadow');
    expect(v.classify(1000, 0, 0, 2)).toBe('culled');

    light.castShadow = false;
    v.prepare(camera, light);
    expect(v.classify(45, 0, 0, 2)).toBe('culled');
  });

  it('matches baseline animal matrices, poses, and world hash when shadow frustum retains all candidates', () => {
    const sim = new Simulation(2);
    const hash = sim.stateHash();
    const baseline = new AnimalView(sim);
    const candidate = new AnimalView(sim, 'camera-shadow');
    const camera = cameraAt(760, 640);
    const visibility = new AnimalVisibility();
    visibility.prepare(camera, lightCovering(760, 640, 2500));
    baseline.update(camera.position, 0.4, 1 / 60, 2, 1600, 0);
    candidate.update(camera.position, 0.4, 1 / 60, 2, 1600, 0, 0, visibility);
    expect(candidate.debugCulling().culled).toBe(0);
    expect(candidate.debugCulling().rendered).toBe(baseline.debugCulling().rendered);

    const batchMeshes = (v: AnimalView): THREE.InstancedMesh[] => v.group.children.filter(
      (c): c is THREE.InstancedMesh => c instanceof THREE.InstancedMesh && !!c.geometry.getAttribute('iAnim'),
    );
    const aMeshes = batchMeshes(baseline);
    const bMeshes = batchMeshes(candidate);
    expect(aMeshes.length).toBe(7);
    for (let i = 0; i < aMeshes.length; i++) {
      const a = aMeshes[i]!;
      const b = bMeshes[i]!;
      expect(b.count).toBe(a.count);
      expect(Array.from(b.instanceMatrix.array.slice(0, b.count * 16))).toEqual(
        Array.from(a.instanceMatrix.array.slice(0, a.count * 16)),
      );
      for (const key of ['iAnim', 'iPose']) {
        const aAttr = a.geometry.getAttribute(key);
        const bAttr = b.geometry.getAttribute(key);
        const renderedAttr = Array.from(bAttr.array.slice(0, b.count * 4));
        const baselineAttr = Array.from(aAttr.array.slice(0, a.count * 4));
        expect(renderedAttr).toEqual(baselineAttr);
      }
    }
    expect(sim.stateHash()).toBe(hash);
    candidate.dispose();
    baseline.dispose();
  });

  it('reduces pose work when camera faces away, with shadows disabled, without mutating ecology', () => {
    const sim = new Simulation(3);
    const hash = sim.stateHash();
    const baseline = new AnimalView(sim);
    const candidate = new AnimalView(sim, 'camera-shadow');
    const camera = cameraAt(760, 640);
    const visibility = new AnimalVisibility();
    visibility.prepare(camera); // Low quality: no shadow-map pass
    baseline.update(camera.position, 0.5, 1 / 60, 3, 1600, 0);
    candidate.beginCullingSample();
    candidate.update(camera.position, 0.5, 1 / 60, 3, 1600, 0, 0, visibility);
    const stats = candidate.endCullingSample();
    expect(stats.frames).toBe(1);
    expect(stats.averageCandidates).toBeGreaterThan(0);
    expect(stats.averageCulled).toBeGreaterThan(0);
    expect(stats.averageRendered).toBeLessThan(baseline.debugCulling().rendered);
    expect(stats.totalOverflow).toBe(0);
    for (const [id, pos] of candidate.pos) expect(pos.equals(baseline.pos.get(id)!)).toBe(true);
    expect(sim.stateHash()).toBe(hash);
    candidate.dispose();
    baseline.dispose();
  });
});
