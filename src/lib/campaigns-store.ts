// Campaigns — definitions, status and recipients (I/O). docs/CAMPAIGNS.md §2.
//
// A campaign (table `campaigns`, 0066) owns its recipients: one
// campaign_contacts row per person and cycle. This store creates and edits
// campaigns, moves them through their lifecycle (lib/campaign-def.mjs), and
// MATERIALISES their audience: the spec is matched over the whole customer
// base (lib/audience-store.ts — consent + no block always implied) and turned
// into recipient rows with a snapshot of name, language, opt-in level and
// order figures, which the draft and the desk read. The per-recipient queue
// (drafts, sends) stays in lib/campaign-store.ts.
//
// Rules of a refresh:
//   * matched, no row yet          → new recipient (pending) — dynamisch
//                                     campaigns always, fest ones only on the
//                                     first materialisation;
//   * matched, last row sent long ago (laufend, reentry_days) → a new cycle;
//   * matched, open row            → snapshot refreshed; `excluded` /
//                                     `suppressed` rows come back as pending;
//   * open row whose person lost consent or got blocked → `suppressed`
//     (any campaign — the send gate would refuse anyway);
//   * dynamisch: a pending row that no longer matches → `excluded`
//     (drafted rows stay — the operator decides; the gate still applies).

import { getSql, type Sql } from "./db";
import { reportError } from "./observability";
import { matchAudience, AUDIENCE_MAX_MEMBERS, type AudienceSpec } from "./audience-store";
import { normalizeAudienceSpec } from "./audience-spec.mjs";
import { canTransition, slugifyCampaignName, campaignPhase } from "./campaign-def.mjs";
import { effectiveEmailLanguage } from "./campaign-language.mjs";
import { parseDiscountScope, type DiscountScope } from "./discount-scope.mjs";

export type CampaignKind = "laufend" | "aktion" | "einzel";
export type CampaignStatus = "entwurf" | "aktiv" | "pausiert" | "beendet" | "archiviert";
export type HeroMode = "none" | "default" | "ai_ab" | "ai_all";

