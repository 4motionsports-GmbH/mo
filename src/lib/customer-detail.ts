// One customer's FULL detail for the Kunden screen — loaded on demand (when the
// operator opens a customer), never for the whole list. Assembles identity and
// the Shopify mirror, the one consent with its history, the computed figures
// (customer_facts), the order ledger, Mo chats with transcripts, campaign
// participation, the activity timeline, bundle offers, correspondence,
// physical letters and the letter draft. Read-only; every source is fail-soft.

import {
  getCustomerById,
  loadCustomerSessions,
  type CustomerProfileData,
  type CustomerSource,
} from "./customer-store";
import { getLatestSendForEmail } from "./marketing-store";
import { listCustomerMessages, type CorrespondenceMessage } from "./email-messages-store";
import { listCustomerLetters, type PhysicalLetterRow } from "./physical-letters-store";
import { physicalEligibilityForCustomer } from "./physical-mail";
import { listBundleOffersWithSignalsForCustomer } from "./bundle-offers-store";
import { buildBundleRedirectUrl } from "./bundle-offers";
import { ARCHETYPE_META } from "./persona";
import type { PersonaArchetype } from "./types";
import type { OrderHistory } from "./shopify-orders";
import type { EmailTextMode } from "./email-text-mode.mjs";
import { getOptOutState, type OptOutState } from "./marketing-optout";
import { listConsentEvents } from "./consent-store";
import { consentLabel, consentSourceLabel } from "./consent-core.mjs";
import { getCustomerFigures, type CustomerFigures } from "./customer-list-store";
import { listCustomerOrders, type LedgerOrder } from "./customer-orders-store";
import { listCampaignParticipation, type CampaignParticipation } from "./campaigns-store";
import { buildCustomerTimeline, type TimelineEntry } from "./customer-timeline.mjs";
import { aiProfileScope, mayBuildAiProfile } from "./platform-flags.mjs";
import { getProductsByIds } from "./product-catalog";

export interface CustomerDetailTranscriptTurn {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  toolName: string | null;
}

export interface CustomerDetailSession {
  conversationId: number;
  createdAt: string | null;
  personaDisplay: string | null;
  messageCount: number;
  transcript: CustomerDetailTranscriptTurn[];
}

/** The customer's latest marketing_sends row (open draft preferred). Sent rows
 * are read-only history. */
export interface CustomerDetailMarketingSend {
  id: number;
  status: "draft" | "approved" | "sent";
  subject: string | null;
  draftedText: string | null;
  discountPercent: number;
  discountCode: string | null;
  discountExpiresAt: string | null;
  /** The instructions snapshot this draft was generated with. */
  adminInstructions: string | null;
  /** The text mode this draft was generated with (null = legacy long-form). */
  textMode: EmailTextMode | null;
  sentAt: string | null;
}

export interface CustomerDetailBundle {
  id: number;
  title: string | null;
  status: "pending" | "active" | "expired" | "failed";
  components: Array<{ productId: string; title: string; quantity: number }>;
  componentsSum: string;
  bundlePrice: string;
  currency: string;
  cartUrl: string | null;
  redirectUrl: string | null;
  createdAt: string | null;
  expiresAt: string | null;
  error: string | null;
  emailSentAt: string | null;
  clicked: boolean;
}

export interface CustomerDetailConsent {
  state: "subscribed" | "pending" | "unsubscribed" | "not_subscribed";
  level: "confirmed_opt_in" | "single_opt_in" | "unknown" | null;
  at: string | null;
  source: string | null;
  /** German label of state + level ("Angemeldet (DOI)"). */
  label: string;
  sourceLabel: string | null;
  /** Hard block on the address (bounce / complaint / erasure), or null. */
  blockReason: string | null;
  /** May this person receive marketing e-mail right now (state + no block)? */
  sendable: boolean;
  history: Array<{ id: number; occurredAt: string; state: string; level: string | null; sourceLabel: string; note: string | null }>;
}

