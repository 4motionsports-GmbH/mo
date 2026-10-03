// „Prüfen & testen“ in the campaign editor (docs/CAMPAIGNS.md §2.2): sample
// mails for a few real recipients of the audience BEFORE the campaign goes
// live, generated exactly like a desk draft (campaign-prepare.ts) but stored
// nowhere — no recipient row, no draft, no code. Only the AI call is metered
// (ai_usage, like every draft).
//
// A sample is generated for a person with the one consent and without a
// block (fail-closed); an Art. 21 objection keeps the AI profile out of the
// text, as on the desk. „An Testpostfach senden“ turns a sample into a
// Testkontakt of the SAVED campaign with exactly that text and sends it
// through approveAndSendCampaign — the only path that delivers campaign mail.

import { isSuppressed } from "./email-capture-store";
import { getCampaign, type Campaign } from "./campaigns-store";
import { formatAdmin, ADMIN_DATE } from "./admin-datetime.mjs";
import { loadPurchaseHistory } from "./customer-orders-store";
import { PLACEHOLDER_DISCOUNT_CODE, formatExpiryDateForLanguage } from "./shopify-discounts";
import { generateCampaignDraft } from "./campaign-draft";
import type { EmailTextMode } from "./marketing-draft";
import { DEFAULT_EMAIL_TEXT_MODE } from "./email-text-mode.mjs";
import type { DiscountScope } from "./discount-scope.mjs";
import { loadCampaignPersonalization } from "./campaign-recommendations";
import { resolveProductSelections } from "./product-catalog";
import { projectedExpiry, daysUntil } from "./campaign-prepare";
import { renderCampaignSample, approveAndSendCampaign } from "./campaign-email";
import { createTestContact, saveCampaignDraft } from "./campaign-store";
import { getCustomerById } from "./customer-store";
import { ARCHETYPE_META } from "./persona";
import type { PersonaArchetype } from "./types";
import { sampleConfigFingerprint } from "./campaign-sample-core.mjs";
import { reportError } from "./observability";

/** The campaign settings a sample is generated with — the saved campaign,
 * overlaid with the editor's unsaved values. */
export type CampaignSampleConfig = Pick<
  Campaign,
  | "name"
  | "kind"
  | "brief"
  | "endsAt"
  | "discountPercent"
  | "discountScope"
  | "discountValidUntil"
  | "designKey"
  | "textMode"
  | "moPromo"
  | "ctaKind"
  | "ctaUrl"
>;

export interface CampaignSample {
  customerId: number;
  language: "de" | "en";
  firstName: string | null;
  subject: string;
  body: string;
  html: string;
  recommendedProductIds: string[];
  productHighlights: Array<{ name: string; description: string }> | null;
  segment: string | null;
  segmentDays: number | null;
  lowConfidence: boolean;
  /** The AI profile informed the text (none with an objection or no profile). */
  usedProfile: boolean;
  /** sampleConfigFingerprint of the settings this sample was made with. */
  fingerprint: string;
}

export type CampaignSampleResult =
  | { ok: true; sample: CampaignSample }
  | { ok: false; reason: "not_found" | "not_eligible" | "failed"; message: string };

/** Compose one sample mail for a customer. Never throws. */
export async function composeCampaignSample(
  config: CampaignSampleConfig,
  customerId: number,
  requestedLanguage: "de" | "en"
): Promise<CampaignSampleResult> {
  try {
    const customer = await getCustomerById(customerId);
    if (!customer) return { ok: false, reason: "not_found", message: "Diese Person gibt es nicht mehr." };
    // The same gate as preparing a real draft (fail-closed).
    if (customer.emailConsentState !== "subscribed" || (await isSuppressed(customer.email))) {
      return {
        ok: false,
        reason: "not_eligible",
        message: "Für diese Person liegt keine Einwilligung vor oder die Adresse ist gesperrt — kein Muster.",
      };
    }
    const language = customer.languageOverride ?? requestedLanguage;
    // An Art. 21 objection to profiling: no AI profile is read for the mail.
    const profileCustomer = customer.profileObjectionAt ? null : customer;
    const preloaded = await loadPurchaseHistory(customer);
    const { purchaseSummary, recommendations, segment } = await loadCampaignPersonalization(
      customer.email,
      null,
      null,
      profileCustomer?.profileData ?? null,
      preloaded ?? undefined
    );
    const textMode: EmailTextMode = config.textMode ?? DEFAULT_EMAIL_TEXT_MODE;
    const discountScope: DiscountScope = config.discountScope ?? "all";
    const hasDiscount = config.discountPercent > 0;
    const expiry = hasDiscount ? projectedExpiry(config) : null;
    const products = recommendations.products;

    const draft = await generateCampaignDraft({
      language,
      firstName: customer.firstName,
      campaign: {
        name: config.name,
        kind: config.kind,
        brief: config.brief,
        endsLabel: config.endsAt ? formatAdmin(config.endsAt, ADMIN_DATE) : null,
      },
      adminNote: null,
      purchaseSummary,
      focusPurchaseTitles: null,
      recommendations: products.map((p) => ({ name: p.name, url: p.shopifyUrl, category: p.category || null })),
      lowConfidence: recommendations.lowConfidence,
      attachedBundle: null,
      textMode,
      segment,
      customerProfile: profileCustomer?.profileSummary
        ? {
            summary: profileCustomer.profileSummary,
            data: profileCustomer.profileData,
            personaDisplay:
              (profileCustomer.personaLabel &&
                ARCHETYPE_META[profileCustomer.personaLabel as PersonaArchetype]?.label) ||
              null,
          }
        : null,
      recommendationStrategy: recommendations.strategy,
      discountCode: hasDiscount ? PLACEHOLDER_DISCOUNT_CODE : null,
      discountPercent: config.discountPercent,
      discountScope,
      discountExpiresLabel: expiry ? formatExpiryDateForLanguage(expiry, language) : null,
      discountValidityDays: expiry ? daysUntil(expiry) : null,
    });

    const recommendedProductIds = products.map((p) => p.id);
    const html = await renderCampaignSample({
      campaign: config,
      language,
      firstName: customer.firstName,
      subject: draft.subject,
      body: draft.body,
      recommendedProductIds,
      productHighlights: draft.productHighlights ?? null,
      discountPercent: config.discountPercent,
      discountExpiresAt: expiry ? expiry.toISOString() : null,
      discountScope,
    });
    return {
      ok: true,
      sample: {
        customerId,
        language,
        firstName: customer.firstName,
        subject: draft.subject,
        body: draft.body,
        html,
        recommendedProductIds,
        productHighlights: draft.productHighlights ?? null,
        segment: segment.key,
        segmentDays: segment.days,
        lowConfidence: recommendations.lowConfidence,
        usedProfile: Boolean(profileCustomer?.profileSummary),
        fingerprint: sampleConfigFingerprint(config as unknown as Record<string, unknown>),
      },
    };
  } catch (err) {
    reportError(err, { route: "lib/campaign-sample", phase: "compose" });
    return { ok: false, reason: "failed", message: "Das Muster konnte nicht erzeugt werden — bitte erneut versuchen." };
  }
}

