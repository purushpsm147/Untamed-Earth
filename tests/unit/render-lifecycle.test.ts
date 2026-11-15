import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { Simulation } from '@untamed/ecology';
import { AnimalView } from '../../apps/web/src/render/AnimalView';
import { GrassView } from '../../apps/web/src/render/GrassView';
import { ScatterView } from '../../apps/web/src/render/ScatterView';
import { Sky } from '../../apps/web/src/render/Sky';
import { TerrainView } from '../../apps/web/src/render/TerrainView';
import { WaterView } from '../../apps/web/src/render/WaterView';
import { WeatherFx } from '../../apps/web/src/render/WeatherFx';

function track(object: THREE.Object3D): { check: () => void } {
  const geometrySpies = new Map<THREE.BufferGeometry, ReturnType<typeof vi.spyOn>>();
  const materialSpies = new Map<THREE.Material, ReturnType<typeof vi.spyOn>>();
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh || child instanceof THREE.LineSegments)) return;
    if (!geometrySpies.has(child.geometry)) geometrySpies.set(child.geometry, vi.spyOn(child.geometry, 'dispose'));
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      if (!materialSpies.has(material)) materialSpies.set(material, vi.spyOn(material, 'dispose'));
    }
  });
  expect(geometrySpies.size).toBeGreaterThan(0);
  expect(materialSpies.size).toBeGreaterThan(0);
  return {
    check() {
      for (const spy of geometrySpies.values()) expect(spy).toHaveBeenCalledTimes(1);
      for (const spy of materialSpies.values()) expect(spy).toHaveBeenCalledTimes(1);
      vi.restoreAllMocks();
    },
  };
}

describe('render view GPU resource ownership (headless; no WebGL needed)', () => {
  it('releases all distinct resources of the sky, grass, water, wildlife, rain and scatter views', () => {
    const sim = new Simulation(2);
    const sky = new Sky();
    const grass = new GrassView(sim.valley, sim.env, 100);
    const water = new WaterView(sim.valley);
    const animals = new AnimalView(sim);
    const weather = new WeatherFx(100);
    const scatter = new ScatterView(sim.valley);
    for (const [root, dispose] of [
      [sky.mesh, () => sky.dispose()],
      [grass.mesh, () => grass.dispose()],
      [new THREE.Group().add(water.mesh, water.pools), () => water.dispose()],
      [animals.group, () => animals.dispose()],
      [weather.rain, () => weather.dispose()],
      [scatter.group, () => scatter.dispose()],
    ] as const) {
      const checks = track(root);
      dispose();
      checks.check();
    }
  });

  it('releases streamed terrain meshes and clears its chunk cache', () => {
    const sim = new Simulation(3);
    const terrain = new TerrainView(sim.valley);
    // A worker is unavailable in headless Node; update the terrain once to build a chunk.
    terrain.viewDist = 50;
    terrain.update(new THREE.Vector3(700, 20, 700));
    const checks = track(terrain.group);
    terrain.dispose();
    checks.check();
    expect(terrain.group.children).toHaveLength(0);
  });
});
