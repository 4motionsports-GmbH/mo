// Data layer for the email-design SELECTION (migration 0049): which registered
// code design (src/lib/email-designs/registry.ts) each outgoing email type
// currently uses. This is deliberately tiny — designs themselves live in code
// and are versioned by git; the DB only holds the per-type pointer the admin
// "Einstellungen" tab flips.
//
// Design constraints:
//   - FAIL-SOFT ON THE SEND PATH: design resolution must never block or break
//     a send. No DB, a read failure, a missing row, or a design_key no code
//     release knows all resolve to null → the classic built-in design.
//   - Send-path reads are TTL-cached (one tiny query, but sends can burst);
//     admin mutations invalidate the cache so same-instance edits go live at
//     once — same pattern as directives-store.
//
// Like every store: degrades gracefully — no DB configured → empty map /
// no-ops.

import { getSql, type Sql } from "./db";
import { reportError } from "./observability";
import type { ResolvedEmailDesign } from "./email-design-context";
import {
  CLASSIC_EMAIL_DESIGN_KEY,
  designSupportsKind,
  isKnownEmailDesign,
  resolveEmailDesignForKind,
  type EmailDesignKind,
} from "./email-designs/registry";
import { parseEmailThemeKind } from "./email-theme.mjs";

/** kind → selected design key (only kinds that HAVE a row appear). */
export type EmailDesignSelections = Partial<Record<string, string>>;

export type EmailDesignMutationError =
  | "invalid_input"
  | "unknown_design"
  | "unsupported_kind"
  | "db_unconfigured"
  | "db_error";

// ── Admin read ────────────────────────────────────────────────────────────────

export async function listEmailDesignSelections(
  sql: Sql | null = getSql()
): Promise<EmailDesignSelections> {
  if (!sql) return {};
  try {
    const rows = (await sql`
      SELECT email_kind, design_key FROM email_design_selections
    `) as Array<{ email_kind: string; design_key: string }>;
    const map: EmailDesignSelections = {};
    for (const r of rows) {
      if (parseEmailThemeKind(r.email_kind)) map[r.email_kind] = String(r.design_key);
    }
    return map;
  } catch (err) {
    reportError(err, { route: "lib/email-design-store", phase: "list" });
    return {};
  }
}

// ── Send-path read (cached) ───────────────────────────────────────────────────

let selectionCache: { at: number; byKind: EmailDesignSelections } | null = null;
const SELECTION_TTL_MS = 5 * 60 * 1000;

/**
 * The design selected for an email kind, resolved (tokens + renderers merged
 * for that kind), or null → render the classic built-ins. NEVER throws.
 */
export async function getCachedEmailDesignForKind(
  kind: string
): Promise<ResolvedEmailDesign | null> {
  const parsedKind = parseEmailThemeKind(kind);
  if (!parsedKind) return null;
  try {
    if (!selectionCache || Date.now() - selectionCache.at >= SELECTION_TTL_MS) {
      selectionCache = { at: Date.now(), byKind: await listEmailDesignSelections() };
    }
    const key = selectionCache.byKind[parsedKind];
    if (!key) return null;
    // Unknown keys (design removed from code, or a newer deploy's key on an
    // older instance) resolve to null inside — classic, never a broken send.
    return resolveEmailDesignForKind(key, parsedKind as EmailDesignKind);
  } catch (err) {
    reportError(err, { route: "lib/email-design-store", phase: "resolve" });
    return null;
  }
}

/** Drop the send-path cache (called after every admin mutation). */
export function invalidateEmailDesignCache(): void {
  selectionCache = null;
}

// ── Admin mutation ────────────────────────────────────────────────────────────

/**
 * Select a design for an email kind. `designKey` null or 'classic' clears the
 * row (the kind renders the built-in classic design).
 */
export async function setEmailDesignSelection(
  kind: string,
  designKey: string | null,
  sql: Sql | null = getSql()
): Promise<{ ok: boolean; error?: EmailDesignMutationError }> {
  if (!sql) return { ok: false, error: "db_unconfigured" };
  const parsedKind = parseEmailThemeKind(kind);
  if (!parsedKind) return { ok: false, error: "invalid_input" };
  try {
    if (designKey == null || designKey === CLASSIC_EMAIL_DESIGN_KEY) {
      await sql`DELETE FROM email_design_selections WHERE email_kind = ${parsedKind}`;
      invalidateEmailDesignCache();
      return { ok: true };
    }
    if (!isKnownEmailDesign(designKey)) return { ok: false, error: "unknown_design" };
    if (!designSupportsKind(designKey, parsedKind as EmailDesignKind)) {
      return { ok: false, error: "unsupported_kind" };
    }
    await sql`
      INSERT INTO email_design_selections (email_kind, design_key)
      VALUES (${parsedKind}, ${designKey})
      ON CONFLICT (email_kind)
      DO UPDATE SET design_key = EXCLUDED.design_key, updated_at = now()
    `;
    invalidateEmailDesignCache();
    return { ok: true };
  } catch (err) {
    reportError(err, { route: "lib/email-design-store", phase: "set" });
    return { ok: false, error: "db_error" };
  }
}
