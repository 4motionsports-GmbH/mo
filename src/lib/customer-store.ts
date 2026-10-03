// Customer data access — the email-keyed entity ABOVE sessions (migration 0008).
//
// Identity model (do not weaken this):
//   * A customer is keyed by the normalised EMAIL, the only reliable
//     cross-session identifier — and it exists only because the user gave it
//     with consent via /api/capture-email.
//   * The localStorage session id is a per-browser THREAD id, not a person.
//     Anonymous sessions are never linked to each other or to a customer.
//   * A conversation gets a customer_id when (and only when) an email is
//     captured for that session. Multiple sessions under one email = the
//     returning-customer case.
//
// email_captures stays the audit-grade source of truth for consent
// (consent_text_shown, DOI lifecycle); customers only MIRRORS the aggregated
// state for customer-level reads. Sync points: email capture, DOI confirm,
// unsubscribe.
//
// Everything here is defensive: linking is best-effort and must never break
// the capture flow; readers return null/[] when no DB is configured.

import { getSql, type Sql } from "./db";
import { normalizeEmail } from "./email-capture-store";
import type { TranscriptMessage } from "./conversation-store";
import type { OrderHistory } from "./shopify-orders";
import type { SignedInAccountSummary } from "./shopify-customer-account";
import { reportError } from "./observability";
import { decideMerge } from "./customer-merge.mjs";
import { normalizeProfileData } from "./customer-profile-core.mjs";
import { linkSessionToCustomer, resolveSignedInCustomerRow } from "./customer-session-link.mjs";

export type CustomerMarketingStatus = "none" | "pending" | "confirmed" | "unsubscribed";

/** Where a customer row came from (migration 0059). */
/** Where the row came from (0061: Shopify mirror rows are "shopify"; the
 *  legacy "shopify_account" / "kampagne" values were folded into it). */
export type CustomerSource = "chat" | "shopify" | "shopify_account" | "kampagne";

/** The structured profile fields (customer-profile-core.normalizeProfileData). */
export interface CustomerProfileData {
  persona: string;
  goals: string[];
  owned: string[];
  interests: string[];
  level: string;
  budget: string;
  nextSteps: string[];
}

export interface Customer {
  id: number;
  email: string;
  createdAt: string | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  transactionalConsent: boolean;
  marketingStatus: CustomerMarketingStatus;
  /** Cached "current understanding" profile (kept current by the nightly
   *  customer-refresh cron, regenerable on demand). */
  profileSummary: string | null;
  profileSummaryUpdatedAt: string | null;
  /** Structured profile fields next to the text (migration 0059). */
  profileData: CustomerProfileData | null;
  /** Persona archetype key of the latest profile. */
  personaLabel: string | null;
  /** When the profile upkeep last looked at this customer. */
  profileCheckedAt: string | null;
  /** Where the row came from — chat capture, Shopify sign-in or Kampagne sync. */
  source: CustomerSource;
  /** Cached Shopify order-history summary (refreshed on demand). */
  purchaseSummary: OrderHistory | null;
  purchaseSummaryUpdatedAt: string | null;
  /**
   * Cached signed-in (tier-3) Customer Account snapshot — name + a
   * data-minimised address context (city/country only). Populated from the
   * Customer Account API on sign-in / refresh (migration 0015). Null for
   * tiers 1–2 and for tier-3 rows not yet refreshed.
   */
  shopifyAccountSummary: SignedInAccountSummary | null;
  shopifyAccountSummaryUpdatedAt: string | null;
  /**
   * The LAWFUL full postal address (migration 0022), the ONLY basis for physical
   * mail (lib/physical-address). Its OWN store, SEPARATE from the minimised
   * city/country account summary above: written only by a future consented-
   * capture / purchase-derived flow, NULL by default. The profile/greeting never
   * read it — minimisation stays intact. Shape:
   * { name, company?, address_line_1, address_line_2?, postal_code, city,
   *   country }. `postalAddressSource` records the lawful basis ('purchase' |
   *   'consented_capture').
   */
  postalAddress: Record<string, unknown> | null;
  postalAddressSource: string | null;
  /** When we last attempted a background Shopify address capture (throttle). */
  postalAddressCheckedAt: string | null;
  /**
   * The SEPARATE, editable physical-letter draft (migration 0023) — distinct
   * from the email draft (marketing_sends). One open draft per customer; written
   * by the letter-draft generator, rendered to a PDF + submitted to Pingen on
   * "Brief senden". Null when no letter draft has been generated.
   */
  letterDraftSubject: string | null;
  letterDraftBody: string | null;
  letterDraftUpdatedAt: string | null;
  /**
   * Admin free-text special instructions for the next generated marketing
   * email (migration 0010) — e.g. "mention the new rowing machine line". The
   * CURRENT editable value; the snapshot that went into a specific draft is
   * frozen on the marketing_sends row.
   */
  adminInstructions: string | null;
  adminInstructionsUpdatedAt: string | null;
  // Historical welcome-discount data (migration 0009). The automatic issuance
  // feature was retired pre-launch; these columns are now READ-ONLY — never
  // written again — and back the dashboard's historical view of codes that
  // were issued while the feature was live.
  /** The one-time welcome discount code, if one was issued historically. */
  welcomeCode: string | null;
  /** When that welcome code stops working (Shopify endsAt). */
  welcomeCodeExpiresAt: string | null;
  /** Issuance stamp — non-NULL means a welcome code was issued historically. */
  welcomeIssuedAt: string | null;
  // --- Tier-3 (signed-in Shopify customer) identity (migration 0014) ---------
  /** Numeric extracted from the Shopify customer GID — the tier-3 key. */
  shopifyCustomerId: string | null;
  /** Canonical gid://shopify/Customer/<numeric>. */
  shopifyCustomerGid: string | null;
  /** When sign-in first bound this row to a Shopify identity. */
  shopifyLinkedAt: string | null;
  /** 1 anonymous, 2 email-identified, 3 signed-in. */
  identityTier: 1 | 2 | 3;
  // --- Shopify mirror (migration 0061) ---------------------------------------
  firstName: string | null;
  lastName: string | null;
  locale: string | null;
  countryCode: string | null;
  /** The person's e-mail language pin (all campaigns, Kunden). */
  languageOverride: "de" | "en" | null;
  shopifyState: string | null;
  shopifyTags: string[];
  shopifyCreatedAt: string | null;
  /** Last time the mirror wrote this row from Shopify (null = not mirrored). */
  shopifySyncedAt: string | null;
  /** kauf = purchase profile only, voll = full profile (chat + purchases). */
  profileDepth: "kauf" | "voll" | null;
  /** Art. 21 objection to profiling — no AI profile is built or used. */
  profileObjectionAt: string | null;
  /** Art. 21 objection to postal advertising — no letters. */
  postalObjectionAt: string | null;
  // --- The one e-mail consent (migration 0064) --------------------------------
  emailConsentState: "subscribed" | "pending" | "unsubscribed" | "not_subscribed";
  emailConsentLevel: "confirmed_opt_in" | "single_opt_in" | "unknown" | null;
  emailConsentAt: string | null;
  emailConsentSource: string | null;
}

