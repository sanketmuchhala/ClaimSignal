export interface ProbabilityObservation { probability: number; outcome: 0 | 1 }
export function reliability(samples: readonly ProbabilityObservation[], binCount = 10) {
  if (!Number.isSafeInteger(binCount) || binCount < 1 || binCount > 100) throw new Error('Invalid bin count');
  if (samples.some(s => !Number.isFinite(s.probability) || s.probability < 0 || s.probability > 1 || ![0, 1].includes(s.outcome))) throw new Error('Invalid probability observation');
  const buckets = Array.from({ length: binCount }, () => [] as ProbabilityObservation[]);
  for (const s of samples) buckets[Math.min(binCount - 1, Math.floor(s.probability * binCount))].push(s);
  const bins = buckets.map((values, i) => ({
    lower: i / binCount, upper: (i + 1) / binCount, count: values.length,
    meanProbability: values.length ? values.reduce((s, x) => s + x.probability, 0) / values.length : null,
    observedFrequency: values.length ? values.reduce((s, x) => s + x.outcome, 0) / values.length : null,
  }));
  return {
    count: samples.length, binConvention: '[lower, upper), final bin includes 1', bins,
    expectedCalibrationError: samples.length ? bins.reduce((s, b) => s + (b.count ? b.count / samples.length * Math.abs(b.meanProbability! - b.observedFrequency!) : 0), 0) : null,
  };
}

export function probabilityMetrics(samples: readonly ProbabilityObservation[]) {
  const calibration = reliability(samples);
  const clip = 1e-15;
  return {
    calibration,
    brier: samples.length ? samples.reduce((s, x) => s + (x.probability - x.outcome) ** 2, 0) / samples.length : null,
    logLoss: samples.length ? samples.reduce((s, x) => s - Math.log(Math.max(clip, x.outcome ? x.probability : 1 - x.probability)), 0) / samples.length : null,
    logLossProbabilityFloor: clip,
  };
}

export interface SelectiveObservation { confidence: number; loss: number; positive?: boolean }
// All ties enter together. A confidence threshold cannot cherry-pick successful members of a tie.
export function selectiveCurve(samples: readonly SelectiveObservation[], planned: number) {
  if (!Number.isSafeInteger(planned) || planned < 1 || planned < samples.length || samples.some(s => !Number.isFinite(s.confidence) || s.confidence < 0 || s.confidence > 1 || !Number.isFinite(s.loss) || s.loss < 0)) throw new Error('Invalid selective samples or denominator');
  const sorted = [...samples].sort((a, b) => b.confidence - a.confidence);
  const rows: Array<{ minConfidence: number | null; accepted: number; coverage: number; coverageOfSuccessful: number; meanLoss: number | null; acceptedPositives: number | null }> = [
    { minConfidence: null, accepted: 0, coverage: 0, coverageOfSuccessful: 0, meanLoss: null, acceptedPositives: samples.some(s => s.positive !== undefined) ? 0 : null },
  ];
  let loss = 0, positives = 0;
  for (let i = 0; i < sorted.length;) {
    let j = i;
    while (j < sorted.length && sorted[j].confidence === sorted[i].confidence) {
      loss += sorted[j].loss; positives += Number(sorted[j].positive === true); j++;
    }
    rows.push({ minConfidence: sorted[i].confidence, accepted: j, coverage: j / planned, coverageOfSuccessful: j / samples.length, meanLoss: loss / j, acceptedPositives: rows[0].acceptedPositives === null ? null : positives });
    i = j;
  }
  return rows;
}

export function normalized(probabilities: Record<string, number>) {
  const sum = Object.values(probabilities).reduce((a, b) => a + b, 0);
  if (!Number.isFinite(sum) || sum <= 0 || Object.values(probabilities).some(v => !Number.isFinite(v) || v < 0 || v > 1)) throw new Error('Invalid distribution');
  return Object.fromEntries(Object.entries(probabilities).map(([k, v]) => [k, v / sum]));
}

export function ordinalMetrics(samples: readonly { score: number; probabilities: Record<string, number>; target: number }[]) {
  if (!samples.length) return { count: 0, mae: null, normalizedRankedProbabilityScore: null };
  let absoluteError = 0, rps = 0;
  for (const s of samples) {
    const p = normalized(s.probabilities), n = Object.keys(p).length;
    if (n < 2 || Array.from({ length: n }, (_, i) => String(i)).some(k => !Object.hasOwn(p, k)) || !Number.isInteger(s.target) || s.target < 0 || s.target >= n || !Number.isFinite(s.score) || s.score < 0 || s.score > n - 1) throw new Error('Invalid ordinal observation');
    absoluteError += Math.abs(s.score - s.target);
    let cumulative = 0;
    for (let k = 0; k < n - 1; k++) { cumulative += p[String(k)]; rps += (cumulative - Number(s.target <= k)) ** 2 / (n - 1); }
  }
  return { count: samples.length, mae: absoluteError / samples.length, normalizedRankedProbabilityScore: rps / samples.length };
}
