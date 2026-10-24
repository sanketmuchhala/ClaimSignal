import { datasetInfo, loadVehicle } from '../benchmarks/datasets/vehicle.ts';
import { fitNaiveBayes } from '../benchmarks/naive-bayes.ts';
import { fraudMetrics } from '../benchmarks/fraud-metrics.ts';
import { tabularFraudScore } from '../src/tabular.ts';
import { modelInput } from '../src/domain.ts';
import { hash, verifyPlan } from './plan.ts';
import { probabilityMetrics, selectiveCurve } from './metrics.ts';
import type { Plan } from './types.ts';

export interface BaselinePrediction { exampleId: string; target: number; value: number }
export function summarizeBaseline(predictions: BaselinePrediction[], kind: 'binary' | 'ordinal', planned: number) {
  if (kind === 'ordinal') return { count: predictions.length, mae: predictions.length ? predictions.reduce((s, p) => s + Math.abs(p.target - p.value), 0) / predictions.length : null };
  const samples = predictions.map(p => ({ probability: p.value, outcome: p.target as 0 | 1 }));
  return {
    count: predictions.length, ...probabilityMetrics(samples),
    discrimination: predictions.length ? fraudMetrics(predictions.map(p => ({ label: p.target as 0 | 1, score: p.value }))) : null,
    selective: selectiveCurve(predictions.map(p => ({ confidence: Math.max(p.value, 1 - p.value), loss: Number(Number(p.value >= 0.5) !== p.target), positive: p.target === 1 })), planned),
  };
}

export async function baselines(plan: Plan) {
  verifyPlan(plan);
  if (plan.task.dataset !== 'vehicle' || plan.dataset.sha256 !== datasetInfo.localSha256) throw new Error('Baselines require the pinned vehicle dataset');
  if (!['validation', 'test'].includes(plan.dataset.split)) throw new Error('Evaluate train-only baselines on validation or test, not their training records');
  if (!['vehicle-fraud-choice-v1', 'vehicle-fraud-noul-v1', 'vehicle-evidence-score-v1'].includes(plan.task.id)) throw new Error('No baseline for this task');
  const data = await loadVehicle(), byId = new Map(data.map(e => [e.claim.id, e]));
  const selected = plan.examples.map(e => {
    const source = byId.get(e.id);
    if (!source || source.split !== plan.dataset.split || source.group !== e.group || hash(modelInput(source.claim)) !== hash(e.state)) throw new Error('Plan input differs from pinned dataset');
    const expected = plan.task.question.type === 'score'
      ? Number(source.features.PoliceReportFiled === 'Yes') + Number(source.features.WitnessPresent === 'Yes') : source.fraud;
    if (e.target.value !== expected || e.target.kind !== (plan.task.question.type === 'score' ? 'ordinal' : 'binary')) throw new Error('Plan label differs from source ground truth');
    return source;
  });
  const training = data.filter(e => e.split === 'train');
  const model = { ...fitNaiveBayes(training), name: 'experiment-naive-bayes', threshold: 0.5, thresholdSelection: 'fixed, no tuning' };
  const prior = training.reduce((s, e) => s + e.fraud, 0) / training.length;
  const kind = plan.task.question.type === 'score' ? 'ordinal' : 'binary';
  const methods = kind === 'ordinal' ? ['field-count'] as const : ['train-prior', 'naive-bayes'] as const;
  return {
    schemaVersion: 1, kind: 'MEASURED OFFLINE BASELINES — NOT JEV OR LLM RESULTS', planId: plan.id,
    dataset: plan.dataset,
    // Hash parameters at twelve significant digits: Math.log can differ in the last bit between platforms.
    training: kind === 'binary' ? { split: 'train', count: training.length, sourceSha256: datasetInfo.localSha256, selectedIdsSha256: hash(training.map(e => e.claim.id).sort()), modelSha256: hash(JSON.parse(JSON.stringify(model, (_, v) => typeof v === 'number' ? Number(v.toPrecision(12)) : v))), prior } : null,
    limitations: ['Uses the same allowed information as Jev; tabular models receive parsed fields.', 'Naive Bayes posterior scores are not assumed calibrated. No calibration fitting or threshold tuning.', 'Field count is an exact reading control, not evidence of fraud prediction.', 'Training time and local inference timing are not compared with network latency.'],
    methods: methods.map(method => {
      // Predictions depend on supplied fields or training data, never selected evaluation targets.
      const predictions: BaselinePrediction[] = selected.map(e => ({ exampleId: e.claim.id,
        target: kind === 'ordinal' ? Number(e.features.PoliceReportFiled === 'Yes') + Number(e.features.WitnessPresent === 'Yes') : e.fraud,
        value: method === 'field-count' ? Number(e.features.PoliceReportFiled === 'Yes') + Number(e.features.WitnessPresent === 'Yes')
          : method === 'train-prior' ? prior : tabularFraudScore(model, e.features).score,
      }));
      return { method, predictions, summary: summarizeBaseline(predictions, kind, plan.examples.length) };
    }),
  };
}
