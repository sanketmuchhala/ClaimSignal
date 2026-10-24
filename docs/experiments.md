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

## Primitive references

Checked 2026-10-24: [Choice](https://docs.typesafe.ai/primitives/choice), [Score](https://docs.typesafe.ai/primitives/score), [Noul](https://docs.typesafe.ai/primitives/noul), and [confidence semantics](https://docs.typesafe.ai/confidence). The experiment protocol tests model quality rather than assuming vendor calibration claims. The [independent Jev paper](https://arxiv.org/abs/2609.37647) supplies reproduction hypotheses; its results do not establish claims-domain performance.
