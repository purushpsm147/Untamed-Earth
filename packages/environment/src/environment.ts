import { Rng, clamp, clamp01, lerp, smoothstep } from '@untamed/core';
import { REGION_SIZE, Valley } from '@untamed/worlds';

export const CELL = 24;
export const GRID = REGION_SIZE / CELL; // 60
export const CELLS = GRID * GRID;
/** Compressed calendar: one year is 48 days, four 12-day seasons. Documented in docs/SIMULATION.md. */
export const YEAR_DAYS = 48;
export const SEASONS = ['Winter', 'Summer', 'Monsoon', 'Post-monsoon'] as const;
export type WeatherKind = 'clear' | 'cloudy' | 'rain' | 'storm';
export type WeatherMode = 'natural' | 'drought' | 'monsoon';

/** Experiment-mode levers. All of them feed the equations below; none are cosmetic. */
export interface EnvParams {
  rainMult: number;
  vegGrowthMult: number;
  weatherMode: WeatherMode;
}

export interface EnvSnapshot {
  timeH: number;
  weather: WeatherKind;
  weatherTimer: number;
  cloud: number;
  rain: number;
  wind: number;
  windDir: number;
  stage: number;
  acc: number;
  temperature: number;
  meanMoisture: number;
  totalVeg: number;
  params: EnvParams;
  veg: Float32Array;
  moisture: Float32Array;
  invert: Float32Array;
  fauna: Float32Array;
  detritus: Float32Array;
  nutrients: Float32Array;
  contam: Float32Array;
}

export interface WaterSite {
  x: number;
  z: number;
  contaminated: boolean;
}

const RAIN_CHANCE: Record<number, number> = { 0: 0.03, 1: 0.05, 2: 0.42, 3: 0.12 };
const SEASON_TEMP = [17, 33, 28, 24];

/**
 * Coarse-grained abiotic + primary-production model on a 24 m grid.
 * This is the "distant region" tier of the simulation hierarchy: it always runs for the
 * whole valley regardless of where the camera is, and individual animals read from and
 * write to it (grazing, dung, carcasses).
 */
export class Environment {
  timeH: number;
  weather: WeatherKind = 'clear';
  weatherTimer = 3;
  cloud = 0.15;
  /** Rain rate, mm per hour. */
  rain = 0;
  wind = 2;
  windDir = 0.8;
  /** River / water-table stage offset in metres (negative in drought). */
  stage = 0;
  temperature = 25;
  params: EnvParams = { rainMult: 1, vegGrowthMult: 1, weatherMode: 'natural' };

  readonly veg = new Float32Array(CELLS);
  readonly moisture = new Float32Array(CELLS);
  readonly invert = new Float32Array(CELLS);
  readonly fauna = new Float32Array(CELLS);
  readonly detritus = new Float32Array(CELLS);
  readonly nutrients = new Float32Array(CELLS);
  readonly contam = new Float32Array(CELLS);
  // static, derived from the valley
  readonly cap = new Float32Array(CELLS);
  readonly forest = new Float32Array(CELLS);
  readonly settlement = new Float32Array(CELLS);
  readonly dump = new Float32Array(CELLS);
  readonly wetland = new Float32Array(CELLS);
  private readonly waterX = new Float32Array(CELLS);
  private readonly waterZ = new Float32Array(CELLS);
  /** Depth at stage 0 of the cell's deepest sampled point; <= -9 means never wet. */
  private readonly waterD = new Float32Array(CELLS);
  private readonly poolCell = new Uint8Array(CELLS);
  private acc = 0;
  // aggregates refreshed on each grid update
  meanMoisture = 0.5;
  totalVeg = 0;
  totalCap = 1;

