import { mkdir, writeFile } from 'node:fs/promises';
import type { AI, Prediction } from '../src/domain.ts';
import { record } from '../src/domain.ts';
import { evaluateJev } from '../src/jev.ts';
import { evaluateLlm } from '../src/llm.ts';
import { triage, withTimeout, defaultPolicy } from '../src/triage.ts';
import type { Attempt } from '../src/triage.ts';
import { fixtures } from './fixtures.ts';
import { cost, summarize } from './metrics.ts';
import type { Rates, Row } from './metrics.ts';

const mock = process.argv.includes('--mock');
const repeats = Number(process.env.BENCHMARK_REPEATS ?? 1);
if (!Number.isSafeInteger(repeats) || repeats < 1 || repeats > 100) throw new Error('BENCHMARK_REPEATS must be an integer from 1 to 100');
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;
if (!mock && (!account || !token)) throw new Error('Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN, or use --mock for a harness smoke test');
const models = { jev: process.env.JEV_MODEL ?? 'typesafe/jev', llm: process.env.LLM_MODEL ?? '@cf/meta/llama-3.1-8b-instruct-fp8' };
const ai: AI = {
  async run(model, input) {
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account!)}/ai/run`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, input }), signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`Cloudflare HTTP ${response.status}`);
    const envelope = record(await response.json());
    if (envelope.success !== true) throw new Error('Cloudflare inference failed');
    return envelope.result;
  },
};
const rateValues = ['JEV_INPUT_PER_MILLION', 'JEV_OUTPUT_PER_MILLION', 'LLM_INPUT_PER_MILLION', 'LLM_OUTPUT_PER_MILLION'].map(key => process.env[key]);
if (rateValues.some(v => v !== undefined && v !== '' && (!Number.isFinite(Number(v)) || Number(v) < 0))) throw new Error('Token rates must be finite nonnegative numbers');
const rates: Rates | null = !mock && rateValues.every(v => v !== undefined && v !== '') ? { jev: { input: Number(rateValues[0]), output: Number(rateValues[1]) }, llm: { input: Number(rateValues[2]), output: Number(rateValues[3]) } } : null;
const rows: Row[] = [];
for (let repeat = 0; repeat < repeats; repeat++) {
  for (const [index, fixture] of fixtures.entries()) {
    const fake: Prediction = { decision: { claimType: fixture.expectedType, typeConfidence: fixture.claim.id === 'other-01' ? 0.4 : 0.95, fraudRisk: fixture.expectedRisk, riskConfidence: 0.95, needsReviewProbability: fixture.reviewRequired ? 0.9 : 0.02 }, model: 'mock-fixture-oracle', usage: null };
    const providers = { jev: async () => mock ? fake : evaluateJev(ai, fixture.claim, models.jev), llm: async () => mock ? fake : evaluateLlm(ai, fixture.claim, models.llm) };
    // Alternate order to reduce systematic first-call bias; no warm-up calls are excluded.
    const modes: Array<'hybrid' | 'llm_only'> = (index + repeat) % 2 ? ['llm_only', 'hybrid'] : ['hybrid', 'llm_only'];
    for (const mode of modes) {
      const start = performance.now();
      let prediction: Prediction | null = null;
      let attempts: Attempt[];
      let autoResolved = false;
      if (mode === 'hybrid') {
        const result = await triage(fixture.claim, providers);
        const decision = result.fallbackDecision ?? result.decision;
        prediction = decision ? { decision, model: 'hybrid', usage: null } : null;
        attempts = result.attempts;
        autoResolved = result.route === 'auto_resolved';
      } else {
        try {
          prediction = await withTimeout(providers.llm(), 8000);
          attempts = [{ provider: 'llm', model: prediction.model, usage: prediction.usage, status: 'ok', latencyMs: performance.now() - start }];
        } catch { attempts = [{ provider: 'llm', model: null, usage: null, status: 'error', latencyMs: performance.now() - start }]; }
      }
      rows.push({ mode, claimId: fixture.claim.id, latencyMs: performance.now() - start, correct: prediction?.decision.claimType === fixture.expectedType, riskAbsoluteError: prediction ? Math.abs(prediction.decision.fraudRisk - fixture.expectedRisk) : null, autoResolved, unsafeAuto: autoResolved && fixture.reviewRequired, error: attempts.some(a => a.status === 'error'), estimatedCostUsd: cost(attempts, rates) });
    }
  }
}
const report = { kind: mock ? 'MOCK HARNESS CHECK — NOT MODEL PERFORMANCE' : 'live synthetic evaluation', timestamp: new Date().toISOString(), models, rates, policy: defaultPolicy, repeats, fixtureCount: fixtures.length, hybrid: summarize(rows.filter(r => r.mode === 'hybrid')), llmOnly: summarize(rows.filter(r => r.mode === 'llm_only')), rows };
await mkdir('benchmark-results', { recursive: true });
await writeFile(`benchmark-results/${mock ? 'mock' : 'live'}-${Date.now()}.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, rows: undefined }, null, 2));
