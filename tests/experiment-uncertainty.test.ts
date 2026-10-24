import test from 'node:test';
import assert from 'node:assert/strict';
import { groupBootstrap, uncertainty } from '../experiments/uncertainty.ts';
import { analyze } from '../experiments/analyze.ts';
import { loadRun } from '../experiments/io.ts';
import { createPlan, hash } from '../experiments/plan.ts';

test('group bootstrap is seeded, keeps groups whole, brackets the estimate and omits mostly undefined statistics', () => {
  // Group "pair" has two members; any resample holds them both or neither.
  const items = [{ group: 'pair', v: 1 }, { group: 'pair', v: 1 }, ...Array.from({ length: 30 }, (_, i) => ({ group: `g${i}`, v: i % 3 }))];
  const seen: number[] = [];
  const evaluate = (sample: readonly typeof items[number][]) => {
    seen.push(sample.filter(x => x.group === 'pair').length);
    return { mean: sample.reduce((s, x) => s + x.v, 0) / sample.length, constant: 4, rare: sample.some(x => x.group === 'pair') ? 1 : null };
  };
  const result = groupBootstrap(items, evaluate, 500, 7);
  assert.ok(seen.every(n => n % 2 === 0));
  assert.deepEqual(result, groupBootstrap(items, evaluate, 500, 7));
  assert.notDeepEqual(result.mean, groupBootstrap(items, evaluate, 500, 8).mean);
  assert.ok(result.mean.low! <= result.mean.estimate! && result.mean.estimate! <= result.mean.high!);
  assert.deepEqual([result.constant.low, result.constant.high], [4, 4]);
  // About a third of resamples miss the group, far above the 1% tolerance.
  assert.equal(result.rare.estimate, 1);
  assert.ok(result.rare.undefinedResamples > 100);
  assert.deepEqual([result.rare.low, result.rare.high], [null, null]);
  assert.throws(() => groupBootstrap([], evaluate), /at least one/);
});

test('point estimates reproduce the offline report; pilot limits are explicit', async () => {
  const choice = await loadRun('reports/experiments/pilot-20261024/choice');
  const report = analyze(choice.plan, choice.rows, choice.run), result = await uncertainty(choice, null, 200);
  assert.equal(result.model.brier.estimate, report.eventProbability!.brier);
  assert.equal(result.model.logLoss.estimate, report.eventProbability!.logLoss);
  assert.equal(result.model.accuracy.estimate, report.classification!.accuracyOnSuccessful);
  assert.equal(result.model.rocAuc.estimate, null);
  assert.equal(result.model.rocAuc.low, null);
  assert.match(result.warnings.join(' '), /Only 20 claim groups/);
  assert.match(result.warnings.join(' '), /0 answered positive/);
  const nb = result.baselines!['naive-bayes'];
  assert.ok(Math.abs(nb.modelMinusBaseline.brier.estimate! - (report.eventProbability!.brier! - nb.onModelAnswered.brier.estimate!)) < 1e-15);

  const score = await loadRun('reports/experiments/pilot-20261024/score');
  const ordinal = analyze(score.plan, score.rows, score.run).ordinal!, scored = await uncertainty(score, null, 200);
  assert.equal(scored.model.mae.estimate, ordinal.mae);
  assert.equal(scored.model.normalizedRankedProbabilityScore.estimate, ordinal.normalizedRankedProbabilityScore);
  assert.equal(scored.baselines!['field-count'].onModelAnswered.normalizedRankedProbabilityScore.estimate, null);
});

test('paired intervals need the same claims, and differences use claims both sides answered', async () => {
  const choice = await loadRun('reports/experiments/pilot-20261024/choice'), noul = await loadRun('reports/experiments/pilot-20261024/noul');
  const result = await uncertainty(choice, noul, 200);
  const a = result.against!;
  assert.equal(a.samePlan, false);
  assert.deepEqual([a.counts.sharedPlanned, a.counts.bothAnswered], [20, 20]);
  assert.ok(Math.abs(a.onBothAnswered.leftMinusRight.brier.estimate! - (a.onBothAnswered.left.brier.estimate! - a.onBothAnswered.right.brier.estimate!)) < 1e-15);
  assert.equal(a.answeredShare.leftMinusRight.estimate, 0);

  // A prefix of the same ordered claims is matched; a different selection is refused.
  const plan = await createPlan({ task: 'vehicle-fraud-noul-v1', limit: 5 });
  const prefix = { plan, run: { ...noul.run, planId: plan.id }, rows: noul.rows.slice(0, 5).map(r => ({ ...r, planId: plan.id })) };
  assert.equal((await uncertainty(choice, prefix, 200)).against!.counts.sharedPlanned, 5);
  const shifted = structuredClone(plan);
  shifted.examples = shifted.examples.slice(1);
  const { id, ...body } = shifted; shifted.id = hash(body);
  await assert.rejects(uncertainty(choice, { plan: shifted, run: { ...noul.run, planId: shifted.id }, rows: [] }, 200), /prefix/);
  const score = await loadRun('reports/experiments/pilot-20261024/score');
  await assert.rejects(uncertainty(choice, score, 200), /target kind/);
});