function mapCustomer(r: Record<string, unknown>): Customer {
  return {
    id: Number(r.id),
    email: String(r.email),
    createdAt: (r.created_at as string | null) ?? null,
    firstSeenAt: (r.first_seen_at as string | null) ?? null,
    lastSeenAt: (r.last_seen_at as string | null) ?? null,
    transactionalConsent: Boolean(r.transactional_consent),
    marketingStatus: (r.marketing_status as CustomerMarketingStatus) ?? "none",
    profileSummary: (r.profile_summary as string | null) ?? null,
    profileSummaryUpdatedAt: (r.profile_summary_updated_at as string | null) ?? null,
    profileData: r.profile_data ? normalizeProfileData(r.profile_data) : null,
    personaLabel: (r.persona_label as string | null) ?? null,
    profileCheckedAt: (r.profile_checked_at as string | null) ?? null,
    source: (r.source as CustomerSource | undefined) ?? "chat",
    purchaseSummary: (r.purchase_summary as OrderHistory | null) ?? null,
    purchaseSummaryUpdatedAt: (r.purchase_summary_updated_at as string | null) ?? null,
    shopifyAccountSummary: (r.shopify_account_summary as SignedInAccountSummary | null) ?? null,
    shopifyAccountSummaryUpdatedAt: (r.shopify_account_summary_updated_at as string | null) ?? null,
    postalAddress: (r.postal_address as Record<string, unknown> | null) ?? null,
    postalAddressSource: (r.postal_address_source as string | null) ?? null,
    postalAddressCheckedAt: (r.postal_address_checked_at as string | null) ?? null,
    letterDraftSubject: (r.letter_draft_subject as string | null) ?? null,
    letterDraftBody: (r.letter_draft_body as string | null) ?? null,
    letterDraftUpdatedAt: (r.letter_draft_updated_at as string | null) ?? null,
    adminInstructions: (r.admin_instructions as string | null) ?? null,
    adminInstructionsUpdatedAt: (r.admin_instructions_updated_at as string | null) ?? null,
    welcomeCode: (r.welcome_code as string | null) ?? null,
    welcomeCodeExpiresAt: (r.welcome_code_expires_at as string | null) ?? null,
    welcomeIssuedAt: (r.welcome_issued_at as string | null) ?? null,
    shopifyCustomerId: (r.shopify_customer_id as string | null) ?? null,
    shopifyCustomerGid: (r.shopify_customer_gid as string | null) ?? null,
    shopifyLinkedAt: (r.shopify_linked_at as string | null) ?? null,
    identityTier: (Number(r.identity_tier ?? 1) as 1 | 2 | 3) ?? 1,
    firstName: (r.first_name as string | null) ?? null,
    lastName: (r.last_name as string | null) ?? null,
    locale: (r.locale as string | null) ?? null,
    countryCode: (r.country_code as string | null) ?? null,
    languageOverride: r.language_override === "de" || r.language_override === "en" ? r.language_override : null,
    shopifyState: (r.shopify_state as string | null) ?? null,
    shopifyTags: Array.isArray(r.shopify_tags) ? (r.shopify_tags as string[]) : [],
    shopifyCreatedAt: isoOrNull(r.shopify_created_at),
    shopifySyncedAt: isoOrNull(r.shopify_synced_at),
    profileDepth: r.profile_depth === "kauf" || r.profile_depth === "voll" ? r.profile_depth : null,
    profileObjectionAt: isoOrNull(r.profile_objection_at),
    postalObjectionAt: isoOrNull(r.postal_objection_at),
    emailConsentState:
      r.email_consent_state === "subscribed" ||
      r.email_consent_state === "pending" ||
      r.email_consent_state === "unsubscribed"
        ? r.email_consent_state
        : "not_subscribed",
    emailConsentLevel:
      r.email_consent_level === "confirmed_opt_in" ||
      r.email_consent_level === "single_opt_in" ||
      r.email_consent_level === "unknown"
        ? r.email_consent_level
        : null,
    emailConsentAt: isoOrNull(r.email_consent_at),
    emailConsentSource: (r.email_consent_source as string | null) ?? null,
  };
}

