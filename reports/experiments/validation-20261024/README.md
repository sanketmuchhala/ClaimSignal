# Validation study — 24 October 2026

**Measured live runs on historical vehicle claims, analysed exactly as [declared before inference](PROTOCOL.md).** Jev ranks recorded fraud *worse than chance* on these records, and a train-only Naive Bayes model ranks it far better. The Llama 3.3 70B comparison runs after the Workers Free allocation resets and will be added here.

## What ran

| Run | Claims | Answered | Notes |
| --- | ---: | ---: | --- |
| Jev `vehicle-fraud-choice-v1` | 1,000 | 1,000 | 5 throttling retries (HTTP 429 before inference) |
| Jev `vehicle-fraud-noul-v1` | 1,000 | 969 | 31 failures caused by the client machine sleeping; see departures |
| Llama 3.3 70B `vehicle-fraud-choice-v1` | 250 | — | Pending: runs after 00:00 UTC on 25 October |

Both Jev runs resolved to `jev-1.13.0` at code revision `df4bf5d`. The sample is the first 1,000 validation claims in hashed-ID order: 68 recorded frauds (6.8%) in 998 claim groups. It includes the 20 pilot claims. All intervals are 95% grouped percentile bootstrap intervals (2,000 resamples, seed 20261024).

## Primary result: Jev Choice against train-only Naive Bayes

| On the 1,000 claims | Jev Choice | Naive Bayes | Training prior | Jev − Naive Bayes |
| --- | ---: | ---: | ---: | ---: |
| ROC-AUC | **0.423** (0.352–0.493) | **0.762** (0.701–0.817) | 0.5 | **−0.339** (−0.432 to −0.240) |
| Average precision | 0.061 (0.045–0.093) | 0.228 (0.155–0.333) | 0.068 | −0.167 (−0.265 to −0.090) |
| Brier score, lower is better | 0.085 (0.073–0.097) | 0.063 (0.053–0.073) | 0.064 | +0.022 (0.015 to 0.029) |
| Log loss, lower is better | 0.318 (0.285–0.352) | 0.244 (0.203–0.289) | 0.249 | +0.074 (0.034 to 0.108) |
| Accuracy at 0.5 | 0.921 | 0.928 | 0.932 | −0.007 (−0.018 to 0.004) |

- **Jev's ranking is inverted.** Its ROC-AUC interval lies entirely below 0.5: recorded frauds received a slightly *lower* mean fraud probability (0.139) than non-frauds (0.161). A brute-force pairwise count gives the same 0.4229.
- **Naive Bayes is better on every probability metric**, and its ROC-AUC interval excludes Jev's. Jev is also worse than predicting the training prevalence for every claim, on both Brier score and log loss.
- **Jev over-predicts fraud.** Its mean probability is 16.0% against 6.8% observed. Calibration bins run the wrong way: claims it gave 0.30–0.40 were fraudulent 4.0% of the time, below the 9.1% for claims it gave under 0.10. At the 0.5 threshold it flagged 13 claims, one of them fraudulent.
- Accuracy is uninformative here: predicting "not fraud" for everything scores 93.2%.

## Choice against Noul

On the 969 claims both answered (68 frauds):

| | Choice | Noul | Choice − Noul |
| --- | ---: | ---: | ---: |
| ROC-AUC | 0.420 (0.349–0.492) | 0.395 (0.333–0.459) | +0.026 (−0.020 to 0.070) |
| Brier score | 0.087 | 0.087 | −0.001 (−0.004 to 0.003) |
| Log loss | 0.323 | 0.333 | −0.010 (−0.022 to 0.003) |

No difference is resolved: every interval includes zero. Both primitives rank fraud below chance. Noul's probabilities sit in a narrower band (almost all 0.10–0.30) and it flagged no claim at 0.5. The two tasks also differ by one sentence of wording, so even a difference would not isolate the primitive.

## Why the ranking inverts (exploratory, not declared)

This breakdown was not in the protocol; it describes the Choice run and tests nothing.

| Claims with… | Recorded fraud | Jev's mean fraud probability |
| --- | ---: | ---: |
| Liability-only policy (n = 326) | 0.9% | 20.7% |
| Sport vehicle (n = 341) | 1.5% | 20.4% |
| More than 4 past claims (n = 129) | 3.9% | 31.2% |
| All Perils policy (n = 287) | 13.9% | 14.3% |
| No past claims (n = 288) | 10.1% | 11.5% |

Jev applies generic suspicion: sport cars, many past claims, liability-only cover. In this dataset those groups have the *lowest* recorded fraud rates. Naive Bayes learns the dataset's actual associations from 9,224 training claims; Jev has only the record and the question. Inverting Jev's score would rank better here, but that rule was found on this sample and would need its own declared test. It would also mean using Jev as a weak feature extractor, not as a fraud judge.

## Operations

| | Jev Choice | Jev Noul |
| --- | ---: | ---: |
| Median latency | 164 ms | 166 ms |
| 95th percentile | 301 ms | not meaningful (machine slept) |
| Input tokens per call | 607 | 570 |
| Estimated cost per 1,000 claims | $0.025 | $0.024 |

Cost is an estimate at Jev's list rate of $0.042 per million input tokens and $0 output, from provider-reported tokens. The account is on the Workers Free plan.

## Departures from the protocol

- **The Noul run started with one untracked file in the working tree** (`experiments/reproduce-validation.ts`, written during the Choice run), so its `run.json` records `workingTreeDirty: true`. The runner does not import that file; the code that ran was `df4bf5d`.
- **31 Noul calls failed because the client Mac slept.** macOS entered sleep 25 seconds after the Noul run started and cycled between sleep and maintenance wakes every 15–18 minutes (`pmset -g log`). Every failure coincides with a sleep or wake. 14 calls were cut off mid-flight by sleep, lasting 29 seconds to 18 minutes, or failed immediately after a wake. 17 were 8-second client timeouts in two bursts that began at full wakes. They are kept as failures, as the protocol requires. Noul's 96.9% answered share reflects the client, not Jev. Choice ran before the sleep and had no failures.

## Reproduce

```bash
npm run report:experiments
git diff --exit-code -- reports/experiments
npm run experiment:explore -- --run=reports/experiments/validation-20261024/jev-choice --run=reports/experiments/validation-20261024/jev-noul --out=experiment-results/validation.html
```

The first command makes no model calls. It re-parses every raw response and regenerates `*/comparison.json`, `*/uncertainty.json` and `jev-choice-vs-jev-noul.json` from the committed captures. The explorer shows every claim, its answer and its calibration bin.
