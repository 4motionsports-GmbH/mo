// Campaign audiences over the whole customer base (I/O).
//
// ONE spelled-out query over customer_overview (0068): every spec field is a
// nullable parameter (lib/audience-spec.mjs builds the tuple), so the query is
// never composed (CLAUDE.md hard rule). The e-mail channel ALWAYS requires the
// one consent (`subscribed`) and no hard block on top of the spec — a spec can
// narrow an audience, never widen it past consent. The effective e-mail
// language is derived in SQL with the rules of campaign-language.mjs plus the
// person's pin and, for a chat-only lead, the language of their last chat.

import { getSql, type Sql } from "./db";
import { reportError } from "./observability";
import { audienceQueryParams, normalizeAudienceSpec } from "./audience-spec.mjs";

export type AudienceSpec = ReturnType<typeof normalizeAudienceSpec>;

export interface AudienceMember {
  customerId: number;
  email: string;
  firstName: string | null;
  lastName: string | null;
  shopifyCustomerId: string | null;
  language: "de" | "en";
  consentLevel: string | null;
  consentAt: string | null;
  ordersCount: number;
  totalSpentCents: number;
  lastOrderAt: string | null;
  lifecycleSegment: string | null;
  hasMoContact: boolean;
  /** customer_facts exist for this person (else the order figures are 0 only
   * because the nightly computation has not run yet). */
  factsComputed: boolean;
}

export interface AudienceMatch {
  /** false = the query failed; callers must not act on an empty match. */
  ok: boolean;
  total: number;
  /** Of the total: how many talked to Mo, how many get English mail. */
  totalWithMo: number;
  totalEnglish: number;
  /** Only meaningful with `withoutConsent`: matches without the e-mail consent, and of those reachable by letter. */
  totalNoConsent: number;
  totalLetter: number;
  members: AudienceMember[];
}

/** Upper bound of one materialisation (far above today's base). */
export const AUDIENCE_MAX_MEMBERS = 100_000;

const iso = (v: unknown) => (v ? new Date(String(v)).toISOString() : null);

/**
 * The customers an audience spec matches — `limit` members (newest activity
 * first) plus the full count. A preview passes a small limit; the
 * materialisation passes AUDIENCE_MAX_MEMBERS. Never throws: on error the
 * match is EMPTY (fail-closed — a DB problem never widens a campaign).
 */
