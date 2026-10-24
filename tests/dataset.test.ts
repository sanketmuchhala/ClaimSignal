import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { parseCsv, loadVehicle, adaptVehicle, featureNames } from '../benchmarks/datasets/vehicle.ts';
import { fraudMetrics } from '../benchmarks/fraud-metrics.ts';
import { trainNaiveBayes } from '../benchmarks/naive-bayes.ts';
import { parseClaim } from '../src/domain.ts';
import { summarize } from '../benchmarks/metrics.ts';

const examples = await loadVehicle();
test('full pinned dataset validates, with correct labels and disjoint groups', () => {
  assert.equal(examples.length, 15420);
  assert.equal(examples.filter(e => e.fraud).length, 923);
  const groups = new Map<string, string>();
  for (const example of examples) {
    assert.ok(!groups.has(example.group) || groups.get(example.group) === example.split);
    groups.set(example.group, example.split);
    assert.equal(example.claim.amount, null); assert.equal(example.claim.currency, null);
    for (const excluded of ['FraudFound_P', 'PolicyNumber', 'RepNumber', 'Sex', 'MaritalStatus', 'AgeOfPolicyHolder', 'Fault', 'NumberOfSuppliments', 'AddressChange_Claim', 'DriverRating']) assert.ok(!example.claim.description.includes(`${excluded}:`));
  }
  assert.deepEqual(['train', 'validation', 'test'].map(s => examples.filter(e => e.split === s).length), [9224, 3186, 3010]);
});
test('target and excluded demographics cannot affect narrative or split', () => {
  const features = examples[0].features;
  const raw = { ...features, PolicyNumber: '1', FraudFound_P: '0', Sex: 'Female', Fault: 'Policy Holder' };
  const a = adaptVehicle(raw), b = adaptVehicle({ ...raw, FraudFound_P: '1', Sex: 'Male', Fault: 'Third Party' });
  assert.deepEqual(a.claim, b.claim); assert.equal(a.split, b.split); assert.equal(a.group, b.group); assert.notEqual(a.fraud, b.fraud);
  assert.equal(featureNames.length, 20);
});
test('CSV handles quoted delimiters, escaped quotes, BOM, CRLF and malformed inputs', () => {
  assert.deepEqual(parseCsv('\uFEFFa,b\r\n"x,y","say ""yes"""\r\n'), [{ a: 'x,y', b: 'say "yes"' }]);
  assert.deepEqual(parseCsv('a,b\n"line\nnext",x'), [{ a: 'line\nnext', b: 'x' }]);
  for (const value of ['a,a\n1,2', 'a,b\n1', 'a,b\n"broken,x', 'a,b\n"x"tail,y']) assert.throws(() => parseCsv(value));
});
test('missing money is explicit and never coerced to zero', () => {
  assert.equal(parseClaim(examples[0].claim).amount, null);
  assert.throws(() => parseClaim({ ...examples[0].claim, currency: 'USD' }));
  assert.throws(() => parseClaim({ ...examples[0].claim, amount: undefined }));
});
test('fraud metrics handle perfect, reversed, tied and single-class rankings', () => {
  const perfect = [{ label: 1 as const, score: 0.9 }, { label: 0 as const, score: 0.1 }];
  assert.equal(fraudMetrics(perfect).rocAuc, 1); assert.equal(fraudMetrics(perfect).averagePrecision, 1);
  assert.equal(fraudMetrics(perfect.map(s => ({ ...s, score: 1 - s.score }))).rocAuc, 0);
  const tied = fraudMetrics(perfect.map(s => ({ ...s, score: 0.2 })));
  assert.equal(tied.rocAuc, 0.5); assert.equal(tied.averagePrecision, 0.5);
  assert.equal(tied.f1, 0); assert.equal(tied.recall, 0);
  assert.equal(fraudMetrics([{ label: 0, score: 0.1 }]).rocAuc, null);
  assert.equal(fraudMetrics([{ label: 0, score: 0.1 }]).averagePrecision, null);
  assert.throws(() => fraudMetrics([{ label: 1, score: NaN }]));
});
test('Naive Bayes fits training features only and handles unseen categories', () => {
  const training = examples.filter(e => e.split === 'train');
  const predict = trainNaiveBayes(training);
  const features = { ...examples.find(e => e.split === 'test')!.features, Make: 'never-seen' };
  const value = predict(features);
  assert.ok(value >= 0 && value <= 1);
  assert.equal(predict({ ...features, FraudFound_P: '1' }), value);
  assert.equal(predict(features), value);
});
test('unknown review labels stay unknown in reports', () => {
  const report = summarize([{ mode: 'hybrid', claimId: 'x', latencyMs: 1, correct: true, riskAbsoluteError: null, autoResolved: true, unsafeAuto: null, error: false, estimatedCostUsd: null }]);
  assert.equal(report.unsafeAutoCount, null); assert.equal(report.riskMAE, null); assert.equal(report.reviewLabeledCount, 0);
});
test('real dataset runner validates all records without credentials and rejects oracle metrics', () => {
  const output = JSON.parse(execFileSync(process.execPath, ['benchmarks/run.ts', '--dataset=vehicle', '--split=all', '--validate-only'], { encoding: 'utf8' }));
  assert.equal(output.selectedCases, 15420);
  const result = spawnSync(process.execPath, ['benchmarks/run.ts', '--dataset=vehicle', '--mock'], { encoding: 'utf8' });
  assert.notEqual(result.status, 0); assert.match(result.stderr, /Mock oracle metrics are not supported/);
});

