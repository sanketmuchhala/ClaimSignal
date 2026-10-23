# Benchmark methodology

The runner compares the full Jev-first triage path with one LLM-only prediction per claim. Both see identical claim text and the same category and risk rubrics. The baseline is a prediction baseline, not an implemented approval workflow; its automatic resolution rate is consequently zero.

Hybrid accuracy uses the fallback suggestion when available, otherwise the primary prediction. Human review is not simulated or counted as a corrected answer. The comparison measures machine suggestions before a reviewer acts. Classification accuracy counts missing predictions as incorrect; risk MAE reports only available predictions together with the evaluated count. Error rate records any failed provider call, even if a fallback succeeds.

Latency uses a monotonic wall clock, includes network time and sequential fallback, and alternates pipeline order. No warm-up samples are discarded. Calls are sequential to avoid uncontrolled concurrency differences. Repeated cases may benefit from provider caching; report repeats, model aliases, execution region, and cache settings with any published result.

Estimated inference cost uses provider-reported token counts and explicitly supplied USD-per-million rates. It excludes Worker CPU, storage, review time, discounts, and unreported cached-token billing. Missing usage or any failed attempt makes that sample's total cost unknown. A timeout may still be billed because a Workers AI binding request cannot be cancelled by the local deadline race. No incomplete cost total is presented as zero.

The fixture set is hand-authored and synthetic. The expected risk values encode the author's rubric interpretation, not adjudicated fraud labels. `unsafeAutoCount` flags automatic handling of fixtures marked for review. It does not measure real-world safety. Before claiming improvements, replace or supplement the set with a separate, consented, representative holdout and report sample sizes, class balance, confidence intervals, and routing coverage alongside accuracy.

`--mock` intentionally returns fixture labels and skips model inference. It verifies plumbing only. Never cite its perfect accuracy or sub-millisecond latency as model results. Live reports are intentionally not committed until they have been generated and reviewed.
