# Vehicle Insurance Claim Fraud Detection

The complete `fraud_oracle.csv` dataset is bundled in `raw/`: **15,420 rows, 33 columns, 923 fraud labels and 14,497 non-fraud labels**. It is a historical auto-insurance benchmark with year values 1994–1996, not a current production claims feed.

## Source and license

- Canonical listing: [Shivam Bansal's Kaggle dataset](https://www.kaggle.com/datasets/shivamb/vehicle-claim-fraud-detection).
- Downloaded from this [public GitHub mirror at a fixed commit](https://github.com/idris10x/vehicle-insurance-fraud-detection/blob/ee0193ce0a0f2da098dcd35256381ba31baf06c7/fraud_oracle.csv), because direct Kaggle download was unavailable in the development environment.
- Mirror Git blob: `8513e8b1deb460c5ba35689caf4220dcc013a2d3`.
- SHA-256: `d7dab6086aa186fc82c607d50919067a1599cea45afb4965511fd7da9e935e09`.
- Data license: **CC0 1.0**, as reported in the Data Availability Statement of [Alharbi et al., A Bagged Ensemble Convolutional Neural Networks Approach to Recognize Insurance Claim Frauds](https://www.mdpi.com/2571-5577/6/1/20). Kaggle's page did not expose license metadata to the automated reader; the license attribution relies on that published statement. ClaimSignal's MIT license covers its code, not a relicensing of third-party data.

The bundled bytes match the pinned mirror's Git blob, including its UTF-8 BOM and lack of a trailing newline. The loader checks the SHA-256 and expected shape on every load. This verifies the mirror snapshot; direct byte-for-byte verification against Kaggle was not performed.

## What this dataset supports

The target `FraudFound_P` is binary. It supports fraud ranking and detection experiments. Every record concerns vehicle insurance, so calling every record “auto” achieves perfect category agreement without demonstrating useful multi-category classification. It has no original free-text narratives, gold review routes, or five-level fraud-severity annotations.

There is no claim amount or currency field. The adapter preserves these as `null`; it does not substitute a deductible or vehicle-price band for a claim amount. Descriptions are deterministic renderings of allowed source fields and are explicitly labeled as tabular records.

## Input fields and leakage controls

The adapter allows 20 incident, vehicle, reporting, and policy fields, listed in `benchmarks/datasets/vehicle.ts`. All remaining columns are excluded from model descriptions and baseline features:

| Excluded column(s) | Reason |
| --- | --- |
| `FraudFound_P` | Target label, used only by the evaluator |
| `PolicyNumber`, `RepNumber` | Source identifiers; a hash of the policy number is used only as the sample ID |
| `Sex`, `MaritalStatus`, `Age`, `AgeOfPolicyHolder` | Demographic fields omitted from this benchmark's predictive inputs |
| `Fault`, `NumberOfSuppliments`, `AddressChange_Claim` | Availability at initial triage is uncertain; omitted to reduce possible outcome leakage |
| `DriverRating`, `AgentType`, `Year` | Excluded by the conservative input allowlist |

These exclusions do not establish fairness or eliminate every possible proxy. The data lacks sufficient provenance to guarantee that every allowed field was available at first notice of loss. Validate field timing before drawing operational conclusions.

## Reproducible partitions

SHA-256 hashes of the allowed-feature vectors, salted with `claimsignal-vehicle-v1`, assign groups to target proportions of 60% train, 20% validation, and 20% test. All identical feature vectors stay together, even when their labels differ. Labels do not determine split membership. The resulting fixed partitions are:

| Split | Records | Fraud | Non-fraud |
| --- | ---: | ---: | ---: |
| Train | 9,224 | 540 | 8,684 |
| Validation | 3,186 | 198 | 2,988 |
| Test | 3,010 | 185 | 2,825 |

There are 15,368 distinct allowed-feature groups. No row is discarded, oversampled, or synthetically added. This is a grouped random split, not a chronological holdout. A public dataset may also have appeared in a pretrained model's training corpus; that cannot be ruled out here.

```bash
npm run dataset:check      # Validate all 15,420 records and construct model inputs
npm run dataset:evaluate   # Train offline baseline; tune on validation; evaluate test
```

The deterministic results are saved in `reports/vehicle-baseline.json`. Unit tests cover checksum/shape, target exclusion, split isolation, metric ties, unknown money fields, and adapter execution.
