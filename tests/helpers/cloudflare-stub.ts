// Test-only REST stub. Never used by the benchmark's live implementation.
import assert from 'node:assert/strict';
let throttle = Number(process.env.CLAIMSIGNAL_TEST_THROTTLE ?? 0);
globalThis.fetch = async (_url, init) => {
  if (throttle > 0) { throttle--; return Response.json({ success: false, errors: [{ code: 971 }] }, { status: 429 }); }
  if (process.env.CLAIMSIGNAL_TEST_QUOTA === '1') return Response.json({ success: false, errors: [{ message: 'AiError: you have used up your daily free allocation of 10,000 neurons' }] }, { status: 429 });
  if (process.env.CLAIMSIGNAL_TEST_FAILURE === '1') return Response.json({ success: false }, { status: 503 });
  const request = JSON.parse(String(init?.body));
  const claim = request.model === 'typesafe/jev' ? request.input.state : JSON.parse(request.input.messages[1].content);
  assert.equal(claim.amount, null); assert.equal(claim.currency, null);
  assert.ok(!claim.description.includes('FraudFound_P'));
  const result = request.model === 'typesafe/jev' ? {
    state: claim,
    result: {
      model: 'jev-1.13.0',
      answers: {
        claim_type: { type: 'choice', choice: 'auto', confidence: 1, probabilities: { auto: 1, property: 0, health: 0, travel: 0, other: 0 } },
        fraud_risk: { type: 'score', score: 0, confidence: 1, probabilities: { '0': 1, '1': 0, '2': 0, '3': 0, '4': 0 } },
        needs_review: { type: 'noul', noul: 0.02 },
      }, usage: { input_tokens: 100, output_tokens: 20 },
    },
  } : { response: { claimType: 'auto', typeConfidence: 0.9, fraudRisk: 0.1, riskConfidence: 0.9, needsReviewProbability: 0.1 }, usage: { prompt_tokens: 100, completion_tokens: 20 } };
  return Response.json({ success: true, result });
};
