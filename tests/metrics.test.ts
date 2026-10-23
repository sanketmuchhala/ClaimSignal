import test from 'node:test';
import assert from 'node:assert/strict';
import { cost, summarize } from '../benchmarks/metrics.ts';
import type { Row } from '../benchmarks/metrics.ts';
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
