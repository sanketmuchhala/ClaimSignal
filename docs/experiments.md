# ClaimSignal experiments

ClaimSignal remains a claims application and an applied Jev research project. The goal is to understand bounded decisions, calibration, abstention, and workflow tradeoffs. Commercial validation is outside this work.

## Baseline audit — 2026-10-24

Baseline commit: `d9e130d`. The working tree was clean before this work. Existing Worker routes, D1 review delivery, tabular model, prompts, fixtures, dataset bytes, and published reports remain the baseline. Use `git show d9e130d:<path>` to inspect an original file without changing the working tree.

- All 41 tests and TypeScript checks pass. The repository has no separate build script; TypeScript runs without emitting and Node executes TypeScript directly.
- Mock harness, full dataset validation, offline model regeneration, and live-report regeneration pass with no tracked differences. Mock output is a plumbing check, never model evidence.
- The vehicle dataset has 15,420 historical records, fixed grouped partitions, and fraud outcome labels. It does not label review need, narrative completeness, or rubric severity. The held-out split has already been examined in earlier research; new exploratory experiments must disclose that exposure.
- There are now 24 authored synthetic claims. These measure behavior against author expectations, not population performance. Repeated calls do not increase the number of independent claims.
- `benchmarks/review-questions.ts` already compares compound and decomposed review questions. Its v2 maximum of four probabilities is a routing statistic, not a probability of the union of those events.
- `src/jev.ts` validates distributions but returns only selected values. Experiments need an independent capture layer that retains raw responses without changing the production contract.

## First milestone

1. Audit and research protocol (this document).
2. Versioned claims experiment definitions, provenance, and deterministic manifests.
3. Explicit live execution with full response capture, failure accounting, and offline planning.
4. Offline calibration and abstention reports with tested metric semantics.

Subsequent independent milestones: matched deterministic/ML and LLM comparisons; question decomposition, wording/order and distractor experiments; grouped uncertainty estimates; interactive result and failure exploration. Do not build these before their inputs are trustworthy.

## Research protocol

- Keep historical reports immutable. New artifacts live in `experiment-results/` and must identify their dataset, labels, question definitions, model, input hashes, and code revision.
- Separate historical outcome prediction from reading explicitly supplied facts. A deterministic parser is the correct baseline for fact-reading tasks; success there is not evidence of predicting fraud.
- Use the existing vehicle partitions. Default new exploration to validation. Freeze task/threshold choices before test evaluation, and disclose prior test exposure. Do not tune on test curves.
- Synthetic tasks must say **synthetic smoke** in plans and reports. Never substitute them for real records when data is missing. Unknown labels stay unknown.
- Choice probabilities and Noul event probabilities can be evaluated against corresponding labels. Vendor `confidence` is a distribution statistic, not the probability of correctness. Score is a position on an ordered rubric, not a fraud probability.
- Preserve unmodified raw distributions. If rounding requires normalization for metrics, describe it and preserve the original values. Report missing/failed calls and coverage denominators.
- Calibration and predictive discrimination are different. Threshold tuning alone does not calibrate probabilities. Calibration plots on small or imbalanced samples are descriptive only.
- Use unique claims/groups for uncertainty analysis; keep repetitions and transformations grouped with their original claim. No confidence intervals based on treating repeats as independent examples.
- No invented latency, costs, predictions, or customer outcomes. Offline fixture responses test code only. Live calls require an explicit execution command and a bounded manifest; never run on import or in CI.

## Running the first experiments

`npm run experiment -- --help` lists tasks. Planning is offline and defaults to 20 validation records (or explicitly labeled synthetic smoke cases):

```bash
npm run experiment -- --task=vehicle-fraud-choice-v1 --limit=20
npm run experiment -- --task=vehicle-fraud-noul-v1 --limit=20
npm run experiment -- --task=vehicle-evidence-score-v1 --limit=20
```

The first two predict the same historical outcome on identical inputs. The score task counts two explicit Yes fields: a field-reading control with deterministic ground truth, not a fraud score. Three `claims-*` tasks use the existing synthetic fixtures for category, review need, and inconsistency severity. No datasets are silently interchanged.

For an intentional live run (may incur charges):

```bash
node --env-file=.env experiments/run.ts --task=vehicle-fraud-choice-v1 --limit=20 --execute --out=experiment-results/fraud-choice-validation-01
```

The output directory must be new. Each run saves `plan.json`, `run.json`, append-only `observations.jsonl`, and `completion.json`. Raw responses and rounded distributions are retained, along with actual resolved model version, usage, timing, request hashes, Git revision, and dirty-tree status. Credentials are never written. A rate limit or authorization failure stops execution without retries; other errors are explicit failed observations. Interrupted runs can be inspected without a completion file. Reruns use a new directory, never overwrite original evidence. This milestone does not implement resume, parallel requests, cost estimates, or threshold tuning.

## Offline analysis

```bash
npm run experiment:report -- --run=experiment-results/fraud-choice-validation-01 --out=experiment-results/fraud-choice-validation-01/report.json
```

The reporter makes no model calls, refuses to overwrite a report, checks request identity, rejects duplicate claims and model-version drift, and re-parses raw responses. It can analyze interrupted runs without `completion.json`; truncated JSON lines cause an error rather than silent omission.

