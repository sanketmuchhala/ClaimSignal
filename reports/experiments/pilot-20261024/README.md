# Claims primitive pilot — 24 October 2026

**Measured live integration pilot, not evidence of calibrated fraud prediction.**

At code revision `27aaaa59852a61ee7ca9119dd3ec38b423085e5c` (clean tree), three independently planned tasks ran against Workers AI `typesafe/jev`, resolving to `jev-1.13.0`. Each used the same first 20 validation claims in hashed claim-ID order. The limit was fixed before inference; labels were not used to select records. Runs were sequential, first Choice, then Noul, then Score; this is not an interleaved performance comparison. All 60 calls succeeded.

## What the sample actually contains

- Fraud outcome: **20 negatives, zero positives**. ROC-AUC, positive-class recall, and average precision are undefined. Every predictor classified all 20 as negative at the fixed 0.5 threshold; this is not evidence of useful discrimination.
- Evidence-count target: **19 zeroes, one one, no twos**. Jev and a direct field counter had zero MAE on these cases. The third rubric level remains untested. Even a constant-zero predictor would have MAE 0.05 here.
- These are historical tabular records rendered into text, not original claimant narratives. Claims triage safety and review necessity are not labeled.

## Descriptive measurements

| Prediction | Binary Brier (lower is better) | Binary log loss | Median network-call latency |
| --- | ---: | ---: | ---: |
| Jev Choice, historical fraud | 0.031150 | 0.170817 | 181 ms |
| Jev Noul, historical fraud | 0.040180 | 0.217678 | 172 ms |
| Train-only Naive Bayes, historical fraud | 0.020014 | 0.111841 | Not compared |
| Training-prevalence constant, historical fraud | 0.003427 | 0.060327 | Not compared |
| Jev Score, explicit evidence count | Not applicable | Not applicable | 168 ms |

The constant training prior looks best on these all-negative cases because it predicts a low probability. This does **not** establish that it ranks fraud better. Choice and Noul produced different probabilities, but this sample cannot establish that either primitive is better calibrated. Rewording and primitive changed together, and there is only one response per claim/task.

Score is measured in count/rubric units. Its position is not a fraud probability. No prices were configured, so cost is unknown rather than reported as zero. Token usage is retained in the captures.

## Reproduce and inspect

Each primitive directory contains the exact `plan.json`, `run.json`, `observations.jsonl`, `completion.json`, and a derived `comparison.json`. Only public dataset inputs are present. The run metadata distinguishes the clean capture revision from later analysis code.

```bash
npm run report:experiments
git diff --exit-code -- reports/experiments
```

The command performs no inference. It validates raw responses and recomputes calibration, abstention, and matched train-only baseline metrics. The comparison files include every claim, full probability distributions via the raw checkpoints, failure accounting, label counts, and sample warnings. Existing reports outside this directory are unchanged.

## Next research step

Predeclare a larger fixed validation sample before further inference; disclose that this pilot was examined. A larger sample is needed for both outcome classes and useful reliability-bin counts. Do not keep increasing the sample until a favorable result appears, and do not silently balance it by fraud labels. A separately declared diagnostic set covering all ordinal levels can test count-reading behavior, but its distribution must not be represented as natural claims prevalence.

Remaining controlled experiments include question wording and option order, irrelevant-field changes, matched LLM outputs, and batching multiple questions. No findings about those experiments are claimed here.