function isoOrNull(v: unknown): string | null {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// ---------------------------------------------------------------------------
// Identity bind — the consent-anchored bridge into Cluster A.
//
// Two entry points share this module:
//   * linkCustomerOnEmailCapture (tier 2) — /api/capture-email, keyed by the
//     consented email.
//   * bindShopifyIdentity (tier 3) — the Customer Account sign-in callback,
//     keyed by the verified Shopify customer id, merging by email.
// ---------------------------------------------------------------------------

export interface LinkCustomerInput {
  email: string;
  sessionId: string | null;
}

/**
 * Find-or-create the customer for an email capture, attach the current
 * conversation, bump last_seen_at, and mirror the aggregated consent state.
 * Returns the customer id, or null when skipped/failed. Best-effort: a failure
 * here must NEVER break the capture flow (the consent is already stored), so
 * this logs and returns null instead of throwing.
 *
 * Stamps identity_tier to at least 2 (email-identified) without ever
 * downgrading an existing tier-3 (signed-in) customer who re-captures an email.
 */
export async function linkCustomerOnEmailCapture(
  input: LinkCustomerInput,
  sql: Sql | null = getSql()
): Promise<number | null> {
  if (!sql) return null;
  const email = normalizeEmail(input.email);
  if (!email) return null;
  const sessionId = input.sessionId?.trim() || null;

  try {
    // Find-or-create keyed by email. An existing customer means a RETURNING
    // visit — bump last_seen_at; first_seen_at stays put. A new row is at least
    // tier 2; GREATEST never weakens an already signed-in (tier 3) customer.
    const rows = await sql`
      INSERT INTO customers (email, identity_tier)
      VALUES (${email}, 2)
      ON CONFLICT (email) DO UPDATE SET
        last_seen_at = now(),
        identity_tier = GREATEST(customers.identity_tier, 2)
      RETURNING id
    `;
    const customerId = rows[0]?.id != null ? Number(rows[0].id) : null;
    if (customerId == null) return null;

    // Mirror the aggregated consent state from the (just-upserted) capture.
    await syncCustomerConsent(email, sql);

    // Attach the consent record.
    await sql`
      UPDATE email_captures SET customer_id = ${customerId} WHERE email = ${email}
    `;

    // Attach the current conversation — the one explicit, consent-anchored
    // bridge into Cluster A. Latest capture wins: if a user corrects their
    // email mid-session, the conversation follows the newest identity.
    if (sessionId) {
      await sql`
        UPDATE conversations SET customer_id = ${customerId} WHERE session_id = ${sessionId}
      `;
      // Record the DIRECT session → customer link (migration 0019) so identity
      // resolution never depends on a conversation row existing.
      // A typed e-mail proves nothing about mailbox ownership: the link is
      // 'email' and never resolves as signed in (0071).
      await linkSessionToCustomer(sql, sessionId, customerId, "email");
    }
    return customerId;
  } catch (err) {
    reportError(err, { route: "lib/customer-store", phase: "linkCustomerOnEmailCapture" });
    return null;
  }
}

/**
 * Find-or-create a prospect („Interessent“) for someone who wrote to us — a
 * contact-form request or an unknown sender the operator takes on. Keyed by
 * e-mail; an existing customer is returned unchanged (a name only fills empty
 * fields). No consent is set. Returns the id, null on failure. Never throws.
 */
export async function findOrCreateProspect(
  input: { email: string; firstName?: string | null; lastName?: string | null },
  sql: Sql | null = getSql()
): Promise<number | null> {
  if (!sql) return null;
  const email = normalizeEmail(input.email);
  if (!email) return null;
  try {
    const rows = (await sql`
      INSERT INTO customers (email, identity_tier, first_name, last_name)
      VALUES (${email}, 2, ${input.firstName ?? null}, ${input.lastName ?? null})
      ON CONFLICT (email) DO UPDATE SET
        first_name = COALESCE(customers.first_name, EXCLUDED.first_name),
        last_name = COALESCE(customers.last_name, EXCLUDED.last_name),
        last_seen_at = now()
      RETURNING id
    `) as Array<{ id: number }>;
    return rows[0]?.id != null ? Number(rows[0].id) : null;
  } catch (err) {
    reportError(err, { route: "lib/customer-store", phase: "findOrCreateProspect" });
    return null;
  }
}

/**
 * Mirror the transactional consent (the summary request) from email_captures
 * onto the customer row. The MARKETING consent is no longer mirrored from the
 * capture: it is the one consent shared with Shopify, written only by
 * lib/consent-store.ts (which also keeps marketing_status as its legacy
 * mirror). No-op when no customer/capture exists. Never throws.
 */
export async function syncCustomerConsent(
  email: string,
  sql: Sql | null = getSql()
): Promise<void> {
  if (!sql) return;
  const e = normalizeEmail(email);
  if (!e) return;
  try {
    await sql`
      UPDATE customers c
         SET transactional_consent = c.transactional_consent OR ec.transactional_consent
        FROM email_captures ec
       WHERE ec.email = c.email
         AND c.email = ${e}
    `;
  } catch (err) {
    reportError(err, { route: "lib/customer-store", phase: "syncCustomerConsent" });
  }
}

// ---------------------------------------------------------------------------
// Readers
// ---------------------------------------------------------------------------

export async function getCustomerById(
  customerId: number,
  sql: Sql | null = getSql()
): Promise<Customer | null> {
  if (!sql) return null;
  try {
    const rows = (await sql`
      SELECT * FROM customers WHERE id = ${customerId}
    `) as Array<Record<string, unknown>>;
    return rows[0] ? mapCustomer(rows[0]) : null;
  } catch (err) {
    reportError(err, { route: "lib/customer-store", phase: "getCustomerById" });
    return null;
  }
}

export async function getCustomerByEmail(
  email: string,
  sql: Sql | null = getSql()
): Promise<Customer | null> {
  if (!sql) return null;
  const e = normalizeEmail(email);
  if (!e) return null;
  try {
    const rows = (await sql`
      SELECT * FROM customers WHERE email = ${e}
    `) as Array<Record<string, unknown>>;
    return rows[0] ? mapCustomer(rows[0]) : null;
  } catch (err) {
    reportError(err, { route: "lib/customer-store", phase: "getCustomerByEmail" });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Tier-3 identity bind (Customer Account sign-in)
// ---------------------------------------------------------------------------

export interface BindShopifyIdentityInput {
  /** Numeric id extracted from the GraphQL customer.id GID — the tier-3 key. */
  shopifyCustomerId: string;
  /** Canonical gid://shopify/Customer/<numeric>. */
  shopifyCustomerGid: string;
  /** Shopify's VERIFIED email (authoritative for identity). */
  email: string | null;
  /** Optional id_token subject, recorded on the token row for cross-check. */
  idTokenSub?: string | null;
  /** Widget thread to attach to this identity. */
  sessionId: string | null;
  /**
   * The proof behind this sign-in, recorded on the session link (migration
   * 0071): the Customer Account OAuth callback or the shop's App Proxy.
   */
  linkKind: "customer_account" | "app_proxy";
}

export interface BindShopifyIdentityResult {
  customerId: number;
  /** Whether a merge conflict was logged for admin review. */
  conflict: boolean;
}

/** Postgres unique_violation (SQLSTATE 23505) — the signature of a lost identity race. */
function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === "23505";
}

async function bindShopifyIdentityOnce(
  sql: Sql,
  shopifyId: string,
  email: string,
  sessionId: string | null,
  input: BindShopifyIdentityInput
): Promise<BindShopifyIdentityResult> {
  const byShopifyRows = (await sql`
    SELECT id, email FROM customers WHERE shopify_customer_id = ${shopifyId}
  `) as Array<Record<string, unknown>>;
  const rowByShopifyId = byShopifyRows[0]
    ? { id: Number(byShopifyRows[0].id), email: (byShopifyRows[0].email as string | null) ?? null }
    : null;

  let rowByEmail: { id: number; email: string | null } | null = null;
  if (email) {
    const byEmailRows = (await sql`
      SELECT id, email FROM customers WHERE email = ${email}
    `) as Array<Record<string, unknown>>;
    rowByEmail = byEmailRows[0]
      ? { id: Number(byEmailRows[0].id), email: (byEmailRows[0].email as string | null) ?? null }
      : null;
  }

  const decision = decideMerge({ rowByShopifyId, rowByEmail, shopifyEmail: email });

  let customerId: number;
  if (decision.action === "create") {
    // No existing row → create a fresh tier-3 customer. If we have no verified
    // email we still need a unique key; fall back to a synthetic placeholder
    // keyed by the Shopify id (kept normalised + unique).
    const insertEmail = email || `shopify:${shopifyId}`;
    const rows = (await sql`
      INSERT INTO customers
        (email, shopify_customer_id, shopify_customer_gid, shopify_linked_at, identity_tier, source)
      VALUES (${insertEmail}, ${shopifyId}, ${input.shopifyCustomerGid}, now(), 3, 'shopify')
      ON CONFLICT (email) DO UPDATE SET last_seen_at = now()
      RETURNING id
    `) as Array<Record<string, unknown>>;
    customerId = Number(rows[0].id);
  } else {
    // use | stamp — both target an existing row. Stamp the Shopify ids and
    // bump to tier 3 (never weakening). We do NOT overwrite the
    // consent-anchored email even on a mismatch (Shopify is authoritative for
    // identity, but the consent provenance stays put — the conflict is logged).
    //
    // MATCH-UP (email-only → signed-in): in the STAMP case the targeted row is
    // the existing tier-2 customer matched by the verified email. This UPDATE
    // touches ONLY identity columns — it NEVER writes marketing_status /
    // transactional_consent — so a PRIOR DOI consent under that email carries
    // forward intact (still 'confirmed' in email_captures + the mirrored
    // customers row): none invented, none silently revoked. Signing in
    // establishes identity, never marketing consent.
    customerId = decision.customerId as number;
    await sql`
      UPDATE customers SET
        shopify_customer_id  = ${shopifyId},
        shopify_customer_gid = ${input.shopifyCustomerGid},
        shopify_linked_at    = COALESCE(shopify_linked_at, now()),
        identity_tier        = GREATEST(identity_tier, 3),
        last_seen_at         = now()
      WHERE id = ${customerId}
    `;
  }

  // Attach the current conversation to this identity (the generalised
  // "identity bind" — same bridge linkCustomerOnEmailCapture uses).
  //
  // MATCH-UP (current-anonymous-session → signed-in): this attaches ONLY the
  // chat that led to sign-in — the session in the signed `state`/pending
  // record — by matching `session_id = THIS session`. It deliberately NEVER
  // scoops other anonymous threads retroactively: a different browser/session
  // id simply doesn't match, so its conversations stay pseudonymous.
  if (sessionId) {
    await sql`
      UPDATE conversations SET customer_id = ${customerId} WHERE session_id = ${sessionId}
    `;
    // THE re-hydration link. The conversation attach above only fires when a
    // chat row already exists for this session — which it often does NOT at
    // sign-in (the prompt=none silent check / "Anmelden" before any message).
    // Persisting the DIRECT session → customer link here (migration 0019) is
    // what lets /api/auth/me and /api/account/* resolve this session back to
    // the signed-in customer regardless of whether a conversation exists yet.
    // The link records the sign-in proof (0071) — only such links count as
    // signed in; a typed e-mail link never does.
    await linkSessionToCustomer(sql, sessionId, customerId, input.linkKind);
  }

  // Record the id_token subject on the token row later (saveCustomerTokens);
  // here we only persist identity. Conflicts are audit-logged.
  let conflict = false;
  if (decision.conflict) {
    conflict = true;
    await sql`
      INSERT INTO customer_merge_conflicts
        (shopify_customer_id, shopify_customer_gid, shopify_email,
         email_row_customer_id, email_row_email, shopify_row_customer_id,
         conflict_kind, resolved_customer_id, session_id)
      VALUES (${shopifyId}, ${input.shopifyCustomerGid}, ${email || null},
              ${decision.conflict.emailRowCustomerId}, ${decision.conflict.emailRowEmail},
              ${decision.conflict.shopifyRowCustomerId}, ${decision.conflict.kind},
              ${customerId}, ${sessionId})
    `;
  }

  return { customerId, conflict };
}

/**
 * Bind a verified Shopify identity to a customer row on sign-in, running the
 * email↔Shopify merge rule (see lib/customer-merge.mjs / docs/CUSTOMER_ACCOUNT.md):
 *   (a) existing row by shopify_customer_id → use it;
 *   (b) else existing tier-2 row by verified email → stamp shopify ids, tier 3
 *       (carries consent/profile/history forward);
 *   (c) else create a tier-3 row;
 *   (d) collision / email mismatch → prefer Shopify's verified email as the
 *       authoritative identity but DO NOT silently fuse consent records — record
 *       a merge-conflict for admin review.
 *
 * Re-keying NEVER imports Shopify's marketing state into marketing_status —
 * sign-in establishes IDENTITY, not marketing consent. Returns null only when
 * no DB is configured or the write hard-fails. Throws nothing the caller can't
 * handle: it returns null on failure (the callback degrades gracefully).
 */
export async function bindShopifyIdentity(
  input: BindShopifyIdentityInput,
  sql: Sql | null = getSql()
): Promise<BindShopifyIdentityResult | null> {
  if (!sql) return null;
  const shopifyId = input.shopifyCustomerId.trim();
  if (!shopifyId) return null;
  const email = input.email ? normalizeEmail(input.email) : "";
  const sessionId = input.sessionId?.trim() || null;

  // Retry up to 3 times on a Postgres unique_violation (SQLSTATE 23505): a
  // concurrent bind of the same Shopify identity can insert the conflicting row
  // between our SELECTs and the write. The DB constraints already prevent
  // duplicates, so retrying re-reads the now-visible row and succeeds cleanly.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await bindShopifyIdentityOnce(sql, shopifyId, email, sessionId, input);
    } catch (err) {
      if (isUniqueViolation(err) && attempt < 2) continue;
      reportError(err, { route: "lib/customer-store", phase: "bindShopifyIdentity" });
      return null;
    }
  }
  return null;
}

