// Test-only D1 stand-in on Node's built-in SQLite, migrated with the same SQL the Worker uses.
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { SQLInputValue } from 'node:sqlite';
import type { D1, D1Statement } from '../../src/reviews.ts';

export function sqliteD1(): D1 & { raw: DatabaseSync } {
  const raw = new DatabaseSync(':memory:');
  raw.exec(readFileSync(new URL('../../migrations/0001_triage_results.sql', import.meta.url), 'utf8'));
  const statement = (query: string, values: SQLInputValue[] = []): D1Statement => ({
    bind: (...next) => statement(query, next as SQLInputValue[]),
    first: async <T>() => (raw.prepare(query).get(...values) ?? null) as T | null,
    run: async () => ({ meta: { changes: Number(raw.prepare(query).run(...values).changes) } }),
    all: async <T>() => ({ results: raw.prepare(query).all(...values) as T[] }),
  });
  return { raw, prepare: query => statement(query) };
}
