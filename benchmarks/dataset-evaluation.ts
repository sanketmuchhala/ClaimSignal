import { mkdir, writeFile } from 'node:fs/promises';
import { loadVehicle, datasetInfo, featureNames } from './datasets/vehicle.ts';
import type { Split } from './datasets/vehicle.ts';
import { fraudMetrics } from './fraud-metrics.ts';
import { trainNaiveBayes } from './naive-bayes.ts';

const examples = await loadVehicle();
const splits = Object.fromEntries((['train', 'validation', 'test'] as Split[]).map(split => [split, examples.filter(e => e.split === split)])) as Record<Split, typeof examples>;
const predict = trainNaiveBayes(splits.train);
const score = (split: Split) => splits[split].map(e => ({ label: e.fraud, score: predict(e.features) }));
const validation = score('validation');
// Fixed grid; select on validation only. Ties favor higher precision, then higher thresholds.
let best = fraudMetrics(validation, 0);
for (let i = 1; i <= 1000; i++) {
  const candidate = fraudMetrics(validation, i / 1000);
  if (candidate.f1 > best.f1 || (candidate.f1 === best.f1 && candidate.precision >= best.precision)) best = candidate;
}
const test = score('test');
const report = {
  kind: 'MEASURED OFFLINE TABULAR BASELINE — NOT JEV OR LLM RESULTS',
  dataset: datasetInfo,
  totalRows: examples.length,
  totalFraud: examples.filter(e => e.fraud).length,
  totalNonFraud: examples.filter(e => !e.fraud).length,
  uniqueFeatureGroups: new Set(examples.map(e => e.group)).size,
  splitMethod: 'SHA-256 of allowed feature groups with fixed seed; 60/20/20 target proportions; no duplicate feature group crosses partitions',
  splits: Object.fromEntries(Object.entries(splits).map(([name, rows]) => [name, { rows: rows.length, fraud: rows.filter(e => e.fraud).length, nonFraud: rows.filter(e => !e.fraud).length }])),
  model: 'Categorical Naive Bayes with Laplace smoothing; 20 allowed features',
  features: featureNames,
  thresholdSelection: 'Maximum fraud F1 on validation, grid 0..1 step .001; tie-break precision then higher threshold',
  validation: best,
  test: fraudMetrics(test, best.threshold),
  majorityBaseline: fraudMetrics(test.map(s => ({ ...s, score: 0 })), 0.5),
  liveJevEvaluation: 'measured separately; see reports/live-comparison.md',
  limitations: ['Historical auto-only tabular benchmark; does not validate multi-line classification', 'Descriptions are deterministic field renderings, not original narratives', 'Fraud labels do not provide gold review routes or rubric severity scores', 'Random grouped split is not a temporal or external validation', 'Posterior scores are not calibrated probabilities'],
};
await mkdir('reports', { recursive: true });
await writeFile('reports/vehicle-baseline.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