/**
 * Resolve the signed-in customer for a widget session (the opaque session
 * reference → customer row). Returns the tier-3 identity for re-hydration, or
 * null when the session isn't linked to a signed-in customer. Fail-closed.
 */
export interface SignedInIdentity {
  customerId: number;
  shopifyCustomerId: string;
  /** Best available display name (displayName → first+last → null). */
  name: string | null;
  tier: 3;
}

export async function resolveSignedInCustomer(
  sessionId: string | null,
  sql: Sql | null = getSql()
): Promise<SignedInIdentity | null> {
  if (!sql) return null;
  const sid = sessionId?.trim();
  if (!sid) return null;
  try {
    // Resolve through the DIRECT session → customer link (migration 0019), with a
    // fallback to the legacy conversation stamp. Reads shopify_customer_id IS NOT
    // NULL only — anonymous/email-only sessions resolve to null (fail closed).
    const resolved = await resolveSignedInCustomerRow(sql, sid);
    if (!resolved) return null;
    // The name comes from Shopify (authoritative) at sign-in; we don't cache PII
    // names locally for tier 3 in CA-1, so this resolver returns the linkage and
    // tier. The callback supplies the live name to /api/auth/me via Shopify.
    return {
      customerId: resolved.customerId,
      shopifyCustomerId: resolved.shopifyCustomerId,
      name: null,
      tier: 3,
    };
  } catch (err) {
    reportError(err, { route: "lib/customer-store", phase: "resolveSignedInCustomer" });
    return null;
  }
}

