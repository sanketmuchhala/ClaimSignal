# Experiment progress

Each implementation task is committed only after its checks pass. The next checkpoint records the preceding commit hash, avoiding self-referential commit hashes. This log records completed work, not planned findings.

| Commit | Completed step | Verification |
| --- | --- | --- |
| `d9e130d` | Preserved pre-experiment ClaimSignal baseline | 41 tests; typecheck; mock harness; full dataset validation; offline model and live report reproduction; clean tracked diff |
| `16bab53` | Recorded audit and claims research protocol | 41 tests; typecheck; whitespace validation |
| `8532411` | Added six versioned claims tasks and reproducible dataset manifests | 45 tests; typecheck; label exclusion, matched selection, split enforcement, and hash checks |
| `c1b585b` | Added explicit live runner and full primitive response capture | 48 tests; typecheck; parser validation, CLI offline default, rate-limit stop, checkpoint retention, overwrite protection |
| `f473034` | Added offline calibration and abstention analysis | 55 tests; typecheck; report CLI reproduction, raw-response integrity, metric/tie checks; old reports and model reproduced unchanged |

No new live model experiments have been run as part of this milestone.