export async function matchAudience(
  rawSpec: unknown,
  opts: { limit?: number; now?: Date; withoutConsent?: boolean } = {},
  sql: Sql | null = getSql()
): Promise<AudienceMatch> {
  if (!sql) return { ok: false, total: 0, totalWithMo: 0, totalEnglish: 0, totalNoConsent: 0, totalLetter: 0, members: [] };
  const spec = normalizeAudienceSpec(rawSpec);
  const p = audienceQueryParams(spec, opts.now ?? new Date());
  const limit = Math.max(1, Math.min(opts.limit ?? 20, AUDIENCE_MAX_MEMBERS));
  // Only the preview's letter-reach count matches WITHOUT the consent; every
  // materialisation (the e-mail channel) requires it.
  const requireConsent = opts.withoutConsent !== true;
  try {
    const rows = (await sql`
      WITH base AS (
        SELECT o.*,
               cu.first_name, cu.last_name,
               CASE
                 WHEN o.language_override IN ('de', 'en') THEN o.language_override
                 WHEN NULLIF(btrim(o.locale), '') IS NOT NULL THEN
                   CASE WHEN lower(split_part(replace(btrim(o.locale), '_', '-'), '-', 1)) = 'de' THEN 'de' ELSE 'en' END
                 WHEN NULLIF(btrim(o.country_code), '') IS NOT NULL THEN
                   CASE WHEN upper(btrim(o.country_code)) IN ('DE', 'AT', 'CH') THEN 'de' ELSE 'en' END
                 WHEN lc.locale IS NOT NULL THEN
                   CASE WHEN lower(lc.locale) LIKE 'en%' THEN 'en' ELSE 'de' END
                 ELSE 'de'
               END AS lang
          FROM customer_overview o
          JOIN customers cu ON cu.id = o.customer_id
          LEFT JOIN LATERAL (
            SELECT cv.locale FROM conversations cv
             WHERE cv.customer_id = o.customer_id AND cv.locale IS NOT NULL
             ORDER BY cv.last_activity_at DESC
             LIMIT 1
          ) lc ON true
         WHERE (${requireConsent}::boolean IS FALSE
                OR (o.email_consent_state = 'subscribed' AND NOT o.blocked))
      )
      SELECT b.customer_id, b.email, b.first_name, b.last_name, b.shopify_customer_id, b.lang,
             b.email_consent_level, b.email_consent_at, b.orders_count, b.total_spent_cents,
             b.last_order_at, b.lifecycle_segment, b.conversations_count, b.facts_computed_at,
             count(*) OVER () AS total,
             count(*) FILTER (WHERE b.conversations_count > 0) OVER () AS total_mo,
             count(*) FILTER (WHERE b.lang = 'en') OVER () AS total_en,
             -- Letter reach (D-7): no e-mail consent (or blocked), a postal address, no objection.
             count(*) FILTER (WHERE NOT (b.email_consent_state = 'subscribed' AND NOT b.blocked)) OVER () AS total_no_consent,
             count(*) FILTER (WHERE NOT (b.email_consent_state = 'subscribed' AND NOT b.blocked)
                                AND b.has_postal_address AND b.postal_objection_at IS NULL) OVER () AS total_letter
        FROM base b
       WHERE (${p.optInLevels}::text[] IS NULL
              OR COALESCE(b.email_consent_level, 'unknown') = ANY(${p.optInLevels}::text[]))
         AND (${p.lifecycle}::text[] IS NULL
              OR b.lifecycle_segment = ANY(${p.lifecycle}::text[])
              OR (${p.lifecycleUnknown}::boolean IS TRUE AND b.last_order_at IS NULL))
         AND (${p.valueTier}::text[] IS NULL OR b.value_tier = ANY(${p.valueTier}::text[]))
         AND (${p.churn}::text[] IS NULL OR b.churn_risk = ANY(${p.churn}::text[]))
         AND (${p.lastOrderAfter}::timestamptz IS NULL OR b.last_order_at >= ${p.lastOrderAfter}::timestamptz)
         AND (${p.lastOrderBefore}::timestamptz IS NULL OR b.last_order_at <= ${p.lastOrderBefore}::timestamptz)
         AND (${p.ordersMin}::int IS NULL OR b.orders_count >= ${p.ordersMin}::int)
         AND (${p.ordersMax}::int IS NULL OR b.orders_count <= ${p.ordersMax}::int)
         AND (${p.spentMinCents}::bigint IS NULL OR b.total_spent_cents >= ${p.spentMinCents}::bigint)
         AND (${p.spentMaxCents}::bigint IS NULL OR b.total_spent_cents <= ${p.spentMaxCents}::bigint)
         AND (${p.boughtAny}::text[] IS NULL OR b.bought_handles && ${p.boughtAny}::text[])
         AND (${p.boughtNone}::text[] IS NULL OR NOT (b.bought_handles && ${p.boughtNone}::text[]))
         AND (${p.categories}::text[] IS NULL OR b.bought_categories && ${p.categories}::text[])
         AND (${p.persona}::text[] IS NULL
              OR b.persona_label = ANY(${p.persona}::text[])
              OR (${p.personaUnknown}::boolean IS TRUE AND b.persona_label IS NULL))
         AND (${p.moContact}::text IS NULL OR (${p.moContact}::text = 'yes') = (b.conversations_count > 0))
         AND (${p.language}::text[] IS NULL OR b.lang = ANY(${p.language}::text[]))
         AND (${p.country}::text[] IS NULL OR upper(b.country_code) = ANY(${p.country}::text[]))
         AND (${p.shopifyTags}::text[] IS NULL OR b.shopify_tags && ${p.shopifyTags}::text[])
         AND (${p.clickedAfter}::timestamptz IS NULL OR b.last_click_at >= ${p.clickedAfter}::timestamptz)
         AND (${p.notMailedAfter}::timestamptz IS NULL
              OR b.last_marketing_at IS NULL
              OR b.last_marketing_at < ${p.notMailedAfter}::timestamptz)
         AND (${p.excludeCampaignIds}::bigint[] IS NULL OR NOT EXISTS (
               SELECT 1 FROM campaign_contacts x
                WHERE x.customer_id = b.customer_id
                  AND x.campaign_id = ANY(${p.excludeCampaignIds}::bigint[])
                  AND x.is_test = false
                  AND x.status <> 'excluded'))
       ORDER BY b.last_activity_at DESC NULLS LAST, b.customer_id DESC
       LIMIT ${limit}
    `) as Array<Record<string, unknown>>;
    return {
      ok: true,
      total: rows.length > 0 ? Number(rows[0].total) : 0,
      totalWithMo: rows.length > 0 ? Number(rows[0].total_mo) : 0,
      totalEnglish: rows.length > 0 ? Number(rows[0].total_en) : 0,
      totalNoConsent: rows.length > 0 ? Number(rows[0].total_no_consent) : 0,
      totalLetter: rows.length > 0 ? Number(rows[0].total_letter) : 0,
      members: rows.map((r) => ({
        customerId: Number(r.customer_id),
        email: String(r.email),
        firstName: (r.first_name as string | null) ?? null,
        lastName: (r.last_name as string | null) ?? null,
        shopifyCustomerId: (r.shopify_customer_id as string | null) ?? null,
        language: r.lang === "en" ? "en" : "de",
        consentLevel: (r.email_consent_level as string | null) ?? null,
        consentAt: iso(r.email_consent_at),
        ordersCount: Number(r.orders_count ?? 0),
        totalSpentCents: Number(r.total_spent_cents ?? 0),
        lastOrderAt: iso(r.last_order_at),
        lifecycleSegment: (r.lifecycle_segment as string | null) ?? null,
        hasMoContact: Number(r.conversations_count ?? 0) > 0,
        factsComputed: r.facts_computed_at != null,
      })),
    };
  } catch (err) {
    reportError(err, { route: "lib/audience-store", phase: "matchAudience" });
    return { ok: false, total: 0, totalWithMo: 0, totalEnglish: 0, totalNoConsent: 0, totalLetter: 0, members: [] };
  }
}

export interface AudiencePreview {
  total: number;
  /** How many of the matches have talked to Mo. */
  withMo: number;
  byLanguage: { de: number; en: number };
  /** The same spec WITHOUT the consent: how many more match, and how many of them a letter could reach. */
  withoutConsent: { total: number; letterReach: number };
  sample: Array<{ customerId: number; email: string; name: string | null }>;
}

/** Count + a small sample for the wizard ("1.240 Kunden passen") — the counts are window aggregates, only 8 rows travel. */
export async function previewAudience(rawSpec: unknown, sql: Sql | null = getSql()): Promise<AudiencePreview> {
  const [match, all] = await Promise.all([
    matchAudience(rawSpec, { limit: 8 }, sql),
    matchAudience(rawSpec, { limit: 1, withoutConsent: true }, sql),
  ]);
  return {
    total: match.total,
    withMo: match.totalWithMo,
    byLanguage: { de: match.total - match.totalEnglish, en: match.totalEnglish },
    withoutConsent: { total: all.totalNoConsent, letterReach: all.totalLetter },
    sample: match.members.slice(0, 8).map((m) => ({
      customerId: m.customerId,
      email: m.email,
      name: [m.firstName, m.lastName].filter(Boolean).join(" ") || null,
    })),
  };
}
