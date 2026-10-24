import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { analyze } from './analyze.ts';
import { loadRun } from './io.ts';

export function paired(left: Awaited<ReturnType<typeof loadRun>>, right: Awaited<ReturnType<typeof loadRun>>) {
  const fullLeft = analyze(left.plan, left.rows, left.run), fullRight = analyze(right.plan, right.rows, right.run);
  if (left.plan.id !== right.plan.id) throw new Error('Matched model comparison requires the exact same plan');
  const success = new Set(right.rows.filter(r => r.status === 'ok').map(r => r.exampleId));
  const ids = new Set(left.rows.filter(r => r.status === 'ok' && success.has(r.exampleId)).map(r => r.exampleId));
  const metrics = (capture: typeof left) => {
    const r = analyze(capture.plan, capture.rows.filter(row => ids.has(row.exampleId)), capture.run);
    // Do not mislabel observations excluded by pairing as unattempted requests.
    return { classification: r.classification, eventProbability: r.eventProbability, binaryDiscrimination: r.binaryDiscrimination, categoricalDistribution: r.categoricalDistribution, topLabelCalibration: r.topLabelCalibration, ordinal: r.ordinal, selective: r.selective };
  };
  return {
    kind: 'PAIRED MODEL COMPARISON', planId: left.plan.id, paired: ids.size, planned: left.plan.examples.length,
    limitations: ['Predictive comparison is conditional on both models returning valid answers; consult full failure counts.', 'No significance claim. Runs may have occurred at different times; latency is descriptive.', 'LLM generated probabilities are not token probabilities.'],
    full: { left: fullLeft, right: fullRight },
    pairedCases: { left: metrics(left), right: metrics(right) },
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const flags = new Map<string, string>();
  for (const arg of process.argv.slice(2)) {
    const m = /^--(left|right|out)=(.+)$/.exec(arg);
    if (!m || flags.has(m[1])) throw new Error('Use --left=<run> --right=<run> [--out=<new.json>]');
    flags.set(m[1], m[2]);
  }
  if (!flags.has('left') || !flags.has('right')) throw new Error('--left and --right are required');
  const output = JSON.stringify(paired(await loadRun(flags.get('left')!), await loadRun(flags.get('right')!)), null, 2) + '\n';
  if (flags.has('out')) await writeFile(flags.get('out')!, output, { flag: 'wx' }); else process.stdout.write(output);
}
