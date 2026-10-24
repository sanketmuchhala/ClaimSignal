import { mkdir, open, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { AI } from '../src/domain.ts';
import { hash, requestFor, verifyPlan } from './plan.ts';
import { decode } from './decode.ts';
import type { Adapter } from './decode.ts';
import type { Observation, Plan } from './types.ts';

export interface RunOptions {
  directory: string;
  model: string;
  codeRevision: string;
  workingTreeDirty: boolean;
  provenance: 'live-provider' | 'test-double';
  adapter?: Adapter;
  // Opt-in. HTTP 429 rejects a request before inference, so retrying it cannot change a recorded answer.
  rateLimit?: { retries: number; pauseMs: number; allocationSpent: () => boolean };
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
    ...(options.adapter ? { adapter: options.adapter } : {}),
    codeRevision: options.codeRevision, workingTreeDirty: options.workingTreeDirty, node: process.version,
    createdAt: new Date().toISOString(),
    execution: options.rateLimit?.retries ? `sequential, one question per call; up to ${options.rateLimit.retries} retries after HTTP 429, which rejects before inference; no other retries` : 'sequential, one question per call, no retries',
    cost: null, costNote: 'No rates supplied; usage is retained. Missing cost is not zero.',
  }, null, 2) + '\n', { flag: 'wx' });
  const file = await open(join(options.directory, 'observations.jsonl'), 'wx');
  let attempted = 0, succeeded = 0, rateLimitRetries = 0, stopReason: string | null = null;
  try {
    for (const example of plan.examples) {
      const request = requestFor(plan.task, example);
      let row: Observation;
      for (let tries = 0; ; tries++) {
        row = {
          schemaVersion: 1, planId: plan.id, exampleId: example.id, requestHash: hash(request),
          startedAt: new Date().toISOString(), latencyMs: 0, requestedModel: options.model,
          resolvedModel: null, status: 'provider-error', answer: null, raw: null, usage: null, error: null,
        };
        const start = performance.now();
        let rateLimited = false;
        try {
          row.raw = await ai.run(options.model, request);
          row.latencyMs = performance.now() - start;
          row.status = 'invalid-response';
          try {
            Object.assign(row, decode(row.raw, plan.task.question, options.model, options.adapter ?? 'jev', request));
            row.status = 'ok';
          } catch (error) { row.error = error instanceof Error ? error.message : 'Invalid response'; }
        } catch (error) {
          row.latencyMs = performance.now() - start;
          // Never serialize arbitrary provider exceptions: they may contain credentials or request headers.
          const http = error instanceof Error ? /^Cloudflare HTTP (\d{3})$/.exec(error.message) : null;
          row.error = http ? `Cloudflare HTTP ${http[1]}` : 'Provider request failed';
          rateLimited = http?.[1] === '429';
          if (http?.[1] === '401' || http?.[1] === '403') stopReason = 'provider authorization failure';
        }
        if (!rateLimited) break;
        const policy = options.rateLimit;
        if (!policy || tries >= policy.retries || policy.allocationSpent()) {
          stopReason = policy?.allocationSpent() ? 'daily allocation spent' : policy?.retries ? `rate-limit; ${policy.retries} retries exhausted` : 'rate-limit; no automatic retry';
          break;
        }
        rateLimitRetries++;
        await new Promise(resolve => setTimeout(resolve, policy.pauseMs * 2 ** tries));
      }
      if (row!.status === 'ok') succeeded++;
      await file.write(JSON.stringify(row!) + '\n');
      await file.sync();
      attempted++;
      if (stopReason) break;
    }
  } finally { await file.close(); }
  const summary = { planId: plan.id, planned: plan.examples.length, attempted, succeeded, failed: attempted - succeeded, unattempted: plan.examples.length - attempted, rateLimitRetries, stopReason };
  await writeFile(join(options.directory, 'completion.json'), JSON.stringify(summary, null, 2) + '\n', { flag: 'wx' });
  return summary;
}
