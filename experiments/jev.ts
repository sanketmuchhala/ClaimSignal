import { parseUsage, record, unit } from '../src/domain.ts';
import type { Answer, Question } from './types.ts';

function distribution(value: unknown, keys: string[]) {
  const v = record(value);
  if (Object.keys(v).length !== keys.length || keys.some(k => !Object.hasOwn(v, k))) throw new Error('Incomplete probability distribution');
  const p = Object.fromEntries(keys.map(k => [k, unit(v[k])]));
  // The API rounds each entry to two decimal places. Retain reported values; do not normalize here.
  if (Math.abs(Object.values(p).reduce((s, x) => s + x, 0) - 1) > keys.length * 0.005 + 1e-9) throw new Error('Probability sum outside rounding tolerance');
  return p;
}

export function parseAnswer(raw: unknown, question: Question) {
  const result = record(record(raw).result);
  if (typeof result.model !== 'string' || !result.model.trim()) throw new Error('Missing resolved model version');
  const answers = record(result.answers);
  if (Object.keys(answers).length !== 1 || !Object.hasOwn(answers, 'decision')) throw new Error('Expected exactly the requested decision');
  const a = record(answers.decision);
  if (a.type !== question.type) throw new Error('Wrong answer primitive');
  let answer: Answer;
  if (question.type === 'noul') answer = { type: 'noul', noul: unit(a.noul) };
  else if (question.type === 'choice') {
    const probabilities = distribution(a.probabilities, Object.keys(question.criteria));
    if (typeof a.choice !== 'string' || !Object.hasOwn(probabilities, a.choice) || probabilities[a.choice] < Math.max(...Object.values(probabilities))) throw new Error('Choice must select a most probable option');
    answer = { type: 'choice', choice: a.choice, probabilities, confidence: unit(a.confidence) };
  } else {
    const keys = question.criteria.map((_, i) => String(i));
    const probabilities = distribution(a.probabilities, keys);
    const expected = keys.reduce((s, k) => s + Number(k) * probabilities[k], 0);
    const tolerance = 0.005 * (1 + keys.reduce((s, k) => s + Number(k), 0));
    if (typeof a.score !== 'number' || !Number.isFinite(a.score) || a.score < 0 || a.score > keys.length - 1 || Math.abs(a.score - expected) > tolerance + 1e-9) throw new Error('Score inconsistent with rubric distribution');
    answer = { type: 'score', score: a.score, probabilities, confidence: unit(a.confidence) };
  }
  return { answer, resolvedModel: result.model, usage: parseUsage(result.usage) };
}