  constructor(readonly valley: Valley, startDay = 34) {
    this.timeH = startDay * 24 + 7;
    for (let j = 0; j < GRID; j++) {
      for (let i = 0; i < GRID; i++) {
        const c = j * GRID + i;
        const s = valley.sample((i + 0.5) * CELL, (j + 0.5) * CELL);
        this.forest[c] = s.forest;
        this.settlement[c] = s.settlement;
        this.dump[c] = s.dump;
        this.wetland[c] = s.wetland;
        // forage capacity, kg dry matter per cell reachable by ground herbivores
        const perM2 = s.meadow * 0.1 + s.forest * 0.035 + s.wetland * 0.11 + s.settlement * 0.05 + s.dump * 0.014;
        const roadLoss = s.road < 6 ? 0.8 : 1;
        this.cap[c] = Math.max(1, perM2 * CELL * CELL * roadLoss * (1 - s.border * 0.6));
        this.contam[c] = s.dump > 0.15 ? clamp01(s.dump * 0.75) : 0;
        let best = -99;
        for (let v = 0; v < 6; v++) {
          for (let u = 0; u < 6; u++) {
            const x = (i + (u + 0.5) / 6) * CELL;
            const z = (j + (v + 0.5) / 6) * CELL;
            const d = valley.waterDepth(x, z, 0);
            if (d > best) {
              best = d;
              this.waterX[c] = x;
              this.waterZ[c] = z;
            }
          }
        }
        this.waterD[c] = best;
      }
    }
    for (const p of valley.pools) {
      const c = this.cellIndex(p.x, p.z);
      this.poolCell[c] = 1;
      this.waterX[c] = p.x;
      this.waterZ[c] = p.z;
      this.contam[c] = 1;
    }
    for (let c = 0; c < CELLS; c++) {
      this.veg[c] = this.cap[c]! * 0.75;
      this.moisture[c] = 0.62;
      this.nutrients[c] = 0.6;
      this.detritus[c] = this.cap[c]! * 0.2 + this.forest[c]! * 20;
      this.invert[c] = this.invertK(c) * 0.8;
      this.fauna[c] = this.faunaK(c) * 0.8;
    }
    this.refreshAggregates();
    this.updateTemperature();
  }

  // ---- calendar & sun ----
  get day(): number {
    return Math.floor(this.timeH / 24);
  }
  get hour(): number {
    return this.timeH % 24;
  }
  get yearFrac(): number {
    return (this.timeH / 24 / YEAR_DAYS) % 1;
  }
  get season(): number {
    return Math.floor(this.yearFrac * 4) % 4;
  }
  /** Sun elevation in radians at latitude 22N with seasonal declination. */
  sunElevation(): number {
    // a pure function of timeH, read for every animal every tick: computed once per distinct time (identical value)
    if (this.timeH === this.sunT) return this.sunEl;
    this.sunT = this.timeH;
    this.sunEl = this.computeSunElevation();
    return this.sunEl;
  }
  private sunT = NaN;
  private sunEl = 0;
  private computeSunElevation(): number {
    const decl = -0.408 * Math.cos(2 * Math.PI * (this.yearFrac - 0.125));
    const lat = 0.384;
    const ha = ((this.hour - 12) / 12) * Math.PI;
    return Math.asin(Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(ha));
  }
  /** Unit vector toward the sun: x east, y up, z south. */
  sunDirection(out: { x: number; y: number; z: number }): void {
    const el = this.sunElevation();
    const ha = ((this.hour - 12) / 12) * Math.PI;
    const c = Math.cos(el);
    out.x = -Math.sin(ha) * c;
    out.y = Math.sin(el);
    out.z = Math.cos(ha) * c * 0.75 + 0.25 * c;
    const l = Math.hypot(out.x, out.y, out.z);
    out.x /= l; out.y /= l; out.z /= l;
  }
  /** 0 at night, 1 in full day; smooth through twilight. */
  daylight(): number {
    return smoothstep(-0.1, 0.18, this.sunElevation());
  }

  cellIndex(x: number, z: number): number {
    const i = clamp(Math.floor(x / CELL), 0, GRID - 1);
    const j = clamp(Math.floor(z / CELL), 0, GRID - 1);
    return j * GRID + i;
  }

  private invertK(c: number): number {
    return (0.5 + 0.02 * this.veg[c]! + 0.012 * this.detritus[c]!) * (0.35 + 0.65 * this.moisture[c]!) * (1 - 0.5 * this.contam[c]!);
  }
  private faunaK(c: number): number {
    // rodents, lizards, frogs, ground-nesting birds: tracks cover and seed supply; ruins and scrap give shelter
    return 0.25 + 0.012 * this.veg[c]! + this.settlement[c]! * 0.9 + this.dump[c]! * 0.6 + this.wetland[c]! * 0.5;
  }

  private updateTemperature(): void {
    const yf = this.yearFrac * 4;
    const s0 = Math.floor(yf) % 4;
    const base = lerp(SEASON_TEMP[s0]!, SEASON_TEMP[(s0 + 1) % 4]!, smoothstep(0.6, 1, yf - Math.floor(yf)));
    const diurnal = Math.cos(((this.hour - 14.5) / 12) * Math.PI) * 6 * (1 - this.cloud * 0.5);
    this.temperature = base + diurnal - Math.min(this.rain, 10) * 0.35;
  }

