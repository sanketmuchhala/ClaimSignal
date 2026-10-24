# Live comparison: Jev, an LLM-only baseline and the hybrid pipeline

Measured on Cloudflare Workers AI on 24 October 2026 with `typesafe/jev` (resolved `jev-1.13.0`) and `@cf/meta/llama-3.1-8b-instruct-fp8`. Both models saw identical claim text and the same rubrics. Calls ran sequentially from one machine, alternating which pipeline went first. Every figure below is reproducible from the committed checkpoints in [`live/`](live/):

```bash
npm run report:live   # recomputes live/*-comparison.json and figures/*.svg from the checkpoints
```

CI runs the same command and fails if the committed numbers or figures differ.

Intervals are 95% paired percentile bootstrap intervals over claims (2,000 resamples, seed 20261024). Each model is scored on the same resampled claims in every draw.

## Summary

| | Jev | LLM only | Hybrid pipeline |
| --- | ---: | ---: | ---: |
| Fraud ROC-AUC, vehicle sample | 0.507 [0.446, 0.567] | 0.500 (constant score) | 0.507 [0.446, 0.567] |
| Claim type correct, synthetic | 100% | 91.7% | 100% |
| Review need correct, synthetic | 100% | 91.7% | 100% |
| Median latency, vehicle | 163 ms (call) | 2,547 ms | 163 ms |
| p95 latency, vehicle | 366 ms (call) | 3,486 ms | 367 ms |
| Estimated cost per 1,000 vehicle claims | | $0.091 | $0.033 |
| Failed calls, vehicle | 0 of 1,347 | 3 of 1,349 | 0 runs |

- **Neither language model ranks historical fraud.** Jev's ROC-AUC interval includes chance. The LLM scored every vehicle claim 0, so it cannot rank them at all. The paired difference, Jev − LLM, is +0.007 [−0.054, +0.067], which is no measurable difference.
- **A simple tabular model does rank it.** The offline Naive Bayes baseline, scored on exactly the same claims, reaches 0.691 [0.644, 0.737]. It beats Jev by +0.183 [+0.104, +0.267] and the LLM by +0.191 [+0.144, +0.237].
- **Jev is faster, cheaper and more reliable as the primary call.** The hybrid pipeline's median latency is about 16 times lower than the LLM's, and its estimated inference cost is about 2.7 times lower. Jev had no failed calls. The LLM had two 8-second timeouts and one invalid response.
- **Jev is cautious and the LLM is overconfident.** Under the same routing policy, Jev sends 99.85% of vehicle claims straight to a person and auto-resolves none. The LLM reports full confidence and zero risk, so the same thresholds would auto-resolve every vehicle claim, including all 90 fraud-labelled ones, and an injury claim that needs review in all five synthetic runs.
- **On claims written to test the rubric, Jev is more accurate.** Across 12 hand-written claims run five times each, Jev got every claim type and review need right. The LLM labelled an admitted-fabrication travel claim as "other" and rated an injury claim as needing no review, both consistently.

![Latency per claim: hybrid pipeline median 163 ms, LLM only 2,547 ms](figures/latency.svg)

![Fraud ROC-AUC with 95% intervals: Jev 0.507, LLM only 0.500, hybrid 0.507, Naive Bayes 0.691](figures/fraud-auc.svg)

![Routing shares under one policy for Jev and for the LLM on vehicle and synthetic claims](figures/routing.svg)

## Held-out vehicle claims

This is a **sample of 1,347 of the 3,010 held-out test claims** (44.8%). The runner processes claims in a fixed order sorted by hashed claim ID, which is unrelated to labels, so the first 1,347 are effectively a random subset. 1,344 were scored by every pipeline; 90 of those are labelled fraud (6.7%, against 6.1% in the full test split).

The run stopped when the Cloudflare account reached its limits. From claim 1,347 onward, every failure was an HTTP 429 rejection returned in 25–100 ms, before any inference ran: first rate limiting, then the Workers Free plan's daily allocation of 10,000 neurons. Those rows were dropped so account limits are not counted as model errors. The three earlier errors are genuine model failures and are kept. [`live/vehicle-test-part1.json`](live/vehicle-test-part1.json) records the truncation. The remaining claims can be run after the daily allocation resets, or on a paid plan, with `--offset=1347`, and merged with `compare.ts`.

### Fraud ranking

| Model | ROC-AUC | Average precision | Distinct scores | Flagged at 0.5 |
| --- | ---: | ---: | ---: | ---: |
| Jev | 0.507 [0.446, 0.567] | 0.068 [0.054, 0.097] | 167 | 1 (not fraud) |
| LLM only | 0.500 [0.500, 0.500] | 0.067 [0.054, 0.080] | 1 | 0 |
| Hybrid pipeline | 0.507 [0.446, 0.567] | 0.068 [0.054, 0.097] | 168 | 1 (not fraud) |
| Naive Bayes, same claims (offline) | 0.691 [0.644, 0.737] | 0.123 [0.093, 0.174] | | |
| Random ranking | 0.500 | 0.067 (fraud rate) | | |

