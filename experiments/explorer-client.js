(() => {
  'use strict';
  const entries = JSON.parse(document.getElementById('experiment-data').textContent);
  const el = id => document.getElementById(id);
  const text = (id, value) => { el(id).textContent = value; };
  const fmt = (n, digits = 3) => n === null || n === undefined ? 'Unavailable' : Number(n).toFixed(digits);
  const colors = ['#2563a6', '#277b64', '#ad591c'];
  // Derived values such as 1 - 0.07 can land just below the two-decimal slider step they display as.
  const atLeast = (value, threshold) => value >= threshold - 1e-9;
  let current, cases, curve;
  const node = (name, attrs, label) => {
    const n = document.createElementNS('http://www.w3.org/2000/svg', name);
    for (const [key, value] of Object.entries(attrs)) n.setAttribute(key, String(value));
    if (label !== undefined) n.textContent = label;
    return n;
  };
  function axes(id, yMax, xLabel, yLabel) {
    const svg = el(id); svg.replaceChildren();
    const x = v => 54 + v * 440, y = v => 254 - v / yMax * 224;
    for (let i = 0; i <= 4; i++) {
      const t = i / 4;
      svg.append(node('line', { x1: 54, x2: 494, y1: y(t * yMax), y2: y(t * yMax), stroke: '#e2e8ec' }));
      svg.append(node('text', { x: 45, y: y(t * yMax) + 4, 'text-anchor': 'end' }, (t * yMax).toFixed(2)));
      svg.append(node('text', { x: x(t), y: 273, 'text-anchor': 'middle' }, t.toFixed(2)));
    }
    svg.append(node('text', { x: 274, y: 295, 'text-anchor': 'middle' }, xLabel));
    svg.append(node('text', { x: 54, y: 15 }, yLabel));
    return { svg, x, y };
  }
  function legend(id, items) {
    el(id).replaceChildren();
    items.forEach((item, i) => {
      const label = document.createElement('span'), dot = document.createElement('span');
      dot.className = 'dot'; dot.style.background = colors[i]; label.append(dot, document.createTextNode(item)); el(id).append(label);
    });
  }
  function calibration() {
    const r = current.report, ordinal = r.ordinal !== null;
    el('calibration-mode').disabled = ordinal;
    const { svg, x, y } = axes('calibration', 1, 'Mean predicted probability', 'Observed frequency');
    if (ordinal) {
      text('calibration-title', 'Ordinal score evidence');
      svg.append(node('text', { x: 274, y: 120, 'text-anchor': 'middle' }, 'Rubric positions are not event probabilities.'));
      svg.append(node('text', { x: 274, y: 150, 'text-anchor': 'middle' }, 'MAE: ' + fmt(r.ordinal.mae) + ' · RPS: ' + fmt(r.ordinal.normalizedRankedProbabilityScore)));
      text('calibration-note', 'Inspect label coverage and individual rubric distributions below.');
      legend('calibration-legend', []); return;
    }
    text('calibration-title', 'Probability calibration');
    const event = el('calibration-mode').value === 'event';
    const measure = event ? r.eventProbability?.calibration : r.topLabelCalibration;
    const series = [{ name: r.run.adapter === 'llm-structured-v1' ? 'LLM estimates' : 'Jev', measure }];
    if (event && current.baseline) for (const m of current.baseline.methods) series.push({ name: m.method, measure: m.summary.calibration });
    svg.append(node('line', { x1: x(0), y1: y(0), x2: x(1), y2: y(1), stroke: '#9aaab4', 'stroke-dasharray': '5 5' }));
    series.forEach((s, index) => {
      for (const bin of s.measure?.bins ?? []) {
        if (!bin.count) continue;
        const circle = node('circle', { cx: x(bin.meanProbability), cy: y(bin.observedFrequency), r: 4 + Math.min(6, Math.sqrt(bin.count)), fill: colors[index], opacity: 0.75 });
        circle.append(node('title', {}, s.name + ': n=' + bin.count + ', predicted=' + fmt(bin.meanProbability) + ', observed=' + fmt(bin.observedFrequency)));
        svg.append(circle);
      }
    });
    legend('calibration-legend', series.map(s => s.name));
    text('calibration-note', measure ? 'ECE: ' + fmt(measure.expectedCalibrationError) + '. Point size reflects bin count; hover for values. Small or single-class samples cannot establish calibration.' : 'This task has no binary event probability. Select predicted class probability.');
  }
  function acceptanceValue(c) { return el('ranking').value === 'vendor' ? c?.vendorConfidence : c?.predictedClassProbability; }
  function coverage() {
    const r = current.report, ordinal = r.ordinal !== null;
    curve = el('ranking').value === 'vendor' ? r.selective.byVendorConfidence : r.selective.byPredictedClassProbability;
    const maxLoss = ordinal ? current.plan.task.question.criteria.length - 1 : 1;
    const { svg, x, y } = axes('coverage', maxLoss, 'Coverage of all planned claims', ordinal ? 'Mean absolute rubric error' : 'Classification error rate');
    const points = (curve ?? []).filter(p => p.accepted > 0);
    if (points.length) {
      let path = '';
      points.forEach((p, i) => { path += (i ? ' H ' + x(p.coverage) + ' V ' + y(p.meanLoss) : 'M ' + x(p.coverage) + ' ' + y(p.meanLoss)); });
      svg.append(node('path', { d: path, fill: 'none', stroke: colors[0], 'stroke-width': 2.5 }));
      for (const p of points) {
        const dot = node('circle', { cx: x(p.coverage), cy: y(p.meanLoss), r: 3, fill: colors[0] });
        dot.append(node('title', {}, 'Minimum ' + fmt(p.minConfidence) + '; accepted ' + p.accepted + '; loss ' + fmt(p.meanLoss)));
        svg.append(dot);
      }
    } else svg.append(node('text', { x: 274, y: 130, 'text-anchor': 'middle' }, 'No acceptance curve for this ranking.'));
    const threshold = Number(el('threshold').value) / 100;
    text('threshold-value', threshold.toFixed(2));
    const accepted = (curve ?? []).filter(p => p.minConfidence !== null && atLeast(p.minConfidence, threshold)).at(-1);
    const count = accepted?.accepted ?? 0;
    text('accepted', curve ? count + ' / ' + r.counts.planned + ' claims accepted · coverage ' + fmt(count / r.counts.planned * 100, 1) + '% · loss ' + fmt(accepted?.meanLoss) : 'No threshold result available.');
    if (accepted) svg.append(node('circle', { cx: x(accepted.coverage), cy: y(accepted.meanLoss), r: 7, fill: 'white', stroke: colors[0], 'stroke-width': 2.5 }));
    table();
  }
  function inspect(example, observation) {
    text('selected-title', example.id);
    text('claim-source', JSON.stringify({ target: example.target, suppliedState: example.state }, null, 2));
    // A malformed response keeps its raw output; show the validation error next to it.
    text('raw-answer', observation ? JSON.stringify(observation.status === 'ok' ? observation.raw : { status: observation.status, error: observation.error, raw: observation.raw }, null, 2) : 'No call was recorded for this planned claim.');
  }
  function table() {
    const query = el('search').value.toLowerCase(), filter = el('case-filter').value;
    const threshold = Number(el('threshold').value) / 100;
    const predictions = new Map(current.report.cases.map(c => [c.exampleId, c]));
    const observations = new Map(current.rows.map(r => [r.exampleId, r]));
    const shown = cases.filter(e => {
      const c = predictions.get(e.id), row = observations.get(e.id);
      if (!(e.id + ' ' + JSON.stringify(e.state)).toLowerCase().includes(query)) return false;
      if (filter === 'errors') return !c || c.correct === false || c.absoluteError > 0;
      if (filter === 'accepted') return row?.status === 'ok' && acceptanceValue(c) !== undefined && atLeast(acceptanceValue(c), threshold);
      return true;
    });
    el('cases').replaceChildren();
    for (const e of shown) {
      const c = predictions.get(e.id), row = observations.get(e.id), tr = document.createElement('tr');
      const first = document.createElement('td'), button = document.createElement('button');
      button.textContent = e.id; button.addEventListener('click', () => inspect(e, row)); first.append(button); tr.append(first);
      for (const value of [e.target.value, c?.predicted ?? c?.score ?? '—', row?.status ?? 'unattempted', fmt(acceptanceValue(c))]) {
        const td = document.createElement('td'); td.textContent = String(value); tr.append(td);
      }
      el('cases').append(tr);
    }
    text('shown', shown.length + ' of ' + cases.length + ' planned claims');
    el('empty').hidden = shown.length > 0;
  }
  function select() {
    current = entries[Number(el('experiment').value)]; cases = current.plan.examples;
    const r = current.report;
    text('context', r.kind + ' · ' + r.dataset.split + ' split · ' + (r.resolvedModel ?? 'no successful model response'));
    el('warnings').replaceChildren();
    for (const warning of [...r.sampleWarnings, 'Descriptive experiment: these thresholds are not validated routing policies.']) {
      const p = document.createElement('p'); p.textContent = warning; el('warnings').append(p);
    }
    text('completed', r.counts.succeeded + ' / ' + r.counts.planned);
    text('failure-count', r.counts.failed + ' failed · ' + r.counts.unattempted + ' unattempted');
    text('metric-label', r.ordinal ? 'Rubric MAE' : r.eventProbability ? 'Binary Brier score' : 'Category Brier score');
    text('metric', fmt(r.ordinal?.mae ?? r.eventProbability?.brier ?? r.categoricalDistribution?.brierSumOverClasses));
    text('metric-note', r.ordinal ? 'Original rubric units · lower is better' : 'Valid responses only · lower is better');
    text('latency', fmt(r.operations.p50Ms, 0) + ' ms');
    text('label-count', r.binaryDiscrimination ? r.binaryDiscrimination.positives + ' positive' : Object.keys(r.plannedTargetCounts).length + (r.ordinal ? ' levels' : ' classes'));
    text('label-detail', Object.entries(r.plannedTargetCounts).map(([k, v]) => k + ': ' + v).join(' · '));
    text('question', JSON.stringify(current.plan.task.question, null, 2));
    el('limitations').replaceChildren();
    for (const value of r.limitations) { const li = document.createElement('li'); li.textContent = value; el('limitations').append(li); }
    text('metadata', 'Plan ' + current.plan.id + ' · capture revision ' + r.run.codeRevision + (r.run.workingTreeDirty ? ' (dirty)' : ' (clean)') + ' · all data embedded locally; no network requests');
    el('ranking').options[0].disabled = !r.selective.byPredictedClassProbability;
    el('ranking').options[1].disabled = !r.selective.byVendorConfidence;
    el('ranking').value = r.selective.byPredictedClassProbability ? 'probability' : 'vendor';
    el('calibration-mode').value = r.eventProbability ? 'event' : 'top';
    el('threshold').value = '0'; el('search').value = ''; el('case-filter').value = 'all';
    text('selected-title', 'Select a claim'); text('claim-source', 'Select a claim to inspect its supplied facts.'); text('raw-answer', 'Raw responses appear here.');
    calibration(); coverage();
  }
  entries.forEach((entry, i) => {
    const option = document.createElement('option'); option.value = String(i);
    option.textContent = entry.plan.task.id + (entry.plan.variant ? ' · ' + entry.plan.variant.id : '') + (entry.run.adapter === 'llm-structured-v1' ? ' · LLM' : ' · Jev');
    el('experiment').append(option);
  });
  el('experiment').addEventListener('change', select);
  el('calibration-mode').addEventListener('change', calibration);
  el('ranking').addEventListener('change', coverage);
  el('threshold').addEventListener('input', coverage);
  el('search').addEventListener('input', table);
  el('case-filter').addEventListener('change', table);
  select();
})();
