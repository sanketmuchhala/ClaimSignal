import { mkdir, open, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { AI } from '../src/domain.ts';
import { hash, requestFor, verifyPlan } from './plan.ts';
import { parseAnswer } from './jev.ts';
import type { Observation, Plan } from './types.ts';

export interface RunOptions {
  directory: string;
  model: string;
  codeRevision: string;
  workingTreeDirty: boolean;
  provenance: 'live-provider' | 'test-double';
}

export async function runPlan(plan: Plan, ai: AI, options: RunOptions) {
  verifyPlan(plan);
  if (!options.model.trim()) throw new Error('Model is required');
  // Refuse to overwrite or append to another run. A partial run remains independently inspectable.
  await mkdir(dirname(options.directory), { recursive: true });
  await mkdir(options.directory);
  await writeFile(join(options.directory, 'plan.json'), JSON.stringify(plan, null, 2) + '\n', { flag: 'wx' });
  await writeFile(join(options.directory, 'run.json'), JSON.stringify({
    schemaVersion: 1, planId: plan.id, provenance: options.provenance, requestedModel: options.model,
    codeRevision: options.codeRevision, workingTreeDirty: options.workingTreeDirty, node: process.version,
    createdAt: new Date().toISOString(), execution: 'sequential, one question per call, no retries',
    cost: null, costNote: 'No rates supplied; usage is retained. Missing cost is not zero.',
  }, null, 2) + '\n', { flag: 'wx' });
  const file = await open(join(options.directory, 'observations.jsonl'), 'wx');
  let attempted = 0, succeeded = 0, stopReason: string | null = null;
  try {
    for (const example of plan.examples) {
      const request = requestFor(plan.task, example);
      const row: Observation = {
        schemaVersion: 1, planId: plan.id, exampleId: example.id, requestHash: hash(request),
        startedAt: new Date().toISOString(), latencyMs: 0, requestedModel: options.model,
        resolvedModel: null, status: 'provider-error', answer: null, raw: null, usage: null, error: null,
      };
      const start = performance.now();
      try {
        row.raw = await ai.run(options.model, request);
        row.latencyMs = performance.now() - start;
        row.status = 'invalid-response';
        try {
          Object.assign(row, parseAnswer(row.raw, plan.task.question));
          row.status = 'ok'; succeeded++;
        } catch (error) { row.error = error instanceof Error ? error.message : 'Invalid response'; }
      } catch (error) {
        row.latencyMs = performance.now() - start;
        // Never serialize arbitrary provider exceptions: they may contain credentials or request headers.
        const http = error instanceof Error ? /^Cloudflare HTTP (\d{3})$/.exec(error.message) : null;
        row.error = http ? `Cloudflare HTTP ${http[1]}` : 'Provider request failed';
        if (http?.[1] === '429') stopReason = 'rate-limit; no automatic retry';
        if (http?.[1] === '401' || http?.[1] === '403') stopReason = 'provider authorization failure';
      }
      await file.write(JSON.stringify(row) + '\n');
      await file.sync();
      attempted++;
      if (stopReason) break;
    }
  } finally { await file.close(); }
  const summary = { planId: plan.id, planned: plan.examples.length, attempted, succeeded, failed: attempted - succeeded, unattempted: plan.examples.length - attempted, stopReason };
  await writeFile(join(options.directory, 'completion.json'), JSON.stringify(summary, null, 2) + '\n', { flag: 'wx' });
  return summary;
}