/**
 * Number of linked conversations EXCLUDING the given session — the customer's
 * PRIOR consultations. The live conversation is linked at capture time, so it
 * must not count as "history" of its own. Returns 0 on any failure.
 */
export async function countPriorConversations(
  customerId: number,
  excludeSessionId: string | null,
  sql: Sql | null = getSql()
): Promise<number> {
  if (!sql) return 0;
  try {
    const rows = await sql`
      SELECT count(*)::int AS n FROM conversations
       WHERE customer_id = ${customerId}
         AND (${excludeSessionId}::text IS NULL OR session_id <> ${excludeSessionId})
    `;
    return rows[0]?.n != null ? Number(rows[0].n) : 0;
  } catch (err) {
    reportError(err, { route: "lib/customer-store", phase: "countPriorConversations" });
    return 0;
  }
}

/** One linked conversation of a customer, with its readable transcript. */
export interface CustomerSession {
  conversationId: number;
  sessionId: string;
  createdAt: string | null;
  lastActivityAt: string | null;
  personaLabel: string | null;
  messageCount: number;
  /** Readable user/assistant turns (tool bookkeeping rows dropped). */
  transcript: TranscriptMessage[];
}

// Bound the dashboard load: customers per page, conversations per customer.
const SESSIONS_PER_CUSTOMER = 25;

/**
 * Load a customer's linked conversations (oldest first — a timeline) with
 * their transcripts. Returns [] on any failure.
 */
