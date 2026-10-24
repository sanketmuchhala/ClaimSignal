import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlan, verifyPlan, hash, requestFor } from '../experiments/plan.ts';
import { variantOf } from '../experiments/variants.ts';
import { robustness } from '../experiments/robustness.ts';
import { parseAnswer } from '../experiments/jev.ts';
import type { Plan, Observation } from '../experiments/types.ts';

test('one-factor variants retain IDs, groups, labels, provenance and deterministic lineage', async () => {
  const base = await createPlan({ task: 'vehicle-fraud-choice-v1', limit: 2 });
  const saved = structuredClone(base);
  for (const id of ['choice-order-reversed-v1', 'paraphrase-v1', 'administrative-note-v1'] as const) {
    const changed = variantOf(base, id);
    verifyPlan(changed);
    assert.deepEqual(changed, variantOf(base, id));
    assert.equal(changed.variant!.parentPlanId, base.id);
    assert.deepEqual(changed.examples.map(e => [e.id, e.group, e.target]), base.examples.map(e => [e.id, e.group, e.target]));
    assert.notEqual(changed.id, base.id);
    assert.throws(() => variantOf(changed, id), /one perturbation/);
    if (id === 'choice-order-reversed-v1' && changed.task.question.type === 'choice') assert.deepEqual(Object.keys(changed.task.question.criteria), ['yes', 'no']);
  }
  assert.deepEqual(base, saved);
  const score = await createPlan({ task: 'vehicle-evidence-score-v1', limit: 2 });
  assert.throws(() => variantOf(score, 'choice-order-reversed-v1'), /Choice/);
});

function captured(plan: Plan, probabilities: number[]) {
  const rows: Observation[] = probabilities.map((p, i) => {
    const raw = { result: { model: 'test-double', answers: { decision: { type: 'noul', noul: p } } } };
    return { schemaVersion: 1, planId: plan.id, exampleId: plan.examples[i].id, requestHash: hash(requestFor(plan.task, plan.examples[i])), startedAt: '2026-10-24T00:00:00Z', latencyMs: 1, requestedModel: 'test', status: 'ok', raw, error: null, ...parseAnswer(raw, plan.task.question) };
  });
  return { plan, rows, run: { schemaVersion: 1 as const, planId: plan.id, requestedModel: 'test', provenance: 'test-double' as const, codeRevision: 'test', workingTreeDirty: true } };
}
test('paired robustness reports flips, probability movement and missing pairs without inflating sample size', async () => {
  const base = await createPlan({ task: 'vehicle-fraud-noul-v1', limit: 3 });
  const altered = variantOf(base, 'paraphrase-v1');
  const a = captured(base, [0.2, 0.9, 0.1]), b = captured(altered, [0.8, 0.7]);
  const report = robustness(a, b);
  assert.deepEqual([report.planned, report.paired, report.unpaired], [3, 2, 1]);
  assert.equal(report.flipRate, 0.5);
  assert.ok(Math.abs(report.meanTotalVariation! - 0.4) < 1e-12);
  assert.throws(() => robustness(a, captured(base, [0.1])), /declared transformation/);
  b.run.requestedModel = 'different';
  assert.throws(() => robustness(a, b), /mismatch|model/);
});
