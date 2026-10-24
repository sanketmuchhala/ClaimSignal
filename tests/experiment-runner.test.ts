import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseAnswer } from '../experiments/jev.ts';
import { getTask } from '../experiments/tasks.ts';
import { createPlan, hash, requestFor } from '../experiments/plan.ts';
import { runPlan } from '../experiments/runner.ts';
import type { Observation } from '../experiments/types.ts';

const envelope = (answer: unknown) => ({ result: { model: 'test-double', answers: { decision: answer }, usage: { input_tokens: 7, output_tokens: 3 } } });
test('all primitives preserve probabilities and distinguish score, probability, and vendor confidence', () => {
  const choice = { type: 'choice', choice: 'yes', confidence: 0.6, probabilities: { no: 0.2, yes: 0.8 } };
  assert.deepEqual(parseAnswer(envelope(choice), getTask('vehicle-fraud-choice-v1').question).answer, choice);
  const score = { type: 'score', score: 1, confidence: 0, probabilities: { '0': 0.33, '1': 0.33, '2': 0.33 } };
  assert.deepEqual(parseAnswer(envelope(score), getTask('vehicle-evidence-score-v1').question).answer, score);
  assert.deepEqual(parseAnswer(envelope({ type: 'noul', noul: 0.8 }), getTask('vehicle-fraud-noul-v1').question).answer, { type: 'noul', noul: 0.8 });
  for (const bad of [ { ...choice, choice: 'absent' }, { ...choice, choice: 'no' }, { ...choice, probabilities: { no: 0.2 } }, { ...choice, probabilities: { no: 0.9, yes: 0.9 } } ]) {
    assert.throws(() => parseAnswer(envelope(bad), getTask('vehicle-fraud-choice-v1').question));
  }
  assert.throws(() => parseAnswer(envelope({ ...score, score: 2 }), getTask('vehicle-evidence-score-v1').question), /inconsistent/);
  assert.throws(() => parseAnswer({ result: { answers: {} } }, getTask('vehicle-fraud-noul-v1').question), /model/);
});

test('runner checkpoints successes and failures, stops on rate limit, and refuses overwriting', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'claimsignal-experiment-'));
  try {
    const plan = await createPlan({ task: 'vehicle-fraud-noul-v1', limit: 5 });
    const raw = envelope({ type: 'noul', noul: 0.25 });
    let calls = 0;
    const ai = { async run(_model: string, request: Record<string, unknown>) {
      assert.deepEqual(request, requestFor(plan.task, plan.examples[calls]));
      calls++;
      if (calls === 1) return raw;
      if (calls === 2) return { result: { model: 'test-double', answers: { decision: { type: 'noul', noul: 2 } } } };
      if (calls === 3) throw new Error('secret token should never appear');
      throw new Error('Cloudflare HTTP 429');
    } };
    const options = { directory: join(dir, 'run'), model: 'test', codeRevision: 'test', workingTreeDirty: true, provenance: 'test-double' as const };
    const result = await runPlan(plan, ai, options);
    assert.deepEqual([result.attempted, result.succeeded, result.failed, result.unattempted], [4, 1, 3, 1]);
    const text = await readFile(join(options.directory, 'observations.jsonl'), 'utf8');
    assert.doesNotMatch(text, /secret token/);
    const rows: Observation[] = text.trim().split('\n').map(s => JSON.parse(s));
    assert.deepEqual(rows.map(r => r.status), ['ok', 'invalid-response', 'provider-error', 'provider-error']);
    assert.deepEqual(rows[0].raw, raw);
    assert.equal(rows[0].requestHash, hash(requestFor(plan.task, plan.examples[0])));
    assert.equal(rows[0].usage!.inputTokens, 7);
    assert.notEqual(rows[1].raw, null);
    assert.equal(rows[2].usage, null);
    assert.equal(JSON.parse(await readFile(join(options.directory, 'run.json'), 'utf8')).provenance, 'test-double');
    await assert.rejects(runPlan(plan, ai, options), /EEXIST/);
    assert.equal(calls, 4);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('CLI defaults to offline planning and rejects unsafe/unknown arguments before inference', () => {
  const env = { ...process.env, CLOUDFLARE_ACCOUNT_ID: '', CLOUDFLARE_API_TOKEN: '' };
  const run = (...args: string[]) => execFileSync(process.execPath, ['experiments/run.ts', ...args], { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] });
  const plan = JSON.parse(run('--task=vehicle-fraud-choice-v1', '--limit=2'));
  assert.equal(plan.examples.length, 2);
  for (const extra of ['--unknown', '--limit=2', '--out=unwanted', '--split=smoke']) assert.throws(() => run('--task=vehicle-fraud-choice-v1', '--limit=2', extra));
  assert.throws(() => run('--task=vehicle-fraud-choice-v1', '--execute', '--out=unwanted'), /requires CLOUDFLARE/);
});
