import test from 'node:test';
import assert from 'node:assert/strict';
import { Script } from 'node:vm';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { explorer } from '../experiments/explorer.ts';
import { createPlan, hash } from '../experiments/plan.ts';

test('offline explorer embeds verified captures, has no remote resources, and its client parses', async () => {
  const html = await explorer(['reports/experiments/pilot-20261024/choice', 'reports/experiments/pilot-20261024/score']);
  assert.match(html, /connect-src 'none'/);
  assert.doesNotMatch(html, /<script[^>]+src=|<link[^>]+href=/);
  const data = JSON.parse(html.match(/<script type="application\/json" id="experiment-data">([\s\S]*?)<\/script>/)![1]);
  assert.equal(data.length, 2);
  assert.equal(data[0].report.counts.succeeded, 20);
  assert.equal(data[0].baseline.methods.length, 2);
  const code = html.match(/<script>([\s\S]*?)<\/script>/)![1];
  assert.doesNotThrow(() => new Script(code));
});

test('claim text cannot break out of the embedded JSON script', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'claimsignal-explorer-'));
  try {
    const plan = await createPlan({ task: 'claims-review-noul-v1', limit: 1 });
    plan.examples[0].state.description = '</script><script>alert("injected")</script>';
    const { id, ...body } = plan; plan.id = hash(body);
    await writeFile(join(dir, 'plan.json'), JSON.stringify(plan));
    await writeFile(join(dir, 'run.json'), JSON.stringify({ schemaVersion: 1, planId: plan.id, provenance: 'test-double', requestedModel: 'test', codeRevision: 'test', workingTreeDirty: true }));
    await writeFile(join(dir, 'observations.jsonl'), '');
    const html = await explorer([dir]);
    assert.doesNotMatch(html, /<script>alert/);
    assert.match(html, /\\u003c\/script\\u003e/);
    assert.equal((html.match(/<script/g) ?? []).length, 2);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
