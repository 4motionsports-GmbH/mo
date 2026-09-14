// Shared types + small pure helpers of the Kampagne screen (server tab → client
// desk props, and the client-side state). The rules the desk applies (checks,
// filters, selection, estimates) live in src/lib/campaign-review-checks.mjs
// and src/lib/campaign-desk-core.mjs — pure and unit-tested.

import type { EmailTextModeValue } from "../EmailTextModeToggle";
import type { CampaignRecommendationView } from "@/lib/campaign-recommendation-view";

/** The three views of the screen (`?view=`, campaign-desk-core.mjs). */
export type DeskView = "pruefen" | "liste" | "gesendet";

/** Queue filter chip key (`?filter=`, campaign-desk-core.mjs QUEUE_FILTERS). */
export type QueueFilter = string;

export type DeliveryFilter = "all" | "delivered" | "clicked" | "bounced" | "complained" | "copy";

export type CampaignRecommendation = CampaignRecommendationView;

/** Attached ACTIVE bundle offer (docs/CAMPAIGNS.md §4). */
export interface CampaignBundle {
  id: number;
  title: string;
  components: string[];
  /** Decimal Money strings (as stored). */
  bundlePrice: string;
  componentsSum: string;
  currency: string;
  expiresAt: string | null;
}

export interface CampaignPurchaseSummary {
  orders: Array<{
    name: string;
    createdAt: string | null;
    totalAmount: string | null;
    currencyCode: string | null;
    items: Array<{
      title: string | null;
      quantity: number;
      /** Catalog product id when the item maps to a current catalog product
       * (selectable as recommendation basis); null/absent otherwise. */
      productId?: string | null;
    }>;
  }>;
  truncated: boolean;
}

export interface CampaignQueueItemProps {
  contactId: number;
  email: string;
  firstName: string | null;
  lastName: string | null;
  /** EFFECTIVE email language (operator override, else Shopify-derived). */
  language: "de" | "en";
  /** Operator-pinned language, or null when the derivation applies. */
  languageOverride: "de" | "en" | null;
  optInLevel: string;
  ordersCount: number;
  totalSpentCents: number;
  subject: string;
  body: string;
  discountPercent: number;
  discountExpiresAt: string | null;
  /** Text mode the draft was generated with (legacy drafts map to 'detailed'). */
  textMode: EmailTextModeValue;
  /** Lifecycle segment the draft was written for (migration 0052). Null =
   * legacy draft, or no known purchase date. */
  segment: string | null;
  /** Days since the last purchase at draft time. */
  segmentDays: number | null;
  lowConfidence: boolean;
  purchaseSummary: CampaignPurchaseSummary | null;
  /** Operator-narrowed purchase basis for the recommendations (product ids);
   * null = all purchases (the default). */
  purchaseSelectedIds: string[] | null;
  recommendations: CampaignRecommendation[];
  bundle: CampaignBundle | null;
  /** Generated KI-Hero on the draft (null = the design's default image). */
  heroUrl: string | null;
  heroHeadline: string | null;
  /** Newest send to this address on either channel (frequency-cap fact). */
  lastSendAt: string | null;
  /** When the draft was last written (stale-draft check). */
  draftUpdatedAt: string | null;
  /** Testkontakt (migration 0057): stays in the queue after every send, is
   * exempt from the cadence cap and never counts in the KPIs. */
  isTest: boolean;
  /** Client-only: subject or text edited by hand in this session. */
  edited?: boolean;
  /** Client-only: the server's reason for refusing the last send attempt. */
  sendError?: string | null;
}

export interface CampaignHistoryItemProps {
  id: number;
  email: string;
  subject: string | null;
  sentVia: "email" | "copy";
  discountCode: string | null;
  sentAt: string | null;
  /** true/false when Shopify answered; null = unknown/unchecked. */
  redeemed: boolean | null;
  /** True when the shipped content was retained (viewable via „Ansehen“). */
  hasContent: boolean;
  deliveredAt: string | null;
  bouncedAt: string | null;
  bounceType: string | null;
  complainedAt: string | null;
  clickedAt: string | null;
  heroVariant: string | null;
  /** Send to a Testkontakt (badged, excluded from the KPIs). */
  isTest: boolean;
}