export interface CustomerDetail {
  id: number;
  email: string;
  /** Best display name (Shopify name, else account summary), else null → fall back to email. */
  name: string | null;
  /** A Shopify customer (mirrored or signed in) vs. a Mo-only lead. */
  isShopifyCustomer: boolean;
  shopifyCustomerId: string | null;
  shopifyState: string | null;
  shopifyTags: string[];
  shopifyCreatedAt: string | null;
  shopifySyncedAt: string | null;
  locale: string | null;
  countryCode: string | null;
  languageOverride: "de" | "en" | null;
  /** The one e-mail consent (Shopify + Mo) with its history. */
  consent: CustomerDetailConsent;
  /** kauf = purchase profile, voll = full profile (chat + purchases). */
  profileDepth: "kauf" | "voll" | null;
  /** May an AI profile be built for this person (CUSTOMER_AI_PROFILE_SCOPE + objection)? */
  profileAllowed: boolean;
  profileObjectionAt: string | null;
  postalObjectionAt: string | null;
  /** The computed figures (customer_facts), or null before the first run. */
  figures: CustomerFigures | null;
  /** „Wahrscheinlich als Nächstes“ — accessories of what the person owns (facts' complement handles). */
  nextLikely: Array<{ id: string; name: string; price: number }>;
  /** The local order ledger (newest first) + the total count. */
  orders: LedgerOrder[];
  ordersTotal: number;
  /** Every campaign this person is (or was) a recipient of. */
  campaigns: CampaignParticipation[];
  /** Everything that happened, newest first. */
  timeline: TimelineEntry[];
  identityTier: 1 | 2 | 3;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  transactionalConsent: boolean;
  marketingStatus: "none" | "pending" | "confirmed" | "unsubscribed";
  adminInstructions: string | null;
  marketingSend: CustomerDetailMarketingSend | null;
  profileSummary: string | null;
  profileSummaryUpdatedAt: string | null;
  /** Structured profile fields (migration 0059), or null before the first profile. */
  profileData: CustomerProfileData | null;
  personaLabel: string | null;
  /** Where the record came from (chat / Shopify sign-in / Kampagne). */
  source: CustomerSource;
  /** Local marketing opt-out (block list / chat unsubscribe) — Marketing tab. */
  optOut: OptOutState | null;
  purchaseSummary: OrderHistory | null;
  purchaseSummaryUpdatedAt: string | null;
  sessions: CustomerDetailSession[];
  bundles: CustomerDetailBundle[];
  correspondence: CorrespondenceMessage[];
  physicalEligible: boolean;
  physicalReason: string | null;
  physicalLetters: PhysicalLetterRow[];
  letterDraftSubject: string | null;
  letterDraftBody: string | null;
}

function personaDisplay(label: string | null): string | null {
  if (!label) return null;
  const meta = ARCHETYPE_META[label as PersonaArchetype];
  return meta ? meta.label : label;
}