export interface Campaign {
  id: number;
  name: string;
  slug: string;
  kind: CampaignKind;
  status: CampaignStatus;
  brief: string | null;
  audience: AudienceSpec;
  audienceMode: "dynamisch" | "fest";
  priority: number;
  startsAt: string | null;
  endsAt: string | null;
  dailyTarget: number | null;
  autoPreparePerDay: number;
  reentryDays: number | null;
  discountPercent: number;
  discountScope: DiscountScope;
  discountValidUntil: string | null;
  designKey: string | null;
  heroMode: HeroMode;
  textMode: "detailed" | "compact" | "minimal" | null;
  moPromo: boolean;
  ctaKind: "mo_chat" | "shop";
  ctaUrl: string | null;
  audienceRefreshedAt: string | null;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface CampaignStats {
  recipients: number;
  pending: number;
  drafted: number;
  sent: number;
  sentToday: number;
  skipped: number;
  suppressed: number;
  excluded: number;
  draftFailed: number;
  clicks: number;
  unsubscribes: number;
  lastSentAt: string | null;
}

export interface CampaignWithStats extends Campaign {
  stats: CampaignStats;
}

const iso = (v: unknown) => (v ? new Date(String(v)).toISOString() : null);

export function mapCampaign(r: Record<string, unknown>): Campaign {
  const textMode = r.text_mode;
  return {
    id: Number(r.id),
    name: String(r.name),
    slug: String(r.slug),
    kind: r.kind as CampaignKind,
    status: r.status as CampaignStatus,
    brief: (r.brief as string | null) ?? null,
    audience: normalizeAudienceSpec(r.audience),
    audienceMode: r.audience_mode === "dynamisch" ? "dynamisch" : "fest",
    priority: Number(r.priority ?? 0),
    startsAt: iso(r.starts_at),
    endsAt: iso(r.ends_at),
    dailyTarget: r.daily_target == null ? null : Number(r.daily_target),
    autoPreparePerDay: Number(r.auto_prepare_per_day ?? 0),
    reentryDays: r.reentry_days == null ? null : Number(r.reentry_days),
    discountPercent: Number(r.discount_percent ?? 0),
    discountScope: parseDiscountScope(r.discount_scope),
    discountValidUntil: iso(r.discount_valid_until),
    designKey: (r.design_key as string | null) ?? null,
    heroMode: (["none", "default", "ai_ab", "ai_all"].includes(String(r.hero_mode)) ? r.hero_mode : "none") as HeroMode,
    textMode: textMode === "detailed" || textMode === "compact" || textMode === "minimal" ? textMode : null,
    moPromo: r.mo_promo !== false,
    ctaKind: r.cta_kind === "shop" ? "shop" : "mo_chat",
    ctaUrl: (r.cta_url as string | null) ?? null,
    audienceRefreshedAt: iso(r.audience_refreshed_at),
    startedAt: iso(r.started_at),
    endedAt: iso(r.ended_at),
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

function mapStats(r: Record<string, unknown>): CampaignStats {
  const n = (k: string) => Number(r[k] ?? 0);
  return {
    recipients: n("recipients"),
    pending: n("pending"),
    drafted: n("drafted"),
    sent: n("sent"),
    sentToday: n("sent_today"),
    skipped: n("skipped"),
    suppressed: n("suppressed"),
    excluded: n("excluded"),
    draftFailed: n("draft_failed"),
    clicks: n("clicks"),
    unsubscribes: n("unsubscribes"),
    lastSentAt: iso(r.last_sent_at),
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Every campaign with its recipient and send figures. Never throws. */
export async function listCampaigns(
  opts: { includeArchived?: boolean } = {},
  sql: Sql | null = getSql()
): Promise<CampaignWithStats[]> {
  if (!sql) return [];
  try {
    const rows = (await sql`
      SELECT c.*,
             COALESCE(r.recipients, 0) AS recipients, COALESCE(r.pending, 0) AS pending,
             COALESCE(r.drafted, 0) AS drafted, COALESCE(r.skipped, 0) AS skipped,
             COALESCE(r.suppressed, 0) AS suppressed, COALESCE(r.excluded, 0) AS excluded,
             COALESCE(r.draft_failed, 0) AS draft_failed,
             COALESCE(s.sent, 0) AS sent, COALESCE(s.sent_today, 0) AS sent_today,
             COALESCE(s.clicks, 0) AS clicks, COALESCE(s.unsubscribes, 0) AS unsubscribes,
             s.last_sent_at
        FROM campaigns c
        LEFT JOIN (
          SELECT campaign_id,
                 count(*) FILTER (WHERE status NOT IN ('excluded'))::int AS recipients,
                 count(*) FILTER (WHERE status = 'pending')::int AS pending,
                 count(*) FILTER (WHERE status = 'drafted')::int AS drafted,
                 count(*) FILTER (WHERE status = 'skipped')::int AS skipped,
                 count(*) FILTER (WHERE status = 'suppressed')::int AS suppressed,
                 count(*) FILTER (WHERE status = 'excluded')::int AS excluded,
                 count(*) FILTER (WHERE status = 'draft_failed')::int AS draft_failed
            FROM campaign_contacts
           WHERE is_test = false
           GROUP BY campaign_id
        ) r ON r.campaign_id = c.id
        LEFT JOIN (
          SELECT campaign_id,
                 count(*)::int AS sent,
                 count(*) FILTER (
                   WHERE (sent_at AT TIME ZONE 'Europe/Berlin')::date = (now() AT TIME ZONE 'Europe/Berlin')::date
                 )::int AS sent_today,
                 -- Any click: the button (clicked_at) or the set link (bundle_clicked_at).
                 count(*) FILTER (WHERE clicked_at IS NOT NULL OR bundle_clicked_at IS NOT NULL)::int AS clicks,
                 count(*) FILTER (WHERE unsubscribed_at IS NOT NULL)::int AS unsubscribes,
                 max(sent_at) AS last_sent_at
            FROM campaign_sends
           WHERE is_test = false
           GROUP BY campaign_id
        ) s ON s.campaign_id = c.id
       WHERE (${opts.includeArchived === true} OR c.status <> 'archiviert')
       ORDER BY CASE c.status WHEN 'aktiv' THEN 0 WHEN 'pausiert' THEN 1 WHEN 'entwurf' THEN 2 WHEN 'beendet' THEN 3 ELSE 4 END,
                c.priority DESC, c.id
    `) as Array<Record<string, unknown>>;
    return rows.map((r) => ({ ...mapCampaign(r), stats: mapStats(r) }));
  } catch (err) {
    reportError(err, { route: "lib/campaigns-store", phase: "listCampaigns" });
    return [];
  }
}

export async function getCampaign(id: number, sql: Sql | null = getSql()): Promise<Campaign | null> {
  if (!sql || !Number.isInteger(id) || id <= 0) return null;
  try {
    const rows = (await sql`SELECT * FROM campaigns WHERE id = ${id}`) as Array<Record<string, unknown>>;
    return rows[0] ? mapCampaign(rows[0]) : null;
  } catch (err) {
    reportError(err, { route: "lib/campaigns-store", phase: "getCampaign" });
    return null;
  }
}

/** A campaign by id or slug (the `?campaign=` deep link accepts both). */
export async function resolveCampaign(ref: string | number | null | undefined, sql: Sql | null = getSql()): Promise<Campaign | null> {
  if (!sql || ref == null || ref === "") return null;
  const asId = typeof ref === "number" ? ref : /^\d+$/.test(ref) ? Number(ref) : null;
  if (asId) return getCampaign(asId, sql);
  try {
    const rows = (await sql`SELECT * FROM campaigns WHERE slug = ${String(ref)}`) as Array<Record<string, unknown>>;
    return rows[0] ? mapCampaign(rows[0]) : null;
  } catch (err) {
    reportError(err, { route: "lib/campaigns-store", phase: "resolveCampaign" });
    return null;
  }
}

/** The built-in Einzelansprache (1:1 mails from Kunden / Eingang). */
export async function getEinzelCampaign(sql: Sql | null = getSql()): Promise<Campaign | null> {
  if (!sql) return null;
  try {
    const rows = (await sql`SELECT * FROM campaigns WHERE kind = 'einzel' LIMIT 1`) as Array<Record<string, unknown>>;
    return rows[0] ? mapCampaign(rows[0]) : null;
  } catch (err) {
    reportError(err, { route: "lib/campaigns-store", phase: "getEinzelCampaign" });
    return null;
  }
}

/** The campaign a recipient row belongs to (send / draft paths). */
export async function getCampaignForContact(contactId: number, sql: Sql | null = getSql()): Promise<Campaign | null> {
  if (!sql) return null;
  try {
    const rows = (await sql`
      SELECT c.* FROM campaigns c JOIN campaign_contacts cc ON cc.campaign_id = c.id WHERE cc.id = ${contactId}
    `) as Array<Record<string, unknown>>;
    return rows[0] ? mapCampaign(rows[0]) : null;
  } catch (err) {
    reportError(err, { route: "lib/campaigns-store", phase: "getCampaignForContact" });
    return null;
  }
}

export interface CampaignParticipation {
  contactId: number;
  campaignId: number;
  campaignName: string;
  campaignKind: CampaignKind;
  campaignStatus: CampaignStatus;
  cycle: number;
  status: string;
  excludedReason: string | null;
  adminNote: string | null;
  addedAt: string | null;
  sentAt: string | null;
  subject: string | null;
  clickedAt: string | null;
  unsubscribedAt: string | null;
  hasDraft: boolean;
}

/** Every campaign a customer is (or was) a recipient of, newest first. */
export async function listCampaignParticipation(
  customerId: number,
  sql: Sql | null = getSql()
): Promise<CampaignParticipation[]> {
  if (!sql) return [];
  try {
    const rows = (await sql`
      SELECT cc.id AS contact_id, cc.campaign_id, c.name, c.kind, c.status AS campaign_status,
             cc.cycle, cc.status, cc.excluded_reason, cc.admin_note, cc.added_at, cc.sent_at,
             s.subject, s.clicked_at, s.unsubscribed_at,
             EXISTS (SELECT 1 FROM campaign_drafts d WHERE d.contact_id = cc.id) AS has_draft
        FROM campaign_contacts cc
        JOIN campaigns c ON c.id = cc.campaign_id
        LEFT JOIN LATERAL (
          SELECT subject, COALESCE(clicked_at, bundle_clicked_at) AS clicked_at, unsubscribed_at FROM campaign_sends
           WHERE contact_id = cc.id AND is_test = false
           ORDER BY sent_at DESC LIMIT 1
        ) s ON true
       WHERE cc.customer_id = ${customerId} AND cc.is_test = false
       ORDER BY COALESCE(cc.sent_at, cc.added_at) DESC, cc.id DESC
       LIMIT 50
    `) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      contactId: Number(r.contact_id),
      campaignId: Number(r.campaign_id),
      campaignName: String(r.name),
      campaignKind: r.kind as CampaignKind,
      campaignStatus: r.campaign_status as CampaignStatus,
      cycle: Number(r.cycle ?? 1),
      status: String(r.status),
      excludedReason: (r.excluded_reason as string | null) ?? null,
      adminNote: (r.admin_note as string | null) ?? null,
      addedAt: iso(r.added_at),
      sentAt: iso(r.sent_at),
      subject: (r.subject as string | null) ?? null,
      clickedAt: iso(r.clicked_at),
      unsubscribedAt: iso(r.unsubscribed_at),
      hasDraft: r.has_draft === true,
    }));
  } catch (err) {
    reportError(err, { route: "lib/campaigns-store", phase: "listCampaignParticipation" });
    return [];
  }
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export interface CampaignInput {
  name?: string;
  kind?: "laufend" | "aktion";
  brief?: string | null;
  audience?: AudienceSpec;
  audienceMode?: "dynamisch" | "fest";
  priority?: number;
  startsAt?: string | null;
  endsAt?: string | null;
  dailyTarget?: number | null;
  autoPreparePerDay?: number;
  reentryDays?: number | null;
  discountPercent?: number;
  discountScope?: DiscountScope;
  discountValidUntil?: string | null;
  designKey?: string | null;
  heroMode?: HeroMode;
  textMode?: "detailed" | "compact" | "minimal" | null;
  moPromo?: boolean;
  ctaKind?: "mo_chat" | "shop";
  ctaUrl?: string | null;
}

/** Create a campaign (status entwurf). Returns the new id, or null. */
export async function createCampaign(
  input: CampaignInput & { name: string; kind: "laufend" | "aktion" },
  sql: Sql | null = getSql()
): Promise<number | null> {
  if (!sql) return null;
  const base = slugifyCampaignName(input.name);
  try {
    const taken = (await sql`
      SELECT slug FROM campaigns WHERE slug = ${base} OR slug LIKE ${`${base}-%`}
    `) as Array<{ slug: string }>;
    const used = new Set(taken.map((t) => t.slug));
    let slug = base;
    for (let i = 2; used.has(slug); i++) slug = `${base}-${i}`;
    const rows = (await sql`
      INSERT INTO campaigns
        (name, slug, kind, status, brief, audience, audience_mode, priority, starts_at, ends_at,
         daily_target, auto_prepare_per_day, reentry_days, discount_percent, discount_scope,
         discount_valid_until, design_key, hero_mode, text_mode, mo_promo, cta_kind, cta_url)
      VALUES
        (${input.name}, ${slug}, ${input.kind}, 'entwurf', ${input.brief ?? null},
         ${JSON.stringify(input.audience ?? { v: 1 })}::jsonb, ${input.audienceMode ?? "fest"},
         ${input.priority ?? 50}, ${input.startsAt ?? null}, ${input.endsAt ?? null},
         ${input.dailyTarget ?? null}, ${input.autoPreparePerDay ?? 0}, ${input.reentryDays ?? null},
         ${input.discountPercent ?? 0}, ${input.discountScope ?? "all"}, ${input.discountValidUntil ?? null},
         ${input.designKey ?? null}, ${input.heroMode ?? "default"}, ${input.textMode ?? null},
         ${input.moPromo ?? true}, ${input.ctaKind ?? "mo_chat"}, ${input.ctaUrl ?? null})
      RETURNING id
    `) as Array<{ id: number }>;
    return rows[0] ? Number(rows[0].id) : null;
  } catch (err) {
    reportError(err, { route: "lib/campaigns-store", phase: "createCampaign" });
    return null;
  }
}

/**
 * Patch a campaign. Absent fields stay; the Einzelansprache keeps its kind,
 * audience and schedule (only offer, design and texts are editable).
 */
export async function updateCampaign(id: number, patch: CampaignInput, sql: Sql | null = getSql()): Promise<boolean> {
  if (!sql) return false;
  const has = (k: keyof CampaignInput) => Object.prototype.hasOwnProperty.call(patch, k);
  try {
    const rows = (await sql`
      UPDATE campaigns SET
        name                 = CASE WHEN ${has("name")} THEN ${patch.name ?? null} ELSE name END,
        brief                = CASE WHEN ${has("brief")} THEN ${patch.brief ?? null} ELSE brief END,
        audience             = CASE WHEN ${has("audience")} AND kind <> 'einzel'
                                    THEN ${JSON.stringify(patch.audience ?? { v: 1 })}::jsonb ELSE audience END,
        audience_mode        = CASE WHEN ${has("audienceMode")} AND kind <> 'einzel'
                                    THEN ${patch.audienceMode ?? "fest"} ELSE audience_mode END,
        priority             = CASE WHEN ${has("priority")} THEN ${patch.priority ?? 0}::int ELSE priority END,
        starts_at            = CASE WHEN ${has("startsAt")} AND kind <> 'einzel'
                                    THEN ${patch.startsAt ?? null}::timestamptz ELSE starts_at END,
        ends_at              = CASE WHEN ${has("endsAt")} AND kind <> 'einzel'
                                    THEN ${patch.endsAt ?? null}::timestamptz ELSE ends_at END,
        daily_target         = CASE WHEN ${has("dailyTarget")} THEN ${patch.dailyTarget ?? null}::int ELSE daily_target END,
        auto_prepare_per_day = CASE WHEN ${has("autoPreparePerDay")} THEN ${patch.autoPreparePerDay ?? 0}::int ELSE auto_prepare_per_day END,
        reentry_days         = CASE WHEN ${has("reentryDays")} THEN ${patch.reentryDays ?? null}::int ELSE reentry_days END,
        discount_percent     = CASE WHEN ${has("discountPercent")} THEN ${patch.discountPercent ?? 0}::int ELSE discount_percent END,
        discount_scope       = CASE WHEN ${has("discountScope")} THEN ${patch.discountScope ?? "all"} ELSE discount_scope END,
        discount_valid_until = CASE WHEN ${has("discountValidUntil")}
                                    THEN ${patch.discountValidUntil ?? null}::timestamptz ELSE discount_valid_until END,
        design_key           = CASE WHEN ${has("designKey")} THEN ${patch.designKey ?? null} ELSE design_key END,
        hero_mode            = CASE WHEN ${has("heroMode")} THEN ${patch.heroMode ?? "none"} ELSE hero_mode END,
        text_mode            = CASE WHEN ${has("textMode")} THEN ${patch.textMode ?? null} ELSE text_mode END,
        mo_promo             = CASE WHEN ${has("moPromo")} THEN ${patch.moPromo ?? true} ELSE mo_promo END,
        cta_kind             = CASE WHEN ${has("ctaKind")} THEN ${patch.ctaKind ?? "mo_chat"} ELSE cta_kind END,
        cta_url              = CASE WHEN ${has("ctaUrl")} THEN ${patch.ctaUrl ?? null} ELSE cta_url END,
        updated_at           = now()
       WHERE id = ${id}
      RETURNING id
    `) as Array<unknown>;
    return rows.length > 0;
  } catch (err) {
    reportError(err, { route: "lib/campaigns-store", phase: "updateCampaign" });
    return false;
  }
}

export type StatusChangeResult =
  | { ok: true; campaign: Campaign; refresh: AudienceRefreshResult | null }
  | { ok: false; reason: "not_found" | "invalid_transition" | "db" };

/**
 * Move a campaign through its lifecycle. Starting it materialises the
 * audience at once (so the desk has recipients); ending it leaves every row
 * as it is (audit trail) — an ended campaign simply cannot prepare or send.
 */
export async function setCampaignStatus(
  id: number,
  to: CampaignStatus,
  sql: Sql | null = getSql()
): Promise<StatusChangeResult> {
  if (!sql) return { ok: false, reason: "db" };
  const current = await getCampaign(id, sql);
  if (!current) return { ok: false, reason: "not_found" };
  if (!canTransition(current.status, to, current.kind)) return { ok: false, reason: "invalid_transition" };
  try {
    await sql`
      UPDATE campaigns
         SET status = ${to},
             started_at = CASE WHEN ${to} = 'aktiv' THEN COALESCE(started_at, now()) ELSE started_at END,
             ended_at = CASE WHEN ${to} = 'beendet' THEN now() WHEN ${to} = 'aktiv' THEN NULL ELSE ended_at END,
             updated_at = now()
       WHERE id = ${id}
    `;
  } catch (err) {
    reportError(err, { route: "lib/campaigns-store", phase: "setCampaignStatus" });
    return { ok: false, reason: "db" };
  }
  const refresh = to === "aktiv" ? await refreshCampaignAudience(id, sql) : null;
  const campaign = (await getCampaign(id, sql)) ?? { ...current, status: to };
  return { ok: true, campaign, refresh };
}

/** End every active campaign whose end date has passed (nightly). */
export async function endExpiredCampaigns(sql: Sql | null = getSql()): Promise<number> {
  if (!sql) return 0;
  try {
    const rows = (await sql`
      UPDATE campaigns SET status = 'beendet', ended_at = now(), updated_at = now()
       WHERE status = 'aktiv' AND kind <> 'einzel' AND ends_at IS NOT NULL AND ends_at <= now()
      RETURNING id
    `) as Array<unknown>;
    return rows.length;
  } catch (err) {
    reportError(err, { route: "lib/campaigns-store", phase: "endExpiredCampaigns" });
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Audience materialisation
// ---------------------------------------------------------------------------

export interface AudienceRefreshResult {
  ok: boolean;
  matched: number;
  added: number;
  refreshed: number;
  suppressed: number;
  excluded: number;
  /** Set when the refresh was skipped on purpose (German, for the UI). */
  note?: string;
}

const REFRESH_CHUNK = 1000;

/**
 * Materialise / refresh a campaign's recipients from its audience spec.
 * Fail-closed: when the audience query fails nothing is excluded. Never throws.
 */
export async function refreshCampaignAudience(
  campaignId: number,
  sql: Sql | null = getSql()
): Promise<AudienceRefreshResult> {
  const empty: AudienceRefreshResult = { ok: false, matched: 0, added: 0, refreshed: 0, suppressed: 0, excluded: 0 };
  if (!sql) return empty;
  const campaign = await getCampaign(campaignId, sql);
  if (!campaign || campaign.kind === "einzel") return { ...empty, ok: true, note: "Einzelansprache hat keine Zielgruppe." };
  if (campaign.status === "archiviert") return { ...empty, ok: true, note: "Archivierte Kampagne." };

  try {
    // Before the first facts run every customer looks like "no purchase" —
    // materialising then would mis-sort the lifecycle campaign. Wait for it.
    const facts = (await sql`SELECT EXISTS (SELECT 1 FROM customer_facts) AS ok`) as Array<{ ok: boolean }>;
    if (!facts[0]?.ok) {
      return { ...empty, ok: true, note: "Kundendaten werden noch berechnet — die Zielgruppe folgt nach dem nächsten Lauf." };
    }
  } catch (err) {
    reportError(err, { route: "lib/campaigns-store", phase: "refreshCampaignAudience.facts" });
    return empty;
  }

  const match = await matchAudience(campaign.audience, { limit: AUDIENCE_MAX_MEMBERS }, sql);
  if (!match.ok) return empty;

  const allowNew = campaign.audienceMode === "dynamisch" || campaign.audienceRefreshedAt == null;
  const reentryDays = campaign.kind === "laufend" ? campaign.reentryDays : null;
  const result: AudienceRefreshResult = { ok: true, matched: match.total, added: 0, refreshed: 0, suppressed: 0, excluded: 0 };

  try {
    for (let i = 0; i < match.members.length; i += REFRESH_CHUNK) {
      const chunk = match.members.slice(i, i + REFRESH_CHUNK).map((m) => ({
        customer_id: m.customerId,
        email: m.email,
        first_name: m.firstName,
        last_name: m.lastName,
        shopify_customer_id: m.shopifyCustomerId,
        language: m.language,
        opt_in_level: (m.consentLevel ?? "unknown").toUpperCase(),
        consent_at: m.consentAt,
        orders_count: m.ordersCount,
        total_spent_cents: m.totalSpentCents,
        last_order_at: m.lastOrderAt,
        facts: m.factsComputed,
      }));
      const rows = (await sql`
        WITH m AS (
          SELECT * FROM jsonb_to_recordset(${JSON.stringify(chunk)}::jsonb) AS m(
            customer_id bigint, email text, first_name text, last_name text, shopify_customer_id text,
            language text, opt_in_level text, consent_at timestamptz, orders_count int,
            total_spent_cents bigint, last_order_at timestamptz, facts boolean)
        ),
        latest AS (
          SELECT DISTINCT ON (cc.customer_id) cc.id, cc.customer_id, cc.cycle, cc.status, cc.sent_at
            FROM campaign_contacts cc
            JOIN m ON m.customer_id = cc.customer_id
           WHERE cc.campaign_id = ${campaignId} AND cc.is_test = false
           ORDER BY cc.customer_id, cc.cycle DESC, cc.id DESC
        ),
        upd AS (
          UPDATE campaign_contacts cc SET
            email = m.email,
            first_name = m.first_name,
            last_name = m.last_name,
            shopify_customer_id = COALESCE(m.shopify_customer_id, cc.shopify_customer_id),
            language = m.language,
            opt_in_level = m.opt_in_level,
            consent_updated_at = m.consent_at,
            orders_count = CASE WHEN m.facts THEN m.orders_count ELSE cc.orders_count END,
            total_spent_cents = CASE WHEN m.facts THEN m.total_spent_cents ELSE cc.total_spent_cents END,
            last_order_at = COALESCE(m.last_order_at, cc.last_order_at),
            last_synced_at = now(),
            status = CASE
                       WHEN cc.status = 'suppressed' THEN 'pending'
                       WHEN cc.status = 'excluded' AND ${allowNew} THEN 'pending'
                       ELSE cc.status
                     END,
            excluded_reason = CASE
                                WHEN cc.status = 'suppressed' OR (cc.status = 'excluded' AND ${allowNew}) THEN NULL
                                ELSE cc.excluded_reason
                              END
            FROM m, latest l
           WHERE cc.id = l.id AND l.customer_id = m.customer_id
             AND cc.status IN ('pending', 'drafted', 'draft_failed', 'excluded', 'suppressed')
          RETURNING 1
        ),
        ins AS (
          INSERT INTO campaign_contacts
            (campaign_id, customer_id, cycle, shopify_customer_id, email, first_name, last_name, language,
             opt_in_level, consent_updated_at, orders_count, total_spent_cents, last_order_at,
             last_synced_at, status, created_at, added_at)
          SELECT ${campaignId}, m.customer_id, COALESCE(l.cycle + 1, 1), m.shopify_customer_id, m.email,
                 m.first_name, m.last_name, m.language, m.opt_in_level, m.consent_at, m.orders_count,
                 m.total_spent_cents, m.last_order_at, now(), 'pending', now(), now()
            FROM m
            LEFT JOIN latest l ON l.customer_id = m.customer_id
           WHERE (l.id IS NULL AND ${allowNew})
              OR (l.status = 'sent' AND ${reentryDays}::int IS NOT NULL
                  AND l.sent_at < now() - make_interval(days => ${reentryDays ?? 0}::int))
          ON CONFLICT DO NOTHING
          RETURNING 1
        )
        SELECT (SELECT count(*) FROM upd)::int AS refreshed, (SELECT count(*) FROM ins)::int AS added
      `) as Array<{ refreshed: number; added: number }>;
      result.refreshed += Number(rows[0]?.refreshed ?? 0);
      result.added += Number(rows[0]?.added ?? 0);
    }

    // Open rows whose person lost consent (or was blocked / erased) — any mode.
    const sup = (await sql`
      WITH upd AS (
        UPDATE campaign_contacts cc
           SET status = 'suppressed', excluded_reason = 'keine_einwilligung'
         WHERE cc.campaign_id = ${campaignId}
           AND cc.is_test = false
           AND cc.status IN ('pending', 'drafted', 'draft_failed')
           AND NOT EXISTS (
                 SELECT 1 FROM customer_overview o
                  WHERE o.customer_id = cc.customer_id
                    AND o.email_consent_state = 'subscribed'
                    AND NOT o.blocked)
        RETURNING 1
      )
      SELECT count(*)::int AS n FROM upd
    `) as Array<{ n: number }>;
    result.suppressed = Number(sup[0]?.n ?? 0);

    // Dynamic audiences: pending rows that no longer match leave — except
    // people added by hand (0069), who stay until they are sent or removed.
    if (campaign.audienceMode === "dynamisch") {
      const ids = match.members.map((m) => m.customerId);
      const exc = (await sql`
        WITH upd AS (
          UPDATE campaign_contacts
             SET status = 'excluded', excluded_reason = 'zielgruppe'
           WHERE campaign_id = ${campaignId}
             AND is_test = false
             AND status IN ('pending', 'draft_failed')
             AND added_manually = false
             AND NOT (customer_id = ANY(${ids}::bigint[]))
          RETURNING 1
        )
        SELECT count(*)::int AS n FROM upd
      `) as Array<{ n: number }>;
      result.excluded = Number(exc[0]?.n ?? 0);
    }

    await sql`UPDATE campaigns SET audience_refreshed_at = now() WHERE id = ${campaignId}`;
    return result;
  } catch (err) {
    reportError(err, { route: "lib/campaigns-store", phase: "refreshCampaignAudience" });
    return { ...result, ok: false };
  }
}

/** Nightly: end expired campaigns, refresh every active one. Never throws. */
export async function refreshLiveAudiences(
  opts: { deadlineMs?: number } = {},
  sql: Sql | null = getSql()
): Promise<{ ended: number; refreshed: Array<{ campaignId: number } & AudienceRefreshResult> }> {
  const ended = await endExpiredCampaigns(sql);
  const out: Array<{ campaignId: number } & AudienceRefreshResult> = [];
  const campaigns = await listCampaigns({}, sql);
  for (const c of campaigns) {
    if (opts.deadlineMs && Date.now() > opts.deadlineMs) break;
    if (c.kind === "einzel" || c.status !== "aktiv") continue;
    // A fest audience is fixed after the start; its refresh only updates
    // snapshots and consent — still worth it for open rows.
    out.push({ campaignId: c.id, ...(await refreshCampaignAudience(c.id, sql)) });
  }
  return { ended, refreshed: out };
}

export type AddRecipientResult =
  | { ok: true; contactId: number; created: boolean }
  | { ok: false; reason: "no_consent" | "blocked" | "not_found" | "campaign_closed" | "db" };

/**
 * Put one person into a campaign by hand — the Einzelansprache from Kunden or
 * an Eingang suggestion, or "zur Kampagne hinzufügen". Requires the one
 * consent and no hard block (the send gate re-checks). An open row is reused
 * (its note updated); after a sent / skipped row a new cycle starts. The row
 * is marked `added_manually` (0069): a dynamic audience refresh keeps it.
 */
export async function addRecipient(
  input: { campaignId: number; customerId: number; adminNote?: string | null; conversationId?: number | null },
  sql: Sql | null = getSql()
): Promise<AddRecipientResult> {
  if (!sql) return { ok: false, reason: "db" };
  try {
    const campaign = await getCampaign(input.campaignId, sql);
    if (!campaign) return { ok: false, reason: "not_found" };
    if (campaign.status === "beendet" || campaign.status === "archiviert") return { ok: false, reason: "campaign_closed" };
    const people = (await sql`
      SELECT o.customer_id, o.email, o.shopify_customer_id, o.email_consent_state, o.email_consent_level,
             o.email_consent_at, o.blocked, o.orders_count, o.total_spent_cents, o.last_order_at,
             o.locale, o.country_code, o.language_override, cu.first_name, cu.last_name,
             (SELECT cv.locale FROM conversations cv
               WHERE cv.customer_id = o.customer_id AND cv.locale IS NOT NULL
               ORDER BY cv.last_activity_at DESC LIMIT 1) AS chat_locale
        FROM customer_overview o
        JOIN customers cu ON cu.id = o.customer_id
       WHERE o.customer_id = ${input.customerId}
    `) as Array<Record<string, unknown>>;
    const p = people[0];
    if (!p) return { ok: false, reason: "not_found" };
    if (p.blocked === true) return { ok: false, reason: "blocked" };
    if (p.email_consent_state !== "subscribed") return { ok: false, reason: "no_consent" };

    const open = (await sql`
      SELECT id, cycle, status FROM campaign_contacts
       WHERE campaign_id = ${input.campaignId} AND customer_id = ${input.customerId} AND is_test = false
       ORDER BY cycle DESC, id DESC LIMIT 1
    `) as Array<{ id: number; cycle: number; status: string }>;
    const latest = open[0];
    if (latest && ["pending", "drafted", "draft_failed", "sending", "excluded", "suppressed"].includes(latest.status)) {
      await sql`
        UPDATE campaign_contacts
           SET admin_note = COALESCE(${input.adminNote ?? null}, admin_note),
               conversation_id = COALESCE(${input.conversationId ?? null}::bigint, conversation_id),
               status = CASE WHEN status IN ('excluded', 'suppressed') THEN 'pending' ELSE status END,
               excluded_reason = CASE WHEN status IN ('excluded', 'suppressed') THEN NULL ELSE excluded_reason END,
               added_manually = true
         WHERE id = ${latest.id}
      `;
      return { ok: true, contactId: Number(latest.id), created: false };
    }
    const language = effectiveEmailLanguage({
      override: p.language_override as string | null,
      locale: p.locale as string | null,
      countryCode: p.country_code as string | null,
      chatLocale: p.chat_locale as string | null,
    });
    const rows = (await sql`
      INSERT INTO campaign_contacts
        (campaign_id, customer_id, cycle, shopify_customer_id, email, first_name, last_name, language,
         opt_in_level, consent_updated_at, orders_count, total_spent_cents, last_order_at,
         last_synced_at, status, created_at, added_at, admin_note, conversation_id, added_manually)
      VALUES
        (${input.campaignId}, ${input.customerId}, ${latest ? Number(latest.cycle) + 1 : 1},
         ${(p.shopify_customer_id as string | null) ?? null}, ${String(p.email)},
         ${(p.first_name as string | null) ?? null}, ${(p.last_name as string | null) ?? null}, ${language},
         ${String(p.email_consent_level ?? "unknown").toUpperCase()}, ${iso(p.email_consent_at)},
         ${Number(p.orders_count ?? 0)}, ${Number(p.total_spent_cents ?? 0)}, ${iso(p.last_order_at)},
         now(), 'pending', now(), now(), ${input.adminNote ?? null}, ${input.conversationId ?? null}, true)
      RETURNING id
    `) as Array<{ id: number }>;
    return { ok: true, contactId: Number(rows[0].id), created: true };
  } catch (err) {
    reportError(err, { route: "lib/campaigns-store", phase: "addRecipient" });
    return { ok: false, reason: "db" };
  }
}

/** May this campaign prepare / send right now? (status + schedule) */
export function campaignAcceptsWork(c: Pick<Campaign, "status" | "startsAt" | "endsAt" | "kind">): boolean {
  if (c.kind === "einzel") return c.status === "aktiv";
  return campaignPhase(c) === "laeuft";
}
