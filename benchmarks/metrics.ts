import type { Attempt } from '../src/triage.ts';
export interface Rates { jev: { input: number; output: number }; llm: { input: number; output: number } }
export interface Row {
  mode: 'hybrid' | 'llm_only'; claimId: string; latencyMs: number;
  correct: boolean; riskAbsoluteError: number | null; autoResolved: boolean;
  unsafeAuto: boolean | null; error: boolean; estimatedCostUsd: number | null;
}
export function cost(attempts: Attempt[], rates: Rates | null): number | null {
  if (!rates || attempts.some(a => a.status === 'error' || !a.usage)) return null;
  return attempts.reduce((total, a) => total + (a.usage!.inputTokens * rates[a.provider].input + a.usage!.outputTokens * rates[a.provider].output) / 1e6, 0);
}
export function summarize(rows: Row[]) {
  if (!rows.length) throw new Error('Cannot summarize an empty run');
  const latencies = rows.map(r => r.latencyMs).sort((a, b) => a - b);
  const risk = rows.flatMap(r => r.riskAbsoluteError === null ? [] : [r.riskAbsoluteError]);
  return {
    count: rows.length,
    accuracy: rows.filter(r => r.correct).length / rows.length,
    riskMAE: risk.length ? risk.reduce((a, b) => a + b, 0) / risk.length : null,
    riskEvaluatedCount: risk.length,
    p50Ms: latencies[Math.ceil(latencies.length * 0.5) - 1],
    p95Ms: latencies[Math.ceil(latencies.length * 0.95) - 1],
    errorRate: rows.filter(r => r.error).length / rows.length,
    autoResolvedRate: rows.filter(r => r.autoResolved).length / rows.length,
    reviewLabeledCount: rows.filter(r => r.unsafeAuto !== null).length,
    unsafeAutoCount: rows.some(r => r.unsafeAuto !== null) ? rows.filter(r => r.unsafeAuto === true).length : null,
    estimatedCostUsd: rows.every(r => r.estimatedCostUsd !== null) ? rows.reduce((sum, r) => sum + r.estimatedCostUsd!, 0) : null,
  };
}