- Binary tasks: Brier score, clipped log loss, event reliability bins/ECE, discrimination, fixed 0.5 threshold, and top-label reliability. Binary Choice and Noul use the same threshold, including ties; the raw selected option remains visible.
- Category tasks: accuracy, class-summed Brier score, log loss, and top-label reliability.
- Score tasks: MAE in rubric units and normalized ranked probability score (mean squared cumulative probability error over the K−1 boundaries). Numeric rubric positions are never evaluated as event probabilities.
- Abstention: loss versus coverage, separately ranked by predicted-class probability and vendor confidence where available. Entire confidence ties enter together. The denominator is all planned claims, including failed and unattempted calls. Ordinal curves use rubric MAE, not classification accuracy.
- Reported probabilities rounded by Jev are normalized by their sum for distribution metrics only. Raw values remain unchanged; the number of affected responses is reported. Log loss uses a stated 1e-15 probability floor for zero-probability outcomes.
- Small-sample plots and ECE do not establish calibration. Reports include bin sizes, class prevalence, failure counts, unique groups, and per-claim errors. There are no uncertainty intervals or calibrated/tuned thresholds in this milestone.

## Matched offline baselines

```bash
npm run experiment:compare -- --run=experiment-results/fraud-choice-validation-01 --out=experiment-results/fraud-choice-validation-01/comparison.json
```

For vehicle fraud, this computes the existing categorical Naive Bayes algorithm and a constant training-prevalence predictor. Both use only the 9,224 training records for fitting. For the evidence-count task, it counts the two source fields directly. Inputs and targets are checked against the pinned dataset before comparison; the baseline cannot silently receive different records. Training split evaluation is rejected.

The artifact records training IDs/model hashes, every baseline prediction, full-sample summaries, and paired summaries on successful model cases. Errors and unattempted cases stay visible; missing model outputs never become negative predictions. Baseline probability scores are evaluated for calibration, not presumed calibrated. No local-compute versus remote-network speed claim is made.

## Paired prompt sensitivity

Use `--variant=choice-order-reversed-v1`, `--variant=paraphrase-v1`, or `--variant=administrative-note-v1` with the same task, split, and limit as a base run. Planning remains offline unless `--execute` is supplied. Option reversal applies only to Choice; paraphrases are defined only for the three historical vehicle tasks. A plan records its parent hash and exact transformation. Variants cannot be stacked.

```bash
npm run experiment -- --task=vehicle-fraud-choice-v1 --limit=20 --variant=choice-order-reversed-v1
npm run experiment:robustness -- --base=experiment-results/base --variant=experiment-results/variant --out=experiment-results/robustness.json
```

The offline comparison verifies the exact declared transformation and same model, then reports paired decision flips, total variation in probability distributions, or absolute changes in rubric score. Unpaired failures remain visible. One response per form does not separate stochastic variation from prompt sensitivity; no statistical significance is claimed. Model outputs and labels are compared in their separate reports. Baselines for transformed inputs are not silently reused; compare those to their unmodified base run explicitly.

## LLM comparison

Use the same task/split/limit, `--provider=llm`, an explicit `--model=<Workers-AI-model>`, and a new output directory with `--execute`. The existing Cloudflare transport is reused. Requests contain exactly the task question and claim state; the raw messages and provider responses are preserved. Generated JSON is validated against the same primitive contract. Malformed JSON remains an invalid response rather than becoming a negative prediction.

`npm run experiment:paired -- --left=<jev-run> --right=<llm-run> --out=<new.json>` verifies identical plans and reports each full run plus metrics on their shared successful cases. `experiment:compare` also works on the LLM run to produce matched deterministic/ML baselines. These are generated probability estimates, not exact next-token probabilities; LLM self-reported confidence is excluded from the Jev-confidence curve. Missing resolved LLM versions are recorded as `unreported:<requested-alias>` and make controlled same-version robustness comparison unavailable.

No new LLM performance is claimed until an explicit live run is captured. Provider choice and model are never silently substituted.

## Offline interactive explorer

```bash
npm run experiment:explore -- --run=reports/experiments/pilot-20261024/choice --run=reports/experiments/pilot-20261024/noul --run=reports/experiments/pilot-20261024/score --out=experiment-results/pilot.html
```

Open the generated HTML file in a browser. It embeds verified captures and uses no network resources. Select a task, inspect event or top-label reliability, move the abstention threshold, filter wrong/failed/unattempted cases, and inspect each claim's input and raw answer. Model changes, missing classes, synthetic/test-double provenance, and source revision stay visible. The threshold control is exploratory and does not tune or change the production policy. The file contains source claims, so share it only with the same care as its input dataset.

## Primitive references

Checked 2026-10-24: [Choice](https://docs.typesafe.ai/primitives/choice), [Score](https://docs.typesafe.ai/primitives/score), [Noul](https://docs.typesafe.ai/primitives/noul), and [confidence semantics](https://docs.typesafe.ai/confidence). The experiment protocol tests model quality rather than assuming vendor calibration claims. The [independent Jev paper](https://arxiv.org/abs/2609.37647) supplies reproduction hypotheses; its results do not establish claims-domain performance.
