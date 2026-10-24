export interface ScoredLabel { label: 0 | 1; score: number }
export function fraudMetrics(samples: ScoredLabel[], threshold = 0.5) {
  if (!samples.length || !Number.isFinite(threshold) || threshold < 0 || threshold > 1 || samples.some(s => ![0, 1].includes(s.label) || !Number.isFinite(s.score) || s.score < 0 || s.score > 1)) throw new Error('Invalid binary evaluation samples or threshold');
  let tp = 0, fp = 0, tn = 0, fn = 0;
  for (const s of samples) {
    if (s.score >= threshold) { if (s.label) tp++; else fp++; }
    else { if (s.label) fn++; else tn++; }
  }
  const positives = tp + fn, negatives = tn + fp;
  const sorted = [...samples].sort((a, b) => b.score - a.score);
  let seenPositive = 0, seenNegative = 0, concordant = 0, ap = 0;
  for (let i = 0; i < sorted.length;) {
    let j = i, groupPos = 0, groupNeg = 0;
    while (j < sorted.length && sorted[j].score === sorted[i].score) { if (sorted[j].label) groupPos++; else groupNeg++; j++; }
    concordant += groupPos * (negatives - seenNegative - groupNeg) + 0.5 * groupPos * groupNeg;
    seenPositive += groupPos; seenNegative += groupNeg;
    if (positives) ap += (groupPos / positives) * (seenPositive / (seenPositive + seenNegative));
    i = j;
  }
  const precision = tp + fp ? tp / (tp + fp) : 0;
  const recall = positives ? tp / positives : null;
  return { count: samples.length, positives, negatives, prevalence: positives / samples.length, threshold, tp, fp, tn, fn,
    accuracy: (tp + tn) / samples.length, precision, recall,
    f1: 2 * tp + fp + fn ? 2 * tp / (2 * tp + fp + fn) : 0,
    balancedAccuracy: positives && negatives ? (tp / positives + tn / negatives) / 2 : null,
    rocAuc: positives && negatives ? concordant / (positives * negatives) : null,
    averagePrecision: positives ? ap : null,
  };
}