/** One Testkontakt as the sheet lists it (GET /api/admin/campaign/test-contacts). */
export interface CampaignTestContactProps {
  id: number;
  email: string;
  firstName: string | null;
  lastName: string | null;
  language: "de" | "en";
  status: string;
  sourceEmail: string | null;
  hasDraft: boolean;
}

export interface CampaignCountsProps {
  pending: number;
  /** Pending contacts inside the lifecycle send window. */
  pendingSendable: number;
  drafted: number;
  sentTotal: number;
  sentToday: number;
  skipped: number;
  suppressed: number;
  draftFailed: number;
  byOptInLevel: Record<string, number>;
  lastSyncedAt: string | null;
}

export interface CampaignSkippedItemProps {
  contactId: number;
  email: string;
  firstName: string | null;
  lastName: string | null;
  hasDraft: boolean;
}

/** A hit of the global contact search (any status). */
export interface CampaignContactHit {
  id: number;
  email: string;
  firstName: string | null;
  lastName: string | null;
  status: string;
  optInLevel: string;
  hasDraft: boolean;
}

/** Recorded average costs (EUR) for the Vorbereiten estimate; null = no data. */
export interface CampaignCostsProps {
  draftEur: number | null;
  heroEur: number | null;
}

/** Pure-DB delivery outcomes of the last `days` days („Gesendet“ strip). */
export interface CampaignSentSummaryProps {
  days: number;
  sent: number;
  tracked: number;
  clicked: number;
  delivered: number;
  bouncedHard: number;
  complained: number;
  unsubscribed: number;
}

/** Everything the server hands to the desk (KampagneTab → KampagneWorkspace). */
export interface CampaignDeskProps {
  counts: CampaignCountsProps;
  queue: CampaignQueueItemProps[];
  skipped: CampaignSkippedItemProps[];
  sendsApproved: boolean;
  allowSingleOptIn: boolean;
  shopifyConfigured: boolean;
  /** The campaign e-mail design has a hero slot (the „Hero“ block applies). */
  heroDesignActive: boolean;
  /** Human name of the campaign design, for the Hero block's label. */
  heroDesignName: string | null;
  heroGenerationConfigured: boolean;
  /** MARKETING_MIN_SEND_INTERVAL_DAYS (0 = no cap). */
  minSendIntervalDays: number;
  costs: CampaignCostsProps;
  sentSummary: CampaignSentSummaryProps | null;
  initialContactId: number | null;
  initialView: DeskView;
  initialFilter: QueueFilter;
}

/** Sizes offered by the Vorbereiten popover; the middle one is the default. */
export const PREPARE_OPTIONS = [25, 50, 100] as const;
export const PREPARE_TOTAL = 50;
export const PREPARE_CHUNK = 5;

/** What a card can be busy with. `regen` covers every chained regenerate. */
export type CardBusy =
  | "send"
  | "skip"
  | "regen"
  | "markdone"
  | "bundle"
  | "recs"
  | "selection"
  | "discount"
  | "language"
  | "hero";

/** One row of the Postausgang strip (sends in flight or just finished). */
export interface OutboxEntry {
  contactId: number;
  email: string;
  name: string;
  state: "sending" | "sent" | "failed";
  error?: string | null;
}

export function optInShort(level: string): string {
  switch (level) {
    case "CONFIRMED_OPT_IN":
      return "DOI";
    case "SINGLE_OPT_IN":
      return "Single-Opt-in";
    default:
      return "Unbekannt";
  }
}

export function contactName(c: {
  email: string;
  firstName: string | null;
  lastName: string | null;
}): string {
  return [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email;
}
