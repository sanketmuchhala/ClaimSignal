import type { Claim, Decision, Prediction, Provider, Usage } from './domain.ts';

export const defaultPolicy = Object.freeze({ confidence: 0.85, maxAutoRisk: 0.25, specialistRisk: 0.7, maxAutoReviewProbability: 0.1, specialistReviewProbability: 0.8 });
export type Policy = typeof defaultPolicy;
export type Route = 'auto_resolved' | 'human_review';
export interface Attempt { provider: 'jev' | 'llm'; model: string | null; latencyMs: number; usage: Usage | null; status: 'ok' | 'error' }
export interface TriageResult {
  claimId: string;
  route: Route;
  reason: string;
  decision: Decision | null;
  fallbackDecision: Decision | null;
  attempts: Attempt[];
  latencyMs: number;
}

export function classifyRoute(d: Decision, policy: Policy = defaultPolicy): 'auto' | 'fallback' | 'human' {
  if (d.fraudRisk >= policy.specialistRisk || d.needsReviewProbability >= policy.specialistReviewProbability) return 'human';
  if (d.claimType !== 'other' && d.typeConfidence >= policy.confidence && d.riskConfidence >= policy.confidence && d.fraudRisk <= policy.maxAutoRisk && d.needsReviewProbability <= policy.maxAutoReviewProbability) return 'auto';
  return 'fallback';
}

export async function withTimeout<T>(operation: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Provider deadline exceeded')), milliseconds); })]);
  } finally { clearTimeout(timer); }
}

export async function triage(claim: Claim, providers: { jev: Provider; llm: Provider }, policy: Policy = defaultPolicy, timeoutMs = 8000): Promise<TriageResult> {
  const started = performance.now();
  const attempts: Attempt[] = [];
  const attempt = async (name: 'jev' | 'llm'): Promise<Prediction | null> => {
    const start = performance.now();
    try {
      const result = await withTimeout(Promise.resolve().then(() => providers[name](claim)), timeoutMs);
      attempts.push({ provider: name, model: result.model, usage: result.usage, latencyMs: performance.now() - start, status: 'ok' });
      return result;
    } catch {
      attempts.push({ provider: name, model: null, usage: null, latencyMs: performance.now() - start, status: 'error' });
      return null;
    }
  };
  const finish = (route: Route, reason: string, decision: Decision | null, fallbackDecision: Decision | null = null): TriageResult => ({ claimId: claim.id, route, reason, decision, fallbackDecision, attempts, latencyMs: performance.now() - started });
  const primary = await attempt('jev');
  if (primary) {
    const route = classifyRoute(primary.decision, policy);
    if (route === 'auto') return finish('auto_resolved', 'high_confidence_low_risk', primary.decision);
    if (route === 'human') return finish('human_review', 'specialist_review_required', primary.decision);
  }
  const fallback = await attempt('llm');
  // LLM confidence is self-reported. It cannot override the primary gate.
  return finish('human_review', fallback ? (primary ? 'low_confidence_llm_assisted' : 'primary_unavailable_llm_assisted') : 'fallback_unavailable', primary?.decision ?? null, fallback?.decision ?? null);
}
