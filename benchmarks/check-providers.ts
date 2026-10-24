import { loadVehicle } from './datasets/vehicle.ts';
import { evaluateJev } from '../src/jev.ts';
import { evaluateLlm } from '../src/llm.ts';
import type { AI } from '../src/domain.ts';

const account = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
const token = process.env.CLOUDFLARE_API_TOKEN?.trim();
if (!account || !token) throw new Error('Configure Cloudflare Account ID and API token in .env');
const redact = (value: string) => [account, token].reduce((text, secret) => text.replaceAll(secret, '[redacted]'), value).slice(0, 1500);
const ai: AI = {
  async run(model, input) {
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/ai/run`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, input }), signal: AbortSignal.timeout(15000),
    });
    const body = await response.json() as { success?: boolean; result?: unknown; errors?: unknown; messages?: unknown };
    if (!response.ok || body.success !== true) {
      throw new Error(redact(JSON.stringify({ httpStatus: response.status, errors: body.errors, messages: body.messages })));
    }
    console.log(JSON.stringify({ model, httpStatus: response.status, resultKeys: body.result && typeof body.result === 'object' ? Object.keys(body.result) : typeof body.result }));
    return body.result;
  },
};
const claim = (await loadVehicle()).find(e => e.split === 'test')!.claim;
for (const [provider, evaluate, model] of [
  ['jev', evaluateJev, process.env.JEV_MODEL ?? 'typesafe/jev'],
  ['llm', evaluateLlm, process.env.LLM_MODEL ?? '@cf/meta/llama-3.1-8b-instruct-fp8'],
] as const) {
  try {
    const result = await evaluate(ai, claim, model);
    console.log(JSON.stringify({ provider, status: 'ok', model: result.model, usage: result.usage }));
  } catch (error) {
    const cause = error instanceof Error && error.cause && typeof error.cause === 'object' && 'code' in error.cause ? String(error.cause.code) : undefined;
    console.log(JSON.stringify({ provider, status: 'error', error: redact(error instanceof Error ? error.message : String(error)), cause }));
    process.exitCode = 1;
  }
}