/** Full detail for one customer, or null when the id is unknown / no DB. */
export async function loadCustomerDetail(customerId: number): Promise<CustomerDetail | null> {
  const c = await getCustomerById(customerId);
  if (!c) return null;

  const [sessions, send, bundles, correspondence, physicalLetters, optOut, consentEvents, figures, ledger, campaigns] =
    await Promise.all([
      loadCustomerSessions(c.id),
      getLatestSendForEmail(c.email),
      listBundleOffersWithSignalsForCustomer(c.id),
      listCustomerMessages(c.id),
      listCustomerLetters(c.id),
      c.email.startsWith("shopify:") ? Promise.resolve(null) : getOptOutState(c.email),
      listConsentEvents(c.id, 30),
      getCustomerFigures(c.id),
      listCustomerOrders(c.id, { limit: 50 }),
      listCampaignParticipation(c.id),
    ]);
  const physical = physicalEligibilityForCustomer(c);
  const blockReason = figures?.blockReason ?? null;
  const nextLikely = figures?.complementHandles.length
    ? (await getProductsByIds(figures.complementHandles.slice(0, 4)).catch(() => [])).map((p) => ({
        id: p.id,
        name: p.name,
        price: p.salePrice ?? p.price,
      }))
    : [];
  const consentHistory = consentEvents.map((e) => ({
    id: e.id,
    occurredAt: e.occurredAt,
    state: e.state,
    level: e.level,
    sourceLabel: consentSourceLabel(e.source),
    note: e.note,
  }));
  const sessionsOut = sessions.map((s) => ({
    conversationId: s.conversationId,
    createdAt: s.createdAt,
    personaDisplay: personaDisplay(s.personaLabel),
    messageCount: s.messageCount,
    transcript: s.transcript,
  }));
  const fullName = [c.firstName, c.lastName].filter(Boolean).join(" ").trim();

  return {
    id: c.id,
    email: c.email,
    name:
      fullName ||
      c.shopifyAccountSummary?.displayName?.trim() ||
      c.shopifyAccountSummary?.firstName?.trim() ||
      null,
    isShopifyCustomer: c.shopifyCustomerId != null,
    shopifyCustomerId: c.shopifyCustomerId,
    shopifyState: c.shopifyState,
    shopifyTags: c.shopifyTags,
    shopifyCreatedAt: c.shopifyCreatedAt,
    shopifySyncedAt: c.shopifySyncedAt,
    locale: c.locale,
    countryCode: c.countryCode,
    languageOverride: c.languageOverride,
    consent: {
      state: c.emailConsentState,
      level: c.emailConsentLevel,
      at: c.emailConsentAt,
      source: c.emailConsentSource,
      label: consentLabel(c.emailConsentState, c.emailConsentLevel),
      sourceLabel: c.emailConsentSource ? consentSourceLabel(c.emailConsentSource) : null,
      blockReason,
      sendable: c.emailConsentState === "subscribed" && !blockReason,
      history: consentHistory,
    },
    profileDepth: c.profileDepth,
    profileAllowed: mayBuildAiProfile({
      consentState: c.emailConsentState,
      profileObjectionAt: c.profileObjectionAt,
      scope: aiProfileScope(),
    }),
    profileObjectionAt: c.profileObjectionAt,
    postalObjectionAt: c.postalObjectionAt,
    figures,
    nextLikely,
    orders: ledger.orders,
    ordersTotal: ledger.total,
    campaigns,
    timeline: buildCustomerTimeline({
      orders: ledger.orders,
      sessions: sessionsOut,
      campaigns: campaigns.map((p) => ({
        sentAt: p.sentAt,
        campaignName: p.campaignName,
        subject: p.subject,
        clickedAt: p.clickedAt,
      })),
      consentEvents: consentHistory,
      messages: correspondence,
    }),
    identityTier: c.identityTier,
    firstSeenAt: c.firstSeenAt,
    lastSeenAt: c.lastSeenAt,
    transactionalConsent: c.transactionalConsent,
    marketingStatus: c.marketingStatus,
    adminInstructions: c.adminInstructions,
    marketingSend: send
      ? {
          id: send.id,
          status: send.status,
          subject: send.subject,
          draftedText: send.draftedText,
          discountPercent: send.discountPercent,
          discountCode: send.discountCode,
          discountExpiresAt: send.discountExpiresAt,
          adminInstructions: send.adminInstructions,
          textMode: send.textMode,
          sentAt: send.sentAt,
        }
      : null,
    profileSummary: c.profileSummary,
    profileSummaryUpdatedAt: c.profileSummaryUpdatedAt,
    profileData: c.profileData,
    personaLabel: c.personaLabel,
    source: c.source,
    optOut,
    purchaseSummary: c.purchaseSummary,
    purchaseSummaryUpdatedAt: c.purchaseSummaryUpdatedAt,
    // No session ids leave the server — the browser doesn't need the
    // pseudonymous keys.
    sessions: sessionsOut,
    bundles: bundles.map((b) => ({
      id: b.id,
      title: b.title,
      status: b.status,
      components: b.components.map((x) => ({
        productId: x.productId,
        title: x.title,
        quantity: x.quantity,
      })),
      componentsSum: b.componentsSum,
      bundlePrice: b.bundlePrice,
      currency: b.currency,
      cartUrl: b.cartUrl,
      redirectUrl: buildBundleRedirectUrl(b.redirectToken),
      createdAt: b.createdAt,
      expiresAt: b.expiresAt,
      error: b.error,
      emailSentAt: b.emailSentAt,
      clicked: b.clicked,
    })),
    correspondence,
    physicalEligible: physical.eligible,
    physicalReason: physical.reason,
    physicalLetters,
    letterDraftSubject: c.letterDraftSubject,
    letterDraftBody: c.letterDraftBody,
  };
}
