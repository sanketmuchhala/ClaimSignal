import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { fraudMetrics } from '../benchmarks/fraud-metrics.ts';
import { quantile, seededRandom } from '../benchmarks/paired-stats.ts';
import { analyze } from './analyze.ts';
import { baselines } from './baselines.ts';
import { loadRun } from './io.ts';
import { normalized, ordinalMetrics, probabilityMetrics } from './metrics.ts';
import { hash } from './plan.ts';
import type { Plan } from './types.ts';

type Capture = Awaited<ReturnType<typeof loadRun>>;
type Kind = 'binary' | 'category' | 'ordinal';
// One evaluable answer per claim, in the units its metrics use.
export type CaseValue =
  | { kind: 'binary'; probability: number; outcome: 0 | 1 }
  | { kind: 'category'; probabilities: Record<string, number>; choice: string; target: string }
  | { kind: 'ordinal'; score: number; probabilities: Record<string, number> | null; target: number };
export interface Interval { estimate: number | null; low: number | null; high: number | null; undefinedResamples: number }

const MAX_UNDEFINED_SHARE = 0.01;

// Percentile bootstrap that resamples whole groups. Claims sharing a group (identical allowed features, or
// repeats/transformations of one claim) always enter a resample together, so they never count as independent.
export function groupBootstrap<T extends { group: string }>(items: readonly T[], evaluate: (sample: readonly T[]) => Record<string, number | null>, resamples = 2000, seed = 20261024): Record<string, Interval> {
  if (!items.length) throw new Error('Bootstrap needs at least one claim');
  if (!Number.isSafeInteger(resamples) || resamples < 100) throw new Error('Use at least 100 resamples');
  const byGroup = new Map<string, T[]>();
  for (const item of items) { const members = byGroup.get(item.group); if (members) members.push(item); else byGroup.set(item.group, [item]); }
  const clusters = [...byGroup.values()], random = seededRandom(seed);
  const estimates = evaluate(items);
  const draws: Record<string, number[]> = Object.fromEntries(Object.keys(estimates).map(k => [k, []]));
  for (let r = 0; r < resamples; r++) {
    const sample: T[] = [];
    for (let i = 0; i < clusters.length; i++) sample.push(...clusters[Math.floor(random() * clusters.length)]);
    for (const [key, value] of Object.entries(evaluate(sample))) if (value !== null && key in draws) draws[key].push(value);
  }
  return Object.fromEntries(Object.entries(estimates).map(([key, estimate]) => {
    const values = draws[key].sort((a, b) => a - b), undefinedResamples = resamples - values.length;
    // A resample without a positive outcome has no ROC-AUC. Dropping many such draws would condition the interval.
    const usable = estimate !== null && undefinedResamples <= resamples * MAX_UNDEFINED_SHARE;
    return [key, { estimate, low: usable ? quantile(values, 0.025) : null, high: usable ? quantile(values, 0.975) : null, undefinedResamples }];
  }));
}

const keys: Record<Kind, string[]> = {
  binary: ['brier', 'logLoss', 'accuracy', 'rocAuc', 'averagePrecision'],
  category: ['accuracy', 'brierSumOverClasses', 'logLoss'],
  ordinal: ['mae', 'normalizedRankedProbabilityScore'],
};
// Same definitions as analyze(): fixed 0.5 threshold with ties positive, 1e-15 log-loss floor, normalized distributions.
export function caseMetrics(kind: Kind, values: readonly CaseValue[]): Record<string, number | null> {
  if (!values.length) return Object.fromEntries(keys[kind].map(k => [k, null]));
  if (kind === 'binary') {
    const v = values as Extract<CaseValue, { kind: 'binary' }>[];
    const p = probabilityMetrics(v.map(x => ({ probability: x.probability, outcome: x.outcome })));
    const ranking = fraudMetrics(v.map(x => ({ label: x.outcome, score: x.probability })));
    return { brier: p.brier, logLoss: p.logLoss, accuracy: v.filter(x => Number(x.probability >= 0.5) === x.outcome).length / v.length, rocAuc: ranking.rocAuc, averagePrecision: ranking.averagePrecision };
  }
  if (kind === 'category') {
    const v = values as Extract<CaseValue, { kind: 'category' }>[];
    return {
      accuracy: v.filter(x => x.choice === x.target).length / v.length,
      brierSumOverClasses: v.reduce((s, x) => s + Object.entries(x.probabilities).reduce((t, [k, p]) => t + (p - Number(k === x.target)) ** 2, 0), 0) / v.length,
      logLoss: v.reduce((s, x) => s - Math.log(Math.max(1e-15, x.probabilities[x.target])), 0) / v.length,
    };
  }
  const v = values as Extract<CaseValue, { kind: 'ordinal' }>[];
  const withDistribution = v.every(x => x.probabilities) ? ordinalMetrics(v.map(x => ({ score: x.score, probabilities: x.probabilities!, target: x.target }))) : null;
  return { mae: v.reduce((s, x) => s + Math.abs(x.score - x.target), 0) / v.length, normalizedRankedProbabilityScore: withDistribution?.normalizedRankedProbabilityScore ?? null };
}

