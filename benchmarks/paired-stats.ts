import type { ScoredLabel } from './fraud-metrics.ts';

// Seeded mulberry32 so published intervals are reproducible from the checkpoint.
export function seededRandom(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = state + 0x6d2b79f5 | 0;
    let t = Math.imul(state ^ state >>> 15, 1 | state);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export function quantile(sorted: readonly number[], q: number): number {
  if (!sorted.length) throw new Error('Cannot take a quantile of no values');
  const position = (sorted.length - 1) * q, low = Math.floor(position), high = Math.ceil(position);
  return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
}

// ROC-AUC and average precision over score-descending tie groups, identical to fraudMetrics
// when every weight is 1. Weights are bootstrap draw counts, so a resample costs O(n) instead of a sort.
export function weightedRanking(samples: readonly ScoredLabel[]) {
  const order = samples.map((_, i) => i).sort((a, b) => samples[b].score - samples[a].score);
  const groups: number[][] = [];
  for (const i of order) {
    const last = groups.at(-1);
    if (last && samples[last[0]].score === samples[i].score) last.push(i); else groups.push([i]);
  }
  return (weights?: ArrayLike<number>): { rocAuc: number; averagePrecision: number } | null => {
    let positives = 0, negatives = 0;
    for (let i = 0; i < samples.length; i++) { const w = weights ? weights[i] : 1; if (samples[i].label) positives += w; else negatives += w; }
    if (!positives || !negatives) return null;
    let seenPositive = 0, seenNegative = 0, concordant = 0, ap = 0;
    for (const group of groups) {
      let groupPos = 0, groupNeg = 0;
      for (const i of group) { const w = weights ? weights[i] : 1; if (samples[i].label) groupPos += w; else groupNeg += w; }
      concordant += groupPos * (negatives - seenNegative - groupNeg) + 0.5 * groupPos * groupNeg;
      seenPositive += groupPos; seenNegative += groupNeg;
      if (groupPos) ap += (groupPos / positives) * (seenPositive / (seenPositive + seenNegative));
    }
    return { rocAuc: concordant / (positives * negatives), averagePrecision: ap };
  };
}

// Paired percentile bootstrap: every statistic sees the same resampled claims in each draw.
export function pairedBootstrap(n: number, statistics: Record<string, (weights: Uint32Array) => number | null>, resamples = 2000, seed = 20261024) {
  if (!Number.isSafeInteger(n) || n < 1) throw new Error('Bootstrap needs at least one paired case');
  const random = seededRandom(seed);
  const draws: Record<string, number[]> = Object.fromEntries(Object.keys(statistics).map(k => [k, []]));
  const weights = new Uint32Array(n);
  for (let r = 0; r < resamples; r++) {
    weights.fill(0);
    for (let i = 0; i < n; i++) weights[Math.floor(random() * n)]++;
    for (const [key, statistic] of Object.entries(statistics)) { const value = statistic(weights); if (value !== null) draws[key].push(value); }
  }
  return Object.fromEntries(Object.entries(draws).map(([key, values]) => {
    values.sort((a, b) => a - b);
    return [key, values.length ? { low: quantile(values, 0.025), high: quantile(values, 0.975), resamples: values.length } : null];
  }));
}

function ranks(values: readonly number[]): number[] {
  const order = values.map((_, i) => i).sort((a, b) => values[a] - values[b]);
  const result = new Array<number>(values.length);
  for (let i = 0; i < order.length;) {
    let j = i;
    while (j < order.length && values[order[j]] === values[order[i]]) j++;
    for (let k = i; k < j; k++) result[order[k]] = (i + j - 1) / 2;
    i = j;
  }
  return result;
}

// Spearman rank correlation with average ranks for ties; null when either side is constant.
export function spearman(x: readonly number[], y: readonly number[]): number | null {
  if (x.length !== y.length || x.length < 2) throw new Error('Spearman needs two equal-length series');
  const rx = ranks(x), ry = ranks(y);
  const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
  const mx = mean(rx), my = mean(ry);
  let covariance = 0, vx = 0, vy = 0;
  for (let i = 0; i < rx.length; i++) { covariance += (rx[i] - mx) * (ry[i] - my); vx += (rx[i] - mx) ** 2; vy += (ry[i] - my) ** 2; }
  return vx && vy ? covariance / Math.sqrt(vx * vy) : null;
}
