#!/usr/bin/env node
/**
 * Analyze independent, counterbalanced four-run animal-upload A/B blocks.
 *
 * Usage: node benchmarks/analyze-animal-upload-ab.mjs ./reports/amd
 * Each block is ABBA or BAAB, ordered by JSON startedAt; A = full, B = active.
 * Individual frames are correlated and are NOT treated as replicates.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const directory = process.argv[2];
if (!directory) {
  console.error('Usage: node benchmarks/analyze-animal-upload-ab.mjs <directory-with-High-only-JSON-reports>');
  process.exit(2);
}
const mean = (values) => values.reduce((s, v) => s + v, 0) / values.length;
const round = (x, n = 2) => Number(x.toFixed(n));
function quantile(items, q) {
  const s = [...items].sort((a, b) => a - b);
  const x = (s.length - 1) * q;
  const i = Math.floor(x);
  return s[i] + (s[Math.min(i + 1, s.length - 1)] - s[i]) * (x - i);
}
// Fixed-seed bootstrap, reproducible across machines and reruns.
let rng = 0x5f3759df;
function rand() {
  rng ^= rng << 13;
  rng ^= rng >>> 17;
  rng ^= rng << 5;
  return (rng >>> 0) / 0x100000000;
}
function uncertainty(differences) {
  const n = differences.length;
  const observed = mean(differences);
  const boot = [];
  for (let i = 0; i < 20000; i++) {
    let s = 0;
    for (let j = 0; j < n; j++) s += differences[Math.floor(rand() * n)];
    boot.push(s / n);
  }
  let extreme = 0;
  const choices = 2 ** n;
  for (let mask = 0; mask < choices; mask++) {
    let signed = 0;
    for (let j = 0; j < n; j++) signed += (mask & (2 ** j)) ? differences[j] : -differences[j];
    if (Math.abs(signed / n) >= Math.abs(observed) - 1e-10) extreme++;
  }
  return {
    meanImprovementPct: round(observed),
    ci95Pct: [round(quantile(boot, 0.025)), round(quantile(boot, 0.975))],
    twoSidedSignFlipP: round(extreme / choices, 5),
  };
}
const profiles = readdirSync(directory)
  .filter((f) => f.toLowerCase().endsWith('.json'))
  .map((filename) => ({ filename, report: JSON.parse(readFileSync(join(directory, filename), 'utf8')) }))
  .filter(({ report }) => report.profileKind === 'animal-upload-ab-high');

if (!profiles.length) {
  console.error('No new High-only A/B reports found. Legacy full profiles are descriptive evidence, not paired replicates.');
  process.exit(2);
}
const groups = new Map();
for (const entry of profiles) {
  const r = entry.report;
  const mode = r.animalUploadExperiment;
  const h = r.presets?.high;
  if (!['full', 'active'].includes(mode) || !h || !Number.isFinite(h.renderMs) || !Number.isFinite(r.seed)) {
    throw new Error('Invalid A/B report: ' + entry.filename);
  }
  if (h.animalUploads?.totalDropped !== 0) {
    throw new Error('Rendered animals dropped in ' + entry.filename + '; this report cannot measure parity.');
  }
  const key = JSON.stringify({
    gpu: r.device?.gpu,
    seed: r.seed,
    world: r.worldId,
    viewport: r.device?.viewport,
    dpr: r.device?.devicePixelRatio,
  });
  const group = groups.get(key) ?? [];
  group.push(entry);
  groups.set(key, group);
}
for (const [key, entries] of groups) {
  entries.sort((a, b) => Date.parse(a.report.startedAt) - Date.parse(b.report.startedAt));
  const metadata = JSON.parse(key);
  console.log('\nGPU:', metadata.gpu);
  console.log('Seed:', metadata.seed, 'world:', metadata.world,
    'viewport:', JSON.stringify(metadata.viewport), 'DPR:', metadata.dpr);

  const completedBlocks = Math.floor(entries.length / 4);
  if (entries.length % 4) console.log('Incomplete trailing block:', entries.length % 4, 'run(s) excluded.');
  const blocks = [];
  for (let i = 0; i < completedBlocks; i++) {
    const block = entries.slice(i * 4, i * 4 + 4);
    const order = block.map((x) => x.report.animalUploadExperiment === 'full' ? 'A' : 'B').join('');
    if (order !== 'ABBA' && order !== 'BAAB') {
      throw new Error('Block ' + (i + 1) + ' has order ' + order + ', expected ABBA or BAAB.');
    }
    const low = Math.min(...block.map((x) => x.report.presets.high.animalUploads?.averageVisible ?? Infinity));
    const high = Math.max(...block.map((x) => x.report.presets.high.animalUploads?.averageVisible ?? -Infinity));
    if (!Number.isFinite(low) || low === 0 || high / low > 1.05) {
      throw new Error('Block ' + (i + 1) + ' differs by >5% in rendered animal counts; control the seed and start state.');
    }
    blocks.push(block);
  }
  console.log('Complete counterbalanced blocks:', blocks.length,
    '(each has two independently relaunched A runs and two B runs).');
  if (!blocks.length) continue;

  for (const [label, keyName] of [
    ['render CPU (PRIMARY)', 'renderMs'],
    ['p95 frame time', 'p95'],
    ['p99 frame time', 'p99'],
    ['average FPS', 'fps'],
  ]) {
    const improvements = blocks.map((block) => {
      const a = mean(block.filter((x) => x.report.animalUploadExperiment === 'full')
        .map((x) => x.report.presets.high[keyName]));
      const b = mean(block.filter((x) => x.report.animalUploadExperiment === 'active')
        .map((x) => x.report.presets.high[keyName]));
      return keyName === 'fps' ? 100 * (b - a) / a : 100 * (a - b) / a;
    });
    console.log(label + ':', JSON.stringify(uncertainty(improvements)));
    if (keyName === 'renderMs') {
      if (blocks.length < 8) {
        console.log('DECISION: collect at least 8 independent blocks; no inferential decision yet.');
      } else {
        const stats = uncertainty(improvements);
        const [lo, hi] = stats.ci95Pct;
        if (stats.meanImprovementPct >= 5 && lo > 0 && stats.twoSidedSignFlipP < 0.05) {
          console.log('DECISION: evidence supports a practically meaningful CPU improvement (subject to no visual/secondary regression).');
        } else if (hi < 5) {
          console.log('DECISION: evidence does not support the prespecified 5% minimum meaningful gain; recommend closing the experiment.');
        } else if (blocks.length >= 10) {
          console.log('DECISION: inconclusive after 10 blocks; stop collecting and close the experiment unless there is a new, prespecified hypothesis.');
        } else {
          console.log('DECISION: inconclusive; collect up to 10 blocks maximum.');
        }
      }
    }
  }
}
console.log('\nStatistical caveat: bootstrap CIs and sign-flip tests describe between-block variation under stable device conditions.');
console.log('They cannot correct thermal drift, hidden browser load, or changes in camera/animal counts. Analyze each GPU separately.');
