export const claimTypes = ['auto', 'property', 'health', 'travel', 'other'] as const;
export type ClaimType = typeof claimTypes[number];
export interface Claim { id: string; description: string; amount: number | null; currency: string | null }
export interface Decision {
  claimType: ClaimType;
  typeConfidence: number;
  fraudRisk: number;
  riskConfidence: number;
  needsReviewProbability: number;
}
export interface Usage { inputTokens: number; outputTokens: number }
export interface Prediction { decision: Decision; model: string; usage: Usage | null }
export interface AI { run(model: string, input: Record<string, unknown>): Promise<unknown> }
export type Provider = (claim: Claim) => Promise<Prediction>;

export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object');
  return value as Record<string, unknown>;
}
export function unit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) throw new Error('Expected a probability in [0, 1]');
  return value;
}
export function parseClaim(value: unknown): Claim {
  const v = record(value);
  if (typeof v.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(v.id)) throw new Error('id must contain 1–80 letters, numbers, underscores or hyphens');
  if (typeof v.description !== 'string' || v.description.trim().length < 10 || v.description.length > 8000) throw new Error('description must contain 10–8000 characters');
  if (v.amount !== null && (typeof v.amount !== 'number' || !Number.isFinite(v.amount) || v.amount < 0 || v.amount > 1e9)) throw new Error('amount must be null or a number between 0 and 1 billion');
  if (v.currency !== null && (typeof v.currency !== 'string' || !/^[A-Z]{3}$/.test(v.currency))) throw new Error('currency must be null or a three-letter uppercase code');
  if ((v.amount === null) !== (v.currency === null)) throw new Error('Unknown amount and currency must both be null');
  return { id: v.id, description: v.description.trim(), amount: v.amount, currency: v.currency };
}
export function parseDecision(value: unknown): Decision {
  const v = record(value);
  if (!claimTypes.includes(v.claimType as ClaimType)) throw new Error('Unknown claim type');
  return { claimType: v.claimType as ClaimType, typeConfidence: unit(v.typeConfidence), fraudRisk: unit(v.fraudRisk), riskConfidence: unit(v.riskConfidence), needsReviewProbability: unit(v.needsReviewProbability) };
}
export function parseUsage(value: unknown): Usage | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const input = v.input_tokens ?? v.prompt_tokens;
  const output = v.output_tokens ?? v.completion_tokens;
  if (typeof input !== 'number' || typeof output !== 'number' || !Number.isSafeInteger(input) || !Number.isSafeInteger(output) || input < 0 || output < 0) return null;
  return { inputTokens: input, outputTokens: output };
}
