import type { VehicleExample } from './datasets/vehicle.ts';
import { featureNames } from './datasets/vehicle.ts';
import { tabularFraudScore } from '../src/tabular.ts';
import type { TabularModel } from '../src/tabular.ts';

// Laplace-smoothed categorical Naive Bayes; vocabularies are learned from training only.
export function fitNaiveBayes(training: VehicleExample[]): Omit<TabularModel, 'name' | 'threshold' | 'thresholdSelection'> {
  if (!training.length) throw new Error('Training data is empty');
  const classCounts = [0, 0];
  const vocab = new Map<string, Set<string>>(featureNames.map(k => [k, new Set()]));
  const counts = [new Map<string, number>(), new Map<string, number>()];
  for (const example of training) {
    classCounts[example.fraud]++;
    for (const name of featureNames) {
      const value = example.features[name];
      vocab.get(name)!.add(value);
      const key = JSON.stringify([name, value]);
      counts[example.fraud].set(key, (counts[example.fraud].get(key) ?? 0) + 1);
    }
  }
  if (classCounts.some(n => !n)) throw new Error('Both labels must occur in training');
  const term = (label: number, name: string, count: number) => Math.log((count + 1) / (classCounts[label] + vocab.get(name)!.size + 1));
  return {
    features: featureNames,
    logPrior: [Math.log(classCounts[0] / training.length), Math.log(classCounts[1] / training.length)],
    logLikelihood: Object.fromEntries(featureNames.map(name => [name, Object.fromEntries([...vocab.get(name)!].sort().map(value => {
      const key = JSON.stringify([name, value]);
      return [value, [term(0, name, counts[0].get(key) ?? 0), term(1, name, counts[1].get(key) ?? 0)]];
    }))])),
    logUnseen: Object.fromEntries(featureNames.map(name => [name, [term(0, name, 0), term(1, name, 0)]])),
  };
}

export function trainNaiveBayes(training: VehicleExample[]) {
  const model = { ...fitNaiveBayes(training), name: 'unnamed', threshold: 1, thresholdSelection: 'none' };
  return (features: Record<string, string>): number => tabularFraudScore(model, features).score;
}