  private stepWeather(dtH: number, rng: Rng): void {
    this.weatherTimer -= dtH;
    if (this.weatherTimer <= 0) {
      let pRain = RAIN_CHANCE[this.season]!;
      if (this.params.weatherMode === 'drought') pRain = 0;
      else if (this.params.weatherMode === 'monsoon') pRain = 0.6;
      const wasWet = this.weather === 'rain' || this.weather === 'storm';
      const r = rng.next();
      const p = clamp01(pRain * (wasWet ? 1.5 : 1));
      if (r < p * 0.25) this.weather = 'storm';
      else if (r < p) this.weather = 'rain';
      else if (r < p + 0.3) this.weather = 'cloudy';
      else this.weather = 'clear';
      this.weatherTimer = rng.range(1.5, 6);
      this.windDir += rng.range(-0.5, 0.5);
    }
    const tgtCloud = this.weather === 'clear' ? 0.12 : this.weather === 'cloudy' ? 0.6 : this.weather === 'rain' ? 0.9 : 1;
    const tgtRain = (this.weather === 'rain' ? 3.5 : this.weather === 'storm' ? 14 : 0) * this.params.rainMult;
    const tgtWind = this.weather === 'storm' ? 11 : this.weather === 'rain' ? 5 : this.weather === 'cloudy' ? 3.5 : 2;
    const k = 1 - Math.exp(-dtH * 2.5);
    this.cloud += (tgtCloud - this.cloud) * k;
    this.rain += (tgtRain - this.rain) * k;
    if (this.rain < 0.02) this.rain = 0;
    this.wind += (tgtWind - this.wind) * k;
  }

  /** Advance by dtH game-hours. Weather is continuous; the grid integrates in 0.25 h slices. */
  step(dtH: number, rng: Rng): void {
    this.timeH += dtH;
    this.stepWeather(dtH, rng);
    this.acc += dtH;
    while (this.acc >= 0.25) {
      this.acc -= 0.25;
      this.stepGrid(0.25);
    }
  }

  private stepGrid(dtH: number): void {
    this.updateTemperature();
    const light = this.daylight() * (1 - this.cloud * 0.55);
    const temp = this.temperature;
    const tempF = clamp01(1 - Math.abs(temp - 27) / 22);
    const evap = (0.0022 + 0.0065 * clamp01((temp - 8) / 28) * (0.25 + light)) * dtH;
    const wet = (this.rain * dtH) / 55;
    const decompBase = 0.0022 * dtH * (0.3 + tempF);
    const gMax = 0.0075 * dtH * this.params.vegGrowthMult; // ~10%/day at best
    let mSum = 0;
    for (let c = 0; c < CELLS; c++) {
      // --- soil water ---
      let m = this.moisture[c]! + wet - evap * (0.6 + 0.4 * (1 - this.forest[c]! * 0.6));
      const d = this.waterD[c]! + this.stage;
      if (d > -0.6) m = Math.max(m, clamp01(0.55 + d * 0.5)); // capillary supply beside open water
      m = clamp01(m);
      this.moisture[c] = m;
      mSum += m;
      // --- primary production (logistic, co-limited by water, temperature, light, nutrients, contamination) ---
      const cap = this.cap[c]!;
      let v = this.veg[c]!;
      const nut = this.nutrients[c]!;
      const fW = smoothstep(0.08, 0.5, m);
      const fN = 0.35 + 0.65 * nut;
      const g = gMax * fW * tempF * light * fN * (1 - 0.7 * this.contam[c]!) * (v + cap * 0.02) * (1 - v / cap);
      // senescence accelerates when soil is dry
      const loss = v * dtH * (0.0003 + 0.0014 * (1 - fW));
      v = Math.max(0, v + g - loss);
      this.veg[c] = v;
      let det = this.detritus[c]! + loss;
      // --- decomposition closes the nutrient loop ---
      const dec = det * decompBase * (0.2 + 0.8 * m);
      det -= dec;
      this.detritus[c] = det;
      this.nutrients[c] = clamp01(nut + (dec * 0.6 - Math.max(g, 0) * 0.55) / cap - (wet > 0 ? wet * 0.004 : 0));
      // --- abstract consumer pools ---
      const ik = this.invertK(c);
      const iv = this.invert[c]!;
      this.invert[c] = Math.max(0.01, iv + 0.011 * dtH * (iv + 0.02) * (1 - iv / ik));
      const fk = this.faunaK(c);
      const fv = this.fauna[c]!;
      this.fauna[c] = Math.max(0.005, fv + 0.004 * dtH * (fv + 0.01) * (1 - fv / fk));
      if (this.contam[c]! > 0 && !this.poolCell[c]) this.contam[c] = this.contam[c]! * (1 - 0.00001 * dtH);
    }
    this.refreshAggregates(mSum / CELLS);
    // river stage follows catchment wetness plus direct rainfall, with lag
    const target = clamp(-0.6 + this.meanMoisture * 1.1 + this.rain * 0.02, -0.5, 0.3);
    this.stage += (target - this.stage) * (1 - Math.exp(-dtH * 0.035));
  }

