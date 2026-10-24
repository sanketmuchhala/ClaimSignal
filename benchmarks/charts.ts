import { readFile, writeFile, mkdir } from 'node:fs/promises';

// Draws the README figures from the committed comparison reports, so a figure can never drift from its numbers.
const vehicle = JSON.parse(await readFile('reports/live/vehicle-comparison.json', 'utf8'));
const synthetic = JSON.parse(await readFile('reports/live/synthetic-comparison.json', 'utf8'));

const palette = { jev: '#2f6fbd', llm: '#c2571a', hybrid: '#5b8c3a', offline: '#6e7781', ink: '#1f2328', muted: '#57606a', grid: '#d8dee4', card: '#ffffff', border: '#d0d7de', auto: '#b42318', fallback: '#d4a72c', human: '#2f6fbd' };
const font = `font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif"`;
const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fixed = (value: number, digits = 3) => value.toFixed(digits);
const thousands = (value: number) => Math.round(value).toLocaleString('en-US');

function frame(width: number, height: number, title: string, note: string, body: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escape(title)}">
<rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="8" fill="${palette.card}" stroke="${palette.border}"/>
<text x="20" y="30" ${font} font-size="15" font-weight="600" fill="${palette.ink}">${escape(title)}</text>
<text x="20" y="50" ${font} font-size="12" fill="${palette.muted}">${escape(note)}</text>
${body}
</svg>
`;
}

function ticks(lo: number, hi: number, step: number) {
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Number(v.toFixed(6)));
  return out;
}

interface Row { label: string; color: string; value: number; low?: number; high?: number; text: string }
// One row per model: dot for the estimate, whisker for the interval, a dashed reference line.
function intervalChart(rows: Row[], domain: [number, number], step: number, reference: { value: number; label: string }, format: (v: number) => string) {
  const width = 720, left = 190, right = 120, top = 72, rowH = 34, plotH = rows.length * rowH, height = top + plotH + 46;
  const x = (v: number) => left + (v - domain[0]) / (domain[1] - domain[0]) * (width - left - right);
  const parts: string[] = [];
  for (const t of ticks(domain[0], domain[1], step)) {
    parts.push(`<line x1="${x(t)}" x2="${x(t)}" y1="${top}" y2="${top + plotH}" stroke="${palette.grid}"/>`);
    parts.push(`<text x="${x(t)}" y="${top + plotH + 18}" ${font} font-size="11" fill="${palette.muted}" text-anchor="middle">${format(t)}</text>`);
  }
  parts.push(`<line x1="${x(reference.value)}" x2="${x(reference.value)}" y1="${top - 6}" y2="${top + plotH}" stroke="${palette.muted}" stroke-dasharray="4 3"/>`);
  parts.push(`<text x="${x(reference.value) + 5}" y="${top + plotH + 36}" ${font} font-size="11" fill="${palette.muted}">${escape(reference.label)}</text>`);
  rows.forEach((row, i) => {
    const y = top + i * rowH + rowH / 2;
    parts.push(`<text x="${left - 14}" y="${y + 4}" ${font} font-size="13" fill="${palette.ink}" text-anchor="end">${escape(row.label)}</text>`);
    if (row.low !== undefined && row.high !== undefined && row.high > row.low) parts.push(`<line x1="${x(row.low)}" x2="${x(row.high)}" y1="${y}" y2="${y}" stroke="${row.color}" stroke-width="3" stroke-linecap="round"/>`);
    parts.push(`<circle cx="${x(row.value)}" cy="${y}" r="5.5" fill="${row.color}"/>`);
    parts.push(`<text x="${x(row.high ?? row.value) + 12}" y="${y + 4}" ${font} font-size="12" fill="${palette.ink}">${escape(row.text)}</text>`);
  });
  return { width, height, body: parts.join('\n') };
}

const f = vehicle.fraud;
const aucRow = (label: string, color: string, p: { rocAuc: number; rocAuc95: { low: number; high: number } | null }): Row =>
  ({ label, color, value: p.rocAuc, low: p.rocAuc95?.low, high: p.rocAuc95?.high, text: fixed(p.rocAuc) });
const auc = intervalChart([
  aucRow('Jev', palette.jev, f.pipelines.jev),
  aucRow('LLM only', palette.llm, f.pipelines.llm),
  aucRow('Hybrid pipeline', palette.hybrid, f.pipelines.hybrid),
  aucRow('Naive Bayes (tabular)', palette.offline, f.offlineBaselineSameClaims),
], [0.4, 0.8], 0.1, { value: 0.5, label: 'chance' }, v => v.toFixed(1));

const ops = vehicle.operations;
const latencyRows = ([['Hybrid pipeline', palette.hybrid, ops.hybrid], ['LLM only', palette.llm, ops.llm_only]] as const);
const latencyMax = Math.ceil(Math.max(...latencyRows.map(([, , o]) => o.latencyMs.p99)) / 1000) * 1000;
const latency = (() => {
  const width = 720, left = 190, right = 40, top = 72, rowH = 44, plotH = latencyRows.length * rowH, height = top + plotH + 52;
  const x = (v: number) => left + v / latencyMax * (width - left - right);
  const parts: string[] = [];
  for (const t of ticks(0, latencyMax, 1000)) {
    parts.push(`<line x1="${x(t)}" x2="${x(t)}" y1="${top}" y2="${top + plotH}" stroke="${palette.grid}"/>`);
    parts.push(`<text x="${x(t)}" y="${top + plotH + 18}" ${font} font-size="11" fill="${palette.muted}" text-anchor="middle">${t === 0 ? '0' : `${t / 1000} s`}</text>`);
  }
  latencyRows.forEach(([label, color, o], i) => {
    const y = top + i * rowH + rowH / 2, l = o.latencyMs;
    parts.push(`<text x="${left - 14}" y="${y + 4}" ${font} font-size="13" fill="${palette.ink}" text-anchor="end">${escape(label)}</text>`);
    parts.push(`<line x1="${x(l.p50)}" x2="${x(l.p99)}" y1="${y}" y2="${y}" stroke="${color}" stroke-opacity="0.35" stroke-width="3" stroke-linecap="round"/>`);
    parts.push(`<circle cx="${x(l.p99)}" cy="${y}" r="4.5" fill="${palette.card}" stroke="${color}" stroke-width="2"/>`);
    parts.push(`<circle cx="${x(l.p95)}" cy="${y}" r="4.5" fill="${palette.card}" stroke="${color}" stroke-width="2"/>`);
    parts.push(`<circle cx="${x(l.p50)}" cy="${y}" r="6" fill="${color}"/>`);
    parts.push(`<text x="${x(l.p50)}" y="${y - 11}" ${font} font-size="12" fill="${palette.ink}" text-anchor="${x(l.p50) < left + 30 ? 'start' : 'middle'}">${thousands(l.p50)} ms</text>`);
  });
  parts.push(`<text x="${left}" y="${top + plotH + 40}" ${font} font-size="11" fill="${palette.muted}">Filled dot: median. Rings: p95 and p99.</text>`);
  return { width, height, body: parts.join('\n') };
})();

const routing = (() => {
  const groups = [
    ['Vehicle claims', vehicle.gate],
    ['Synthetic claims', synthetic.gate],
  ] as const;
  const segments = [['auto', 'Auto-resolved', palette.auto], ['fallback', 'LLM second opinion, then a person', palette.fallback], ['human', 'Straight to a person', palette.human]] as const;
  const width = 720, left = 190, right = 30, top = 92, rowH = 30, groupGap = 26;
  const x = (share: number) => left + share * (width - left - right);
  const parts: string[] = [];
  let cursor = 0;
  segments.forEach(([, label, color]) => {
    parts.push(`<rect x="${20 + cursor}" y="62" width="10" height="10" rx="2" fill="${color}"/>`);
    parts.push(`<text x="${34 + cursor}" y="71" ${font} font-size="12" fill="${palette.muted}">${escape(label)}</text>`);
    cursor += 34 + label.length * 6.2;
  });
  let y = top;
  for (const [group, gate] of groups) {
    parts.push(`<text x="20" y="${y + 4}" ${font} font-size="12" font-weight="600" fill="${palette.muted}">${escape(group)}</text>`);
    y += 12;
    for (const [model, label] of [['jev', 'Jev (deployed)'], ['llm', 'LLM, same thresholds']] as const) {
      parts.push(`<text x="${left - 14}" y="${y + rowH / 2 + 4}" ${font} font-size="13" fill="${palette.ink}" text-anchor="end">${escape(label)}</text>`);
      let start = 0;
      for (const [route, , color] of segments) {
        const share = gate[model][route].share as number;
        if (!share) continue;
        const x0 = x(start), w = x(start + share) - x0;
        parts.push(`<rect x="${x0}" y="${y + 4}" width="${Math.max(1, w - 1.5)}" height="${rowH - 8}" rx="3" fill="${color}"/>`);
        if (w > 46) parts.push(`<text x="${x0 + 7}" y="${y + rowH / 2 + 4}" ${font} font-size="12" fill="#ffffff">${share === 1 ? '100' : (share * 100).toFixed(1)}%</text>`);
        start += share;
      }
      y += rowH;
    }
    y += groupGap;
  }
  return { width, height: y + 4, body: parts.join('\n') };
})();

await mkdir('reports/figures', { recursive: true });
await writeFile('reports/figures/fraud-auc.svg', frame(auc.width, auc.height, `Fraud ROC-AUC on ${thousands(f.scoredByAllPipelines)} held-out vehicle claims`, 'Dots are estimates; bars are paired bootstrap 95% intervals. All four are scored on the same claims.', auc.body));
await writeFile('reports/figures/latency.svg', frame(latency.width, latency.height, `Latency per claim, ${thousands(ops.hybrid.pipelineRuns)} vehicle claims`, 'Wall-clock time from one machine to Cloudflare Workers AI, including network and any fallback call.', latency.body));
await writeFile('reports/figures/routing.svg', frame(routing.width, routing.height, 'Where the same routing policy sends each model\'s claims', 'The deployed service never lets LLM output auto-resolve; the LLM rows show what the same thresholds would do.', routing.body));
console.log('Wrote reports/figures/fraud-auc.svg, latency.svg, routing.svg');
