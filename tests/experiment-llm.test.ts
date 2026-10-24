import test from 'node:test';
import assert from 'node:assert/strict';
import { llmAdapter, parseLlm, llmRequest } from '../experiments/llm.ts';
import { createPlan, requestFor, hash } from '../experiments/plan.ts';
import { analyze } from '../experiments/analyze.ts';
import { paired } from '../experiments/paired.ts';
import type { Observation } from '../experiments/types.ts';

test('LLM adapter captures actual messages and unmodified provider output, with unknown versions explicit', async () => {
  const plan = await createPlan({ task: 'vehicle-fraud-noul-v1', limit: 1 });
  const input = requestFor(plan.task, plan.examples[0]);
  const response = { response: '{"type":"noul","noul":0.2}', usage: { prompt_tokens: 10, completion_tokens: 4 } };
  const adapter = llmAdapter({ async run(model, request) { assert.equal(model, 'llm'); assert.deepEqual(request, llmRequest(input)); return response; } });
  const raw = await adapter.run('llm', input);
  const parsed = parseLlm(raw, plan.task.question, 'llm', input);
  assert.equal(parsed.resolvedModel, 'unreported:llm');
  assert.equal(parsed.usage!.inputTokens, 10);
  assert.deepEqual((raw as { response: unknown }).response, response);
  const invalid = { adapter: 'llm-structured-v1', request: llmRequest(input), response: { response: 'not JSON' } };
  assert.throws(() => parseLlm(invalid, plan.task.question, 'llm', input), SyntaxError);
  assert.throws(() => parseLlm(raw, plan.task.question, 'llm', { ...input, state: {} }), /request/);
});

test('LLM reports label generated estimates and paired comparisons use identical plans and complete cases', async () => {
  const plan = await createPlan({ task: 'vehicle-fraud-choice-v1', limit: 2 });
  const input = requestFor(plan.task, plan.examples[0]);
  const raw = { adapter: 'llm-structured-v1', request: llmRequest(input), response: { response: JSON.stringify({ type: 'choice', choice: 'no', probabilities: { no: 0.9, yes: 0.1 }, confidence: 1 }) } };
  const row: Observation = { schemaVersion: 1, planId: plan.id, exampleId: plan.examples[0].id, requestHash: hash(input), startedAt: '2026-10-24T00:00:00Z', latencyMs: 1, requestedModel: 'llm', status: 'ok', raw, error: null, ...parseLlm(raw, plan.task.question, 'llm', input) };
  const run = { schemaVersion: 1 as const, planId: plan.id, requestedModel: 'llm', provenance: 'test-double' as const, codeRevision: 'test', workingTreeDirty: true, adapter: 'llm-structured-v1' as const };
  const report = analyze(plan, [row], run);
  assert.equal(report.selective.byVendorConfidence, null);
  assert.match(report.sampleWarnings.join(' '), /generated estimates/);
  assert.match(report.sampleWarnings.join(' '), /resolved model version/);
  const pair = paired({ plan, rows: [row], run }, { plan, rows: [row], run });
  assert.equal(pair.paired, 1);
  assert.equal(pair.full.left.counts.unattempted, 1);
  const other = await createPlan({ task: 'vehicle-fraud-choice-v1', limit: 1 });
  assert.throws(() => paired({ plan, rows: [], run }, { plan: other, rows: [], run: { ...run, planId: other.id } }), /same plan/);
});
