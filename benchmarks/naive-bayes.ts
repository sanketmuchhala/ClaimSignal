import type { VehicleExample } from './datasets/vehicle.ts';
import { featureNames } from './datasets/vehicle.ts';

// Laplace-smoothed categorical Naive Bayes; vocabularies are learned from training only.
export function trainNaiveBayes(training: VehicleExample[]) {
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
  return (features: Record<string, string>): number => {
    const logp = [0, 1].map(label => {
      let result = Math.log(classCounts[label] / training.length);
      for (const name of featureNames) {
        const count = counts[label].get(JSON.stringify([name, features[name]])) ?? 0;
        result += Math.log((count + 1) / (classCounts[label] + vocab.get(name)!.size + 1));
      }
      return result;
    });
    return 1 / (1 + Math.exp(logp[0] - logp[1]));
  };
}
