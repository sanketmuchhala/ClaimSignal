import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Plan, Observation } from './types.ts';
import type { RunMetadata } from './analyze.ts';

export async function loadRun(directory: string): Promise<{ plan: Plan; run: RunMetadata; rows: Observation[] }> {
  const plan = JSON.parse(await readFile(join(directory, 'plan.json'), 'utf8'));
  const run = JSON.parse(await readFile(join(directory, 'run.json'), 'utf8'));
  const checkpoint = await readFile(join(directory, 'observations.jsonl'), 'utf8');
  const rows = checkpoint.split('\n').filter(s => s.trim()).map(s => JSON.parse(s));
  return { plan, run, rows };
}
