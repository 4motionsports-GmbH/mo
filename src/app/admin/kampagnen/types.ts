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

/**
 * The „Kampagnenbild“ (campaigns.hero_image, 0079) — same shape as
 * CampaignHeroImage in lib/campaigns-store.ts: FILE NAMES under email-heroes/
 * (preview URLs via campaign-hero.mjs campaignHeroUrls(value, "")), the
 * operator's AI statement and display metadata. Staged by the upload route,
 * committed by „Speichern“.
 */
export interface CampaignHeroImageProps {
  v: 1;
  file: string;
  mobileFile: string;
  ai: boolean;
  name: string | null;
  width: number | null;
  height: number | null;
  uploadedAt: string | null;
}

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
  /** The Kampagnenbild, or null (the design's default picture). */
  heroImage: CampaignHeroImageProps | null;
  textMode: "detailed" | "compact" | "minimal" | null;
  moPromo: boolean;
  ctaKind: "mo_chat" | "shop";
  ctaUrl: string | null;
  letterMode: "aus" | "ohne_einwilligung" | "alle";
  letterBudgetCents: number | null;
  audienceRefreshedAt: string | null;
  stats: CampaignStatsProps;
}

/** One email design as the editor needs it; `hasHero` = it shows a Titelbild
 *  (registry emailDesignHasHero — today only „Performance“). */
export interface CampaignDesignOption {
  key: string;
  name: string;
  hasHero: boolean;
}

export interface CampaignEditorOptions {
  /** Designs a campaign can pick (non-classic, campaign-capable). */
  designs: CampaignDesignOption[];
  /** The design chosen in Einstellungen for campaigns — what „Wie in
   *  Einstellungen“ (designKey null) renders. */
  settingsDesign: CampaignDesignOption;
  /** Kampagnenbild upload: BLOB_READ_WRITE_TOKEN set; the design's default
   *  picture, shown while a campaign has none. */
  heroUpload: { configured: boolean; defaultUrl: string };
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
