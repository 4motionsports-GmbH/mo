// Props of the Kampagnen overview + editor (server KampagneTab → client).

import type { DiscountScope } from "@/lib/discount-scope.mjs";

export type AudienceSpecProps = {
  v: 1;
  optInLevels?: string[];
  lifecycle?: string[];
  valueTier?: string[];
  churn?: string[];
  lastOrderDays?: { min?: number; max?: number };
  ordersCount?: { min?: number; max?: number };
  totalSpentEur?: { min?: number; max?: number };
  boughtAny?: string[];
  boughtNone?: string[];
  categories?: string[];
  persona?: string[];
  moContact?: "yes" | "no";
  language?: string[];
  country?: string[];
  shopifyTags?: string[];
  clickedWithinDays?: number;
  excludeMailedWithinDays?: number;
  excludeCampaignIds?: number[];
};

export interface CampaignStatsProps {
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

export interface CampaignCardProps {
  id: number;
  name: string;
  slug: string;
  kind: "laufend" | "aktion" | "einzel";
  status: "entwurf" | "aktiv" | "pausiert" | "beendet" | "archiviert";
  phase: string;
  brief: string | null;
  audience: AudienceSpecProps;
  audienceText: string;
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
  heroMode: "none" | "default" | "ai_ab" | "ai_all";
  textMode: "detailed" | "compact" | "minimal" | null;
  moPromo: boolean;
  ctaKind: "mo_chat" | "shop";
  ctaUrl: string | null;
  letterMode: "aus" | "ohne_einwilligung" | "alle";
  letterBudgetCents: number | null;
  audienceRefreshedAt: string | null;
  stats: CampaignStatsProps;
}

export interface CampaignEditorOptions {
  designs: Array<{ key: string; name: string }>;
  personas: Array<{ key: string; label: string }>;
  categories: string[];
  maxDiscountPercent: number;
  autoPrepareBudget: number;
  /** Recorded average cost of a draft / a per-contact AI hero, EUR (null = none yet). */
  costs: { draftEur: number | null; heroEur: number | null };
  /** Letters as a channel (0074): PHYSICAL_MAIL_SENDS_APPROVED + Pingen configured, assumed postage. */
  letters: { sendsApproved: boolean; pingenConfigured: boolean; costCents: number };
}

export interface CampaignsOverviewProps {
  campaigns: CampaignCardProps[];
  options: CampaignEditorOptions;
  /** Open the editor for this campaign on load (`?edit=<id>`); "new" = create. */
  initialEdit: number | "new" | null;
  /** `?edit=new&audience=<json>` — a new campaign starts with this audience (Kunden „Ähnliche Kunden“). */
  presetAudience?: Record<string, unknown> | null;
  sendsApproved: boolean;
  notFound?: boolean;
}