const kindOf = (plan: Plan): Kind => plan.task.question.type === 'score' ? 'ordinal' : plan.examples[0].target.kind === 'binary' ? 'binary' : 'category';

// analyze() verifies identity, re-parses every raw response and rejects edited answers before any value is used.
export function caseValues(capture: Capture): Map<string, CaseValue> {
  analyze(capture.plan, capture.rows, capture.run);
  const { plan } = capture, examples = new Map(plan.examples.map(e => [e.id, e]));
  return new Map(capture.rows.filter(r => r.status === 'ok').map(row => {
    const a = row.answer!, target = examples.get(row.exampleId)!.target;
    let value: CaseValue;
    if (a.type === 'score') value = { kind: 'ordinal', score: a.score, probabilities: a.probabilities, target: target.value as number };
    else if (target.kind === 'binary') value = { kind: 'binary', probability: a.type === 'noul' ? a.noul : normalized(a.probabilities)[plan.task.positiveOption!], outcome: target.value };
    else if (a.type === 'choice') value = { kind: 'category', probabilities: normalized(a.probabilities), choice: a.choice, target: target.value as string };
    else throw new Error('Unsupported answer and target combination');
    return [row.exampleId, value];
  }));
}

// Claims must be identical, and one plan's claims must be the first claims of the other in the shared order.
function sharedClaims(left: Plan, right: Plan) {
  if (left.dataset.sha256 !== right.dataset.sha256 || left.dataset.split !== right.dataset.split || left.selection !== right.selection || kindOf(left) !== kindOf(right)) throw new Error('Runs must evaluate the same dataset, split, selection and target kind');
  const shorter = left.examples.length <= right.examples.length ? left : right, longer = shorter === left ? right : left;
  shorter.examples.forEach((e, i) => {
    const other = longer.examples[i];
    if (other.id !== e.id || other.group !== e.group || hash(other.state) !== hash(e.state) || hash(other.target) !== hash(e.target)) throw new Error('Runs must evaluate the same claims: one plan must be a prefix of the other');
  });
  return shorter.examples;
}

const difference = (a: Record<string, number | null>, b: Record<string, number | null>) => Object.fromEntries(Object.keys(a).map(k => [k, a[k] === null || b[k] === null ? null : a[k]! - b[k]!]));
const prefix = (name: string, values: Record<string, number | null>) => Object.fromEntries(Object.entries(values).map(([k, v]) => [`${name}.${k}`, v]));
const split = (intervals: Record<string, Interval>, name: string) => Object.fromEntries(Object.entries(intervals).filter(([k]) => k.startsWith(`${name}.`)).map(([k, v]) => [k.slice(name.length + 1), v]));

