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

/** First-visit guess from coarse device signals; the adaptive controller refines it at runtime. */
export function guessQuality(): QualityName {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const mobile = /Android|iPhone|iPad|Mobile/i.test(nav.userAgent) || (nav.maxTouchPoints > 1 && window.innerWidth < 1000);
  const mem = nav.deviceMemory ?? 8;
  if (mobile) return mem >= 6 ? 'medium' : 'low';
  if (mem <= 4 || (nav.hardwareConcurrency ?? 8) <= 4) return 'medium';
  return 'high';
}
