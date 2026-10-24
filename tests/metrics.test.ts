import test from 'node:test';
import assert from 'node:assert/strict';
import { cost, summarize } from '../benchmarks/metrics.ts';
import type { Row } from '../benchmarks/metrics.ts';
import { fraudMetrics } from '../benchmarks/fraud-metrics.ts';
import { pairedBootstrap, quantile, seededRandom, spearman, weightedRanking } from '../benchmarks/paired-stats.ts';
const row: Row = { mode: 'hybrid', claimId: 'x', latencyMs: 10, correct: true, riskAbsoluteError: 0.2, autoResolved: true, unsafeAuto: false, error: false, estimatedCostUsd: 0.1 };
test('metrics retain failures in accuracy denominator and expose missing cost', () => {
  const summary = summarize([row, { ...row, latencyMs: 100, correct: false, riskAbsoluteError: null, error: true, estimatedCostUsd: null }]);
  assert.equal(summary.accuracy, 0.5); assert.equal(summary.p95Ms, 100); assert.equal(summary.riskMAE, 0.2); assert.equal(summary.errorRate, 0.5); assert.equal(summary.estimatedCostUsd, null);
});
test('cost includes both stages and never treats unavailable usage as free', () => {
  const rates = { jev: { input: 1, output: 0 }, llm: { input: 2, output: 4 } };
  const attempt = { provider: 'jev' as const, model: 'x', latencyMs: 1, status: 'ok' as const, usage: { inputTokens: 100, outputTokens: 50 } };
  assert.ok(Math.abs(cost([attempt, { ...attempt, provider: 'llm' }], rates)! - 0.0005) < 1e-10);
  assert.equal(cost([{ ...attempt, usage: null }], rates), null);
  assert.equal(cost([{ ...attempt, status: 'error' }], rates), null);
});
test('weighted ranking matches fraudMetrics, including ties and duplicated draws', () => {
  const random = seededRandom(7);
  const samples = Array.from({ length: 300 }, () => ({ label: (random() < 0.1 ? 1 : 0) as 0 | 1, score: Math.round(random() * 8) / 8 }));
  const expected = fraudMetrics(samples), ranked = weightedRanking(samples)()!;
  assert.ok(Math.abs(ranked.rocAuc - expected.rocAuc!) < 1e-12); assert.ok(Math.abs(ranked.averagePrecision - expected.averagePrecision!) < 1e-12);
  const weights = Array.from(samples, (_, i) => i % 3);
  const expanded = samples.flatMap((s, i) => Array(weights[i]).fill(s));
  const weighted = weightedRanking(samples)(weights)!, direct = fraudMetrics(expanded);
  assert.ok(Math.abs(weighted.rocAuc - direct.rocAuc!) < 1e-12); assert.ok(Math.abs(weighted.averagePrecision - direct.averagePrecision!) < 1e-12);
  assert.equal(weightedRanking([{ label: 0, score: 0.2 }])(), null);
});
test('paired bootstrap is seeded, brackets the estimate and handles constant series', () => {
  const samples = Array.from({ length: 200 }, (_, i) => ({ label: (i % 10 === 0 ? 1 : 0) as 0 | 1, score: i % 10 === 0 ? 0.9 : (i % 7) / 10 }));
  const auc = (w: Uint32Array) => weightedRanking(samples)(w)?.rocAuc ?? null;
  const first = pairedBootstrap(samples.length, { auc }, 300, 1), second = pairedBootstrap(samples.length, { auc }, 300, 1);
  assert.deepEqual(first, second); assert.ok(first.auc!.low <= fraudMetrics(samples).rocAuc! && fraudMetrics(samples).rocAuc! <= first.auc!.high);
  assert.equal(quantile([1, 2, 3, 4], 0.5), 2.5);
  assert.equal(spearman([1, 2, 3], [3, 5, 9]), 1); assert.equal(spearman([1, 2, 3], [3, 2, 1]), -1); assert.equal(spearman([1, 1, 1], [1, 2, 3]), null);
});