export async function uncertainty(left: Capture, right: Capture | null = null, resamples = 2000, seed = 20261024) {
  const { plan } = left, kind = kindOf(plan), report = analyze(plan, left.rows, left.run), values = caseValues(left);
  const baseline = plan.task.dataset === 'vehicle' && !plan.variant && plan.dataset.split !== 'train' ? await baselines(plan) : null;
  const baselineValues = new Map((baseline?.methods ?? []).map(m => [m.method, new Map(m.predictions.map(p => [p.exampleId, (kind === 'ordinal'
    ? { kind: 'ordinal', score: p.value, probabilities: null, target: p.target } : { kind: 'binary', probability: p.value, outcome: p.target as 0 | 1 }) as CaseValue]))]));
  const units = plan.examples.map(e => ({ id: e.id, group: e.group }));
  // One bootstrap, so the model and every baseline see the same resampled claims in each draw.
  const single = groupBootstrap(units, sample => {
    const answered = sample.filter(u => values.has(u.id)), model = caseMetrics(kind, answered.map(u => values.get(u.id)!));
    const out: Record<string, number | null> = { 'model.answeredShare': answered.length / sample.length, ...prefix('model', model) };
    for (const [method, predictions] of baselineValues) {
      const matched = caseMetrics(kind, answered.map(u => predictions.get(u.id)!));
      Object.assign(out, prefix(`${method}.onAnswered`, matched), prefix(`${method}.modelMinusBaseline`, difference(model, matched)));
    }
    return out;
  }, resamples, seed);
  const answered = plan.examples.filter(e => values.has(e.id));
  const positives = kind === 'binary' ? answered.filter(e => e.target.value === 1).length : null;
  const warnings: string[] = [...report.sampleWarnings];
  const groups = new Set(plan.examples.map(e => e.group)).size;
  if (groups < 30) warnings.push(`Only ${groups} claim groups: percentile intervals are unreliable this small.`);
  if (positives !== null && positives < 10) warnings.push(`Only ${positives} answered positive outcomes: ROC-AUC and average-precision intervals are very wide or omitted.`);
  if (plan.task.dataset === 'synthetic') warnings.push('Synthetic smoke: intervals describe resampling of authored fixtures, not any claims population.');

  let against = null;
  if (right) {
    const otherReport = analyze(right.plan, right.rows, right.run), otherValues = caseValues(right), shared = sharedClaims(plan, right.plan);
    const sharedUnits = shared.map(e => ({ id: e.id, group: e.group }));
    const paired = groupBootstrap(sharedUnits, sample => {
      const both = sample.filter(u => values.has(u.id) && otherValues.has(u.id));
      const a = caseMetrics(kind, both.map(u => values.get(u.id)!)), b = caseMetrics(kind, both.map(u => otherValues.get(u.id)!));
      const shareA = sample.filter(u => values.has(u.id)).length / sample.length, shareB = sample.filter(u => otherValues.has(u.id)).length / sample.length;
      return { 'answeredShare.left': shareA, 'answeredShare.right': shareB, 'answeredShare.leftMinusRight': shareA - shareB, ...prefix('left', a), ...prefix('right', b), ...prefix('leftMinusRight', difference(a, b)) };
    }, resamples, seed);
    const both = shared.filter(e => values.has(e.id) && otherValues.has(e.id));
    against = {
      left: { planId: plan.id, task: plan.task.id, adapter: left.run.adapter ?? 'jev', resolvedModel: report.resolvedModel },
      right: { planId: right.plan.id, task: right.plan.task.id, adapter: right.run.adapter ?? 'jev', resolvedModel: otherReport.resolvedModel },
      samePlan: plan.id === right.plan.id,
      counts: { sharedPlanned: shared.length, bothAnswered: both.length, groupsBothAnswered: new Set(both.map(e => e.group)).size, ...(kind === 'binary' ? { positivesBothAnswered: both.filter(e => e.target.value === 1).length } : {}) },
      answeredShare: split(paired, 'answeredShare'),
      onBothAnswered: { left: split(paired, 'left'), right: split(paired, 'right'), leftMinusRight: split(paired, 'leftMinusRight') },
    };
    if (right.run.provenance === 'test-double') warnings.push('Comparison run is a test double, not model performance.');
  }
  return {
    schemaVersion: 1,
    kind: left.run.provenance === 'test-double' ? 'TEST DOUBLE — NOT MODEL PERFORMANCE' : 'GROUPED BOOTSTRAP INTERVALS',
    planId: plan.id, task: plan.task.id, dataset: plan.dataset, adapter: left.run.adapter ?? 'jev', resolvedModel: report.resolvedModel,
    method: {
      interval: '95% percentile bootstrap', resamples, seed,
      unit: 'Claim group: claims with identical allowed features resample together; synthetic fixtures are their own groups.',
      undefinedResamples: `Interval omitted when the statistic is undefined in more than ${MAX_UNDEFINED_SHARE * 100}% of resamples, for example a resample without a positive outcome.`,
      pairing: 'Differences are computed on the same resampled claims in each draw, restricted to claims both sides answered.',
    },
    counts: { planned: plan.examples.length, groups, answered: answered.length, ...(positives !== null ? { answeredPositives: positives } : {}) },
    warnings,
    model: Object.assign({ answeredShare: single['model.answeredShare'] }, split(single, 'model')),
    baselines: baseline ? Object.fromEntries(baseline.methods.map(m => [m.method, { onModelAnswered: split(single, `${m.method}.onAnswered`), modelMinusBaseline: split(single, `${m.method}.modelMinusBaseline`) }])) : null,
    against,
    limitations: [
      'Intervals describe sampling variability across these claims, not run-to-run model variation: there is one call per claim.',
      'No adjustment for multiple comparisons. Treat intervals that exclude zero as descriptive, not as significance tests.',
      'Percentile intervals undercover with few groups or rare positives; counts are reported for that reason.',
      'Metrics exclude failed and unattempted calls; answeredShare reports that coverage separately.',
    ],
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const flags = new Map<string, string>();
  for (const arg of process.argv.slice(2)) {
    const m = /^--(run|against|resamples|seed|out)=(.+)$/.exec(arg);
    if (!m || flags.has(m[1])) throw new Error('Use --run=<directory> [--against=<directory>] [--resamples=2000] [--seed=20261024] [--out=<new.json>]');
    flags.set(m[1], m[2]);
  }
  if (!flags.has('run')) throw new Error('--run is required; this makes no model calls');
  const resamples = Number(flags.get('resamples') ?? 2000), seed = Number(flags.get('seed') ?? 20261024);
  if (!Number.isSafeInteger(seed)) throw new Error('--seed must be an integer');
  const result = await uncertainty(await loadRun(flags.get('run')!), flags.has('against') ? await loadRun(flags.get('against')!) : null, resamples, seed);
  const output = JSON.stringify(result, null, 2) + '\n';
  if (flags.has('out')) await writeFile(flags.get('out')!, output, { flag: 'wx' }); else process.stdout.write(output);
}
