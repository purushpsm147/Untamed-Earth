import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Environment } from '@untamed/environment';
import { Valley } from '@untamed/worlds';
import { Sky } from '../../apps/web/src/render/Sky';

/** Ambient light reaching the ground and the frame's exposure, across a day at a fixed date, clear sky. */
function sample(hour: number): { el: number; ambient: number; exposure: number; warmth: number } {
  const env = new Environment(new Valley(1));
  env.timeH = 34 * 24 + hour;
  env.cloud = 0.15;
  const sky = new Sky();
  const cam = new THREE.PerspectiveCamera();
  sky.update(env, cam, 0, 100);
  const c = sky.hemi.color;
  return { el: env.sunElevation(), ambient: sky.hemi.intensity * (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b), exposure: sky.exposure, warmth: c.r / Math.max(c.b, 1e-3) };
}

describe('sky lighting across the day (natural curve, not uniform brightening)', () => {
  const night = sample(23);
  const dawn = sample(5.4); // sun at the horizon
  const golden = sample(18.0);
  const noon = sample(12);
  it('keeps night dark', () => {
    expect(night.el).toBeLessThan(-0.5);
    expect(night.ambient).toBeLessThan(0.12);
    expect(night.exposure).toBeCloseTo(0.95, 2);
  });
  it('lights the ground through twilight, still dimmer than full day', () => {
    expect(Math.abs(dawn.el)).toBeLessThan(0.05);
    expect(dawn.ambient).toBeGreaterThan(night.ambient * 4);
    expect(dawn.ambient).toBeLessThan(noon.ambient);
    expect(dawn.exposure).toBeGreaterThan(noon.exposure);
  });
  it('warms the light at golden hour and pulls midday exposure down', () => {
    expect(golden.warmth).toBeGreaterThan(noon.warmth * 1.15);
    expect(noon.exposure).toBeLessThan(0.85);
  });
  it('ambient rises monotonically from night through sunrise to midday', () => {
    const hours = [3, 4.8, 5.1, 5.4, 5.7, 6.0, 6.5, 7.5, 9, 12];
    const amb = hours.map((h) => sample(h).ambient);
    for (let i = 1; i < amb.length; i++) expect(amb[i]!, `at ${hours[i]}h`).toBeGreaterThanOrEqual(amb[i - 1]! - 1e-9);
  });
});
