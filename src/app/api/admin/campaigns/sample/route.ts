// POST /api/admin/campaigns/sample — „Prüfen & testen“ in the campaign editor
// (docs/CAMPAIGNS.md §2.2):
//   { action: "pick", audience }
//       → { total, candidates: [{ customerId, name, email, language, hasMoContact, lifecycleSegment, ordersCount }] }
//   { action: "generate", campaignId?, config, customerId, language }
//       → { sample }   (subject, body, html, … — stored nowhere)
//   { action: "send_test", campaignId, to, sample }
//       → { ok, contactId, sentTo }   (Testkontakt + approveAndSendCampaign)
//
// `config` is the editor's current form (validated like an update and laid
// over the saved campaign), so a sample reflects unsaved changes; a test
// send only goes out under the SAVED settings (fingerprint check).
//
// Auth + CSRF via guardAdminPost (the proxy already gates /api/admin/*).

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { matchAudience } from "@/lib/audience-store";
import { normalizeAudienceSpec } from "@/lib/audience-spec.mjs";
import { getCampaign, type Campaign } from "@/lib/campaigns-store";
import { validateCampaignInput } from "@/lib/campaign-def.mjs";
import { DISCOUNT_PERCENT_MAX } from "@/lib/discount-validation.mjs";
import { pickSampleRecipients, SAMPLE_COUNT } from "@/lib/campaign-sample-core.mjs";
import {
  composeCampaignSample,
  sendCampaignSampleTest,
  type CampaignSampleConfig,
} from "@/lib/campaign-sample";
import { isDbConfigured } from "@/lib/db";
import { reportError } from "@/lib/observability";

export const maxDuration = 90;

/** How many of the newest matches the varied pick chooses from. */
const PICK_POOL = 60;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const STATUS_BY_REASON: Record<string, number> = {
  not_found: 404,
  not_eligible: 409,
  stale_sample: 409,
  claim_failed: 409,
  already_sent: 409,
  campaign_closed: 409,
  discount_mismatch: 409,
  discount_scope_unresolved: 409,
  sends_not_approved: 403,
  opt_in_blocked: 403,
  no_consent: 403,
  too_soon: 429,
  no_unsubscribe: 503,
  email_not_configured: 503,
  discount_failed: 502,
  send_failed: 502,
  failed: 500,
};

const DEFAULT_CONFIG: CampaignSampleConfig = {
  name: "Neue Kampagne",
  kind: "aktion",
  brief: null,
  endsAt: null,
  discountPercent: 0,
  discountScope: "all",
  discountValidUntil: null,
  designKey: null,
  textMode: null,
  moPromo: true,
  ctaKind: "mo_chat",
  ctaUrl: null,
};

function pickConfig(c: Campaign | null): CampaignSampleConfig {
  if (!c) return { ...DEFAULT_CONFIG };
  return {
    name: c.name,
    kind: c.kind,
    brief: c.brief,
    endsAt: c.endsAt,
    discountPercent: c.discountPercent,
    discountScope: c.discountScope,
    discountValidUntil: c.discountValidUntil,
    designKey: c.designKey,
    textMode: c.textMode,
    moPromo: c.moPromo,
    ctaKind: c.ctaKind,
    ctaUrl: c.ctaUrl,
  };
}

