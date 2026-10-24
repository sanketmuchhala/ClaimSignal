import { readFile, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import type { ClaimType, Decision, Usage } from '../src/domain.ts';
import { classifyRoute, defaultPolicy } from '../src/triage.ts';
import { fraudMetrics } from './fraud-metrics.ts';
import type { ScoredLabel } from './fraud-metrics.ts';
import { pairedBootstrap, quantile, spearman, weightedRanking } from './paired-stats.ts';
import { loadVehicle } from './datasets/vehicle.ts';
import { trainNaiveBayes } from './naive-bayes.ts';

interface Attempt { provider: 'jev' | 'llm'; model: string | null; latencyMs: number; usage: Usage | null; status: 'ok' | 'error' }
interface Checkpoint {
  repeat: number; mode: 'hybrid' | 'llm_only'; claimId: string; latencyMs: number; autoResolved: boolean; error: boolean; estimatedCostUsd: number | null;
  expectedType: ClaimType; expectedRisk: number | null; reviewRequired: boolean | null; expectedFraud?: 0 | 1;
  reason: string | null; decisions: { jev: Decision | null; llm: Decision | null }; attempts: Attempt[];
}
interface Pair { hybrid: Checkpoint; llm_only: Checkpoint }

const args = process.argv.slice(2);
const inputs = args.filter(a => !a.startsWith('--'));
const out = args.find(a => a.startsWith('--out='))?.slice('--out='.length);
if (!inputs.length || inputs.some(i => !/\.jsonl(\.gz)?$/.test(i)) || args.some(a => a.startsWith('--') && !a.startsWith('--out='))) throw new Error('Usage: node benchmarks/compare.ts <run>.jsonl[.gz] [<resumed run>.jsonl[.gz] ...] [--out=report.json]');
// Several checkpoints merge into one evaluation (an interrupted run plus its --offset resumption).
const rows: Checkpoint[] = [];
const runs = [];
const seen = new Set<string>();
for (const input of inputs) {
  const raw = await readFile(input);
  for (const line of (input.endsWith('.gz') ? gunzipSync(raw) : raw).toString('utf8').trim().split('\n')) {
    const row: Checkpoint = JSON.parse(line);
    const key = `${row.repeat}:${row.claimId}:${row.mode}`;
    if (seen.has(key)) throw new Error(`${key} appears in more than one checkpoint row`);
    seen.add(key); rows.push(row);
  }
  const run = await readFile(input.replace(/\.jsonl(\.gz)?$/, '.json'), 'utf8').then(JSON.parse, () => null);
  runs.push({ source: input, ...(run && { kind: run.kind, timestamp: run.timestamp, dataset: run.dataset, split: run.split, offset: run.offset ?? 0, selectedCases: run.selectedCases, repeats: run.repeats, stoppedEarly: run.stoppedEarly, stopReason: run.stopReason ?? null, throttledCalls: run.throttledCalls ?? null, truncation: run.truncation ?? null, plannedPredictions: run.plannedPredictions, completedPredictions: run.completedPredictions, models: run.models, rates: run.rates, policy: run.policy }) });
}
if (rows.some(r => !r.decisions)) throw new Error('Checkpoint predates per-model decisions; rerun benchmarks/run.ts');

const byKey = new Map<string, Partial<Pair>>();
for (const row of rows) byKey.set(`${row.repeat}:${row.claimId}`, { ...byKey.get(`${row.repeat}:${row.claimId}`), [row.mode]: row });
const pairs = [...byKey.values()].filter((p): p is Pair => !!p.hybrid && !!p.llm_only);
// Model-level views of the same paired claims. Hybrid mirrors run.ts: fallback suggestion, else the primary decision.
const pipelines = {
  jev: (p: Pair) => p.hybrid.decisions.jev,
  llm: (p: Pair) => p.llm_only.decisions.llm,
  hybrid: (p: Pair) => p.hybrid.decisions.llm ?? p.hybrid.decisions.jev,
} as const;
type Pipeline = keyof typeof pipelines;
const names = Object.keys(pipelines) as Pipeline[];

const round = (value: number | null, digits = 4) => value === null ? null : Number(value.toFixed(digits));
const share = (count: number, total: number) => total ? round(count / total) : null;
function distribution(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return { count: values.length, mean: round(values.reduce((a, b) => a + b, 0) / values.length, 1), p50: round(quantile(sorted, 0.5), 1), p95: round(quantile(sorted, 0.95), 1), p99: round(quantile(sorted, 0.99), 1), max: round(sorted.at(-1)!, 1) };
}
function countBy<T>(items: T[], key: (item: T) => string) {
  const counts: Record<string, number> = {};
  for (const item of items) counts[key(item)] = (counts[key(item)] ?? 0) + 1;
  return counts;
}

const attempts = rows.flatMap(r => r.attempts);
const operations = Object.fromEntries((['hybrid', 'llm_only'] as const).map(mode => {
  const modeRows = rows.filter(r => r.mode === mode);
  const known = modeRows.flatMap(r => r.estimatedCostUsd === null ? [] : [r.estimatedCostUsd]);
  return [mode, {
    pipelineRuns: modeRows.length,
    latencyMs: distribution(modeRows.map(r => r.latencyMs)),
    modelCallsPerClaim: round(modeRows.reduce((n, r) => n + r.attempts.length, 0) / modeRows.length, 3),
    runsWithAnyError: modeRows.filter(r => r.error).length,
    estimatedCostUsd: { known: round(known.reduce((a, b) => a + b, 0), 6), knownRuns: known.length, unknownRuns: modeRows.length - known.length, per1000ClaimsFromKnown: known.length ? round(known.reduce((a, b) => a + b, 0) / known.length * 1000, 4) : null },
    autoResolved: modeRows.filter(r => r.autoResolved).length,
  }];
}));
const providers = Object.fromEntries((['jev', 'llm'] as const).map(provider => {
  const calls = attempts.filter(a => a.provider === provider), ok = calls.filter(a => a.status === 'ok'), usage = ok.flatMap(a => a.usage ? [a.usage] : []);
  return [provider, {
    calls: calls.length, errors: calls.length - ok.length, errorRate: share(calls.length - ok.length, calls.length),
    models: countBy(ok, a => a.model ?? 'unknown'),
    okLatencyMs: distribution(ok.map(a => a.latencyMs)),
    meanInputTokens: usage.length ? round(usage.reduce((n, u) => n + u.inputTokens, 0) / usage.length, 1) : null,
    meanOutputTokens: usage.length ? round(usage.reduce((n, u) => n + u.outputTokens, 0) / usage.length, 1) : null,
  }];
}));

// Same routing policy applied to each model's own decision. LLM confidence is self-reported, so its
// simulated gate is a counterfactual, not the deployed path (LLM output can never auto-resolve in production).
const gate = Object.fromEntries((['jev', 'llm'] as const).map(model => {
  const routed = pairs.flatMap(p => { const d = pipelines[model](p); return d ? [{ p, route: classifyRoute(d, defaultPolicy) }] : []; });
  return [model, Object.fromEntries((['auto', 'fallback', 'human'] as const).map(route => {
    const group = routed.filter(r => r.route === route), labeled = group.filter(r => r.p.hybrid.expectedFraud !== undefined);
    const fraud = labeled.filter(r => r.p.hybrid.expectedFraud === 1).length;
    const unsafe = group.filter(r => r.p.hybrid.reviewRequired === true).length;
    return [route, { count: group.length, share: share(group.length, routed.length), ...(labeled.length ? { fraud, fraudRate: share(fraud, labeled.length) } : {}), ...(group.some(r => r.p.hybrid.reviewRequired !== null) ? { reviewRequired: unsafe } : {}) }];
  }))];
}));

const vehicle = pairs.length && pairs.every(p => p.hybrid.expectedFraud !== undefined);
const scored = vehicle ? pairs.filter(p => names.every(n => pipelines[n](p))) : [];
const positives = scored.filter(p => p.hybrid.expectedFraud === 1).length;
let fraud = null;
// Ranking metrics need both fraud and non-fraud claims among those every pipeline scored.
if (vehicle && (!positives || positives === scored.length)) fraud = { pairedClaims: pairs.length, scoredByAllPipelines: scored.length, positives, pipelines: null };
else if (vehicle) {
  const samples = Object.fromEntries(names.map(n => [n, scored.map(p => ({ label: p.hybrid.expectedFraud!, score: pipelines[n](p)!.fraudRisk }))])) as Record<Pipeline, ScoredLabel[]>;
  const rankers = Object.fromEntries(names.map(n => [n, weightedRanking(samples[n])])) as Record<Pipeline, ReturnType<typeof weightedRanking>>;
  const metric = (n: Pipeline, key: 'rocAuc' | 'averagePrecision') => (w: Uint32Array) => rankers[n](w)?.[key] ?? null;
  const difference = (a: Pipeline, b: Pipeline, key: 'rocAuc' | 'averagePrecision') => (w: Uint32Array) => { const x = rankers[a](w), y = rankers[b](w); return x && y ? x[key] - y[key] : null; };
  const intervals = pairedBootstrap(scored.length, {
    ...Object.fromEntries(names.flatMap(n => [[`${n}.rocAuc`, metric(n, 'rocAuc')], [`${n}.averagePrecision`, metric(n, 'averagePrecision')]])),
    'jev-llm.rocAuc': difference('jev', 'llm', 'rocAuc'), 'jev-llm.averagePrecision': difference('jev', 'llm', 'averagePrecision'),
    'hybrid-llm.rocAuc': difference('hybrid', 'llm', 'rocAuc'), 'hybrid-llm.averagePrecision': difference('hybrid', 'llm', 'averagePrecision'),
  });
  const ci = (key: string) => intervals[key] ? { low: round(intervals[key].low), high: round(intervals[key].high) } : null;
  const point = (n: Pipeline) => rankers[n]()!;
  // The offline tabular baseline scored on exactly these claims, fit on the training split only.
  const examples = await loadVehicle();
  const byId = new Map(examples.map(e => [e.claim.id, e]));
  const predict = trainNaiveBayes(examples.filter(e => e.split === 'train'));
  const offline = scored.map(p => {
    const example = byId.get(p.hybrid.claimId);
    if (!example || example.split === 'train' || example.fraud !== p.hybrid.expectedFraud) throw new Error(`${p.hybrid.claimId} is missing, in the training split, or relabelled`);
    return { label: example.fraud, score: predict(example.features) };
  });
  const offlineRank = weightedRanking(offline);
  const offlineIntervals = pairedBootstrap(scored.length, {
    rocAuc: w => offlineRank(w)?.rocAuc ?? null, averagePrecision: w => offlineRank(w)?.averagePrecision ?? null,
    'minusJev.rocAuc': w => { const a = offlineRank(w), b = rankers.jev(w); return a && b ? a.rocAuc - b.rocAuc : null; },
    'minusLlm.rocAuc': w => { const a = offlineRank(w), b = rankers.llm(w); return a && b ? a.rocAuc - b.rocAuc : null; },
  });
  const offlineCi = (key: string) => offlineIntervals[key] ? { low: round(offlineIntervals[key].low), high: round(offlineIntervals[key].high) } : null;
  fraud = {
    pairedClaims: pairs.length, scoredByAllPipelines: scored.length, excludedForMissingScores: pairs.length - scored.length,
    positives, bootstrap: { method: 'paired percentile, claims resampled with replacement', resamples: 2000, seed: 20261024 },
    pipelines: Object.fromEntries(names.map(n => {
      const m = fraudMetrics(samples[n], 0.5), scores = samples[n].map(s => s.score);
      const mean = (label: 0 | 1) => { const v = samples[n].filter(s => s.label === label).map(s => s.score); return round(v.reduce((a, b) => a + b, 0) / v.length); };
      return [n, {
        rocAuc: round(point(n).rocAuc), rocAuc95: ci(`${n}.rocAuc`), averagePrecision: round(point(n).averagePrecision), averagePrecision95: ci(`${n}.averagePrecision`),
        atDeclaredCutoff: { threshold: 0.5, flagged: m.tp + m.fp, tp: m.tp, fp: m.fp, fn: m.fn, precision: round(m.precision), recall: round(m.recall), f1: round(m.f1) },
        distinctScores: new Set(scores).size, shareScoredZero: share(scores.filter(s => s === 0).length, scores.length),
        meanScoreFraud: mean(1), meanScoreNonFraud: mean(0),
      }];
    })),
    differences: {
      'jev-llm': { rocAuc: round(point('jev').rocAuc - point('llm').rocAuc), rocAuc95: ci('jev-llm.rocAuc'), averagePrecision: round(point('jev').averagePrecision - point('llm').averagePrecision), averagePrecision95: ci('jev-llm.averagePrecision') },
      'hybrid-llm': { rocAuc: round(point('hybrid').rocAuc - point('llm').rocAuc), rocAuc95: ci('hybrid-llm.rocAuc'), averagePrecision: round(point('hybrid').averagePrecision - point('llm').averagePrecision), averagePrecision95: ci('hybrid-llm.averagePrecision') },
    },
    spearmanJevLlm: round(spearman(samples.jev.map(s => s.score), samples.llm.map(s => s.score))),
    offlineBaselineSameClaims: {
      model: 'Categorical Naive Bayes, 20 allowed tabular fields, fit on the training split', claims: offline.length,
      rocAuc: round(offlineRank()!.rocAuc), rocAuc95: offlineCi('rocAuc'), averagePrecision: round(offlineRank()!.averagePrecision), averagePrecision95: offlineCi('averagePrecision'),
      minusJevRocAuc: round(offlineRank()!.rocAuc - point('jev').rocAuc), minusJevRocAuc95: offlineCi('minusJev.rocAuc'),
      minusLlmRocAuc: round(offlineRank()!.rocAuc - point('llm').rocAuc), minusLlmRocAuc95: offlineCi('minusLlm.rocAuc'),
    },
    // Exploratory, chosen after seeing the fraud rubric results: does either review probability rank fraud?
    exploratoryReviewSignal: Object.fromEntries((['jev', 'llm'] as const).map(n => {
      const review = weightedRanking(scored.map(p => ({ label: p.hybrid.expectedFraud!, score: pipelines[n](p)!.needsReviewProbability })));
      const interval = pairedBootstrap(scored.length, { rocAuc: w => review(w)?.rocAuc ?? null }).rocAuc;
      return [n, { rocAuc: round(review()!.rocAuc), rocAuc95: interval && { low: round(interval.low), high: round(interval.high) } }];
    })),
  };
}

const labeledTypes = pairs.length && pairs.every(p => p.hybrid.expectedRisk !== null && p.hybrid.reviewRequired !== null);
let classification = null;
if (labeledTypes) {
  const perModel = Object.fromEntries(names.map(n => {
    const decided = pairs.map(p => ({ p, d: pipelines[n](p) }));
    const available = decided.filter((x): x is { p: Pair; d: Decision } => !!x.d);
    const risk = available.map(x => Math.abs(x.d.fraudRisk - x.p.hybrid.expectedRisk!));
    return [n, {
      cases: decided.length, missing: decided.length - available.length,
      typeAccuracy: share(available.filter(x => x.d.claimType === x.p.hybrid.expectedType).length, decided.length),
      riskMAE: risk.length ? round(risk.reduce((a, b) => a + b, 0) / risk.length) : null,
      reviewAgreementAtHalf: share(available.filter(x => (x.d.needsReviewProbability >= 0.5) === x.p.hybrid.reviewRequired).length, decided.length),
    }];
  }));
  const fixtures = [...new Set(pairs.map(p => p.hybrid.claimId))].map(id => {
    const group = pairs.filter(p => p.hybrid.claimId === id);
    const types = (n: Pipeline) => countBy(group, p => pipelines[n](p)?.claimType ?? 'missing');
    return { id, expectedType: group[0].hybrid.expectedType, expectedRisk: group[0].hybrid.expectedRisk, reviewRequired: group[0].hybrid.reviewRequired, repeats: group.length, jevTypes: types('jev'), llmTypes: types('llm'), hybridReasons: countBy(group, p => p.hybrid.reason ?? 'none') };
  });
  classification = { pairedRuns: pairs.length, fixtures: fixtures.length, perModel, hybridUnsafeAuto: pairs.filter(p => p.hybrid.autoResolved && p.hybrid.reviewRequired).length, fixturesDetail: fixtures };
}

const report = {
  kind: 'PAIRED LIVE COMPARISON — Jev, LLM-only and hybrid on identical claims',
  runs,
  pairs: pairs.length, unpairedRows: rows.length - pairs.length * 2,
  operations, providers, gate, fraud, classification,
};
if (out) await writeFile(out, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