export async function loadCustomerSessions(
  customerId: number,
  sql: Sql | null = getSql()
): Promise<CustomerSession[]> {
  if (!sql) return [];
  try {
    const convRows = (await sql`
      SELECT id, session_id, created_at, last_activity_at, persona_label, message_count
        FROM conversations
       WHERE customer_id = ${customerId}
       ORDER BY created_at ASC, id ASC
       LIMIT ${SESSIONS_PER_CUSTOMER}
    `) as Array<Record<string, unknown>>;
    if (convRows.length === 0) return [];

    const ids = convRows.map((r) => Number(r.id));
    const msgRows = (await sql`
      SELECT conversation_id, role, content, tool_name
        FROM messages
       WHERE conversation_id = ANY(${ids})
       ORDER BY created_at ASC, id ASC
    `) as Array<Record<string, unknown>>;

    const byConversation = new Map<number, TranscriptMessage[]>();
    for (const m of msgRows) {
      const cid = Number(m.conversation_id);
      const role = m.role as TranscriptMessage["role"];
      const content = typeof m.content === "string" ? m.content : "";
      const toolName = (m.tool_name as string | null) ?? null;
      // Keep only the readable conversation turns.
      if (toolName !== null || (role !== "user" && role !== "assistant") || !content.trim()) {
        continue;
      }
      const list = byConversation.get(cid) ?? [];
      list.push({ role, content, toolName: null });
      byConversation.set(cid, list);
    }

    return convRows.map((r) => ({
      conversationId: Number(r.id),
      sessionId: String(r.session_id),
      createdAt: (r.created_at as string | null) ?? null,
      lastActivityAt: (r.last_activity_at as string | null) ?? null,
      personaLabel: (r.persona_label as string | null) ?? null,
      messageCount: r.message_count != null ? Number(r.message_count) : 0,
      transcript: byConversation.get(Number(r.id)) ?? [],
    }));
  } catch (err) {
    reportError(err, { route: "lib/customer-store", phase: "loadCustomerSessions" });
    return [];
  }
}

// ---------------------------------------------------------------------------
// Cached summaries (written by the admin routes)
// ---------------------------------------------------------------------------

export async function saveCustomerPurchaseSummary(
  customerId: number,
  history: OrderHistory,
  sql: Sql | null = getSql()
): Promise<boolean> {
  if (!sql) return false;
  try {
    const rows = await sql`
      UPDATE customers
         SET purchase_summary = ${JSON.stringify(history)}::jsonb,
             purchase_summary_updated_at = now()
       WHERE id = ${customerId}
      RETURNING id
    `;
    return rows.length > 0;
  } catch (err) {
    reportError(err, { route: "lib/customer-store", phase: "saveCustomerPurchaseSummary" });
    return false;
  }
}

/**
 * Cache the signed-in (tier-3) Customer Account snapshot — name + the
 * data-minimised address context (migration 0015). Best-effort; returns false
 * when the customer doesn't exist or the write failed. Never throws.
 */
export async function saveCustomerAccountSummary(
  customerId: number,
  summary: SignedInAccountSummary,
  sql: Sql | null = getSql()
): Promise<boolean> {
  if (!sql) return false;
  try {
    const rows = await sql`
      UPDATE customers
         SET shopify_account_summary = ${JSON.stringify(summary)}::jsonb,
             shopify_account_summary_updated_at = now()
       WHERE id = ${customerId}
      RETURNING id
    `;
    return rows.length > 0;
  } catch (err) {
    reportError(err, { route: "lib/customer-store", phase: "saveCustomerAccountSummary" });
    return false;
  }
}

/**
 * Persist the LAWFUL full postal address (migration 0022) — the ONLY basis for
 * physical mail. SEPARATE from the minimised account summary: written by the
 * address-acquisition flow (a completed order's shipping address, or the saved
 * profile address) with the lawful basis recorded in postal_address_source. The
 * caller passes a COMPLETE, normalised address (lib/postal-address) — we never
 * part-fill here. Best-effort; returns false when the customer doesn't exist or
 * the write failed. Never throws.
 */
export async function saveCustomerPostalAddress(
  customerId: number,
  address: Record<string, unknown>,
  source: string,
  sql: Sql | null = getSql()
): Promise<boolean> {
  if (!sql) return false;
  try {
    const rows = await sql`
      UPDATE customers
         SET postal_address = ${JSON.stringify(address)}::jsonb,
             postal_address_source = ${source},
             postal_address_updated_at = now()
       WHERE id = ${customerId}
      RETURNING id
    `;
    return rows.length > 0;
  } catch (err) {
    reportError(err, { route: "lib/customer-store", phase: "saveCustomerPostalAddress" });
    return false;
  }
}

/** Customers WITHOUT a stored postal address that haven't been checked since
 *  `staleBeforeIso` — the candidates for background address auto-capture. Newest-
 *  seen first (most likely to matter). Returns [] on no DB / error. */
export async function listCustomersMissingAddress(
  limit: number,
  staleBeforeIso: string,
  sql: Sql | null = getSql()
): Promise<Array<{ id: number; email: string }>> {
  if (!sql) return [];
  try {
    const rows = (await sql`
      SELECT id, email
        FROM customers
       WHERE postal_address IS NULL
         AND (postal_address_checked_at IS NULL OR postal_address_checked_at < ${staleBeforeIso})
       ORDER BY last_seen_at DESC, id DESC
       LIMIT ${limit}
    `) as Array<Record<string, unknown>>;
    return rows.map((r) => ({ id: Number(r.id), email: String(r.email) }));
  } catch (err) {
    reportError(err, { route: "lib/customer-store", phase: "listCustomersMissingAddress" });
    return [];
  }
}

/** Customers whose cached Shopify data is stale (purchase_summary older than
 *  `staleBeforeIso`, or never fetched) — the batch the scheduled refresh cron
 *  processes, most-stale first. Returns the fields refreshCustomerData needs. */
