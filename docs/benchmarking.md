# Benchmark methodology

The runner compares the full Jev-first triage path with one LLM-only prediction per claim. Both see identical claim text and the same category and risk rubrics. The baseline is a prediction baseline, not an implemented approval workflow; its automatic resolution rate is consequently zero.

Hybrid accuracy uses the fallback suggestion when available, otherwise the primary prediction. Human review is not simulated or counted as a corrected answer. The comparison measures machine suggestions before a reviewer acts. Classification accuracy counts missing predictions as incorrect; risk MAE reports only available predictions together with the evaluated count. Error rate records any failed provider call, even if a fallback succeeds.

Latency uses a monotonic wall clock, includes network time and sequential fallback, and alternates pipeline order. No warm-up samples are discarded. Calls are sequential to avoid uncontrolled concurrency differences. Repeated cases may benefit from provider caching; report repeats, model aliases, execution region, and cache settings with any published result.

Estimated inference cost uses provider-reported token counts and explicitly supplied USD-per-million rates. It excludes Worker CPU, storage, review time, discounts, and unreported cached-token billing. Missing usage or any failed attempt makes that sample's total cost unknown. A timeout may still be billed because a Workers AI binding request cannot be cancelled by the local deadline race. No incomplete cost total is presented as zero.

The fixture set is hand-authored and synthetic: 24 claims, twelve added on 24 October 2026 with labels fixed before any model run. The expected risk values encode the author's rubric interpretation, not adjudicated fraud labels. `unsafeAutoCount` flags automatic handling of fixtures marked for review. It does not measure real-world safety. Before claiming improvements, replace or supplement the set with a separate, consented, representative holdout and report sample sizes, class balance, confidence intervals, and routing coverage alongside accuracy.

`--mock` intentionally returns fixture labels and skips model inference. It verifies plumbing only. Never cite its perfect accuracy or sub-millisecond latency as model results. Live reports are intentionally not committed until they have been generated and reviewed.

## Full public vehicle dataset

`--dataset=vehicle` loads the full pinned Kaggle-associated vehicle claims dataset through the adapter documented in [data/README.md](../data/README.md). `--split=test` is the default (3,010 held-out records); `--split=all` includes all 15,420 records. `--limit=N` selects the first N records in a deterministic hashed-ID ordering, without inspecting labels. Sampled results must be reported as samples. `--validate-only` validates and constructs inputs without calling a provider. The runner rejects `--dataset=vehicle --mock` to prevent oracle results from being presented as measured performance.

```bash
npm run dataset:check
npm run dataset:evaluate
# After configuring .env, start with a small live integration check:
node --env-file=.env benchmarks/run.ts --dataset=vehicle --split=test --limit=20
# Paired evaluation on the complete held-out partition:
node --env-file=.env benchmarks/run.ts --dataset=vehicle --split=test
# Optional full-corpus diagnostic; this is NOT a held-out-only result:
node --env-file=.env benchmarks/run.ts --dataset=vehicle --split=all
```

A paired run makes at least two model calls per selected record, and up to three when the hybrid pipeline uses fallback. Full-corpus evaluation therefore requires 30,840–46,260 calls per repeat. No live runs are started by CI.

For vehicle data, fraud precision/recall/F1, ROC-AUC and average precision compare output risk rankings with binary fraud labels. The default binary comparison cutoff is a declared 0.5 rubric score, not a learned threshold or a calibrated fraud probability. Live thresholds are not tuned on the test set. A future tuning experiment should use the validation split and freeze its choice before evaluating test data.

Gold review routes and rubric severity scores are absent, so `unsafeAutoCount` and risk MAE are `null`. `autoFraud` records automatically routed claims that carry a positive fraud label; it is a diagnostic, not an adjudicated routing-safety metric. Claim-type accuracy is only auto-category agreement, not evidence of multi-line classification performance.

Fraud metrics are conditional on available model scores; `evaluatedPredictions`, completed/planned counts, and provider-error rates must be reported with them. Missing scores are not imputed as non-fraud. Raw per-attempt timings, resolved model names, token usage, expected fraud labels, and predictions are checkpointed to ignored JSONL files after each paired case. Ten consecutive paired cases with no usable output stop the run with a nonzero exit code and an explicitly partial report.

Cloudflare's account rate limiter answers HTTP 429 before any model runs, so a rejected call says nothing about either model. A pair that hits it is written to `<run>.throttled.jsonl`, excluded from metrics, and repeated after a pause that doubles from `BENCHMARK_THROTTLE_PAUSE_MS` (default 60 s, capped at ten times that). Eight rejections of the same pair, or a message that the Workers Free daily allocation is spent, stop the run with a `stopReason`. Resume with `--offset=N`, which continues the same deterministic ordering, and pass every checkpoint to `compare.ts`; it refuses a claim that appears in two of them.

## Review-question experiment

`benchmarks/review-questions.ts` runs Jev alone with the original single review question (v1, frozen in the script) and the current one-per-reason questions (v2) on identical claims, alternating order. It reports review-probability spread, per-reason signals, routing under the unchanged policy, and unsafe auto-resolution on labelled fixtures. Rate-limited calls are retried after a pause.

```bash
BENCHMARK_REPEATS=3 node --env-file=.env benchmarks/review-questions.ts --dataset=synthetic --out=summary.json
node --env-file=.env benchmarks/review-questions.ts --dataset=vehicle --limit=300 --out=summary.json
node benchmarks/review-questions.ts --from=<checkpoint.jsonl[.gz]> --out=summary.json   # recompute without inference
```

## Paired model comparison

Hybrid scores mix models: when Jev routes a claim to the fallback, the hybrid suggestion is the LLM's. Checkpoints therefore record each model's own decision (`decisions.jev`, `decisions.llm`) alongside the route reason. `benchmarks/compare.ts` reads a checkpoint and compares three views of the same claims:

- **Jev**: the primary decision from every hybrid run.
- **LLM**: the LLM-only decision.
- **Hybrid**: the pipeline's final suggestion, as deployed.

```bash
npm run benchmark:compare -- benchmark-results/<run>.jsonl --out=reports/<name>.json
# An interrupted run and its resumption, merged:
npm run benchmark:compare -- benchmark-results/<first>.jsonl benchmark-results/<resumed>.jsonl --out=reports/<name>.json
```

Fraud ROC-AUC and average precision use only claims scored by all three views. Their 95% intervals, and the intervals for the Jev−LLM and hybrid−LLM differences, come from a seeded paired percentile bootstrap (2,000 resamples over claims). Each draw resamples the same claims for every view, so model differences are not inflated by independent sampling noise. Latency, call counts, token usage, provider errors and cost are reported per pipeline and per provider. On vehicle data the offline Naive Bayes baseline is also scored on exactly the compared claims, fit on the training split only, with paired intervals against each model.

`gate` applies the deployed routing policy to each model's own decision. The deployed service never lets LLM output auto-resolve a claim, because LLM confidence is self-reported. The LLM gate is therefore a counterfactual. It shows what the same thresholds would do if that model were primary.

The offline Naive Bayes baseline uses the identical allowed fields. It fits on train, selects a cutoff on validation, and reports test results. It is a separate reproducible comparator; it does not replace Jev in the Worker or masquerade as live inference.
