import type { AI } from './domain.ts';
import { parseClaim } from './domain.ts';
import { evaluateJev } from './jev.ts';
import { evaluateLlm } from './llm.ts';
import { triage } from './triage.ts';

export interface Env { AI: AI; TRIAGE_API_KEY: string; JEV_MODEL?: string; LLM_MODEL?: string }
const MAX_BYTES = 32768;
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });

async function readBody(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error('A JSON body is required');
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) { await reader.cancel(); throw new RangeError('Body exceeds 32 KiB'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === '/health' && request.method === 'GET') return json({ service: 'ClaimSignal', status: 'ok' });
    if (path !== '/v1/triage') return json({ error: 'Not found' }, 404);
    if (request.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST' } });
    if (!env.TRIAGE_API_KEY) return json({ error: 'Service authentication is not configured' }, 503);
    if (request.headers.get('Authorization') !== `Bearer ${env.TRIAGE_API_KEY}`) return json({ error: 'Unauthorized' }, 401);
    if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return json({ error: 'Use application/json' }, 415);
    let claim;
    try { claim = parseClaim(await readBody(request)); }
    catch (error) { return json({ error: error instanceof RangeError ? 'Body exceeds 32 KiB' : 'Invalid JSON or claim fields' }, error instanceof RangeError ? 413 : 400); }
    const result = await triage(claim, {
      jev: c => evaluateJev(env.AI, c, env.JEV_MODEL),
      llm: c => evaluateLlm(env.AI, c, env.LLM_MODEL),
    });
    // The caller must persist human_review responses in its own review queue.
    return json({ ...result, requestId: crypto.randomUUID(), policyVersion: 'triage-v1' });
  },
};
