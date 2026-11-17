/**
 * Paired-seed comparison of two variants (same seeds, identical weather per seed): per-seed outcomes, extinction
 * transitions, and two-sided sign tests, instead of comparing medians of independent samples.
 *   node --import tsx benchmarks/ecology-paired.ts <variantA> <variantB> --dir <diag dir> [--json out.json]
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (k: string): string | undefined => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : undefined);
const dir = opt('dir') ?? 'docs/evidence/ecology';
const [va, vb] = args.filter((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
const SP = ['chital', 'boar', 'jackal', 'hare', 'crow', 'myna'];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function load(v: string): Map<number, any> {
  const m = new Map();
  for (const f of readdirSync(dir)) {
    if (!f.startsWith(`diag-${v}-dt2-d365`) || !f.endsWith('.json')) continue;
    const j = JSON.parse(readFileSync(`${dir}/${f}`, 'utf8'));
    if (j.meta.variant !== v) continue;
    for (const r of j.runs) m.set(r.seed, r);
  }
  return m;
}
const A = load(va!);
const B = load(vb!);
const seeds = [...A.keys()].filter((s) => B.has(s)).sort((x, y) => x - y);
/** Two-sided exact sign test p-value for `plus` increases and `minus` decreases (ties dropped). */
function signP(plus: number, minus: number): number {
  const n = plus + minus;
  if (n === 0) return 1;
  const k = Math.min(plus, minus);
  let c = 1;
  let tail = 0;
  for (let i = 0; i <= n; i++) {
    if (i <= k) tail += c;
    c = (c * (n - i)) / (i + 1);
  }
  return Math.min(1, (2 * tail) / 2 ** n);
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const metrics: Record<string, (r: any) => number> = Object.fromEntries([
  ...SP.map((s, i) => [`end ${s}`, (r: { endPops: number[] }) => r.endPops[i]!]),
  ...SP.map((s, i) => [`min ${s} after day 30`, (r: { days: { day: number; pops: number[] }[] }) => Math.min(...[...r.days].sort((a, b) => a.day - b.day).slice(30).map((d) => d.pops[i]!))]),
  ['kills', (r: { summary: { hunting: { kills: number } } }) => r.summary.hunting.kills],
  ['kills per jackal-day', (r: { summary: { hunting: { kills: number } }; days: { pops: number[] }[] }) => r.summary.hunting.kills / Math.max(1, r.days.reduce((t, d) => t + d.pops[2]!, 0))],
  ['jackal-days', (r: { days: { pops: number[] }[] }) => r.days.reduce((t, d) => t + d.pops[2]!, 0)],
  ...SP.map((s) => [`dehydration ${s}`, (r: { summary: { deaths: Record<string, { dehydration: number }> } }) => r.summary.deaths[s]!.dehydration]),
  ...SP.map((s) => [`starvation ${s}`, (r: { summary: { deaths: Record<string, { starvation: number }> } }) => r.summary.deaths[s]!.starvation]),
]);
const out: Record<string, unknown> = { a: va, b: vb, seeds, metrics: {}, extinction: {} };
console.log(`paired ${va} -> ${vb}, seeds ${seeds.join(',')}`);
for (const [name, f] of Object.entries(metrics)) {
  const d = seeds.map((s) => [f(A.get(s)), f(B.get(s))] as const);
  const plus = d.filter(([x, y]) => y > x).length;
  const minus = d.filter(([x, y]) => y < x).length;
  const med = (xs: number[]): number => { const t = [...xs].sort((p, q) => p - q); return t.length % 2 ? t[t.length >> 1]! : (t[t.length / 2 - 1]! + t[t.length / 2]!) / 2; };
  const row = { medianA: +med(d.map((x) => x[0])).toFixed(3), medianB: +med(d.map((x) => x[1])).toFixed(3), medianDiff: +med(d.map(([x, y]) => y - x)).toFixed(3), higherInB: plus, lowerInB: minus, ties: seeds.length - plus - minus, signTestP: +signP(plus, minus).toFixed(3), perSeed: Object.fromEntries(seeds.map((s, i) => [s, d[i]])) };
  (out.metrics as Record<string, unknown>)[name] = row;
  console.log(`${name.padEnd(26)} median ${row.medianA} -> ${row.medianB} (paired median diff ${row.medianDiff}); higher in B ${plus}, lower ${minus}, ties ${row.ties}; sign test p ${row.signTestP}`);
}
for (const [i, s] of SP.entries()) {
  const lost = seeds.filter((k) => A.get(k).endPops[i] > 0 && B.get(k).endPops[i] === 0);
  const rescued = seeds.filter((k) => A.get(k).endPops[i] === 0 && B.get(k).endPops[i] > 0);
  const p = signP(rescued.length, lost.length);
  (out.extinction as Record<string, unknown>)[s] = { extinctA: seeds.filter((k) => A.get(k).endPops[i] === 0).length, extinctB: seeds.filter((k) => B.get(k).endPops[i] === 0).length, newlyExtinctSeeds: lost, rescuedSeeds: rescued, signTestP: +p.toFixed(3) };
  console.log(`extinction ${s.padEnd(7)} ${va}: ${seeds.filter((k) => A.get(k).endPops[i] === 0).length}/${seeds.length} -> ${vb}: ${seeds.filter((k) => B.get(k).endPops[i] === 0).length}/${seeds.length}; newly extinct in seeds [${lost}], rescued in [${rescued}]; p ${p.toFixed(3)}`);
}
const jo = opt('json');
if (jo) writeFileSync(jo, JSON.stringify(out, null, 1));