test('vehicle benchmark uses real adapter paths and checkpoints without fabricated labels', async () => {
  const { mkdtemp, readdir, readFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const cwd = await mkdtemp(join(tmpdir(), 'claimsignal-eval-'));
  try {
    const run = new URL('../benchmarks/run.ts', import.meta.url).pathname;
    const stub = new URL('./helpers/cloudflare-stub.ts', import.meta.url).pathname;
    const result = spawnSync(process.execPath, ['--import', stub, run, '--dataset=vehicle', '--limit=4'], { cwd, encoding: 'utf8', env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: 'test', CLOUDFLARE_API_TOKEN: 'test', BENCHMARK_REPEATS: '1' } });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.completedPredictions, 8); assert.equal(report.hybrid.riskMAE, null); assert.equal(report.hybrid.unsafeAutoCount, null);
    assert.equal(report.fraud.hybrid.evaluatedPredictions, 4); assert.equal(report.fraud.jev_only.evaluatedPredictions, 4);
    const files = await readdir(join(cwd, 'benchmark-results'));
    const checkpoint = await readFile(join(cwd, 'benchmark-results', files.find(f => f.endsWith('.jsonl'))!), 'utf8');
    assert.equal(checkpoint.trim().split('\n').length, 8);
    const lines = checkpoint.trim().split('\n').map(line => JSON.parse(line));
    const hybrid = lines.find(l => l.mode === 'hybrid'), llmOnly = lines.find(l => l.mode === 'llm_only');
    assert.equal(hybrid.decisions.jev.claimType, 'auto'); assert.equal(hybrid.reason, 'high_confidence_low_risk');
    assert.equal(llmOnly.decisions.jev, null); assert.equal(llmOnly.decisions.llm.fraudRisk, 0.1);
    const compare = new URL('../benchmarks/compare.ts', import.meta.url).pathname;
    const comparison = JSON.parse(execFileSync(process.execPath, [compare, join('benchmark-results', files.find(f => f.endsWith('.jsonl'))!)], { cwd, encoding: 'utf8' }));
    assert.equal(comparison.pairs, 4); assert.equal(comparison.fraud.scoredByAllPipelines, 4); assert.equal(comparison.classification, null);
    assert.equal(comparison.gate.jev.auto.count, 4); assert.equal(comparison.providers.llm.calls, 4); assert.equal(comparison.operations.hybrid.modelCallsPerClaim, 1);
    const checkpointPath = join('benchmark-results', files.find(f => f.endsWith('.jsonl'))!);
    assert.throws(() => execFileSync(process.execPath, [compare, checkpointPath, checkpointPath], { cwd, stdio: 'pipe' }), /appears in more than one checkpoint row/);
    const failed = spawnSync(process.execPath, ['--import', stub, run, '--dataset=vehicle', '--limit=12'], { cwd, encoding: 'utf8', env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: 'test', CLOUDFLARE_API_TOKEN: 'test', BENCHMARK_REPEATS: '1', CLAIMSIGNAL_TEST_FAILURE: '1' } });
    assert.equal(failed.status, 1);
    const failureReport = JSON.parse(failed.stdout);
    assert.equal(failureReport.stoppedEarly, true); assert.equal(failureReport.completedPredictions, 20); assert.equal(failureReport.fraud.hybrid.metrics, null);
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

test('throttled pairs are set aside and repeated, and offset resumes the same ordering', async () => {
  const { mkdtemp, readdir, readFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const cwd = await mkdtemp(join(tmpdir(), 'claimsignal-throttle-'));
  try {
    const run = new URL('../benchmarks/run.ts', import.meta.url).pathname;
    const stub = new URL('./helpers/cloudflare-stub.ts', import.meta.url).pathname;
    const env = { ...process.env, CLOUDFLARE_ACCOUNT_ID: 'test', CLOUDFLARE_API_TOKEN: 'test', BENCHMARK_REPEATS: '1', BENCHMARK_THROTTLE_PAUSE_MS: '1' };
    const all = JSON.parse(execFileSync(process.execPath, [run, '--dataset=vehicle', '--limit=5', '--validate-only'], { encoding: 'utf8' }));
    const result = spawnSync(process.execPath, ['--import', stub, run, '--dataset=vehicle', '--offset=2', '--limit=3'], { cwd, encoding: 'utf8', env: { ...env, CLAIMSIGNAL_TEST_THROTTLE: '2' } });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(all.offset, 0); assert.equal(report.offset, 2); assert.equal(report.selectedCases, 3);
    assert.equal(report.throttledCalls, 2); assert.equal(report.repeatedPairs, 1); assert.equal(report.completedPredictions, 6);
    assert.equal(report.hybrid.errorRate, 0); assert.equal(report.llmOnly.errorRate, 0);
    const files = await readdir(join(cwd, 'benchmark-results'));
    const kept = (await readFile(join(cwd, 'benchmark-results', files.find(f => f.endsWith('.jsonl') && !f.endsWith('.throttled.jsonl'))!), 'utf8')).trim().split('\n');
    const setAside = (await readFile(join(cwd, 'benchmark-results', files.find(f => f.endsWith('.throttled.jsonl'))!), 'utf8')).trim().split('\n');
    assert.equal(kept.length, 6); assert.equal(setAside.length, 2); assert.equal(JSON.parse(setAside[0]).try, 0);
    assert.throws(() => execFileSync(process.execPath, [run, '--dataset=synthetic', '--offset=12', '--validate-only'], { stdio: 'pipe' }));
    const quota = spawnSync(process.execPath, ['--import', stub, run, '--dataset=vehicle', '--limit=3'], { cwd, encoding: 'utf8', env: { ...env, CLAIMSIGNAL_TEST_QUOTA: '1' } });
    assert.equal(quota.status, 1);
    const quotaReport = JSON.parse(quota.stdout);
    assert.equal(quotaReport.stoppedEarly, true); assert.match(quotaReport.stopReason, /daily free allocation/); assert.equal(quotaReport.completedPredictions, 0);
  } finally { await rm(cwd, { recursive: true, force: true }); }
});
