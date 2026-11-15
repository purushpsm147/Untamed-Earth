import { hash3 } from './rng';

/** Seeded 2D gradient-free value noise with quintic interpolation. Output in [0,1]. */
export function valueNoise(seed: number, x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const a = hash3(seed, xi, yi) / 4294967296;
  const b = hash3(seed, xi + 1, yi) / 4294967296;
  const c = hash3(seed, xi, yi + 1) / 4294967296;
  const d = hash3(seed, xi + 1, yi + 1) / 4294967296;
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Fractal Brownian motion; output roughly in [0,1]. */
export function fbm(seed: number, x: number, y: number, octaves: number, lacunarity = 2, gain = 0.5): number {
  let amp = 0.5;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise(seed + i * 1013, x, y);
    norm += amp;
    x = x * lacunarity + 17.3;
    y = y * lacunarity - 9.1;
    amp *= gain;
  }
  return sum / norm;
}

/** Ridged noise in [0,1]: sharp crests, useful for mountain borders. */
export function ridge(seed: number, x: number, y: number, octaves: number): number {
  let amp = 0.5;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(valueNoise(seed + i * 577, x, y) * 2 - 1);
    sum += amp * n * n;
    norm += amp;
    x *= 2.1;
    y *= 2.1;
    amp *= 0.5;
  }
  return sum / norm;
}
