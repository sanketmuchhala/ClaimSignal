import { writeFile } from 'node:fs/promises';
import { compare } from './compare.ts';
import { loadRun } from './io.ts';
import { uncertainty } from './uncertainty.ts';

// Recompute derived summaries of the declared validation study (see its PROTOCOL.md). Captures are immutable evidence.
// Twelve significant digits: the train-only baseline is refitted here, and Math.log can differ in the last bit between Node versions.
const root = new URL('../reports/experiments/validation-20261024/', import.meta.url);
const stable = (value: unknown) => JSON.stringify(value, (_, v) => typeof v === 'number' ? Number(v.toPrecision(12)) : v, 2) + '\n';
const runs = ['jev-choice', 'jev-noul'];
const pairs: Array<[string, string]> = [['jev-choice', 'jev-noul']];
const captures = new Map(await Promise.all(runs.map(async name => [name, await loadRun(new URL(name, root).pathname)] as const)));
for (const [name, capture] of captures) {
  await writeFile(new URL(`${name}/comparison.json`, root), stable(await compare(capture.plan, capture.rows, capture.run)));
  await writeFile(new URL(`${name}/uncertainty.json`, root), stable(await uncertainty(capture)));
}
for (const [left, right] of pairs) await writeFile(new URL(`${left}-vs-${right}.json`, root), stable(await uncertainty(captures.get(left)!, captures.get(right)!)));
console.log(`Reproduced validation summaries for ${runs.length} captures and ${pairs.length} paired comparisons; no inference.`);
