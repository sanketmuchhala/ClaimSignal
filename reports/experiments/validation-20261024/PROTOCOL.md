# Validation study protocol — declared 24 October 2026, before inference

This file is committed before any call in this study runs. Results go in `README.md` in this directory and must follow this protocol. Any departure is reported there as a departure.

## Question

On historical vehicle claims, does Jev rank and estimate the recorded fraud outcome better than a train-only Naive Bayes model, a constant training prior, and a stronger general LLM given the same input? How do Choice and Noul compare on the same claims? The 20-claim pilot had no fraud positives and could not answer any of these.

## Sample

- Vehicle **validation** split, claim-ID ascending (IDs are hashes), first **1,000** claims. Labels were not inspected to choose the size; it was set by cost and by the split's known prevalence (198 of 3,186, 6.2%), which should give enough positives for a ranking interval.
- The first 20 claims are the pilot's claims; the pilot is disclosed and was already examined. The test split is not used.
- Plan IDs: Choice `b003806e2bb401103885efb383fc9bfc6508f40e45027b31288d790f3eb78d4a`, Noul `c3722ad116401797fce1312cadca1232b6edf769130fd0a7b389b0b208e50649`. The LLM run uses the first 250 of the same claims: plan `1f5e7cd572b1afdb9c13cb7a36e6276ba6e1bd30d7f124f75f59dc17824d75df`.

## Runs

1. Jev `typesafe/jev`, `vehicle-fraud-choice-v1`, 1,000 claims.
2. Jev `typesafe/jev`, `vehicle-fraud-noul-v1`, 1,000 claims.
3. LLM `@cf/meta/llama-3.3-70b-instruct-fp8-fast`, `vehicle-fraud-choice-v1`, 250 claims, after the Workers Free daily allocation resets at 00:00 UTC on 25 October. 250 is what one day's allocation covers at this model's rates.

Each run is executed once, with `--rate-limit-retries=5`, from a clean tree at the commit that adds this file. No run is repeated or extended because of its results. If a run stops early, its partial capture is the result, and the stop reason is reported.

## Analysis

All analysis is offline with `experiment:report`, `experiment:compare` and `experiment:uncertainty` at their defaults: fixed 0.5 threshold, no threshold tuning, no calibration fitting, 95% grouped percentile bootstrap intervals (2,000 resamples, seed 20261024).

- **Primary:** Jev Choice minus Naive Bayes, ROC-AUC, on the claims Jev answered, with its interval.
- **Secondary:** Brier score and log loss for Jev Choice, Naive Bayes and the training prior; Jev Choice minus Jev Noul (ROC-AUC, Brier) on the 1,000 claims; Jev Choice minus the 70B LLM (ROC-AUC, Brier, answered share) on the first 250 claims.
- Choice and Noul differ in primitive and in one sentence of wording, so a difference cannot be attributed to the primitive alone.
- The 250-claim comparison will have few positives, so its interval is expected to be wide. It is reported whatever its width.
- Failures and unattempted claims are reported for every run. Latency is descriptive. Cost is estimated from reported tokens at list prices and labelled as an estimate.
- No significance claims and no multiple-comparison adjustment. An interval that excludes zero is described as such, not as proof.
