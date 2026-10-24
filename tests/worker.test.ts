import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.ts';
import type { Env } from '../src/worker.ts';
const claim = { id: 'api-1', description: 'Vehicle damage from a parking collision.', amount: 100, currency: 'USD' };
const env: Env = { TRIAGE_API_KEY: 'test-only-key', AI: { run: async () => { throw new Error('unavailable'); } } };
function request(body = JSON.stringify(claim), headers = { Authorization: 'Bearer test-only-key', 'Content-Type': 'application/json' }) { return new Request('https://claimsignal.test/v1/triage', { method: 'POST', headers, body }); }

test('health and route handling', async () => {
  assert.equal((await worker.fetch(new Request('https://claimsignal.test/health'), env)).status, 200);
  assert.equal((await worker.fetch(new Request('https://claimsignal.test/missing'), env)).status, 404);
  assert.equal((await worker.fetch(new Request('https://claimsignal.test/v1/triage'), env)).status, 405);
});
test('fails closed without configured authentication', async () => {
  assert.equal((await worker.fetch(request(), { ...env, TRIAGE_API_KEY: '' })).status, 503);
  assert.equal((await worker.fetch(request(undefined, { Authorization: 'Bearer wrong', 'Content-Type': 'application/json' }), env)).status, 401);
});
test('rejects malformed, invalid, oversized and wrong-content-type requests', async () => {
  assert.equal((await worker.fetch(request('{'), env)).status, 400);
  assert.equal((await worker.fetch(request('{}'), env)).status, 400);
  assert.equal((await worker.fetch(request('x'.repeat(32769)), env)).status, 413);
  assert.equal((await worker.fetch(request(undefined, { Authorization: 'Bearer test-only-key', 'Content-Type': 'text/plain' }), env)).status, 415);
});
test('provider failures yield an explicit review disposition without sensitive errors', async () => {
  const response = await worker.fetch(request(), env);
  const body = await response.json() as Record<string, unknown>;
  assert.equal(response.status, 200); assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(body.route, 'human_review'); assert.equal(body.reason, 'fallback_unavailable');
  assert.equal(typeof body.requestId, 'string'); assert.ok(!JSON.stringify(body).includes(claim.description));
});
test('optional vehicle fields add a tabular signal; unknown fields are rejected', async () => {
  const withVehicle = JSON.stringify({ ...claim, vehicle: { Make: 'Honda', PoliceReportFiled: 'No', BasePolicy: 'Collision' } });
  const body = await (await worker.fetch(request(withVehicle), env)).json() as { tabular: { model: string; featuresUsed: number; score: number }; policyVersion: string };
  assert.equal(body.tabular.model, 'vehicle-naive-bayes-v1'); assert.equal(body.tabular.featuresUsed, 3); assert.ok(body.tabular.score > 0 && body.tabular.score < 1);
  assert.equal(body.policyVersion, 'triage-v2');
  assert.equal((await worker.fetch(request(JSON.stringify({ ...claim, vehicle: { Colour: 'red' } })), env)).status, 400);
  const plain = await (await worker.fetch(request(), env)).json() as { tabular: unknown };
  assert.equal(plain.tabular, null);
});