/** What the editor sends back for „An Testpostfach senden“ (validated here). */
export interface SampleTestInput {
  campaignId: number;
  to: string;
  customerId: number;
  language: "de" | "en";
  fingerprint: string;
  subject: string;
  body: string;
  recommendedProductIds: string[];
  productHighlights: Array<{ name: string; description: string }> | null;
  segment: string | null;
  segmentDays: number | null;
  lowConfidence: boolean;
}

export type SampleTestResult =
  | { ok: true; contactId: number; sentTo: string }
  | { ok: false; reason: string; message: string };

/**
 * Send a sample to the operator's own inbox: a Testkontakt of the saved
 * campaign (borrowing the sample person's purchase history, 0057) with
 * exactly the sample's text, sent through approveAndSendCampaign — so the
 * test mail carries everything a real one does (MK- code, link tracking,
 * unsubscribe) and passes the same gates. Refused when the saved campaign's
 * settings differ from the sample's (fingerprint).
 */
export async function sendCampaignSampleTest(input: SampleTestInput): Promise<SampleTestResult> {
  try {
    const campaign = await getCampaign(input.campaignId);
    if (!campaign) return { ok: false, reason: "not_found", message: "Kampagne nicht gefunden." };
    if (sampleConfigFingerprint(campaign as unknown as Record<string, unknown>) !== input.fingerprint) {
      return {
        ok: false,
        reason: "stale_sample",
        message: "Das Muster passt nicht mehr zur gespeicherten Kampagne — speichern und das Muster neu erzeugen.",
      };
    }
    const customer = await getCustomerById(input.customerId);
    if (!customer) return { ok: false, reason: "not_found", message: "Diese Person gibt es nicht mehr." };

    // Only products that are still in the catalog and in stock (the desk's rule).
    const selections = input.recommendedProductIds.length
      ? await resolveProductSelections(input.recommendedProductIds)
      : [];
    const refs = selections.filter((s) => !s.missingVariant && s.available && s.display).map((s) => s.ref);

    const contact = await createTestContact({
      campaignId: campaign.id,
      email: input.to,
      firstName: customer.firstName,
      lastName: null,
      language: input.language,
      sourceEmail: customer.email,
    });
    if (!contact) return { ok: false, reason: "failed", message: "Der Testkontakt konnte nicht angelegt werden." };
    if (contact.status === "sending") {
      return { ok: false, reason: "claim_failed", message: "An diese Adresse wird gerade gesendet — kurz warten." };
    }

    const expiry = campaign.discountPercent > 0 ? projectedExpiry(campaign) : null;
    const saved = await saveCampaignDraft({
      contactId: contact.id,
      subject: input.subject,
      body: input.body,
      discountPercent: campaign.discountPercent,
      discountExpiresAt: expiry ? expiry.toISOString() : null,
      discountScope: campaign.discountScope ?? "all",
      purchaseSummary: null,
      recommendedProductIds: refs,
      productHighlights: input.productHighlights,
      purchaseSelectedIds: null,
      textMode: campaign.textMode ?? DEFAULT_EMAIL_TEXT_MODE,
      segment: input.segment,
      segmentDays: input.segmentDays,
      lowConfidence: input.lowConfidence,
    });
    if (!saved) return { ok: false, reason: "failed", message: "Der Testentwurf konnte nicht gespeichert werden." };

    const result = await approveAndSendCampaign(contact.id);
    if (!result.ok) return { ok: false, reason: result.reason, message: result.message };
    return { ok: true, contactId: contact.id, sentTo: result.sentTo };
  } catch (err) {
    reportError(err, { route: "lib/campaign-sample", phase: "sendTest" });
    return { ok: false, reason: "failed", message: "Der Testversand ist fehlgeschlagen — bitte erneut versuchen." };
  }
}
