-- Triage results for idempotent retries, audit and the human review queue.
-- Claim text is never stored; reviewers read the claim in the system of record.
CREATE TABLE triage_results (
  request_id TEXT PRIMARY KEY,
  idempotency_key TEXT UNIQUE,
  body_sha256 TEXT NOT NULL,
  claim_id TEXT NOT NULL,
  route TEXT NOT NULL CHECK (route IN ('auto_resolved', 'human_review')),
  reason TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  response TEXT NOT NULL,
  review_status TEXT CHECK (review_status IN ('pending', 'resolved')),
  review_outcome TEXT CHECK (review_outcome IN ('confirmed', 'corrected', 'escalated')),
  reviewer TEXT,
  review_note TEXT,
  created_at TEXT NOT NULL,
  reviewed_at TEXT
);
CREATE INDEX triage_results_queue ON triage_results (review_status, created_at);
