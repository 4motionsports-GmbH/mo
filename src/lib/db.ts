// Postgres client for the Vercel/Neon-managed database.
//
// As of 2026 Vercel Postgres is the Neon native integration; the old
// `@vercel/postgres` SDK is deprecated in favour of Neon's own
// `@neondatabase/serverless` driver. We use the HTTP query function
// (`neon()`), which is the right fit for serverless one-shot queries and
// needs no connection pool or WebSocket setup.
//
// Connection details come from the env vars the Neon Vercel integration
// injects. It sets both the modern names (DATABASE_URL = pooled,
// DATABASE_URL_UNPOOLED = direct) and the legacy POSTGRES_URL /
// POSTGRES_URL_NON_POOLING names. We accept either so the code works
// whichever pair is present.
//
// Everything here degrades gracefully: when no connection string is set
// (e.g. local dev without a DB) `getSql()` returns null and callers no-op.
// A database write must NEVER break a chat response.

import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

export type Sql = NeonQueryFunction<false, false>;

// Pooled connection string — preferred for short serverless queries.
function pooledConnectionString(): string | undefined {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL || undefined;
}

let cached: Sql | null = null;
let warned = false;

/**
 * Returns the shared SQL query function, or null when no database is
 * configured. Callers MUST handle null (the DB is optional infrastructure;
 * the chat must work without it).
 */
export function getSql(): Sql | null {
  if (cached) return cached;
  const cs = pooledConnectionString();
  if (!cs) {
    if (!warned) {
      console.warn(
        "[db] No Postgres connection string set (DATABASE_URL / POSTGRES_URL) — persistence disabled"
      );
      warned = true;
    }
    return null;
  }
  cached = neon(cs);
  return cached;
}

export function isDbConfigured(): boolean {
  return Boolean(pooledConnectionString());
}
