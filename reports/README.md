# Measured offline baseline

Reproduce with `npm ci && npm run dataset:evaluate`. The complete dataset is partitioned into 9,224 training, 3,186 validation and 3,010 held-out test records. A categorical Naive Bayes baseline learns only from the training partition; its threshold of 0.269 is selected by validation F1 on a fixed grid.

**These are measured local tabular-model results, not Jev or LLM results.** No live provider credentials were available for this evaluation.

| Test metric | Naive Bayes | Always non-fraud |
| --- | ---: | ---: |
| ROC-AUC | 0.7210 | 0.5000 |
| Average precision | 0.1320 | 0.0615 |
| Fraud precision | 15.28% | 0% |
| Fraud recall | 24.86% | 0% |
| Fraud F1 | 0.1893 | 0 |
| Accuracy | 86.91% | 93.85% |

At the validation-selected threshold, the baseline detects 46 of 185 fraudulent test records, misses 139, and flags 255 non-fraud records. These results provide a reproducible starting point and show why accuracy is misleading on this dataset. They do not justify automated fraud decisions.

See [`vehicle-baseline.json`](vehicle-baseline.json) for complete confusion matrices, dataset hashes, feature allowlist, split counts, and limitations. CI reproduces this file and checks that the results have not drifted.
