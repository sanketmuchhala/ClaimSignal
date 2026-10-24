import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlan, hash, requestFor, verifyPlan } from '../experiments/plan.ts';
import { getTask } from '../experiments/tasks.ts';
import { loadVehicle } from '../benchmarks/datasets/vehicle.ts';

test('claims plans are deterministic, preserve partitions, and exclude outcome labels from requests', async () => {
  const a = await createPlan({ task: 'vehicle-fraud-choice-v1', limit: 30 });
  assert.deepEqual(a, await createPlan({ task: 'vehicle-fraud-choice-v1', limit: 30 }));
  verifyPlan(a);
  const source = await loadVehicle();
  for (const e of a.examples) {
    assert.equal(source.find(v => v.claim.id === e.id)!.split, 'validation');
    assert.equal(e.target.value, source.find(v => v.claim.id === e.id)!.fraud);
    const request = requestFor(a.task, e);
    assert.doesNotMatch(JSON.stringify(request), /FraudFound_P|expectedFraud|target|labelSource/);
    assert.deepEqual(request, requestFor(a.task, { ...e, target: { kind: 'binary', value: e.target.value === 1 ? 0 : 1 } }));
  }
  const noul = await createPlan({ task: 'vehicle-fraud-noul-v1', limit: 30 });
  assert.deepEqual(a.examples, noul.examples);
  assert.notEqual(a.id, noul.id);
  a.examples[0].state.description = 'changed';
  assert.throws(() => verifyPlan(a), /hash/);
});

test('score positive control has source-derived ordinal labels, never fraud probabilities', async () => {
  const plan = await createPlan({ task: 'vehicle-evidence-score-v1', limit: 50 });
  for (const e of plan.examples) {
    const text = String(e.state.description);
    assert.deepEqual(e.target, { kind: 'ordinal', value: Number(text.includes('PoliceReportFiled: Yes')) + Number(text.includes('WitnessPresent: Yes')) });
  }
  assert.match(plan.task.limitations.join(' '), /Not fraud prediction/);
});

test('synthetic plans are conspicuous and cannot be mislabeled as held-out real data', async () => {
  const plan = await createPlan({ task: 'claims-inconsistency-score-v1', limit: 24 });
  assert.equal(plan.kind, 'SYNTHETIC SMOKE EXPERIMENT');
  assert.equal(plan.dataset.split, 'smoke');
  assert.equal(plan.examples.find(e => e.id === 'travel-02')!.target.value, 4);
  await assert.rejects(createPlan({ task: 'claims-review-noul-v1', split: 'test' }), /smoke/);
  await assert.rejects(createPlan({ task: 'vehicle-fraud-noul-v1', split: 'smoke' }), /Vehicle/);
  for (const limit of [0, -1, 1.5, NaN, 999999]) await assert.rejects(createPlan({ task: 'claims-type-choice-v1', limit }));
  assert.throws(() => getTask('unknown'), /Unknown/);
});

test('question order and wording affect hashes and task definitions cannot be mutated through lookup', () => {
  const a = getTask('vehicle-fraud-choice-v1');
  const before = hash(a);
  a.question.instructions = 'changed';
  assert.equal(hash(getTask(a.id)), before);
  assert.notEqual(hash(a), before);
  assert.notEqual(hash({ a: 'A', b: 'B' }), hash({ b: 'B', a: 'A' }));
});
