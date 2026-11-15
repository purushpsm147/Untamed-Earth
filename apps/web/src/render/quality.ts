export type QualityName = 'low' | 'medium' | 'high' | 'ultra';
export interface QualityPreset {
  name: QualityName;
  /** Cap on device pixel ratio. */
  pixelRatio: number;
  shadowMap: number;
  shadowDist: number;
  viewDist: number;
  vegDist: number;
  /** Radius within which trees use the detailed model. */
  treeHiDist: number;
  grassDist: number;
  grassCount: number;
  rain: number;
  waterDetail: boolean;
}
export const QUALITY: Record<QualityName, QualityPreset> = {
  low: { name: 'low', pixelRatio: 1, shadowMap: 0, shadowDist: 0, viewDist: 420, vegDist: 240, treeHiDist: 40, grassDist: 26, grassCount: 1800, rain: 500, waterDetail: false },
  medium: { name: 'medium', pixelRatio: 1.25, shadowMap: 1024, shadowDist: 90, viewDist: 700, vegDist: 400, treeHiDist: 70, grassDist: 40, grassCount: 5000, rain: 1200, waterDetail: true },
  high: { name: 'high', pixelRatio: 1.5, shadowMap: 2048, shadowDist: 140, viewDist: 1100, vegDist: 620, treeHiDist: 110, grassDist: 55, grassCount: 11000, rain: 2200, waterDetail: true },
  ultra: { name: 'ultra', pixelRatio: 2, shadowMap: 4096, shadowDist: 200, viewDist: 1700, vegDist: 900, treeHiDist: 160, grassDist: 75, grassCount: 22000, rain: 3500, waterDetail: true },
};
export const QUALITY_ORDER: QualityName[] = ['low', 'medium', 'high', 'ultra'];

/** What the browser lets us learn about the device. None of it is exact; all of it may be missing or masked. */
export interface HardwareHints {
  mobile: boolean;
  /** navigator.deviceMemory (GB, capped at 8 by browsers) or null where unsupported. */
  memoryGB: number | null;
  cores: number | null;
  /** Physical pixels the canvas would cover at full device pixel ratio. */
  pixels: number;
  /** GPU renderer string, possibly masked or empty. */
  renderer: string;
  /** True when the renderer string names a CPU rasteriser (SwiftShader, llvmpipe, ...). */
  software: boolean;
}

export interface QualityAssessment {
  /** Preset to start on. */
  initial: QualityName;
  /** Highest preset Auto may climb to on this class of device. */
  ceiling: QualityName;
  fps: 30 | 60;
  /** Human-readable basis for the choice (shown in diagnostics; never presented as a measurement). */
  reasons: string[];
}

export const SOFTWARE_RENDERER = /swiftshader|llvmpipe|softpipe|software rasterizer|microsoft basic render/i;

export function readHardwareHints(renderer: string): HardwareHints {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const mobile = /Android|iPhone|iPad|Mobile/i.test(nav.userAgent) || (nav.maxTouchPoints > 1 && Math.min(window.innerWidth, window.innerHeight) < 820);
  const dpr = window.devicePixelRatio || 1;
  return {
    mobile, memoryGB: nav.deviceMemory ?? null, cores: nav.hardwareConcurrency ?? null,
    pixels: Math.round(window.innerWidth * window.innerHeight * dpr * dpr), renderer, software: SOFTWARE_RENDERER.test(renderer),
  };
}

/**
 * Starting point for Auto quality from coarse capability hints. Deliberately conservative: the runtime
 * governor (qualityGovernor.ts) refines it from real frame times within seconds, and Ultra is never
 * chosen automatically. Pure function so the policy is unit-tested.
 */
export function assessQuality(h: HardwareHints): QualityAssessment {
  const reasons: string[] = [];
  if (h.software) {
    reasons.push(`software renderer (${h.renderer || 'unnamed'}): no GPU acceleration`);
    return { initial: 'low', ceiling: 'low', fps: 30, reasons };
  }
  if (h.mobile) {
    const roomy = (h.memoryGB ?? 4) >= 6;
    reasons.push(`mobile-class device${h.memoryGB ? `, ~${h.memoryGB} GB memory hint` : ''}`);
    return { initial: roomy ? 'medium' : 'low', ceiling: 'medium', fps: 30, reasons };
  }
  let initial: QualityName = 'high';
  if ((h.memoryGB ?? 8) <= 4) {
    initial = 'medium';
    reasons.push(`~${h.memoryGB} GB memory hint`);
  }
  if ((h.cores ?? 8) <= 4) {
    initial = 'medium';
    reasons.push(`${h.cores} logical cores`);
  }
  if (/Intel.*(HD|UHD|Iris)/i.test(h.renderer)) {
    initial = 'medium';
    reasons.push('integrated graphics');
  }
  if (h.pixels > 6_000_000) {
    initial = 'medium';
    reasons.push(`${(h.pixels / 1e6).toFixed(1)} MP viewport`);
  }
  if (!reasons.length) reasons.push('desktop-class hints');
  return { initial, ceiling: 'high', fps: 60, reasons };
}
