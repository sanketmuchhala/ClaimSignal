import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { analyze } from './analyze.ts';
import { baselines, summarizeBaseline } from './baselines.ts';
import type { Plan, Observation } from './types.ts';
import type { RunMetadata } from './analyze.ts';

export async function compare(plan: Plan, rows: Observation[], run: RunMetadata) {
  const model = analyze(plan, rows, run);
  const baseline = await baselines(plan);
  const successful = new Set(rows.filter(r => r.status === 'ok').map(r => r.exampleId));
  return {
    kind: 'MATCHED CLAIMS COMPARISON', planId: plan.id,
    pairing: { planned: plan.examples.length, matched: successful.size, excludedModelFailuresOrUnattempted: plan.examples.length - successful.size, note: 'Paired predictive metrics use only successful model cases. Model failure counts and full-sample baselines remain visible. No significance claim.' },
    model,
    baseline: { ...baseline, methods: baseline.methods.map(m => ({ ...m,
      paired: summarizeBaseline(m.predictions.filter(p => successful.has(p.exampleId)), plan.task.question.type === 'score' ? 'ordinal' : 'binary', plan.examples.length),
    })) },
  };
}

// Allow tests and other tools to reuse the comparison without starting a CLI.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const flags = new Map<string, string>();
  for (const arg of process.argv.slice(2)) {
    const m = /^--(run|out)=(.+)$/.exec(arg);
    if (!m || flags.has(m[1])) throw new Error('Use --run=<directory> [--out=<new-comparison.json>]');
    flags.set(m[1], m[2]);
  }
  const directory = flags.get('run');
  if (!directory) throw new Error('--run is required');
  const plan = JSON.parse(await readFile(join(directory, 'plan.json'), 'utf8'));
  const run = JSON.parse(await readFile(join(directory, 'run.json'), 'utf8'));
  const rows = (await readFile(join(directory, 'observations.jsonl'), 'utf8')).split('\n').filter(s => s.trim()).map(s => JSON.parse(s));
  const output = JSON.stringify(await compare(plan, rows, run), null, 2) + '\n';
  if (flags.has('out')) await writeFile(flags.get('out')!, output, { flag: 'wx' });
  else process.stdout.write(output);
}