The hybrid row nearly equals Jev because Jev sent only 2 of 1,347 claims to the LLM fallback. Jev's mean fraud score is 0.240 for fraud claims and 0.238 for the rest. As an exploratory check chosen after seeing these results, Jev's review probability ranks fraud at 0.518 [0.454, 0.580], also at chance.

This is a test of something the rubric was not built to see. The fraud rubric asks for described inconsistencies, such as mismatched documents or admitted fabrication. Vehicle descriptions here are rendered from tabular fields, so they contain no such statements, and the fraud labels are historical outcomes whose signal is statistical. The Naive Bayes result shows that signal exists in the same fields.

### Speed, reliability and cost

| | Hybrid pipeline | LLM only |
| --- | ---: | ---: |
| Runs | 1,347 | 1,347 |
| Median latency | 163 ms | 2,547 ms |
| p95 latency | 367 ms | 3,486 ms |
| p99 latency | 571 ms | 5,237 ms |
| Model calls per claim | 1.001 | 1 |
| Runs with a failed call | 0 | 3 |
| Estimated cost, all runs | $0.045 | $0.123 (3 runs unknown) |
| Estimated cost per 1,000 claims | $0.033 | $0.091 |

| Provider call | Calls | Failed | Median | p95 | Mean input tokens | Mean output tokens |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Jev | 1,347 | 0 | 163 ms | 366 ms | 793 | 87 |
| LLM | 1,349 | 3 | 2,546 ms | 3,421 ms | 513 | 47 |

Latency is wall-clock time from one machine in the US Eastern time zone, including network time. Cost multiplies provider-reported tokens by the rates configured for the run: Jev $0.042 per million input tokens and $0 output; LLM $0.152 input and $0.287 output. It excludes Worker CPU and review time. The account was on the Workers Free plan, so these are list-price estimates rather than billed amounts.

### Routing under the same policy

| | Auto-resolved | LLM second opinion, then a person | Straight to a person |
| --- | ---: | ---: | ---: |
| Jev (deployed) | 0 | 2 (0.15%) | 1,345 (99.85%) |
| LLM, same thresholds (simulated) | 1,344 (100%), including 90 fraud-labelled | 0 | 0 |

Production never lets LLM output auto-resolve a claim, because its confidence is self-reported. The simulated row shows what would happen if the LLM were primary. Jev's review probability on these field-rendered claims has a median of 0.84 (range 0.79–0.90), which puts almost everything past the 0.80 specialist threshold.

## Synthetic claims with known answers

Twelve hand-written claims across auto, property, health, travel and unclear cases, each with an intended type, rubric risk and review need, run five times each (60 paired runs, no errors). They are smoke tests of the rubric, not a representative sample.

| Model | Claim type correct | Risk error (MAE) | Review need correct |
| --- | ---: | ---: | ---: |
| Jev | 100% | 0.019 | 100% |
| LLM only | 91.7% | 0.042 | 91.7% |
| Hybrid pipeline | 100% | 0.014 | 100% |

Both models were consistent across repeats, so each miss is one claim five times over:

- `travel-02`, a lost-baggage claim whose claimant admits fabricating receipts: the LLM labelled it `other`. Jev labelled it `travel` with risk 0.98–0.99.
- `auto-03`, a rear-end collision with a passenger injury: the LLM gave review probability 0.00 with full confidence, so the same thresholds would auto-resolve it. Jev gave 0.92–0.93 and sent it to a person.

Jev auto-resolved none of the six clean claims either. It rated their review probability 0.22–0.44, above the policy's 0.10 limit, so they went to the LLM for a second opinion and then to a person. Every claim needing review scored 0.80 or higher, so a threshold between those values would separate them on this set. Twelve claims are too few to tune on, and the policy is unchanged.

| | Hybrid pipeline | LLM only |
| --- | ---: | ---: |
| Median latency | 1,486 ms | 2,647 ms |
| Model calls per claim | 1.5 | 1 |
| Estimated cost per 1,000 claims | $0.058 | $0.067 |

Half the synthetic claims went through the fallback, so the hybrid pipeline's advantage is smaller here than on the vehicle data.

## What this supports

- Jev is a better primary call than this LLM for latency, cost, reliability and calibrated caution, and it classified every synthetic claim correctly.
- Neither model is a fraud detector on tabular historical data. Use a model trained on that data for fraud ranking, and keep the rubric for described inconsistencies.
- The current thresholds give no automation on these datasets. Tuning `maxAutoReviewProbability` needs a validation set with gold review labels, which neither dataset has.
- Nothing here supports automated fraud or coverage decisions.
