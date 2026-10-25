# Experiment progress

Each implementation task is committed only after its checks pass. The next checkpoint records the preceding commit hash, avoiding self-referential commit hashes. This log records completed work, not planned findings.

| Commit | Completed step | Verification |
| --- | --- | --- |
| `d9e130d` | Preserved pre-experiment ClaimSignal baseline | 41 tests; typecheck; mock harness; full dataset validation; offline model and live report reproduction; clean tracked diff |
| `16bab53` | Recorded audit and claims research protocol | 41 tests; typecheck; whitespace validation |
| `8532411` | Added six versioned claims tasks and reproducible dataset manifests | 45 tests; typecheck; label exclusion, matched selection, split enforcement, and hash checks |
| `c1b585b` | Added explicit live runner and full primitive response capture | 48 tests; typecheck; parser validation, CLI offline default, rate-limit stop, checkpoint retention, overwrite protection |
| `f473034` | Added offline calibration and abstention analysis | 55 tests; typecheck; report CLI reproduction, raw-response integrity, metric/tie checks; old reports and model reproduced unchanged |
| `27aaaa5` | Added matched train-only baselines and comparisons | 58 tests; typecheck; train isolation, source validation, matched-case CLI reproduction |
| `c53d831` | Preserved 60-call live pilot, raw captures, and missing-class warnings | 58 tests; typecheck; byte-for-byte comparison reproduction; original baseline files unchanged |
| `48586f6` | Added one-factor prompt variants and paired robustness reports | 60 tests; typecheck; unchanged pilot reproduction; identity, label preservation, and paired-metric checks |
| `d75368c` | Added raw structured LLM capture and paired model comparisons | 62 tests; typecheck; pilot reproduction; actual-request verification and generated-probability/version labeling |
| `bf981a9` | Added offline interactive explorer | 64 tests; typecheck; pilot reproduction; headless-Chrome checks of every control on the pilot and on LLM, failure and category test doubles; 375 px layout |
| `d585723` | Made the baseline model hash platform-stable | 64 tests; typecheck; Linux CI reproduces the pilot comparisons byte for byte |
| `44a1fb6` | Added grouped bootstrap intervals and opt-in throttle retries | 68 tests; typecheck; point estimates equal analyze(); groups resample whole; prefix-only matching; retried 429s never recorded |
| `df4bf5d`–`107654a` | Declared, ran and reported the validation study (Jev Choice and Noul, 1,000 claims) | Protocol committed before inference; Linux CI reproduces every derived file |
| `44a1fb6` | Added claim-grouped uncertainty intervals and opt-in throttle retries | 68 tests; typecheck; grouped resampling, paired intervals, 429-only retries, and allocation-stop coverage |
| `df4bf5d` | Declared the 1,000-claim Choice/Noul study before inference | Protocol committed before either study run; fixed plans, sample, questions, metrics, and LLM follow-up |
| `56ffb47` | Captured both validation runs and reproducible grouped analyses | 68 tests; typecheck; 1,000/1,000 Choice responses, 969/1,000 Noul responses, reports regenerate without inference |
| `107654a` | Published validation findings and documented protocol departures | Report findings checked against captured comparison and interval artifacts |
| `401a6e8` | Restored omitted study commits and their results to the handoff log | Documentation correction; the log now records the completed Jev arms and pending LLM arm |

At `27aaaa5`, a bounded pilot made 60 live Jev calls (20 claims per primitive). All succeeded. The sample has no fraud positives and does not support discrimination claims; see the [pilot report](../reports/experiments/pilot-20261024/README.md).

The declared validation study has two completed Jev arms: Choice and Noul. The 70B LLM arm remains pending the quota reset specified in the [protocol](../reports/experiments/validation-20261024/PROTOCOL.md); no LLM comparison result is claimed yet. Report reproduction, typecheck, dataset validation, and all 68 tests passed at `107654a`.
