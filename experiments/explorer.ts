import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { loadRun } from './io.ts';
import { analyze } from './analyze.ts';
import { baselines } from './baselines.ts';

export async function explorer(directories: string[]): Promise<string> {
  if (!directories.length) throw new Error('At least one captured run is required');
  const entries = [];
  for (const directory of directories) {
    const capture = await loadRun(directory);
    const report = analyze(capture.plan, capture.rows, capture.run);
    const baseline = capture.plan.task.dataset === 'vehicle' && !capture.plan.variant && capture.plan.dataset.split !== 'train' ? await baselines(capture.plan) : null;
    entries.push({ ...capture, report, baseline });
  }
  // JSON is data, never executable source. Escape HTML delimiters to prevent a claim closing the script element.
  const data = JSON.stringify(entries).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const client = await readFile(new URL('./explorer-client.js', import.meta.url), 'utf8');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'">
<title>ClaimSignal · Experiment explorer</title>
<style>
:root{color-scheme:light;--ink:#172d3b;--muted:#526673;--line:#d8e1e5;--blue:#2563a6;--green:#277b64;--orange:#ad591c}
*{box-sizing:border-box}body{margin:0;background:#f3f6f7;color:var(--ink);font:15px/1.5 system-ui,-apple-system,sans-serif}header{border-bottom:1px solid var(--line);background:white;padding:18px max(24px,calc((100% - 1240px)/2));display:flex;justify-content:space-between;gap:20px}.brand{white-space:nowrap;font-weight:750;letter-spacing:-.5px;font-size:20px}.eyebrow{font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:var(--muted)}main{max-width:1290px;margin:auto;padding:32px 24px 60px}h1{font-size:36px;line-height:1.15;letter-spacing:-1.3px;margin:8px 0 12px}h2{font-size:18px;margin:0 0 12px}p{margin:8px 0}.muted{color:var(--muted)}.intro{display:flex;justify-content:space-between;align-items:end;gap:24px;margin-bottom:24px}.select-block{min-width:310px}label{display:block;font-size:12px;color:var(--muted);margin-bottom:5px}select,input[type=search]{font:inherit;border:1px solid #b8c7ce;background:white;border-radius:7px;padding:9px 12px;max-width:100%;width:100%;color:var(--ink)}select:focus-visible,input:focus-visible,button:focus-visible{outline:3px solid #7db9e0;outline-offset:2px}.warning{background:#fff7df;border:1px solid #e8d59c;border-radius:10px;padding:14px 18px;margin:18px 0}.warning p{margin:4px 0}.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin:20px 0}.card,.panel{border:1px solid var(--line);background:white;border-radius:12px}.card{padding:18px}.value{font-size:28px;font-weight:650;letter-spacing:-1px;margin-top:6px}.small{font-size:12px}.plots{display:grid;grid-template-columns:1fr 1fr;gap:16px}.panel{padding:22px}.panel-head{display:flex;gap:16px;justify-content:space-between;align-items:start}.panel-head select{font-size:12px;max-width:200px}svg{display:block;width:100%;height:auto;overflow:visible}svg text{font:11px system-ui;fill:var(--muted)}.legend{display:flex;gap:18px;flex-wrap:wrap;font-size:12px;margin:8px 0}.dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:5px}.threshold{padding-top:12px;border-top:1px solid var(--line)}input[type=range]{width:100%;accent-color:var(--blue)}.case-panel{margin-top:18px}.filters{display:flex;gap:12px;align-items:center;margin:18px 0}.filters input{flex:1}.filters select{width:210px}.table-wrap{overflow:auto;max-height:360px}table{border-collapse:collapse;width:100%;font-size:13px}th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);position:sticky;top:0;background:#f5f8fa}th,td{padding:12px;border-bottom:1px solid var(--line);white-space:nowrap}button{font:inherit;background:none;border:0;color:var(--blue);cursor:pointer;text-align:left;padding:0}button:hover{text-decoration:underline}.details{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:20px}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f4f7f9;border-radius:7px;font:12px/1.6 ui-monospace,monospace;padding:14px;max-height:350px;overflow:auto}details{margin-top:18px}summary{cursor:pointer;font-weight:600}.empty{color:var(--muted);padding:20px;text-align:center}.meta{overflow-wrap:anywhere;font:11px/1.5 ui-monospace,monospace;margin-top:24px;color:var(--muted)}@media(max-width:850px){.intro{display:block}.select-block{margin-top:20px;min-width:0}.cards{grid-template-columns:1fr 1fr}.plots,.details{grid-template-columns:1fr}h1{font-size:30px}.filters{flex-wrap:wrap}.filters select{width:100%}main{padding:24px 16px}.panel{padding:16px}.panel-head{flex-wrap:wrap}}
</style></head><body>
<header><span class="brand">ClaimSignal<span style="color:var(--blue)"> /</span></span><span class="eyebrow">Decision intelligence lab · local report</span></header>
<main><div class="intro"><div><div class="eyebrow">Claims research notebook</div><h1>Claims, decisions, evidence.</h1><p class="muted">Inspect captured decisions, uncertainty, and the cases behind the numbers.</p></div><div class="select-block"><label for="experiment">Captured experiment</label><select id="experiment"></select></div></div>
<p id="context" class="muted small"></p><div id="warnings" class="warning" role="note"></div>
<div class="cards"><div class="card"><div class="eyebrow">Valid responses</div><div class="value" id="completed"></div><div class="small muted" id="failure-count"></div></div><div class="card"><div class="eyebrow" id="metric-label"></div><div class="value" id="metric"></div><div class="small muted" id="metric-note"></div></div><div class="card"><div class="eyebrow">Median call latency</div><div class="value" id="latency"></div><div class="small muted">Observed in this run</div></div><div class="card"><div class="eyebrow">Ground-truth labels</div><div class="value" id="label-count"></div><div class="small muted" id="label-detail"></div></div></div>
<div class="plots"><section class="panel"><div class="panel-head"><h2 id="calibration-title">Probability calibration</h2><select id="calibration-mode" aria-label="Calibration view"><option value="event">Event probability</option><option value="top">Predicted class probability</option></select></div><svg id="calibration" viewBox="0 0 520 300" role="img" aria-label="Reliability diagram"></svg><div id="calibration-legend" class="legend"></div><p id="calibration-note" class="small muted"></p></section>
<section class="panel"><div class="panel-head"><h2>Abstention explorer</h2><select id="ranking" aria-label="Abstention ranking"><option value="probability">Predicted class probability</option><option value="vendor">Jev confidence statistic</option></select></div><svg id="coverage" viewBox="0 0 520 300" role="img" aria-label="Loss versus coverage"></svg><div class="threshold"><label for="threshold">Minimum acceptance value: <strong id="threshold-value">0.00</strong></label><input id="threshold" type="range" min="0" max="100" value="0"><p id="accepted" class="small" aria-live="polite"></p><p class="small muted">Exploratory threshold. Ties stay together; coverage includes failed and unattempted claims.</p></div></section></div>
<section class="panel case-panel"><div class="panel-head"><h2>Inspect the claims</h2><span id="shown" class="small muted"></span></div><div class="filters"><input id="search" type="search" aria-label="Search claims" placeholder="Search claim ID or supplied facts"><select id="case-filter" aria-label="Case filter"><option value="all">All planned claims</option><option value="errors">Errors and wrong predictions</option><option value="accepted">Accepted at this threshold</option></select></div><div class="table-wrap"><table><thead><tr><th>Claim</th><th>Target</th><th>Prediction</th><th>Status</th><th>Acceptance value</th></tr></thead><tbody id="cases"></tbody></table></div><div id="empty" class="empty" hidden>No cases match this filter.</div>
<div class="details"><div><h2 id="selected-title">Select a claim</h2><pre id="claim-source">Select a claim to inspect its supplied facts.</pre></div><div><h2>Captured answer</h2><pre id="raw-answer">Raw responses appear here.</pre></div></div><details><summary>Exact question and experiment limitations</summary><pre id="question"></pre><ul id="limitations"></ul></details></section><p id="metadata" class="meta"></p>
</main><script type="application/json" id="experiment-data">${data}</script><script>${client}</script></body></html>\n`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const runs: string[] = []; let output: string | undefined;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--run=')) runs.push(arg.slice(6));
    else if (arg.startsWith('--out=') && !output) output = arg.slice(6);
    else throw new Error('Use --run=<directory> (repeatable) --out=<new.html>');
  }
  if (!output) throw new Error('--out=<new.html> is required');
  await writeFile(output, await explorer(runs), { flag: 'wx' });
  console.log(`Wrote offline explorer: ${output}`);
}