export async function listCustomersForDataRefresh(
  limit: number,
  staleBeforeIso: string,
  sql: Sql | null = getSql()
): Promise<Array<{ id: number; email: string; shopifyCustomerId: string | null }>> {
  if (!sql) return [];
  try {
    const rows = (await sql`
      SELECT id, email, shopify_customer_id
        FROM customers
       -- Mirrored people read their orders from the ledger (0062); only the
       -- rest still need the per-e-mail Shopify read.
       WHERE shopify_synced_at IS NULL
         AND (purchase_summary_updated_at IS NULL
              OR purchase_summary_updated_at < ${staleBeforeIso})
       ORDER BY purchase_summary_updated_at ASC NULLS FIRST, id ASC
       LIMIT ${limit}
    `) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: Number(r.id),
      email: String(r.email),
      shopifyCustomerId: (r.shopify_customer_id as string | null) ?? null,
    }));
  } catch (err) {
    reportError(err, { route: "lib/customer-store", phase: "listCustomersForDataRefresh" });
    return [];
  }
}

/** Stamp that we attempted an address capture for this customer (throttle), so a
 *  customer with genuinely no Shopify address isn't re-queried every page load. */
export async function markPostalAddressChecked(
  customerId: number,
  sql: Sql | null = getSql()
): Promise<void> {
  if (!sql) return;
  try {
    await sql`UPDATE customers SET postal_address_checked_at = now() WHERE id = ${customerId}`;
  } catch (err) {
    reportError(err, { route: "lib/customer-store", phase: "markPostalAddressChecked" });
  }
}

/**
 * Persist the editable physical-letter draft (migration 0023) — subject + body
 * the operator reviews before "Brief senden". Best-effort; returns false when the
 * customer doesn't exist or the write failed. Never throws.
 */
export async function saveCustomerLetterDraft(
  customerId: number,
  subject: string,
  body: string,
  sql: Sql | null = getSql()
): Promise<boolean> {
  if (!sql) return false;
  try {
    const rows = await sql`
      UPDATE customers
         SET letter_draft_subject = ${subject},
             letter_draft_body = ${body},
             letter_draft_updated_at = now()
       WHERE id = ${customerId}
      RETURNING id
    `;
    return rows.length > 0;
  } catch (err) {
    reportError(err, { route: "lib/customer-store", phase: "saveCustomerLetterDraft" });
    return false;
  }
}

/**
 * Persist the admin's free-text special instructions for the next generated
 * marketing email. NULL clears them. Returns false when the customer doesn't
 * exist or the write failed. Never throws.
 */
export async function saveCustomerAdminInstructions(
  customerId: number,
  instructions: string | null,
  sql: Sql | null = getSql()
): Promise<boolean> {
  if (!sql) return false;
  try {
    const rows = await sql`
      UPDATE customers
         SET admin_instructions = ${instructions},
             admin_instructions_updated_at = now()
       WHERE id = ${customerId}
      RETURNING id
    `;
    return rows.length > 0;
  } catch (err) {
    reportError(err, { route: "lib/customer-store", phase: "saveCustomerAdminInstructions" });
    return false;
  }
}

/** Per-conversation product sets of a customer, NEWEST conversation first. */
export interface CustomerProductSelection {
  selectedProductIds: string[];
  recommendedProductIds: string[];
}

/**
 * The product sets of every linked conversation, newest first — the raw input
 * for the per-customer email's product chooser (see chooseCustomerProductIds
 * in lib/cart). Returns [] on any failure.
 */
export async function loadCustomerProductSelections(
  customerId: number,
  sql: Sql | null = getSql()
): Promise<CustomerProductSelection[]> {
  if (!sql) return [];
  try {
    const rows = (await sql`
      SELECT selected_product_ids, recommended_product_ids
        FROM conversations
       WHERE customer_id = ${customerId}
       ORDER BY created_at DESC, id DESC
       LIMIT ${SESSIONS_PER_CUSTOMER}
    `) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      selectedProductIds: Array.isArray(r.selected_product_ids)
        ? (r.selected_product_ids as string[])
        : [],
      recommendedProductIds: Array.isArray(r.recommended_product_ids)
        ? (r.recommended_product_ids as string[])
        : [],
    }));
  } catch (err) {
    reportError(err, { route: "lib/customer-store", phase: "loadCustomerProductSelections" });
    return [];
  }
}

/** Store a freshly generated profile: the readable text, the structured
 *  fields and the persona column. Also stamps profile_checked_at, so the
 *  nightly upkeep only picks the customer again after new activity. */
export async function saveCustomerProfile(
  customerId: number,
  profile: { summary: string; data: CustomerProfileData; depth?: "kauf" | "voll" },
  sql: Sql | null = getSql()
): Promise<boolean> {
  if (!sql) return false;
  const persona = profile.data.persona !== "unknown" ? profile.data.persona : null;
  try {
    const rows = await sql`
      UPDATE customers
         SET profile_summary = ${profile.summary},
             profile_summary_updated_at = now(),
             profile_data = ${JSON.stringify(profile.data)}::jsonb,
             persona_label = ${persona},
             profile_depth = ${profile.depth ?? "voll"},
             profile_checked_at = now()
       WHERE id = ${customerId}
      RETURNING id
    `;
    return rows.length > 0;
  } catch (err) {
    reportError(err, { route: "lib/customer-store", phase: "saveCustomerProfile" });
    return false;
  }
}

/** The upkeep looked at this customer but found nothing to summarise (or the
 *  model failed) — stamp it so it waits for new activity instead of being
 *  retried every night. */
export async function markCustomerProfileChecked(
  customerId: number,
  sql: Sql | null = getSql()
): Promise<void> {
  if (!sql) return;
  try {
    await sql`UPDATE customers SET profile_checked_at = now() WHERE id = ${customerId}`;
  } catch (err) {
    reportError(err, { route: "lib/customer-store", phase: "markCustomerProfileChecked" });
  }
}

