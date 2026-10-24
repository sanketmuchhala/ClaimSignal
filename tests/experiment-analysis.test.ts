import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { runPlan } from '../experiments/runner.ts';
import { probabilityMetrics, reliability, selectiveCurve, ordinalMetrics } from '../experiments/metrics.ts';
import { analyze } from '../experiments/analyze.ts';
import { createPlan, hash, requestFor } from '../experiments/plan.ts';
import { parseAnswer } from '../experiments/jev.ts';
import type { Observation, Plan } from '../experiments/types.ts';

const close = (a: number | null, b: number) => assert.ok(a !== null && Math.abs(a - b) < 1e-12, `${a} != ${b}`);
test('proper probability scores, calibration endpoints and empty bins have explicit semantics', () => {
  const perfect = probabilityMetrics([{ probability: 0, outcome: 0 }, { probability: 1, outcome: 1 }]);
  assert.equal(perfect.brier, 0); assert.equal(perfect.logLoss, 0);
  assert.equal(perfect.calibration.bins[0].count, 1); assert.equal(perfect.calibration.bins[9].count, 1);
  assert.equal(perfect.calibration.bins[1].meanProbability, null);
  const uncertain = probabilityMetrics([{ probability: 0.5, outcome: 0 }, { probability: 0.5, outcome: 1 }]);
  close(uncertain.brier, 0.25); close(uncertain.logLoss, Math.log(2));
  assert.equal(uncertain.calibration.expectedCalibrationError, 0);
  const wrong = probabilityMetrics([{ probability: 1, outcome: 0 }]);
  assert.equal(wrong.brier, 1); assert.ok(Number.isFinite(wrong.logLoss));
  assert.equal(probabilityMetrics([]).brier, null);
  assert.throws(() => reliability([{ probability: NaN, outcome: 1 }]));
});

test('selective curves retain complete ties and include failed calls in coverage denominator', () => {
  const curve = selectiveCurve([{ confidence: 0.9, loss: 0, positive: false }, { confidence: 0.9, loss: 1, positive: true }, { confidence: 0.6, loss: 0, positive: false }], 4);
  assert.deepEqual(curve.map(p => p.accepted), [0, 2, 3]);
  assert.equal(curve[0].meanLoss, null);
  assert.equal(curve[1].meanLoss, 0.5); assert.equal(curve[1].coverage, 0.5);
  assert.equal(curve[2].coverage, 0.75); assert.equal(curve[2].coverageOfSuccessful, 1);
  assert.equal(curve[1].acceptedPositives, 1);
  assert.throws(() => selectiveCurve([{ confidence: 1, loss: 0 }], 0));
});

test('ordinal metrics measure rubric error and ordered distribution error, not event probabilities', () => {
  assert.deepEqual(ordinalMetrics([{ score: 2, probabilities: { 0: 0, 1: 0, 2: 1 }, target: 2 }]), { count: 1, mae: 0, normalizedRankedProbabilityScore: 0 });
  assert.deepEqual(ordinalMetrics([{ score: 0, probabilities: { 0: 1, 1: 0, 2: 0 }, target: 2 }]), { count: 1, mae: 2, normalizedRankedProbabilityScore: 1 });
  assert.throws(() => ordinalMetrics([{ score: 0, probabilities: { 0: 1, 1: 0 }, target: 0.5 }]));
});

function observation(plan: Plan, index: number, value: unknown): Observation {
  const raw = { result: { model: 'test-double', answers: { decision: value }, usage: { input_tokens: 1, output_tokens: 1 } } };
  const parsed = parseAnswer(raw, plan.task.question);
  return { schemaVersion: 1, planId: plan.id, exampleId: plan.examples[index].id, requestHash: hash(requestFor(plan.task, plan.examples[index])), startedAt: '2026-10-24T00:00:00Z', latencyMs: 10, requestedModel: 'test', status: 'ok', raw, error: null, ...parsed };
}
const metadata = (plan: Plan) => ({ schemaVersion: 1 as const, planId: plan.id, requestedModel: 'test', provenance: 'test-double' as const, codeRevision: 'test', workingTreeDirty: true });

