# Review questions: one compound question vs one per reason

The first live comparison found that Jev auto-resolved no claims. Its single review question, "does the claim lack information, contain conflicting facts, describe bodily injury, or require specialist review?", scored 0.82–0.86 on vehicle claims and 0.21–0.55 on complete synthetic claims, above the policy's 0.10 limit for auto-resolution.

This experiment replaces it with four yes/no questions, one per reason, and takes their maximum as the review probability:

| Question | Asks |
| --- | --- |
| `missing_information` | Is information needed to route the claim missing? An unstated amount alone does not count. |
| `conflicting_facts` | Do facts, dates, names or documents contradict each other? |
| `bodily_injury` | Was a person injured in the incident? Routine medical bills do not count. |
| `specialist_involved` | Does the claim say a lawyer, investigator or other specialist is involved, or ask for one? |

Both question sets ran on Jev (`jev-1.13.0`) on 24 October 2026, on the same claims, alternating which went first. The routing thresholds were not changed. v1 is kept verbatim in [`benchmarks/review-questions.ts`](../benchmarks/review-questions.ts); v2 is now the default in [`src/jev.ts`](../src/jev.ts). Reproduce the summaries with `npm run report:live`; the checkpoints are in [`live/`](live/).

## Synthetic claims with known answers

24 hand-written claims, run three times with each question set. Twelve are the original fixtures; twelve were added for this experiment with labels fixed before any run: eight complete, consistent claims, plus one each for injury, conflicting dates, missing information and an attorney's involvement.

| | v1: one question | v2: one per reason |
| --- | ---: | ---: |
| Review probability, 5th–95th percentile | 0.24–0.93 | 0.09–0.97 |
| Complete claims auto-resolved | 0 of 42 runs | 5 of 42 runs |
| Claims needing review sent straight to a person | 30 of 30 | 30 of 30 |
| Claims needing review auto-resolved | 0 | 0 |
| Review need correct at 0.5 | 95.8% | 100% |
| Claim type correct | 100% | 100% |
| Median latency | 179 ms | 182 ms |
| Tokens per call, input / output | 591 / 87 | 710 / 146 |

| Claim | Needs review | v1 review | v1 route | v2 review | v2 route | v2's strongest reason |
| --- | :---: | ---: | --- | ---: | --- | --- |
| `auto-01` | no | 0.35 | fallback | 0.10 | auto | missing information |
| `auto-02` | yes | 0.94 | human | 0.95 | human | conflicting facts |
| `property-01` | no | 0.35 | fallback | 0.09 | fallback | missing information |
| `property-02` | yes | 0.80 | human | 0.89 | human | conflicting facts |
| `health-01` | no | 0.38 | fallback | 0.19 | fallback | missing information |
| `health-02` | yes | 0.90 | human | 0.87 | human | conflicting facts |
| `travel-01` | no | 0.35 | fallback | 0.19 | fallback | missing information |
| `travel-02` | yes | 0.81 | human | 0.63 | human | conflicting facts |
| `other-01` | yes | 0.92 | human | 0.97 | human | missing information |
| `auto-03` | yes | 0.92 | human | 0.97 | human | bodily injury |
| `property-03` | no | 0.40 | fallback | 0.12 | fallback | missing information |
| `travel-03` | no | 0.23 | fallback | 0.16 | fallback | missing information |
| `auto-04` | no | 0.24 | fallback | 0.08 | auto | missing information |
| `auto-05` | no | 0.53 | fallback | 0.15 | fallback | missing information |
| `property-04` | no | 0.26 | fallback | 0.11 | fallback | missing information |
| `property-05` | no | 0.43 | fallback | 0.35 | fallback | specialist involved |
| `health-03` | no | 0.26 | fallback | 0.13 | fallback | missing information |
| `health-04` | no | 0.47 | fallback | 0.25 | fallback | missing information |
| `travel-04` | no | 0.30 | fallback | 0.21 | fallback | missing information |
| `travel-05` | no | 0.40 | fallback | 0.18 | fallback | missing information |
| `auto-06` | yes | 0.94 | human | 0.98 | human | bodily injury |
| `property-06` | yes | 0.90 | human | 0.80 | human | conflicting facts |
| `other-02` | yes | 0.91 | human | 0.95 | human | missing information |
| `health-05` | yes | 0.86 | human | 0.92 | human | specialist involved |

Values are medians of three runs. `travel-02` scores 0.63 under v2, below the 0.80 specialist threshold, but still goes straight to a person because its fraud score is 0.98.

## Held-out vehicle claims

The first 300 claims of the held-out test split, in the benchmark's hashed-ID order, so they overlap the live comparison sample.

| | v1 | v2 |
| --- | ---: | ---: |
| Review probability, 5th–95th percentile | 0.82–0.86 | 0.93–0.95 |
| Auto-resolved | 0 | 0 |
| Straight to a person | 299 | 300 |
| Errors | 0 of 300 | 0 of 300 |

| v2 reason | 5th percentile | Median | 95th percentile |
| --- | ---: | ---: | ---: |
| Missing information | 0.93 | 0.94 | 0.95 |
| Conflicting facts | 0.11 | 0.26 | 0.57 |
| Bodily injury | 0.16 | 0.19 | 0.25 |
| Specialist involved | 0.03 | 0.03 | 0.03 |

The vehicle records are tables of fields. They never say what happened or what was damaged, so a person could not route them either. v2 does not automate them, and it now says why.

## Conclusions

- **Separate questions make review routing work on claims that describe a loss.** Complete claims scored about half as high, review-needed claims still went to a person every time, and agreement with the intended review need rose to 100%.
- **The remaining blocker is the 0.10 auto-resolution limit.** Across individual runs, complete claims score 0.08–0.38 (0.08–0.25 on `missing_information`), while claims needing review score at least 0.61. A higher limit would automate more, but these 24 hand-written claims are too few, and too close to the rubric's author, to set it. The threshold needs claims with independent review labels.
- **The reason is now visible.** Each decision carries `reviewSignals`, so a reviewer sees "bodily injury 0.98" rather than one opaque number. One quirk is visible too: `property-05` mentions an electrician's report and scores 0.35 on `specialist_involved`.
- **The cost is about 20% more input tokens and 68% more output tokens per Jev call**, with no measurable latency change.

The live comparison in [`live-comparison.md`](live-comparison.md) was run with v1. Its LLM rows are unaffected; rerunning the paired benchmark with v2 needs LLM quota.
