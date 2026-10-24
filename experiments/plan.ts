import { createHash } from 'node:crypto';
import { fixtures } from '../benchmarks/fixtures.ts';
import { datasetInfo, loadVehicle } from '../benchmarks/datasets/vehicle.ts';
import { modelInput } from '../src/domain.ts';
import { getTask } from './tasks.ts';
import type { Example, Plan, Task } from './types.ts';

// Order is intentional: changing option order must change the experiment hash.
export function hash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
export function requestFor(task: Task, example: Example) { return { state: example.state, questions: { decision: task.question } }; }
export type Selection = { task: string; split?: Plan['dataset']['split']; limit?: number };

export async function createPlan(options: Selection): Promise<Plan> {
  const task = getTask(options.task);
  const split = options.split ?? (task.dataset === 'vehicle' ? 'validation' : 'smoke');
  const limit = options.limit ?? 20;
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('limit must be a positive safe integer');
  let examples: Example[], name: string, sha256: string;
  if (task.dataset === 'vehicle') {
    if (!['train', 'validation', 'test'].includes(split)) throw new Error('Vehicle requires train, validation, or test split');
    examples = (await loadVehicle()).filter(e => e.split === split).map(e => {
      if (task.question.type === 'score' && ![e.features.PoliceReportFiled, e.features.WitnessPresent].every(v => ['Yes', 'No'].includes(v))) throw new Error('Unknown evidence label; no implicit negative');
      return { id: e.claim.id, group: e.group, state: modelInput(e.claim), target: task.question.type === 'score'
        ? { kind: 'ordinal', value: Number(e.features.PoliceReportFiled === 'Yes') + Number(e.features.WitnessPresent === 'Yes') }
        : { kind: 'binary', value: e.fraud } };
    });
    name = datasetInfo.name; sha256 = datasetInfo.localSha256;
  } else {
    if (split !== 'smoke') throw new Error('Synthetic fixtures only support smoke; they are not a held-out dataset');
    examples = fixtures.map(f => {
      if (f.reviewRequired === null || f.expectedRisk === null) throw new Error('Missing fixture labels');
      return { id: f.claim.id, group: f.claim.id, state: modelInput(f.claim), target: task.question.type === 'choice'
        ? { kind: 'category', value: f.expectedType }
        : task.question.type === 'noul' ? { kind: 'binary', value: f.reviewRequired ? 1 : 0 }
          : { kind: 'ordinal', value: f.expectedRisk * 4 } };
    });
    name = 'Existing authored claims smoke fixtures'; sha256 = hash(fixtures);
  }
  if (limit > examples.length) throw new Error(`limit ${limit} exceeds available ${examples.length}; choose an explicit smaller limit`);
  const body: Omit<Plan, 'id'> = {
    schemaVersion: 1, kind: task.dataset === 'vehicle' ? 'HISTORICAL CLAIMS EXPERIMENT' : 'SYNTHETIC SMOKE EXPERIMENT', task,
    dataset: { name, sha256, split, available: examples.length },
    selection: 'claim ID ascending, first N; no label selection', examples: examples.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).slice(0, limit),
  };
  return { ...body, id: hash(body) };
}

export function verifyPlan(plan: Plan): void {
  const { id, ...body } = plan;
  if (plan.schemaVersion !== 1 || hash(body) !== id) throw new Error('Plan hash or schema mismatch');
  if (!plan.examples.length || new Set(plan.examples.map(e => e.id)).size !== plan.examples.length) throw new Error('Empty or duplicate plan examples');
}