test('analysis separates test doubles, incomplete runs, binary probabilities, and vendor confidence', async () => {
  const plan = await createPlan({ task: 'vehicle-fraud-choice-v1', limit: 3 });
  const first = observation(plan, 0, { type: 'choice', choice: 'no', confidence: 0.6, probabilities: { no: 0.8, yes: 0.2 } });
  const failed: Observation = { ...first, exampleId: plan.examples[1].id, requestHash: hash(requestFor(plan.task, plan.examples[1])), status: 'provider-error', answer: null, raw: null, resolvedModel: null, usage: null, error: 'failed' };
  const report = analyze(plan, [first, failed], metadata(plan));
  assert.equal(report.kind, 'TEST DOUBLE — NOT MODEL PERFORMANCE');
  assert.deepEqual(report.counts, { planned: 3, attempted: 2, succeeded: 1, failed: 1, unattempted: 1, uniqueFeatureGroups: new Set(plan.examples.map(e => e.group)).size });
  assert.equal(report.selective.byPredictedClassProbability!.at(-1)!.coverage, 1 / 3);
  assert.equal(report.selective.byPredictedClassProbability!.at(-1)!.minConfidence, 0.8);
  assert.equal(report.selective.byVendorConfidence!.at(-1)!.minConfidence, 0.6);
  assert.equal(report.operations.costUsd, null);
  assert.throws(() => analyze(plan, [first, first], metadata(plan)), /duplicate/);
  assert.throws(() => analyze(plan, [{ ...first, requestHash: 'wrong' }], metadata(plan)), /identity/);
  assert.throws(() => analyze(plan, [{ ...first, answer: { type: 'noul', noul: 1 } }], metadata(plan)), /raw response/);
});

test('score analysis does not calibrate rubric positions as fraud probabilities and normalizes only for metrics', async () => {
  const plan = await createPlan({ task: 'vehicle-evidence-score-v1', limit: 1 });
  const row = observation(plan, 0, { type: 'score', score: 1, confidence: 0, probabilities: { 0: 0.33, 1: 0.33, 2: 0.33 } });
  const report = analyze(plan, [row], metadata(plan));
  assert.equal(report.eventProbability, null); assert.equal(report.binaryDiscrimination, null);
  assert.equal(report.topLabelCalibration, null); assert.equal(report.classification, null);
  assert.equal(report.metricConventions.normalizedDistributions, 1);
  assert.equal(report.ordinal!.count, 1);
  assert.ok(row.answer?.type === 'score');
  assert.equal(row.answer.probabilities['0'], 0.33);
});

test('category analysis reports class-summed Brier and top-label calibration; model drift is rejected', async () => {
  const plan = await createPlan({ task: 'claims-type-choice-v1', limit: 2 });
  const rows = plan.examples.map((e, i) => observation(plan, i, { type: 'choice', choice: e.target.value, confidence: 1, probabilities: Object.fromEntries(['auto', 'property', 'health', 'travel', 'other'].map(k => [k, Number(k === e.target.value)])) }));
  const report = analyze(plan, rows, metadata(plan));
  assert.equal(report.categoricalDistribution!.brierSumOverClasses, 0);
  assert.equal(report.classification!.accuracyOnSuccessful, 1);
  assert.equal(report.eventProbability, null);
  assert.equal(report.topLabelCalibration!.expectedCalibrationError, 0);
  const changed = structuredClone(rows);
  (changed[1].raw as { result: { model: string } }).result.model = 'changed';
  changed[1].resolvedModel = 'changed';
  assert.throws(() => analyze(plan, changed, metadata(plan)), /model changed/);
});

test('report CLI reproduces a captured run offline, refuses overwrite, and rejects truncated checkpoints', async () => {
  const root = await mkdtemp(join(tmpdir(), 'claimsignal-report-'));
  try {
    const directory = join(root, 'run');
    const plan = await createPlan({ task: 'claims-review-noul-v1', limit: 3 });
    await runPlan(plan, { async run() {
      return { result: { model: 'test-double', answers: { decision: { type: 'noul', noul: 0.5 } } } };
    } }, { directory, model: 'test', codeRevision: 'test', workingTreeDirty: true, provenance: 'test-double' });
    const command = (...args: string[]) => execFileSync(process.execPath, ['experiments/report.ts', `--run=${directory}`, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const first = command();
    assert.equal(command(), first);
    assert.equal(JSON.parse(first).kind, 'TEST DOUBLE — NOT MODEL PERFORMANCE');
    const output = join(root, 'report.json');
    command(`--out=${output}`);
    assert.equal(await readFile(output, 'utf8'), first);
    assert.throws(() => command(`--out=${output}`), /EEXIST/);
    await appendFile(join(directory, 'observations.jsonl'), '{"schemaVersion":');
    assert.throws(() => command(), /SyntaxError/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
