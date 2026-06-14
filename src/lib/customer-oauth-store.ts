// Server-side store for the Customer Account OAuth tokens and the short-lived
// pending-auth records. Tokens are encrypted at rest (lib/token-crypto.ts) and
// NEVER leave the backend.
//
// bytea handling: we encode/decode through base64 at the SQL boundary
// (decode(?, 'base64') on write, encode(col, 'base64') on read) so we never
// depend on the driver's Buffer↔bytea serialization.

import { getSql, type Sql } from "./db";
import { reportError } from "./observability";
import { encryptToken, decryptToken } from "./token-crypto";
import {
  refreshTokens,
  type TokenSet,
  TokenEndpointError,
} from "./shopify-customer-account";

// Refresh the access token this long before it actually expires.
const REFRESH_BUFFER_MS = 2 * 60 * 1000;

function isoFromSeconds(seconds: number | null): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(Date.now() + seconds * 1000).toISOString();
}

// ---------------------------------------------------------------------------
// Pending auth (CSRF state + PKCE verifier + return target)
// ---------------------------------------------------------------------------

export interface PendingAuthInput {
  state: string;
  sessionId: string;
  codeVerifier: string;
  nonce: string;
  returnUrl: string;
  promptNone: boolean;
  ttlMinutes: number;
}

export async function createPendingAuth(
  input: PendingAuthInput,
  sql: Sql | null = getSql()
): Promise<boolean> {
  if (!sql) return false;
  const expiresAt = new Date(Date.now() + input.ttlMinutes * 60_000).toISOString();
  try {
    await sql`
      INSERT INTO customer_auth_pending
        (state, session_id, code_verifier, nonce, return_url, prompt_none, expires_at)
      VALUES (${input.state}, ${input.sessionId}, ${input.codeVerifier}, ${input.nonce},
              ${input.returnUrl}, ${input.promptNone}, ${expiresAt})
    `;
    return true;
  } catch (err) {
    reportError(err, { route: "lib/customer-oauth-store", phase: "createPendingAuth" });
    return false;
  }
}

export interface PendingAuthRecord {
  state: string;
  sessionId: string;
  codeVerifier: string;
  nonce: string;
  returnUrl: string;
  promptNone: boolean;
  expiresAt: string;
}

/**
 * Atomically consume (delete + return) the pending record for a state. Returns
 * null when missing or expired — single-use by construction (the DELETE removes
 * it so a replayed callback finds nothing).
 */
