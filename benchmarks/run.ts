import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import type { Decision, Prediction } from '../src/domain.ts';
import { cloudflareAI } from './cloudflare.ts';
import { evaluateJev } from '../src/jev.ts';
import { evaluateLlm } from '../src/llm.ts';
import { triage, withTimeout, defaultPolicy } from '../src/triage.ts';
import type { Attempt } from '../src/triage.ts';
import { fixtures } from './fixtures.ts';
import type { Fixture } from './fixtures.ts';
import { loadVehicle, datasetInfo } from './datasets/vehicle.ts';
import type { Split } from './datasets/vehicle.ts';
import { fraudMetrics } from './fraud-metrics.ts';
import type { ScoredLabel } from './fraud-metrics.ts';
import { cost, summarize } from './metrics.ts';
import type { Rates, Row } from './metrics.ts';

const args = process.argv.slice(2);
if (args.some(a => !/^(--mock|--validate-only|--dataset=(synthetic|vehicle)|--split=(train|validation|test|all)|--offset=\d+|--limit=\d+)$/.test(a))) throw new Error('Use --dataset=synthetic|vehicle, --split=train|validation|test|all, --offset=N, --limit=N, --validate-only, or --mock');
const option = (key: string, fallback: string) => args.find(a => a.startsWith(`--${key}=`))?.split('=')[1] ?? fallback;
const mock = args.includes('--mock');
const dataset = option('dataset', 'synthetic');
const split = option('split', 'test') as Split | 'all';
if (mock && dataset === 'vehicle') throw new Error('Mock oracle metrics are not supported for the real dataset. Use npm run dataset:evaluate for measured offline results.');
let cases: Fixture[] = fixtures;
if (dataset === 'vehicle') {
  cases = (await loadVehicle()).filter(e => split === 'all' || e.split === split)
    .sort((a, b) => a.claim.id.localeCompare(b.claim.id))
    .map(e => ({ claim: e.claim, expectedType: 'auto', expectedRisk: null, reviewRequired: null, expectedFraud: e.fraud }));
}
const availableCases = cases.length;
// --offset resumes an interrupted run on the same deterministic ordering.
const offset = Number(option('offset', '0'));
if (!Number.isSafeInteger(offset) || offset < 0 || offset >= availableCases) throw new Error(`offset must be 0..${availableCases - 1}`);
const limit = Number(option('limit', String(availableCases - offset)));
if (!Number.isSafeInteger(limit) || limit < 1 || limit > availableCases - offset) throw new Error(`limit must be 1..${availableCases - offset}`);
cases = cases.slice(offset, offset + limit);
if (args.includes('--validate-only')) {
  console.log(JSON.stringify({ kind: 'INPUT VALIDATION ONLY — NO INFERENCE', dataset, split, availableCases, offset, selectedCases: cases.length, fraudLabels: cases.filter(c => c.expectedFraud === 1).length }, null, 2));
  process.exit(0);
}
const repeats = Number(process.env.BENCHMARK_REPEATS ?? 1);
if (!Number.isSafeInteger(repeats) || repeats < 1 || repeats > 100) throw new Error('BENCHMARK_REPEATS must be an integer from 1 to 100');
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;
if (!mock && (!account || !token)) throw new Error('Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN, or use --mock for a harness smoke test');
const throttlePauseMs = Number(process.env.BENCHMARK_THROTTLE_PAUSE_MS ?? 60000);
if (!Number.isSafeInteger(throttlePauseMs) || throttlePauseMs < 0) throw new Error('BENCHMARK_THROTTLE_PAUSE_MS must be a nonnegative integer');
// Cloudflare's account rate limiter rejects calls before any model runs. Those are not model failures,
// so a pair that hits it is set aside in a separate checkpoint and repeated after a pause.
let throttledCalls = 0;
// A spent daily allocation (Workers Free plan) will not clear with a pause, so it ends the run instead.
let stopReason: string | null = null;
const models = { jev: process.env.JEV_MODEL ?? 'typesafe/jev', llm: process.env.LLM_MODEL ?? '@cf/meta/llama-3.1-8b-instruct-fp8' };
const ai = cloudflareAI(account ?? '', token ?? '', dailyAllocationSpent => {
  throttledCalls++;
  if (dailyAllocationSpent) stopReason = 'Workers AI daily free allocation exhausted; resume with --offset after it resets at 00:00 UTC or on a paid plan';
});
const rateValues = ['JEV_INPUT_PER_MILLION', 'JEV_OUTPUT_PER_MILLION', 'LLM_INPUT_PER_MILLION', 'LLM_OUTPUT_PER_MILLION'].map(key => process.env[key]);
if (rateValues.some(v => v !== undefined && v !== '' && (!Number.isFinite(Number(v)) || Number(v) < 0))) throw new Error('Token rates must be finite nonnegative numbers');
const rates: Rates | null = !mock && rateValues.every(v => v !== undefined && v !== '') ? { jev: { input: Number(rateValues[0]), output: Number(rateValues[1]) }, llm: { input: Number(rateValues[2]), output: Number(rateValues[3]) } } : null;
const rows: Row[] = [];
// jev_only scores the primary decision from each hybrid run, so the two models are compared on identical claims.
const fraudScores: Record<'hybrid' | 'llm_only' | 'jev_only', ScoredLabel[]> = { hybrid: [], llm_only: [], jev_only: [] };
const dispositions: Record<'hybrid' | 'llm_only', { autoFraud: number; autoNonFraud: number }> = { hybrid: { autoFraud: 0, autoNonFraud: 0 }, llm_only: { autoFraud: 0, autoNonFraud: 0 } };
const runId = `${mock ? 'mock' : 'live'}-${dataset}-${Date.now()}`;
await mkdir('benchmark-results', { recursive: true });
let stoppedEarly = false;
let consecutiveEmptyPairs = 0;
let repeatedPairs = 0;
evaluation:
for (let repeat = 0; repeat < repeats; repeat++) {
  for (const [index, fixture] of cases.entries()) {
    const fake: Prediction = { decision: { claimType: fixture.expectedType, typeConfidence: fixture.claim.id === 'other-01' ? 0.4 : 0.95, fraudRisk: fixture.expectedRisk ?? 0, riskConfidence: 0.95, needsReviewProbability: fixture.reviewRequired ? 0.9 : 0.02 }, model: 'mock-fixture-oracle', usage: null };
    const providers = { jev: async () => mock ? fake : evaluateJev(ai, fixture.claim, models.jev), llm: async () => mock ? fake : evaluateLlm(ai, fixture.claim, models.llm) };
    // Alternate order to reduce systematic first-call bias; no warm-up calls are excluded.
    const modes: Array<'hybrid' | 'llm_only'> = (offset + index + repeat) % 2 ? ['llm_only', 'hybrid'] : ['hybrid', 'llm_only'];
    for (let tries = 0; ; tries++) {
      const throttledBefore = throttledCalls;
      const pending: Array<{ mode: 'hybrid' | 'llm_only'; row: Row; prediction: Prediction | null; decisions: { jev: Decision | null; llm: Decision | null }; autoResolved: boolean; checkpoint: Record<string, unknown> }> = [];
      for (const mode of modes) {
        const start = performance.now();
        let prediction: Prediction | null = null;
        let attempts: Attempt[];
        let autoResolved = false;
        let decisions: { jev: Decision | null; llm: Decision | null };
        let reason: string | null = null;
        if (mode === 'hybrid') {
          const result = await triage(fixture.claim, providers);
          const decision = result.fallbackDecision ?? result.decision;
          prediction = decision ? { decision, model: 'hybrid', usage: null } : null;
          attempts = result.attempts;
          autoResolved = result.route === 'auto_resolved';
          decisions = { jev: result.decision, llm: result.fallbackDecision };
          reason = result.reason;
        } else {
          try {
            prediction = await withTimeout(providers.llm(), 8000);
            attempts = [{ provider: 'llm', model: prediction.model, usage: prediction.usage, status: 'ok', latencyMs: performance.now() - start }];
          } catch { attempts = [{ provider: 'llm', model: null, usage: null, status: 'error', latencyMs: performance.now() - start }]; }
          decisions = { jev: null, llm: prediction?.decision ?? null };
        }
        const row: Row = { mode, claimId: fixture.claim.id, latencyMs: performance.now() - start, correct: prediction?.decision.claimType === fixture.expectedType, riskAbsoluteError: prediction && fixture.expectedRisk !== null ? Math.abs(prediction.decision.fraudRisk - fixture.expectedRisk) : null, autoResolved, unsafeAuto: fixture.reviewRequired === null ? null : autoResolved && fixture.reviewRequired, error: attempts.some(a => a.status === 'error'), estimatedCostUsd: cost(attempts, rates) };
        pending.push({ mode, row, prediction, decisions, autoResolved, checkpoint: { repeat, ...row, expectedType: fixture.expectedType, expectedRisk: fixture.expectedRisk, reviewRequired: fixture.reviewRequired, expectedFraud: fixture.expectedFraud, fraudScore: prediction?.decision.fraudRisk ?? null, reason, decisions, attempts } });
      }
      if (throttledCalls > throttledBefore) {
        await appendFile(`benchmark-results/${runId}.throttled.jsonl`, pending.map(p => JSON.stringify({ try: tries, ...p.checkpoint })).join('\n') + '\n');
        if (stopReason || tries >= 7) { stopReason ??= 'Cloudflare kept rate limiting the same pair'; stoppedEarly = true; process.exitCode = 1; break evaluation; }
        repeatedPairs++;
        await new Promise(resolve => setTimeout(resolve, Math.min(throttlePauseMs * 2 ** tries, throttlePauseMs * 10)));
        continue;
      }
      for (const { mode, row, prediction, decisions, autoResolved, checkpoint } of pending) {
        if (fixture.expectedFraud !== undefined && prediction) fraudScores[mode].push({ label: fixture.expectedFraud, score: prediction.decision.fraudRisk });
        if (fixture.expectedFraud !== undefined && decisions.jev) fraudScores.jev_only.push({ label: fixture.expectedFraud, score: decisions.jev.fraudRisk });
        if (fixture.expectedFraud !== undefined && autoResolved) dispositions[mode][fixture.expectedFraud ? 'autoFraud' : 'autoNonFraud']++;
        rows.push(row);
        await appendFile(`benchmark-results/${runId}.jsonl`, JSON.stringify(checkpoint) + '\n');
      }
      consecutiveEmptyPairs = pending.some(p => p.prediction) ? 0 : consecutiveEmptyPairs + 1;
      if (!mock && consecutiveEmptyPairs >= 10) { stoppedEarly = true; process.exitCode = 1; break evaluation; }
      break;
    }
  }
}
const report = { kind: mock ? 'MOCK HARNESS CHECK — NOT MODEL PERFORMANCE' : `live ${dataset} evaluation`, dataset: dataset === 'vehicle' ? datasetInfo : 'synthetic fixtures', split: dataset === 'vehicle' ? split : null, availableCases, offset, selectedCases: cases.length, stoppedEarly, stopReason, throttledCalls, repeatedPairs, plannedPredictions: repeats * cases.length * 2, completedPredictions: rows.length, fraud: dataset === 'vehicle' ? Object.fromEntries((['hybrid', 'llm_only', 'jev_only'] as const).map(mode => [mode, { evaluatedPredictions: fraudScores[mode].length, metrics: fraudScores[mode].length ? fraudMetrics(fraudScores[mode], 0.5) : null, ...(mode === 'jev_only' ? {} : dispositions[mode]) }])) : null, timestamp: new Date().toISOString(), models, rates, policy: defaultPolicy, repeats, fixtureCount: cases.length, hybrid: rows.length ? summarize(rows.filter(r => r.mode === 'hybrid')) : null, llmOnly: rows.length ? summarize(rows.filter(r => r.mode === 'llm_only')) : null, rows };
await mkdir('benchmark-results', { recursive: true });
await writeFile(`benchmark-results/${runId}.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, rows: undefined }, null, 2));