/**
 * Customers whose profile needs (re)generation, per depth (0061):
 *   voll — people with a Mo chat or correspondence (deep tier);
 *   kauf — Shopify customers with orders but no conversation (writer tier).
 * Due = never checked, or activity (chat, mail, campaign send, order) newer
 * than the last check. Only people the scope allows (CUSTOMER_AI_PROFILE_SCOPE:
 * `consented` = with the one consent, `all` = everyone) and without an Art. 21
 * objection. Never-checked first, then the most recently active. Returns ids
 * plus the total still waiting (backfill progress).
 */
export async function listCustomersForProfileUpkeep(
  limit: number,
  opts: { depth?: "voll" | "kauf"; scope?: "consented" | "all" } = {},
  sql: Sql | null = getSql()
): Promise<{ ids: number[]; remaining: number }> {
  if (!sql) return { ids: [], remaining: 0 };
  const depth = opts.depth ?? "voll";
  const scope = opts.scope ?? "consented";
  try {
    const rows = (await sql`
      WITH activity AS (
        SELECT c.id, c.profile_checked_at, c.last_seen_at,
               EXISTS (SELECT 1 FROM conversations v WHERE v.customer_id = c.id)
                 OR EXISTS (SELECT 1 FROM email_messages m WHERE m.customer_id = c.id) AS has_dialogue,
               COALESCE(f.orders_count, 0) AS orders_count,
               GREATEST(
                 (SELECT max(v.last_activity_at) FROM conversations v WHERE v.customer_id = c.id),
                 (SELECT max(m.occurred_at) FROM email_messages m WHERE m.customer_id = c.id),
                 (SELECT max(s.sent_at) FROM campaign_sends s WHERE s.customer_id = c.id AND s.is_test = false),
                 f.last_order_at
               ) AS last_activity_at
          FROM customers c
          LEFT JOIN customer_facts f ON f.customer_id = c.id
         WHERE c.profile_objection_at IS NULL
           AND (${scope} = 'all' OR c.email_consent_state = 'subscribed')
      ),
      due AS (
        SELECT id, profile_checked_at, last_seen_at
          FROM activity
         WHERE (CASE WHEN ${depth} = 'voll' THEN has_dialogue ELSE (NOT has_dialogue AND orders_count > 0) END)
           AND (profile_checked_at IS NULL
                OR (last_activity_at IS NOT NULL AND last_activity_at > profile_checked_at))
      )
      SELECT id, (SELECT count(*)::int FROM due) AS remaining
        FROM due
       ORDER BY (profile_checked_at IS NULL) DESC, last_seen_at DESC NULLS LAST, id DESC
       LIMIT ${limit}
    `) as Array<Record<string, unknown>>;
    return {
      ids: rows.map((r) => Number(r.id)),
      remaining: rows.length > 0 ? Number(rows[0].remaining ?? 0) : 0,
    };
  } catch (err) {
    reportError(err, { route: "lib/customer-store", phase: "listCustomersForProfileUpkeep" });
    return { ids: [], remaining: 0 };
  }
}

/**
 * Record or lift an Art. 21 DSGVO objection (0061). `profile`: no AI profile
 * is built or used any more — the stored profile is deleted with it;
 * `postal`: no advertising letters (the letter draft is cleared). Returns
 * false when the customer is unknown / no DB.
 */
export async function setCustomerObjection(
  customerId: number,
  kind: "profile" | "postal",
  objected: boolean,
  sql: Sql | null = getSql()
): Promise<boolean> {
  if (!sql) return false;
  try {
    const rows =
      kind === "profile"
        ? await sql`
            UPDATE customers
               SET profile_objection_at = CASE WHEN ${objected} THEN COALESCE(profile_objection_at, now()) ELSE NULL END,
                   profile_summary = CASE WHEN ${objected} THEN NULL ELSE profile_summary END,
                   profile_summary_updated_at = CASE WHEN ${objected} THEN NULL ELSE profile_summary_updated_at END,
                   profile_data = CASE WHEN ${objected} THEN NULL ELSE profile_data END,
                   persona_label = CASE WHEN ${objected} THEN NULL ELSE persona_label END,
                   profile_depth = CASE WHEN ${objected} THEN NULL ELSE profile_depth END
             WHERE id = ${customerId}
            RETURNING id
          `
        : await sql`
            UPDATE customers
               SET postal_objection_at = CASE WHEN ${objected} THEN COALESCE(postal_objection_at, now()) ELSE NULL END,
                   letter_draft_subject = CASE WHEN ${objected} THEN NULL ELSE letter_draft_subject END,
                   letter_draft_body = CASE WHEN ${objected} THEN NULL ELSE letter_draft_body END
             WHERE id = ${customerId}
            RETURNING id
          `;
    return rows.length > 0;
  } catch (err) {
    reportError(err, { route: "lib/customer-store", phase: "setCustomerObjection" });
    return false;
  }
}

/**
 * Pin (or clear, `null`) a person's e-mail language (customers.language_override,
 * 0061); open recipient rows of every campaign follow at once. false when the
 * customer is unknown; null on a database problem. Never throws.
 */
export async function setCustomerLanguageOverride(
  customerId: number,
  language: "de" | "en" | null,
  sql: Sql | null = getSql()
): Promise<boolean | null> {
  if (!sql) return null;
  try {
    const rows = await sql`UPDATE customers SET language_override = ${language} WHERE id = ${customerId} RETURNING id`;
    if (rows.length === 0) return false;
    await sql`
      UPDATE campaign_contacts SET language_override = ${language}
       WHERE customer_id = ${customerId} AND status IN ('pending', 'drafted', 'draft_failed')
    `;
    return true;
  } catch (err) {
    reportError(err, { route: "lib/customer-store", phase: "setCustomerLanguageOverride" });
    return null;
  }
}