export async function consumePendingAuth(
  state: string,
  sql: Sql | null = getSql()
): Promise<PendingAuthRecord | null> {
  if (!sql) return null;
  try {
    const rows = (await sql`
      DELETE FROM customer_auth_pending
       WHERE state = ${state}
      RETURNING state, session_id, code_verifier, nonce, return_url, prompt_none, expires_at
    `) as Array<Record<string, unknown>>;
    const r = rows[0];
    if (!r) return null;
    const expiresAt = String(r.expires_at);
    if (new Date(expiresAt).getTime() < Date.now()) return null; // expired
    return {
      state: String(r.state),
      sessionId: String(r.session_id),
      codeVerifier: String(r.code_verifier),
      nonce: String(r.nonce),
      returnUrl: String(r.return_url),
      promptNone: Boolean(r.prompt_none),
      expiresAt,
    };
  } catch (err) {
    reportError(err, { route: "lib/customer-oauth-store", phase: "consumePendingAuth" });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Token persistence (encrypted)
// ---------------------------------------------------------------------------

/**
 * Persist (insert or replace) the current token pair for a customer, encrypted.
 * Refresh token may be null in a response only on refresh-without-rotation; we
 * keep the previous one in that case.
 */
export async function saveCustomerTokens(
  customerId: number,
  tokens: TokenSet,
  idTokenSub: string | null,
  sql: Sql | null = getSql()
): Promise<boolean> {
  if (!sql) return false;
  try {
    const accessB64 = encryptToken(tokens.accessToken).toString("base64");
    const accessExpiresAt = isoFromSeconds(tokens.expiresIn) ?? new Date().toISOString();
    const refreshExpiresAt = isoFromSeconds(tokens.refreshExpiresIn);

    if (tokens.refreshToken) {
      const refreshB64 = encryptToken(tokens.refreshToken).toString("base64");
      await sql`
        INSERT INTO customer_oauth_tokens
          (customer_id, access_token_enc, refresh_token_enc, id_token_sub, scope,
           access_expires_at, refresh_expires_at, updated_at)
        VALUES (${customerId}, decode(${accessB64}, 'base64'), decode(${refreshB64}, 'base64'),
                ${idTokenSub}, ${tokens.scope}, ${accessExpiresAt}, ${refreshExpiresAt}, now())
        ON CONFLICT (customer_id) DO UPDATE SET
          access_token_enc   = EXCLUDED.access_token_enc,
          refresh_token_enc  = EXCLUDED.refresh_token_enc,
          id_token_sub       = COALESCE(EXCLUDED.id_token_sub, customer_oauth_tokens.id_token_sub),
          scope              = EXCLUDED.scope,
          access_expires_at  = EXCLUDED.access_expires_at,
          refresh_expires_at = EXCLUDED.refresh_expires_at,
          updated_at         = now()
      `;
    } else {
      // No new refresh token (no rotation) — update only the access side.
      await sql`
        UPDATE customer_oauth_tokens SET
          access_token_enc  = decode(${accessB64}, 'base64'),
          scope             = ${tokens.scope},
          access_expires_at = ${accessExpiresAt},
          updated_at        = now()
        WHERE customer_id = ${customerId}
      `;
    }
    return true;
  } catch (err) {
    reportError(err, { route: "lib/customer-oauth-store", phase: "saveCustomerTokens" });
    return false;
  }
}

interface StoredTokenRow {
  accessTokenB64: string;
  refreshTokenB64: string;
  accessExpiresAt: string;
}

async function readTokenRow(
  customerId: number,
  sql: Sql
): Promise<StoredTokenRow | null> {
  const rows = (await sql`
    SELECT encode(access_token_enc, 'base64')  AS access_token_enc,
           encode(refresh_token_enc, 'base64') AS refresh_token_enc,
           access_expires_at
      FROM customer_oauth_tokens
     WHERE customer_id = ${customerId}
  `) as Array<Record<string, unknown>>;
  const r = rows[0];
  if (!r) return null;
  return {
    accessTokenB64: String(r.access_token_enc),
    refreshTokenB64: String(r.refresh_token_enc),
    accessExpiresAt: String(r.access_expires_at),
  };
}

export async function deleteCustomerTokens(
  customerId: number,
  sql: Sql | null = getSql()
): Promise<void> {
  if (!sql) return;
  try {
    await sql`DELETE FROM customer_oauth_tokens WHERE customer_id = ${customerId}`;
  } catch (err) {
    reportError(err, { route: "lib/customer-oauth-store", phase: "deleteCustomerTokens" });
  }
}

/**
 * Return a currently-valid customer access token, refreshing first if it is
 * within the refresh buffer of expiry. Refresh-token ROTATION is persisted
 * atomically before the new token is returned. Fail-closed: returns null on any
 * problem (no DB, no row, decrypt failure, refresh rejected). On a hard refresh
 * rejection (invalid_grant) the stored pair is dropped so the customer re-auths.
 */
export async function getValidAccessToken(
  customerId: number,
  sql: Sql | null = getSql()
): Promise<string | null> {
  if (!sql) return null;
  try {
    const row = await readTokenRow(customerId, sql);
    if (!row) return null;

    const notExpiring =
      new Date(row.accessExpiresAt).getTime() - REFRESH_BUFFER_MS > Date.now();
    if (notExpiring) {
      try {
        return decryptToken(Buffer.from(row.accessTokenB64, "base64"));
      } catch (err) {
        reportError(err, { route: "lib/customer-oauth-store", phase: "decryptAccess" });
        return null;
      }
    }

    // Refresh (with rotation).
    let refreshToken: string;
    try {
      refreshToken = decryptToken(Buffer.from(row.refreshTokenB64, "base64"));
    } catch (err) {
      reportError(err, { route: "lib/customer-oauth-store", phase: "decryptRefresh" });
      return null;
    }

    let refreshed: TokenSet;
    try {
      refreshed = await refreshTokens(refreshToken);
    } catch (err) {
      // invalid_grant (rotated/expired refresh token) → drop the pair; the
      // customer must sign in again.
      if (
        err instanceof TokenEndpointError &&
        (err.oauthError === "invalid_grant" || err.status === 400 || err.status === 401)
      ) {
        await deleteCustomerTokens(customerId, sql);
      }
      reportError(err, { route: "lib/customer-oauth-store", phase: "refresh" });
      return null;
    }

    const saved = await saveCustomerTokens(customerId, refreshed, null, sql);
    if (!saved) return null;
    return refreshed.accessToken;
  } catch (err) {
    reportError(err, { route: "lib/customer-oauth-store", phase: "getValidAccessToken" });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Retention helper
// ---------------------------------------------------------------------------

/** Delete pending-auth records past their TTL. Returns the count removed. */
export async function purgeExpiredPendingAuth(sql: Sql | null = getSql()): Promise<number> {
  if (!sql) return 0;
  try {
    const rows = await sql`
      WITH del AS (
        DELETE FROM customer_auth_pending WHERE expires_at < now() RETURNING 1
      )
      SELECT count(*)::int AS n FROM del
    `;
    return rows[0]?.n != null ? Number(rows[0].n) : 0;
  } catch (err) {
    reportError(err, { route: "lib/customer-oauth-store", phase: "purgeExpiredPendingAuth" });
    return 0;
  }
}
