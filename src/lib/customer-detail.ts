// One customer's FULL detail for the Kunden screen — loaded on demand (when the
// operator opens a customer), never for the whole list. Assembles the cached
// summaries, linked consultations with transcripts, the latest marketing send,
// bundle offers, correspondence metadata, physical letters and the letter
// draft. Read-only; every source is fail-soft.

import { getCustomerById, loadCustomerSessions } from "./customer-store";
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

export interface CustomerDetail {
  id: number;
  email: string;
  /** Best display name (Shopify account summary), else null → fall back to email. */
  name: string | null;
  identityTier: 1 | 2 | 3;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  transactionalConsent: boolean;
  marketingStatus: "none" | "pending" | "confirmed" | "unsubscribed";
  adminInstructions: string | null;
  marketingSend: CustomerDetailMarketingSend | null;
  profileSummary: string | null;
  profileSummaryUpdatedAt: string | null;
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

  const [sessions, send, bundles, correspondence, physicalLetters] = await Promise.all([
    loadCustomerSessions(c.id),
    getLatestSendForEmail(c.email),
    listBundleOffersWithSignalsForCustomer(c.id),
    listCustomerMessages(c.id),
    listCustomerLetters(c.id),
  ]);
  const physical = physicalEligibilityForCustomer(c);

  return {
    id: c.id,
    email: c.email,
    name:
      c.shopifyAccountSummary?.displayName?.trim() ||
      c.shopifyAccountSummary?.firstName?.trim() ||
      null,
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
    purchaseSummary: c.purchaseSummary,
    purchaseSummaryUpdatedAt: c.purchaseSummaryUpdatedAt,
    // No session ids leave the server — the browser doesn't need the
    // pseudonymous keys.
    sessions: sessions.map((s) => ({
      conversationId: s.conversationId,
      createdAt: s.createdAt,
      personaDisplay: personaDisplay(s.personaLabel),
      messageCount: s.messageCount,
      transcript: s.transcript,
    })),
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
