import { fraudMetrics } from '../benchmarks/fraud-metrics.ts';
import { hash, requestFor, verifyPlan } from './plan.ts';
import { parseAnswer } from './jev.ts';
import { normalized, ordinalMetrics, probabilityMetrics, reliability, selectiveCurve } from './metrics.ts';
import type { Observation, Plan } from './types.ts';
import type { ProbabilityObservation, SelectiveObservation } from './metrics.ts';

export interface RunMetadata {
  schemaVersion: 1; planId: string; provenance: 'live-provider' | 'test-double';
  requestedModel: string; codeRevision: string; workingTreeDirty: boolean;
}
export function analyze(plan: Plan, rows: Observation[], run: RunMetadata) {
  verifyPlan(plan);
  if (run.schemaVersion !== 1 || run.planId !== plan.id || !['live-provider', 'test-double'].includes(run.provenance) || typeof run.requestedModel !== 'string' || !run.requestedModel || typeof run.codeRevision !== 'string' || typeof run.workingTreeDirty !== 'boolean') throw new Error('Run metadata mismatch');
  const examples = new Map(plan.examples.map(e => [e.id, e]));
  const seen = new Set<string>();
  const event: ProbabilityObservation[] = [], top: ProbabilityObservation[] = [];
  const selective: SelectiveObservation[] = [], vendor: SelectiveObservation[] = [];
  const ordinal: Array<{ score: number; probabilities: Record<string, number>; target: number }> = [];
  const models = new Set<string>();
  const errors: Array<{ exampleId: string; status: string; error: string | null }> = [];
  const cases: Array<Record<string, unknown>> = [];
  let multiclassBrier = 0, multiclassLogLoss = 0, normalizationCount = 0, correct = 0, successes = 0;
  for (const row of rows) {
    const example = examples.get(row.exampleId);
    if (!example || row.schemaVersion !== 1 || row.planId !== plan.id || row.requestHash !== hash(requestFor(plan.task, example)) || seen.has(row.exampleId) || row.requestedModel !== run.requestedModel) throw new Error('Observation identity mismatch or duplicate claim');
    if (!Number.isFinite(row.latencyMs) || row.latencyMs < 0 || !Number.isFinite(Date.parse(row.startedAt))) throw new Error('Invalid timing metadata');
    seen.add(row.exampleId);
    if (row.status !== 'ok') {
      if (!['provider-error', 'invalid-response'].includes(row.status) || row.answer !== null) throw new Error('Invalid failure observation');
      errors.push({ exampleId: row.exampleId, status: row.status, error: row.error });
      continue;
    }
    // Re-parse the source response rather than trusting a cached, potentially edited prediction.
    const parsed = parseAnswer(row.raw, plan.task.question);
    if (hash(parsed.answer) !== hash(row.answer) || parsed.resolvedModel !== row.resolvedModel || hash(parsed.usage) !== hash(row.usage)) throw new Error('Stored answer differs from raw response');
    models.add(parsed.resolvedModel); successes++;
    const a = parsed.answer, target = example.target;
    if (a.type !== 'noul' && Math.abs(Object.values(a.probabilities).reduce((s, p) => s + p, 0) - 1) > 1e-12) normalizationCount++;
    if (a.type === 'score') {
      if (target.kind !== 'ordinal') throw new Error('Score requires ordinal ground truth');
      ordinal.push({ score: a.score, probabilities: a.probabilities, target: target.value });
      vendor.push({ confidence: a.confidence, loss: Math.abs(a.score - target.value) });
      cases.push({ exampleId: example.id, target, score: a.score, absoluteError: Math.abs(a.score - target.value), vendorConfidence: a.confidence });
    } else {
      let probability: number, outcome: 0 | 1, predicted: string | number;
      if (a.type === 'noul' || target.kind === 'binary') {
        if (target.kind !== 'binary') throw new Error('Noul requires binary ground truth');
        if (a.type === 'choice' && (!plan.task.positiveOption || !Object.hasOwn(a.probabilities, plan.task.positiveOption) || Object.keys(a.probabilities).length !== 2)) throw new Error('Binary choice requires two options and an explicit positive option');
        const p = a.type === 'noul' ? a.noul : normalized(a.probabilities)[plan.task.positiveOption!];
        event.push({ probability: p, outcome: target.value });
        // Common fixed threshold makes choice and Noul comparable, including ties at 0.5.
        predicted = Number(p >= 0.5);
        outcome = Number(predicted === target.value) as 0 | 1;
        probability = predicted ? p : 1 - p;
      } else {
        if (target.kind !== 'category') throw new Error('Choice requires categorical or binary ground truth');
        const p = normalized(a.probabilities);
        if (!Object.hasOwn(p, target.value)) throw new Error('Ground-truth category outside options');
        predicted = a.choice; probability = p[a.choice]; outcome = Number(a.choice === target.value) as 0 | 1;
        multiclassBrier += Object.entries(p).reduce((s, [k, v]) => s + (v - Number(k === target.value)) ** 2, 0);
        multiclassLogLoss -= Math.log(Math.max(1e-15, p[target.value]));
      }
      correct += outcome;
      top.push({ probability, outcome });
      selective.push({ confidence: probability, loss: 1 - outcome, ...(target.kind === 'binary' ? { positive: target.value === 1 } : {}) });
      if (a.type === 'choice') vendor.push({ ...selective.at(-1)!, confidence: a.confidence });
      cases.push({ exampleId: example.id, target, predicted, correct: !!outcome, predictedClassProbability: probability, ...(a.type === 'choice' ? { vendorConfidence: a.confidence, rawChoice: a.choice } : {}) });
    }
  }
  if (models.size > 1) throw new Error('Resolved model changed within run; split runs before analysis');
  const planned = plan.examples.length, isScore = plan.task.question.type === 'score';
  const latency = rows.map(r => r.latencyMs).sort((a, b) => a - b);
  const q = (p: number) => latency.length ? latency[Math.max(0, Math.ceil(p * latency.length) - 1)] : null;
  const knownUsage = rows.flatMap(r => r.usage ? [r.usage] : []);
  const targetCounts = (ids: string[]) => ids.reduce<Record<string, number>>((counts, id) => {
    const key = String(examples.get(id)!.target.value); counts[key] = (counts[key] ?? 0) + 1; return counts;
  }, {});
  const plannedTargetCounts = targetCounts(plan.examples.map(e => e.id));
  const evaluatedTargetCounts = targetCounts(rows.filter(r => r.status === 'ok').map(r => r.exampleId));
  const sampleWarnings: string[] = [];
  if (plan.examples[0].target.kind === 'binary' && (!evaluatedTargetCounts['0'] || !evaluatedTargetCounts['1'])) sampleWarnings.push('Evaluated sample lacks a binary class: ROC-AUC is undefined and accuracy cannot establish discrimination.');
  if (plan.task.question.type === 'score') {
    const missing = plan.task.question.criteria.map((_, i) => String(i)).filter(k => !evaluatedTargetCounts[k]);
    if (missing.length) sampleWarnings.push(`Rubric levels absent from evaluated sample: ${missing.join(', ')}. Performance on these levels is untested.`);
  }
  return {
    schemaVersion: 1,
    kind: run.provenance === 'test-double' ? 'TEST DOUBLE — NOT MODEL PERFORMANCE' : plan.kind,
    planId: plan.id, task: plan.task, dataset: plan.dataset, run,
    resolvedModel: [...models][0] ?? null,
    plannedTargetCounts, evaluatedTargetCounts, sampleWarnings,
    counts: { planned, attempted: rows.length, succeeded: successes, failed: errors.length, unattempted: planned - rows.length, uniqueFeatureGroups: new Set(plan.examples.map(e => e.group)).size },
    limitations: [...plan.task.limitations, 'Descriptive statistics only; no uncertainty intervals or threshold tuning.', 'Calibration and distribution metrics exclude failed/unattempted calls; coverage uses all planned claims.', 'Confidence ties are accepted together. Curves are exploratory, not a validated routing policy.', 'Class imbalance can make accuracy and overall calibration misleading; inspect prevalence and per-bin counts.'],
    metricConventions: { distributionNormalization: 'Divide validated rounded probabilities by their sum for metrics only; raw responses unchanged.', normalizedDistributions: normalizationCount, binaryThreshold: 0.5, logLossProbabilityFloor: 1e-15, vendorConfidence: 'Distribution statistic used for ranking only; never interpreted as correctness probability.', ordinalLoss: 'Absolute error in original rubric units; score is not an event probability.' },
    classification: isScore ? null : { accuracyOnSuccessful: successes ? correct / successes : null, correctPerPlanned: correct / planned },
    eventProbability: isScore ? null : event.length ? probabilityMetrics(event) : null,
    binaryDiscrimination: event.length ? fraudMetrics(event.map(s => ({ label: s.outcome, score: s.probability }))) : null,
    categoricalDistribution: !isScore && !event.length && successes ? { brierSumOverClasses: multiclassBrier / successes, logLoss: multiclassLogLoss / successes } : null,
    topLabelCalibration: isScore ? null : reliability(top),
    ordinal: isScore ? ordinalMetrics(ordinal) : null,
    selective: { loss: isScore ? 'absolute rubric error' : 'classification error', byPredictedClassProbability: isScore ? null : selectiveCurve(selective, planned), byVendorConfidence: plan.task.question.type === 'noul' ? null : selectiveCurve(vendor, planned) },
    operations: { latencyIncludesFailedAttempts: true, p50Ms: q(0.5), p95Ms: q(0.95), callsWithKnownUsage: knownUsage.length, inputTokensKnown: knownUsage.reduce((s, u) => s + u.inputTokens, 0), outputTokensKnown: knownUsage.reduce((s, u) => s + u.outputTokens, 0), costUsd: null },
    errors, cases,
  };
}
