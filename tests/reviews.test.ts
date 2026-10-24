import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.ts';
import type { Env } from '../src/worker.ts';
import { reviewQuestions } from '../src/jev.ts';
import { sqliteD1 } from './helpers/d1.ts';

const claim = { id: 'queue-1', description: 'A parked car was struck. Photos and an estimate are attached.', amount: 900, currency: 'USD' };
// Jev answers with every review signal at `review`; high confidence and no fraud indicators.
function jevAI(review: number, calls = { n: 0 }) {
  return { calls, run: async () => {
    calls.n++;
    return { result: { model: 'jev-test', answers: {
      claim_type: { type: 'choice', choice: 'auto', confidence: 1, probabilities: { auto: 1, property: 0, health: 0, travel: 0, other: 0 } },
      fraud_risk: { type: 'score', score: 0, confidence: 1, probabilities: { '0': 1, '1': 0, '2': 0, '3': 0, '4': 0 } },
      ...Object.fromEntries(reviewQuestions.map(k => [k, { type: 'noul', noul: review }])),
    }, usage: { input_tokens: 10, output_tokens: 5 } } };
  } };
}
const env = (review: number, extra: Partial<Env> = {}): Env & { DB: ReturnType<typeof sqliteD1> } => ({ TRIAGE_API_KEY: 'triage-key', REVIEWER_API_KEY: 'reviewer-key', AI: jevAI(review), DB: sqliteD1(), ...extra } as Env & { DB: ReturnType<typeof sqliteD1> });
const triageRequest = (body: unknown = claim, headers: Record<string, string> = {}) => new Request('https://claimsignal.test/v1/triage', { method: 'POST', headers: { Authorization: 'Bearer triage-key', 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
const reviewRequest = (path: string, init: RequestInit = {}, key = 'reviewer-key') => new Request(`https://claimsignal.test${path}`, { ...init, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) } });

test('human-review results join the queue without storing claim text, and resolve once', async () => {
  const e = env(0.95);
  const triaged = await (await worker.fetch(triageRequest(), e)).json() as { requestId: string; route: string; reviewStatus: string };
  assert.equal(triaged.route, 'human_review'); assert.equal(triaged.reviewStatus, 'pending');
  const stored = e.DB.raw.prepare('SELECT * FROM triage_results').all();
  assert.equal(stored.length, 1); assert.ok(!JSON.stringify(stored).includes(claim.description));
  const queue = await (await worker.fetch(reviewRequest('/v1/reviews'), e)).json() as { items: Array<{ requestId: string; reason: string; decision: { claimType: string } }> };
  assert.equal(queue.items.length, 1); assert.equal(queue.items[0].requestId, triaged.requestId); assert.equal(queue.items[0].reason, 'specialist_review_required'); assert.equal(queue.items[0].decision.claimType, 'auto');
  const resolve = () => worker.fetch(reviewRequest(`/v1/reviews/${triaged.requestId}`, { method: 'POST', body: JSON.stringify({ outcome: 'confirmed', reviewer: 'adjuster-7', note: 'Matches the estimate.' }) }), e);
  const first = await resolve();
  assert.equal(first.status, 200); assert.equal((await first.json() as { status: string }).status, 'resolved');
  assert.equal((await resolve()).status, 409);
  assert.equal(((await (await worker.fetch(reviewRequest('/v1/reviews'), e)).json()) as { items: unknown[] }).items.length, 0);
  const resolved = await (await worker.fetch(reviewRequest('/v1/reviews?status=resolved'), e)).json() as { items: Array<{ outcome: string; reviewer: string }> };
  assert.equal(resolved.items[0].outcome, 'confirmed'); assert.equal(resolved.items[0].reviewer, 'adjuster-7');
});

test('auto-resolved results are stored but never queued', async () => {
  const e = env(0.01);
  const triaged = await (await worker.fetch(triageRequest(), e)).json() as { route: string; reviewStatus: unknown };
  assert.equal(triaged.route, 'auto_resolved'); assert.equal(triaged.reviewStatus, null);
  assert.equal(e.DB.raw.prepare('SELECT count(*) AS n FROM triage_results').get()!.n, 1);
  assert.equal(((await (await worker.fetch(reviewRequest('/v1/reviews'), e)).json()) as { items: unknown[] }).items.length, 0);
});

test('an Idempotency-Key replays the stored response and rejects a different body', async () => {
  const calls = { n: 0 }, e = env(0.95, { AI: jevAI(0.95, calls) });
  const first = await worker.fetch(triageRequest(claim, { 'Idempotency-Key': 'submit-42' }), e);
  const again = await worker.fetch(triageRequest(claim, { 'Idempotency-Key': 'submit-42' }), e);
  assert.equal(again.headers.get('Idempotent-Replayed'), 'true');
  assert.deepEqual(await again.json(), await first.json()); assert.equal(calls.n, 1);
  assert.equal((await worker.fetch(triageRequest({ ...claim, amount: 901 }, { 'Idempotency-Key': 'submit-42' }), e)).status, 422);
  assert.equal((await worker.fetch(triageRequest(claim, { 'Idempotency-Key': 'has spaces' }), e)).status, 400);
  const [a, b] = await Promise.all([worker.fetch(triageRequest(claim, { 'Idempotency-Key': 'race' }), e), worker.fetch(triageRequest(claim, { 'Idempotency-Key': 'race' }), e)]);
  assert.equal((await a.json() as { requestId: string }).requestId, (await b.json() as { requestId: string }).requestId);
  assert.equal(e.DB.raw.prepare("SELECT count(*) AS n FROM triage_results WHERE idempotency_key = 'race'").get()!.n, 1);
});

test('reviewer endpoints fail closed and validate input', async () => {
  const e = env(0.95);
  assert.equal((await worker.fetch(reviewRequest('/v1/reviews'), { ...e, REVIEWER_API_KEY: undefined })).status, 503);
  assert.equal((await worker.fetch(reviewRequest('/v1/reviews'), { ...e, DB: undefined } as Env)).status, 503);
  assert.equal((await worker.fetch(reviewRequest('/v1/reviews', {}, 'triage-key'), e)).status, 401);
  assert.equal((await worker.fetch(reviewRequest('/v1/reviews?status=all'), e)).status, 400);
  assert.equal((await worker.fetch(reviewRequest('/v1/reviews?limit=500'), e)).status, 400);
  const { requestId } = await (await worker.fetch(triageRequest(), e)).json() as { requestId: string };
  for (const body of [{ outcome: 'approved', reviewer: 'x' }, { outcome: 'confirmed' }, { outcome: 'confirmed', reviewer: 'x', note: 'n'.repeat(2001) }])
    assert.equal((await worker.fetch(reviewRequest(`/v1/reviews/${requestId}`, { method: 'POST', body: JSON.stringify(body) }), e)).status, 400);
  assert.equal((await worker.fetch(reviewRequest(`/v1/reviews/${crypto.randomUUID()}`, { method: 'POST', body: JSON.stringify({ outcome: 'confirmed', reviewer: 'x' }) }), e)).status, 404);
  assert.equal((await worker.fetch(reviewRequest(`/v1/reviews/${requestId}`), e)).status, 405);
});

test('without a DB binding the service stays stateless', async () => {
  const { DB: _, ...stateless } = env(0.95);
  const body = await (await worker.fetch(triageRequest(claim, { 'Idempotency-Key': 'ignored' }), stateless)).json() as { reviewStatus: unknown; route: string };
  assert.equal(body.route, 'human_review'); assert.equal(body.reviewStatus, null);
});
