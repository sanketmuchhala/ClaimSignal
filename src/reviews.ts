// Durable triage results on Cloudflare D1 (schema: migrations/0001_triage_results.sql).
// Only the structural subset of the D1 API that ClaimSignal uses is typed here.
export interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<{ meta: { changes: number } }>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}
export interface D1 { prepare(query: string): D1Statement }

export const reviewOutcomes = ['confirmed', 'corrected', 'escalated'] as const;
export type ReviewOutcome = typeof reviewOutcomes[number];
export interface StoredResult { requestId: string; bodySha256: string; response: Record<string, unknown> }
interface Row { request_id: string; body_sha256: string; response: string; claim_id: string; reason: string; created_at: string; review_status: string | null; review_outcome: string | null; reviewer: string | null; review_note: string | null; reviewed_at: string | null }

export async function sha256(bytes: Uint8Array<ArrayBuffer> | string): Promise<string> {
  const data = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))].map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function findByIdempotencyKey(db: D1, key: string): Promise<StoredResult | null> {
  const row = await db.prepare('SELECT request_id, body_sha256, response FROM triage_results WHERE idempotency_key = ?').bind(key).first<Row>();
  return row && { requestId: row.request_id, bodySha256: row.body_sha256, response: JSON.parse(row.response) };
}

// Returns the stored result for this idempotency key, which is ours unless a concurrent request won the insert.
export async function saveResult(db: D1, entry: { requestId: string; idempotencyKey: string | null; bodySha256: string; claimId: string; route: string; reason: string; policyVersion: string; response: Record<string, unknown>; now: string }): Promise<StoredResult> {
  const { meta } = await db.prepare(`INSERT INTO triage_results (request_id, idempotency_key, body_sha256, claim_id, route, reason, policy_version, response, review_status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (idempotency_key) DO NOTHING`)
    .bind(entry.requestId, entry.idempotencyKey, entry.bodySha256, entry.claimId, entry.route, entry.reason, entry.policyVersion, JSON.stringify(entry.response), entry.route === 'human_review' ? 'pending' : null, entry.now).run();
  if (meta.changes === 1 || entry.idempotencyKey === null) return { requestId: entry.requestId, bodySha256: entry.bodySha256, response: entry.response };
  return (await findByIdempotencyKey(db, entry.idempotencyKey))!;
}

const reviewItem = (row: Row) => {
  const response = JSON.parse(row.response) as { decision?: unknown; fallbackDecision?: unknown; tabular?: unknown };
  return {
    requestId: row.request_id, claimId: row.claim_id, reason: row.reason, createdAt: row.created_at,
    decision: response.decision ?? null, fallbackDecision: response.fallbackDecision ?? null, tabular: response.tabular ?? null,
    status: row.review_status, outcome: row.review_outcome, reviewer: row.reviewer, note: row.review_note, reviewedAt: row.reviewed_at,
  };
};

// Oldest first, so the queue is worked in arrival order.
export async function listReviews(db: D1, status: 'pending' | 'resolved', limit: number) {
  const { results } = await db.prepare(`SELECT * FROM triage_results WHERE review_status = ? ORDER BY created_at ${status === 'pending' ? 'ASC' : 'DESC'}, request_id LIMIT ?`).bind(status, limit).all<Row>();
  return results.map(reviewItem);
}

export async function resolveReview(db: D1, requestId: string, resolution: { outcome: ReviewOutcome; reviewer: string; note: string | null; now: string }) {
  const { meta } = await db.prepare(`UPDATE triage_results SET review_status = 'resolved', review_outcome = ?, reviewer = ?, review_note = ?, reviewed_at = ?
    WHERE request_id = ? AND review_status = 'pending'`).bind(resolution.outcome, resolution.reviewer, resolution.note, resolution.now, requestId).run();
  const row = await db.prepare('SELECT * FROM triage_results WHERE request_id = ?').bind(requestId).first<Row>();
  return { updated: meta.changes === 1, item: row && row.review_status ? reviewItem(row) : null };
}
