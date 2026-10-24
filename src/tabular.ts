// Categorical Naive Bayes over allowlisted vehicle-claim fields. Parameters are fit offline on the
// training split by `npm run dataset:evaluate`, which writes src/vehicle-fraud-model.ts.
export interface TabularModel {
  name: string;
  features: readonly string[];
  // Index 0 is not fraud, 1 is fraud.
  logPrior: [number, number];
  logLikelihood: Record<string, Record<string, [number, number]>>;
  logUnseen: Record<string, [number, number]>;
  // Chosen on the validation split; scores at or above it are routed to a person.
  threshold: number;
  thresholdSelection: string;
}
export interface TabularSignal { model: string; score: number; threshold: number; flagged: boolean; featuresUsed: number }

// A missing field is left out of the product, which marginalizes it rather than guessing a value.
export function tabularFraudScore(model: TabularModel, fields: Record<string, string>): { score: number; featuresUsed: number } {
  const logp = [model.logPrior[0], model.logPrior[1]];
  let featuresUsed = 0;
  for (const name of model.features) {
    const value = fields[name];
    if (value === undefined) continue;
    const terms = model.logLikelihood[name][value] ?? model.logUnseen[name];
    logp[0] += terms[0]; logp[1] += terms[1];
    featuresUsed++;
  }
  return { score: 1 / (1 + Math.exp(logp[0] - logp[1])), featuresUsed };
}

export function tabularSignal(model: TabularModel, fields: Record<string, string>): TabularSignal {
  const { score, featuresUsed } = tabularFraudScore(model, fields);
  return { model: model.name, score, threshold: model.threshold, flagged: score >= model.threshold, featuresUsed };
}
