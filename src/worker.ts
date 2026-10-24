import type { AI } from './domain.ts';
import { parseClaim } from './domain.ts';
import { evaluateJev } from './jev.ts';
import { evaluateLlm } from './llm.ts';
import { triage } from './triage.ts';
import type { D1 } from './reviews.ts';
import { findByIdempotencyKey, listReviews, resolveReview, reviewOutcomes, saveResult, sha256 } from './reviews.ts';

// DB and REVIEWER_API_KEY are optional: without DB the service is stateless, as before.
export interface Env { AI: AI; TRIAGE_API_KEY: string; JEV_MODEL?: string; LLM_MODEL?: string; DB?: D1; REVIEWER_API_KEY?: string }
const MAX_BYTES = 32768;
const POLICY_VERSION = 'triage-v2';
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers } });

async function readBytes(request: Request): Promise<Uint8Array<ArrayBuffer>> {
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
  return bytes;
}
const parseJson = (bytes: Uint8Array): unknown => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));

// Compares every byte so response timing does not reveal how much of a key matched.
function authorized(request: Request, key: string): boolean {
  const given = new TextEncoder().encode(request.headers.get('Authorization') ?? ''), expected = new TextEncoder().encode(`Bearer ${key}`);
  let difference = given.length ^ expected.length;
  for (let i = 0; i < expected.length; i++) difference |= expected[i] ^ (given[i] ?? 0);
  return difference === 0;
}
const isJson = (request: Request) => request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() === 'application/json';

async function handleTriage(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST' } });
  if (!env.TRIAGE_API_KEY) return json({ error: 'Service authentication is not configured' }, 503);
  if (!authorized(request, env.TRIAGE_API_KEY)) return json({ error: 'Unauthorized' }, 401);
  if (!isJson(request)) return json({ error: 'Use application/json' }, 415);
  const idempotencyKey = request.headers.get('Idempotency-Key');
  if (idempotencyKey !== null && !/^[A-Za-z0-9._:-]{1,200}$/.test(idempotencyKey)) return json({ error: 'Idempotency-Key must be 1–200 letters, digits, dots, colons, underscores or hyphens' }, 400);
  let bytes;
  try { bytes = await readBytes(request); }
  catch (error) { return json({ error: error instanceof RangeError ? 'Body exceeds 32 KiB' : 'Invalid JSON or claim fields' }, error instanceof RangeError ? 413 : 400); }
  const bodySha256 = await sha256(bytes);
  // Without DB, Idempotency-Key is accepted but has no effect; triage itself has no side effects.
  const key = env.DB ? idempotencyKey : null;
  if (env.DB && key) {
    const stored = await findByIdempotencyKey(env.DB, key);
    if (stored) return stored.bodySha256 === bodySha256 ? json(stored.response, 200, { 'Idempotent-Replayed': 'true' }) : json({ error: 'Idempotency-Key was already used with a different body' }, 422);
  }
  let claim;
  try { claim = parseClaim(parseJson(bytes)); }
  catch { return json({ error: 'Invalid JSON or claim fields' }, 400); }
  const result = await triage(claim, {
    jev: c => evaluateJev(env.AI, c, env.JEV_MODEL),
    llm: c => evaluateLlm(env.AI, c, env.LLM_MODEL),
  });
  const response: Record<string, unknown> = { ...result, requestId: crypto.randomUUID(), policyVersion: POLICY_VERSION, reviewStatus: env.DB && result.route === 'human_review' ? 'pending' : null };
  if (!env.DB) return json(response);
  const saved = await saveResult(env.DB, { requestId: response.requestId as string, idempotencyKey: key, bodySha256, claimId: result.claimId, route: result.route, reason: result.reason, policyVersion: POLICY_VERSION, response, now: new Date().toISOString() });
  // A concurrent request with the same key may have stored its result first.
  if (saved.requestId !== response.requestId) return saved.bodySha256 === bodySha256 ? json(saved.response, 200, { 'Idempotent-Replayed': 'true' }) : json({ error: 'Idempotency-Key was already used with a different body' }, 422);
  return json(response);
}

async function handleReviews(request: Request, env: Env, url: URL): Promise<Response> {
  if (!env.DB || !env.REVIEWER_API_KEY) return json({ error: 'The review queue is not configured' }, 503);
  if (!authorized(request, env.REVIEWER_API_KEY)) return json({ error: 'Unauthorized' }, 401);
  if (url.pathname === '/v1/reviews') {
    if (request.method !== 'GET') return new Response(null, { status: 405, headers: { Allow: 'GET' } });
    const status = url.searchParams.get('status') ?? 'pending', limit = Number(url.searchParams.get('limit') ?? 50);
    if ((status !== 'pending' && status !== 'resolved') || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) return json({ error: 'Use status=pending|resolved and limit=1..100' }, 400);
    return json({ items: await listReviews(env.DB, status, limit) });
  }
  const requestId = url.pathname.slice('/v1/reviews/'.length);
  if (!/^[0-9a-f-]{36}$/.test(requestId)) return json({ error: 'Not found' }, 404);
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST' } });
  if (!isJson(request)) return json({ error: 'Use application/json' }, 415);
  let body: Record<string, unknown>;
  try { body = parseJson(await readBytes(request)) as Record<string, unknown>; }
  catch { return json({ error: 'Invalid JSON' }, 400); }
  const { outcome, reviewer, note = null } = body ?? {};
  if (!reviewOutcomes.includes(outcome as typeof reviewOutcomes[number]) || typeof reviewer !== 'string' || !/^[\x20-\x7E]{1,100}$/.test(reviewer) || (note !== null && (typeof note !== 'string' || note.length > 2000)))
    return json({ error: `Send outcome (${reviewOutcomes.join('|')}), reviewer (1–100 printable characters) and an optional note of up to 2,000 characters` }, 400);
  const { updated, item } = await resolveReview(env.DB, requestId, { outcome: outcome as typeof reviewOutcomes[number], reviewer, note: note as string | null, now: new Date().toISOString() });
  if (updated) return json(item);
  return item ? json({ error: 'This review is already resolved', item }, 409) : json({ error: 'Not found' }, 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health' && request.method === 'GET') return json({ service: 'ClaimSignal', status: 'ok' });
    if (url.pathname === '/v1/triage') return handleTriage(request, env);
    if (url.pathname === '/v1/reviews' || url.pathname.startsWith('/v1/reviews/')) return handleReviews(request, env, url);
    return json({ error: 'Not found' }, 404);
  },
};
