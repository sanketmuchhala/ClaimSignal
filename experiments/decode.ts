import { parseAnswer } from './jev.ts';
import { parseLlm } from './llm.ts';
import type { Question } from './types.ts';

export type Adapter = 'jev' | 'llm-structured-v1';
export function decode(raw: unknown, question: Question, requestedModel: string, adapter: Adapter, input: Record<string, unknown>) {
  if (adapter === 'jev') return parseAnswer(raw, question);
  if (adapter === 'llm-structured-v1') return parseLlm(raw, question, requestedModel, input);
  throw new Error('Unknown experiment adapter');
}