const str = (v: unknown, max: number): string | null =>
  typeof v === "string" && v.trim() && v.length <= max ? v : null;

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;
  if (!isDbConfigured()) return adminJsonError("no_database", "No database configured.", 503);
  let raw: Record<string, unknown>;
  try {
    raw = (await req.json()) as Record<string, unknown>;
  } catch {
    return adminJsonError("bad_request", "Invalid JSON body", 400);
  }

  if (raw.action === "pick") {
    try {
      const match = await matchAudience(normalizeAudienceSpec(raw.audience), { limit: PICK_POOL });
      if (!match.ok) return adminJsonError("internal_error", "Die Zielgruppe ist gerade nicht abrufbar.", 500);
      const picked = pickSampleRecipients(match.members, SAMPLE_COUNT);
      return adminJson({
        total: match.total,
        candidates: picked.map((m) => ({
          customerId: m.customerId,
          name: [m.firstName, m.lastName].filter(Boolean).join(" ") || null,
          email: m.email,
          language: m.language,
          hasMoContact: m.hasMoContact,
          lifecycleSegment: m.lifecycleSegment,
          ordersCount: m.ordersCount,
        })),
      });
    } catch (err) {
      reportError(err, { route: "api/admin/campaigns/sample", phase: "pick" });
      return adminJsonError("internal_error", "Die Zielgruppe ist gerade nicht abrufbar.", 500);
    }
  }

  const customerId = Number(raw.customerId ?? (raw.sample as Record<string, unknown> | undefined)?.customerId);
  if (!Number.isInteger(customerId) || customerId <= 0) {
    return adminJsonError("bad_request", "customerId required", 400);
  }

  if (raw.action === "generate") {
    const campaignId = raw.campaignId == null ? null : Number(raw.campaignId);
    if (campaignId !== null && (!Number.isInteger(campaignId) || campaignId <= 0)) {
      return adminJsonError("bad_request", "campaignId invalid", 400);
    }
    try {
      const saved = campaignId ? await getCampaign(campaignId) : null;
      if (campaignId && !saved) return adminJsonError("not_found", "Kampagne nicht gefunden.", 404);
      const base = pickConfig(saved);
      // The form's values, validated like an update; a still-empty name of a
      // new campaign falls back to the placeholder instead of failing.
      const form = (raw.config && typeof raw.config === "object" ? raw.config : {}) as Record<string, unknown>;
      const { audience: _a, kind: formKind, ...fields } = form;
      void _a;
      // A new campaign's kind comes from the form; a saved one keeps its own.
      if (!saved && (formKind === "laufend" || formKind === "aktion")) base.kind = formKind;
      if (typeof fields.name === "string" && fields.name.trim().length < 3) delete fields.name;
      const v = validateCampaignInput(fields, {
        maxDiscountPercent: DISCOUNT_PERCENT_MAX,
        current: saved ?? undefined,
      });
      if (!v.ok) return adminJsonError("invalid", Object.values(v.errors)[0] ?? "Ungültige Eingabe.", 400);
      const config = { ...base } as Record<string, unknown>;
      for (const key of Object.keys(base)) {
        if (key in v.value) config[key] = v.value[key];
      }
      const result = await composeCampaignSample(
        config as unknown as CampaignSampleConfig,
        customerId,
        raw.language === "en" ? "en" : "de"
      );
      if (!result.ok) return adminJsonError(result.reason, result.message, STATUS_BY_REASON[result.reason] ?? 400);
      return adminJson({ sample: result.sample });
    } catch (err) {
      reportError(err, { route: "api/admin/campaigns/sample", phase: "generate" });
      return adminJsonError("internal_error", "Das Muster konnte nicht erzeugt werden.", 500);
    }
  }

  if (raw.action === "send_test") {
    const campaignId = Number(raw.campaignId);
    if (!Number.isInteger(campaignId) || campaignId <= 0) {
      return adminJsonError("bad_request", "Erst speichern — Testversand gibt es nur für gespeicherte Kampagnen.", 400);
    }
    const to = String(raw.to ?? "").trim().toLowerCase();
    if (!EMAIL_RE.test(to) || to.length > 254) {
      return adminJsonError("bad_request", "Bitte eine gültige E-Mail-Adresse angeben.", 400);
    }
    const s = (raw.sample && typeof raw.sample === "object" ? raw.sample : {}) as Record<string, unknown>;
    const subject = str(s.subject, 300);
    const body = str(s.body, 20_000);
    const fingerprint = typeof s.fingerprint === "string" ? s.fingerprint : "";
    if (!subject || !body || !/^[0-9a-f]{8}$/.test(fingerprint)) {
      return adminJsonError("bad_request", "Das Muster ist unvollständig — bitte neu erzeugen.", 400);
    }
    const ids = Array.isArray(s.recommendedProductIds) ? s.recommendedProductIds : [];
    const recommendedProductIds = ids
      .filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 200)
      .slice(0, 12);
    const highlights = Array.isArray(s.productHighlights)
      ? s.productHighlights
          .filter(
            (h): h is { name: string; description: string } =>
              !!h &&
              typeof h === "object" &&
              typeof (h as { name?: unknown }).name === "string" &&
              typeof (h as { description?: unknown }).description === "string"
          )
          .slice(0, 12)
          .map((h) => ({ name: h.name.slice(0, 200), description: h.description.slice(0, 1000) }))
      : null;
    const segmentDays = Number(s.segmentDays);
    try {
      const result = await sendCampaignSampleTest({
        campaignId,
        to,
        customerId,
        language: s.language === "en" ? "en" : "de",
        fingerprint,
        subject,
        body,
        recommendedProductIds,
        productHighlights: highlights,
        segment: str(s.segment, 40),
        segmentDays: Number.isFinite(segmentDays) ? Math.round(segmentDays) : null,
        lowConfidence: s.lowConfidence === true,
      });
      if (!result.ok) return adminJsonError(result.reason, result.message, STATUS_BY_REASON[result.reason] ?? 400);
      return adminJson({ ok: true, contactId: result.contactId, sentTo: result.sentTo });
    } catch (err) {
      reportError(err, { route: "api/admin/campaigns/sample", phase: "send_test" });
      return adminJsonError("internal_error", "Der Testversand ist fehlgeschlagen.", 500);
    }
  }

  return adminJsonError("bad_request", "action must be pick, generate or send_test", 400);
}
