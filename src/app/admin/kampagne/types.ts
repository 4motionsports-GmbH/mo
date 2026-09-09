// Shared types + small pure helpers of the Kampagne screen (server tab → client
// workspace props, and the client-side state machine).

import type { EmailTextModeValue } from "../EmailTextModeToggle";

export type OptInFilter = "all" | "doi" | "soi";

export interface CampaignRecommendation {
  id: string;
  name: string;
  url: string | null;
}

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
}

export interface CampaignCountsProps {
  pending: number;
  drafted: number;
  sentTotal: number;
  sentToday: number;
  skipped: number;
  suppressed: number;
  draftFailed: number;
  byOptInLevel: Record<string, number>;
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

export const PREPARE_TOTAL = 50;
export const PREPARE_CHUNK = 5;

export type CampaignBusy =
  | null
  | "send"
  | "skip"
  | "regen"
  | "sync"
  | "prepare"
  | "markdone"
  | "bundle"
  | "recs"
  | "selection"
  | "discount"
  | "reset";

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