  private refreshAggregates(mean?: number): void {
    let v = 0;
    let k = 0;
    let m = 0;
    for (let c = 0; c < CELLS; c++) {
      v += this.veg[c]!;
      k += this.cap[c]!;
      m += this.moisture[c]!;
    }
    this.totalVeg = v;
    this.totalCap = k;
    this.meanMoisture = mean ?? m / CELLS;
  }

  // ---- queries used by animals ----
  vegFrac(c: number): number {
    return this.veg[c]! / this.cap[c]!;
  }
  /** Remove up to `kg` from a pool; returns the amount actually obtained. A residual fraction is ungrazeable. */
  consume(pool: Float32Array, c: number, kg: number, floor: number): number {
    const avail = Math.max(0, pool[c]! - floor);
    const got = Math.min(kg, avail);
    pool[c] = pool[c]! - got;
    return got;
  }
  addDetritus(x: number, z: number, kg: number): void {
    const c = this.cellIndex(x, z);
    this.detritus[c] = this.detritus[c]! + kg;
  }

  /** Is there drinkable surface water at this exact point right now? */
  waterHere(x: number, z: number): 0 | 1 | 2 {
    if (this.valley.waterDepth(x, z, this.stage) > 0.04) return 1;
    if (this.dump[this.cellIndex(x, z)]! > 0.1 && this.valley.poolAt(x, z) >= 0) return 2;
    return 0;
  }
  cellHasWater(c: number): boolean {
    return this.poolCell[c] === 1 || this.waterD[c]! + this.stage > 0.08;
  }
  /**
   * Nearest wet cell within `radius` metres, preferring clean water. Bounded scan, no global knowledge.
   * `accept` lets the caller reject water points an animal cannot stand at (inside a ruin, beyond the region margin).
   */
  findWater(x: number, z: number, radius: number, accept?: (x: number, z: number) => boolean): WaterSite | null {
    const r = Math.ceil(radius / CELL);
    const ci = clamp(Math.floor(x / CELL), 0, GRID - 1);
    const cj = clamp(Math.floor(z / CELL), 0, GRID - 1);
    let best = -1;
    let bestScore = 1e18;
    for (let j = Math.max(0, cj - r); j <= Math.min(GRID - 1, cj + r); j++) {
      for (let i = Math.max(0, ci - r); i <= Math.min(GRID - 1, ci + r); i++) {
        const c = j * GRID + i;
        if (!this.cellHasWater(c)) continue;
        const dx = this.waterX[c]! - x;
        const dz = this.waterZ[c]! - z;
        const d2 = dx * dx + dz * dz;
        if (d2 > radius * radius) continue;
        const score = d2 * (this.poolCell[c] ? 6 : 1);
        if (score >= bestScore || (accept && !accept(this.waterX[c]!, this.waterZ[c]!))) continue;
        if (score < bestScore) {
          bestScore = score;
          best = c;
        }
      }
    }
    if (best < 0) return null;
    return { x: this.waterX[best]!, z: this.waterZ[best]!, contaminated: this.poolCell[best] === 1 };
  }

  snapshot(): EnvSnapshot {
    return {
      timeH: this.timeH, weather: this.weather, weatherTimer: this.weatherTimer, cloud: this.cloud, rain: this.rain,
      wind: this.wind, windDir: this.windDir, stage: this.stage, acc: this.acc, temperature: this.temperature, meanMoisture: this.meanMoisture, totalVeg: this.totalVeg, params: { ...this.params },
      veg: this.veg.slice(), moisture: this.moisture.slice(), invert: this.invert.slice(), fauna: this.fauna.slice(),
      detritus: this.detritus.slice(), nutrients: this.nutrients.slice(), contam: this.contam.slice(),
    };
  }
  restore(s: EnvSnapshot): void {
    this.timeH = s.timeH; this.weather = s.weather; this.weatherTimer = s.weatherTimer; this.cloud = s.cloud; this.rain = s.rain;
    this.wind = s.wind; this.windDir = s.windDir; this.stage = s.stage; this.params = { ...s.params };
    this.veg.set(s.veg); this.moisture.set(s.moisture); this.invert.set(s.invert); this.fauna.set(s.fauna);
    this.detritus.set(s.detritus); this.nutrients.set(s.nutrients); this.contam.set(s.contam);
    this.acc = s.acc;
    this.refreshAggregates();
    this.temperature = s.temperature;
    this.meanMoisture = s.meanMoisture;
    this.totalVeg = s.totalVeg;
  }
}
