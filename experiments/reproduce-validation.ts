import { readFile, writeFile } from 'node:fs/promises';
import { compare } from './compare.ts';
import { loadRun } from './io.ts';
import { uncertainty } from './uncertainty.ts';

// Recompute derived summaries of the declared validation study (see its PROTOCOL.md). Captures are immutable evidence.
// Twelve significant digits: the train-only baseline is refitted here, and Math.log can differ in the last bit between Node versions.
const root = new URL('../reports/experiments/validation-20261024/', import.meta.url);
const stable = (value: unknown) => JSON.stringify(value, (_, v) => typeof v === 'number' ? Number(v.toPrecision(12)) : v, 2) + '\n';
const runs = ['jev-choice', 'jev-noul', 'llm70b-choice'];
const pairs: Array<[string, string]> = [['jev-choice', 'jev-noul'], ['jev-choice', 'llm70b-choice']];
const captures = new Map(await Promise.all(runs.map(async name => [name, await loadRun(new URL(name, root).pathname)] as const)));
for (const [name, capture] of captures) {
  await writeFile(new URL(`${name}/comparison.json`, root), stable(await compare(capture.plan, capture.rows, capture.run)));
  await writeFile(new URL(`${name}/uncertainty.json`, root), stable(await uncertainty(capture)));
}
for (const [left, right] of pairs) await writeFile(new URL(`${left}-vs-${right}.json`, root), stable(await uncertainty(captures.get(left)!, captures.get(right)!)));

const jev = JSON.parse(await readFile(new URL('jev-choice/uncertainty.json', root), 'utf8'));
const llm = JSON.parse(await readFile(new URL('llm70b-choice/uncertainty.json', root), 'utf8'));
const aucRows = [
  { label: 'Jev Choice', n: jev.counts.answered, metric: jev.model.rocAuc, color: '#b42318' },
  { label: 'Train-only Naive Bayes', n: jev.counts.answered, metric: jev.baselines['naive-bayes'].onModelAnswered.rocAuc, color: '#067647' },
  { label: 'Llama 3.3 70B', n: llm.counts.answered, metric: llm.model.rocAuc, color: '#6941c6' },
];
const left = 320;
const width = 530;
const min = 0.25;
const max = 0.9;
const x = (value: number) => left + (value - min) / (max - min) * width;
const tickMarks = [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
const rows = aucRows.map((row, i) => {
  const y = 142 + i * 76;
  return `<text x="24" y="${y - 5}" class="label">${row.label}</text><text x="24" y="${y + 18}" class="small">n = ${row.n.toLocaleString('en-US')} answered claims</text><line x1="${x(row.metric.low)}" y1="${y}" x2="${x(row.metric.high)}" y2="${y}" stroke="${row.color}" stroke-width="4" stroke-linecap="round"/><line x1="${x(row.metric.low)}" y1="${y - 8}" x2="${x(row.metric.low)}" y2="${y + 8}" stroke="${row.color}" stroke-width="2"/><line x1="${x(row.metric.high)}" y1="${y - 8}" x2="${x(row.metric.high)}" y2="${y + 8}" stroke="${row.color}" stroke-width="2"/><circle cx="${x(row.metric.estimate)}" cy="${y}" r="7" fill="${row.color}"/><text x="${x(row.metric.high) + 12}" y="${y + 5}" class="value">${row.metric.estimate.toFixed(3)} [${row.metric.low.toFixed(3)}, ${row.metric.high.toFixed(3)}]</text>`;
}).join('\n');
const ticks = tickMarks.map(value => `<line x1="${x(value)}" y1="110" x2="${x(value)}" y2="350" class="grid"/><text x="${x(value)}" y="372" text-anchor="middle" class="small">${value.toFixed(1)}</text>`).join('\n');
const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 430" role="img" aria-labelledby="title desc">
  <title id="title">Fraud ranking performance on the historical claims validation study</title>
  <desc id="desc">ROC-AUC point estimates and grouped 95 percent bootstrap intervals. Jev Choice: 0.423, interval 0.352 to 0.493, 1,000 claims. Train-only Naive Bayes: 0.762, interval 0.701 to 0.817, 1,000 claims. Llama 3.3 70B: 0.516, interval 0.393 to 0.638, 250 claims.</desc>
  <style>text{font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;fill:#101828}.title{font-size:20px;font-weight:700}.subtitle{font-size:13px;fill:#475467}.label{font-size:15px;font-weight:600}.small{font-size:12px;fill:#667085}.value{font-size:12px;font-weight:600}.grid{stroke:#e4e7ec;stroke-width:1}.chance{stroke:#667085;stroke-width:1.5;stroke-dasharray:5 5}.axis{stroke:#98a2b3;stroke-width:1}</style>
  <rect width="960" height="430" rx="12" fill="#fff"/>
  <text x="24" y="36" class="title">Fraud ranking on historical claims</text>
  <text x="24" y="61" class="subtitle">ROC-AUC with grouped 95% bootstrap intervals · higher ranks fraud cases above non-fraud cases</text>
  ${ticks}
  <line x1="${x(0.5)}" y1="104" x2="${x(0.5)}" y2="350" class="chance"/>
  <text x="${x(0.5) + 7}" y="98" class="small">chance (0.5)</text>
  ${rows}
  <line x1="${left}" y1="350" x2="${left + width}" y2="350" class="axis"/>
  <text x="${left + width / 2}" y="402" text-anchor="middle" class="small">ROC-AUC</text>
  <text x="24" y="422" class="small">Jev and Naive Bayes: 1,000 claims · Llama: matched first 250 claims · 2,000 grouped bootstrap resamples</text>
</svg>\n`;
await writeFile(new URL('../../figures/validation-roc-auc.svg', root), svg);
console.log(`Reproduced validation summaries for ${runs.length} captures and ${pairs.length} paired comparisons; no inference.`);
