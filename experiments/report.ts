import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { analyze } from './analyze.ts';
import type { RunMetadata } from './analyze.ts';
import type { Observation, Plan } from './types.ts';

const flags = new Map<string, string>();
for (const arg of process.argv.slice(2)) {
  const m = /^--(run|out)=(.+)$/.exec(arg);
  if (!m || flags.has(m[1])) throw new Error('Use --run=<directory> [--out=<new-report.json>]');
  flags.set(m[1], m[2]);
}
const directory = flags.get('run');
if (!directory) throw new Error('--run=<directory> is required; analysis makes no provider calls');
const plan: Plan = JSON.parse(await readFile(join(directory, 'plan.json'), 'utf8'));
const run: RunMetadata = JSON.parse(await readFile(join(directory, 'run.json'), 'utf8'));
const checkpoint = await readFile(join(directory, 'observations.jsonl'), 'utf8');
// Reject partial JSON lines instead of silently losing the final attempted claim.
const rows: Observation[] = checkpoint.split('\n').filter(line => line.trim()).map(line => JSON.parse(line));
const report = JSON.stringify(analyze(plan, rows, run), null, 2) + '\n';
if (flags.has('out')) await writeFile(flags.get('out')!, report, { flag: 'wx' });
else process.stdout.write(report);
