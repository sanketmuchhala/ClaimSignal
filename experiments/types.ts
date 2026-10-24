import type { Usage } from '../src/domain.ts';

export type Question =
  | { type: 'choice'; instructions: string; criteria: Record<string, string> }
  | { type: 'score'; instructions: string; criteria: readonly string[] }
  | { type: 'noul'; instructions: string };
export type Target = { kind: 'binary'; value: 0 | 1 } | { kind: 'category'; value: string } | { kind: 'ordinal'; value: number };
export interface Task {
  id: string;
  version: 1;
  dataset: 'vehicle' | 'synthetic';
  labelSource: string;
  question: Question;
  positiveOption?: string;
  limitations: readonly string[];
}
export interface Example {
  id: string;
  group: string;
  state: Record<string, unknown>;
  target: Target;
}
export interface Plan {
  schemaVersion: 1;
  kind: 'HISTORICAL CLAIMS EXPERIMENT' | 'SYNTHETIC SMOKE EXPERIMENT';
  task: Task;
  dataset: { name: string; sha256: string; split: 'train' | 'validation' | 'test' | 'smoke'; available: number };
  selection: 'claim ID ascending, first N; no label selection';
  examples: Example[];
  variant?: { id: 'choice-order-reversed-v1' | 'paraphrase-v1' | 'administrative-note-v1'; parentPlanId: string };
  id: string;
}
export type Answer =
  | { type: 'choice'; choice: string; probabilities: Record<string, number>; confidence: number }
  | { type: 'score'; score: number; probabilities: Record<string, number>; confidence: number }
  | { type: 'noul'; noul: number };
export interface Observation {
  schemaVersion: 1;
  planId: string;
  exampleId: string;
  requestHash: string;
  startedAt: string;
  latencyMs: number;
  requestedModel: string;
  resolvedModel: string | null;
  status: 'ok' | 'invalid-response' | 'provider-error';
  answer: Answer | null;
  raw: unknown;
  usage: Usage | null;
  error: string | null;
}
