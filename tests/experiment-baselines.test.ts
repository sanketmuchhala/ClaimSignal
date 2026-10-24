import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { baselines } from '../experiments/baselines.ts';
import { compare } from '../experiments/compare.ts';
import { createPlan, hash, requestFor } from '../experiments/plan.ts';
import { parseAnswer } from '../experiments/jev.ts';
import { loadVehicle } from '../benchmarks/datasets/vehicle.ts';
import { trainNaiveBayes } from '../benchmarks/naive-bayes.ts';
import type { Observation } from '../experiments/types.ts';

test('matched baselines reproduce train-only fit and train prevalence, independent of primitive', async () => {
  const plan = await createPlan({ task: 'vehicle-fraud-choice-v1', limit: 40 });
  const result = await baselines(plan);
  const data = await loadVehicle(), training = data.filter(e => e.split === 'train');
  const predict = trainNaiveBayes(training);
  assert.equal(result.training!.count, 9224);
  assert.equal(result.training!.prior, 540 / 9224);
  for (const p of result.methods.find(m => m.method === 'naive-bayes')!.predictions) {
    assert.equal(p.value, predict(data.find(e => e.claim.id === p.exampleId)!.features));
  }
  assert.deepEqual(result, await baselines(plan));
  const noul = await baselines(await createPlan({ task: 'vehicle-fraud-noul-v1', limit: 40 }));
  assert.deepEqual(noul.methods, result.methods);
  await assert.rejects(baselines(await createPlan({ task: 'vehicle-fraud-choice-v1', split: 'train', limit: 1 })), /training/);
  await assert.rejects(baselines(await createPlan({ task: 'claims-type-choice-v1' })), /pinned/);
});

test('baselines reject changed inputs or labels even if the plan is rehashed', async () => {
  for (const mutation of ['input', 'label']) {
    const plan = await createPlan({ task: 'vehicle-fraud-noul-v1', limit: 1 });
    if (mutation === 'input') plan.examples[0].state.description = 'changed';
    else plan.examples[0].target = { kind: 'binary', value: plan.examples[0].target.value === 1 ? 0 : 1 };
    const { id, ...body } = plan;
    plan.id = hash(body);
    await assert.rejects(baselines(plan), /differs/);
  }
});

test('evidence control is exact and comparison pairs only successful model observations', async () => {
  const plan = await createPlan({ task: 'vehicle-evidence-score-v1', limit: 3 });
  const baseline = await baselines(plan);
  assert.equal(baseline.training, null);
  assert.equal(baseline.methods[0].summary.mae, 0);
  const raw = { result: { model: 'test-double', answers: { decision: { type: 'score', score: 0, confidence: 1, probabilities: { 0: 1, 1: 0, 2: 0 } } } } };
  const row: Observation = { schemaVersion: 1, planId: plan.id, exampleId: plan.examples[0].id, requestHash: hash(requestFor(plan.task, plan.examples[0])), startedAt: '2026-10-24T00:00:00Z', latencyMs: 1, requestedModel: 'test', status: 'ok', raw, error: null, ...parseAnswer(raw, plan.task.question) };
  const run = { schemaVersion: 1 as const, planId: plan.id, requestedModel: 'test', provenance: 'test-double' as const, codeRevision: 'test', workingTreeDirty: true };
  const report = await compare(plan, [row], run);
  assert.equal(report.pairing.matched, 1);
  assert.equal(report.baseline.methods[0].summary.count, 3);
  assert.equal(report.baseline.methods[0].paired.count, 1);
  assert.match(report.model.kind, /TEST DOUBLE/);
  const dir = await mkdtemp(join(tmpdir(), 'claimsignal-compare-'));
  try {
    await writeFile(join(dir, 'plan.json'), JSON.stringify(plan));
    await writeFile(join(dir, 'run.json'), JSON.stringify(run));
    await writeFile(join(dir, 'observations.jsonl'), JSON.stringify(row) + '\n');
    const output = execFileSync(process.execPath, ['experiments/compare.ts', `--run=${dir}`], { encoding: 'utf8' });
    assert.deepEqual(JSON.parse(output), report);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
