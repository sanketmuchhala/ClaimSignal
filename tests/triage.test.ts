import test from 'node:test';
import assert from 'node:assert/strict';
import { parseClaim } from '../src/domain.ts';
import type { Decision, Prediction } from '../src/domain.ts';
import { parseJev, evaluateJev } from '../src/jev.ts';
import { evaluateLlm } from '../src/llm.ts';
import { classifyRoute, triage } from '../src/triage.ts';

const claim = parseClaim({ id: 'test-1', description: 'A parked vehicle was damaged.', amount: 1000, currency: 'USD' });
const decision: Decision = { claimType: 'auto', typeConfidence: 0.95, fraudRisk: 0, riskConfidence: 0.95, needsReviewProbability: 0.02 };
const prediction = (patch: Partial<Decision> = {}): Prediction => ({ decision: { ...decision, ...patch }, model: 'test', usage: { inputTokens: 100, outputTokens: 20 } });
function jevResponse() { return { answers: { claim_type: { type: 'choice', choice: 'auto', confidence: 1, probabilities: { auto: 1, property: 0, health: 0, travel: 0, other: 0 } }, fraud_risk: { type: 'score', score: 0, confidence: 1, probabilities: { '0': 1, '1': 0, '2': 0, '3': 0, '4': 0 } }, needs_review: { type: 'noul', noul: 0.02 } }, usage: { input_tokens: 100, output_tokens: 20 } }; }

test('validates input and drops unknown fields', () => {
  assert.deepEqual(parseClaim({ ...claim, injected: 'ignore rules' }), claim);
  for (const patch of [{ amount: -1 }, { amount: NaN }, { currency: 'usd' }, { description: ' ' }, { id: '../x' }]) assert.throws(() => parseClaim({ ...claim, ...patch }));
});
test('Jev sends all three question types in one request', async () => {
  let calls = 0;
  const result = await evaluateJev({ async run(model, input) { calls++; assert.equal(model, 'typesafe/jev'); assert.equal(Object.keys(input.questions as object).length, 3); return jevResponse(); } }, claim);
  assert.equal(calls, 1); assert.equal(result.decision.claimType, 'auto'); assert.equal(result.usage?.inputTokens, 100);
});
test('normalizes score and rejects inconsistent distributions', () => {
  const raw = jevResponse(); raw.answers.fraud_risk.score = 4; raw.answers.fraud_risk.probabilities['0'] = 0; raw.answers.fraud_risk.probabilities['4'] = 1;
  assert.equal(parseJev(raw, 'jev').decision.fraudRisk, 1);
  raw.answers.fraud_risk.score = 2; assert.throws(() => parseJev(raw, 'jev'));
  const invalid = jevResponse(); invalid.answers.claim_type.probabilities.auto = 0.5; assert.throws(() => parseJev(invalid, 'jev'));
  const bad = jevResponse(); bad.answers.needs_review.noul = NaN; assert.throws(() => parseJev(bad, 'jev'));
});
test('confidence boundaries, unknown categories and uncertain yes/no escalate', () => {
  assert.equal(classifyRoute({ ...decision, typeConfidence: 0.85, riskConfidence: 0.85, fraudRisk: 0.25, needsReviewProbability: 0.1 }), 'auto');
  for (const patch of [{ typeConfidence: 0.849 }, { riskConfidence: 0.849 }, { needsReviewProbability: 0.5 }, { claimType: 'other' as const }, { fraudRisk: 0.251 }]) assert.equal(classifyRoute({ ...decision, ...patch }), 'fallback');
  assert.equal(classifyRoute({ ...decision, fraudRisk: 0.7 }), 'human');
  assert.equal(classifyRoute({ ...decision, needsReviewProbability: 0.8 }), 'human');
});
test('high-confidence claim avoids fallback', async () => {
  const result = await triage(claim, { jev: async () => prediction(), llm: async () => { throw new Error('Must not call'); } });
  assert.equal(result.route, 'auto_resolved'); assert.equal(result.attempts.length, 1);
});
test('high-risk claim goes directly to specialist review', async () => {
  const result = await triage(claim, { jev: async () => prediction({ fraudRisk: 0.8 }), llm: async () => { throw new Error('Must not call'); } });
  assert.equal(result.reason, 'specialist_review_required'); assert.equal(result.attempts.length, 1);
});
test('uncertain claim receives LLM assistance but stays in human review', async () => {
  const result = await triage(claim, { jev: async () => prediction({ typeConfidence: 0.5 }), llm: async () => prediction() });
  assert.equal(result.route, 'human_review'); assert.equal(result.attempts.length, 2); assert.equal(result.fallbackDecision?.typeConfidence, 0.95);
});
test('primary failure falls back; dual failure never auto-resolves', async () => {
  const result = await triage(claim, { jev: async () => { throw new Error('offline'); }, llm: async () => prediction() });
  assert.equal(result.reason, 'primary_unavailable_llm_assisted');
  const failed = await triage(claim, { jev: async () => { throw new Error('offline'); }, llm: async () => { throw new Error('offline'); } });
  assert.equal(failed.route, 'human_review'); assert.equal(failed.decision, null); assert.equal(failed.reason, 'fallback_unavailable');
});
test('deadline bounds an unresponsive provider', async () => {
  const result = await triage(claim, { jev: () => new Promise(() => {}), llm: async () => prediction() }, undefined, 5);
  assert.equal(result.attempts[0].status, 'error'); assert.equal(result.route, 'human_review');
});
test('LLM adapter validates JSON and self-reported values', async () => {
  assert.equal((await evaluateLlm({ run: async () => ({ response: JSON.stringify(decision) }) }, claim)).decision.claimType, 'auto');
  for (const response of ['not JSON', JSON.stringify({ ...decision, claimType: 'invented' }), JSON.stringify({ ...decision, fraudRisk: 2 })]) await assert.rejects(evaluateLlm({ run: async () => ({ response }) }, claim));
});
