import { readFile, writeFile } from 'node:fs/promises';
import { compare } from './compare.ts';

// Recompute derived summaries only. Captured plans, requests, and responses are immutable evidence.
for (const primitive of ['choice', 'noul', 'score']) {
  const root = new URL(`../reports/experiments/pilot-20261024/${primitive}/`, import.meta.url);
  const plan = JSON.parse(await readFile(new URL('plan.json', root), 'utf8'));
  const run = JSON.parse(await readFile(new URL('run.json', root), 'utf8'));
  const rows = (await readFile(new URL('observations.jsonl', root), 'utf8')).trim().split('\n').map(s => JSON.parse(s));
  await writeFile(new URL('comparison.json', root), JSON.stringify(await compare(plan, rows, run), null, 2) + '\n');
}
console.log('Reproduced three pilot comparisons from committed captures; no inference.');
