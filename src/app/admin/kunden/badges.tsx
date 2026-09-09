"use client";

// Status vocabulary of the Kunden screen — one table per dimension so list rows,
// the detail header and filters never drift apart.

import { Check, Star } from "lucide-react";
import type { CustomerMarketingStatus, CustomerPurchaseState } from "@/lib/customer-store";
import { StatusBadge, Tooltip, type StatusTone } from "../ui";

export const TIER_INFO: Record<1 | 2 | 3, string> = {
  1: "Tier 1 · anonym — nur eine Chat-Session, keine E-Mail hinterlassen.",
  2: "Tier 2 · E-Mail bekannt — im Chat mit Einwilligung hinterlassen.",
  3: "Tier 3 · angemeldet — mit dem Shopify-Kundenkonto verknüpft.",
};

export function TierBadge({ tier, size = "sm" }: { tier: 1 | 2 | 3; size?: "sm" | "md" }) {
  return (
    <Tooltip content={TIER_INFO[tier]}>
      <StatusBadge
        tone={tier === 3 ? "info" : "neutral"}
        dot={false}
        size={size}
        tabIndex={0}
        className="cursor-help"
      >
        Tier {tier}
      </StatusBadge>
    </Tooltip>
  );
}

export const MARKETING_STATUS_META: Record<
  CustomerMarketingStatus,
  { short: string | null; label: string; tone: StatusTone }
> = {
  none: { short: null, label: "Kein Marketing", tone: "neutral" },
  pending: { short: "DOI offen", label: "DOI ausstehend", tone: "warning" },
  confirmed: { short: "Marketing", label: "Marketing bestätigt", tone: "success" },
  unsubscribed: { short: "Abgemeldet", label: "Abgemeldet", tone: "destructive" },
};

export function MarketingStatusBadge({
  status,
  full = false,
  size = "sm",
}: {
  status: CustomerMarketingStatus;
  /** Long label (detail header) instead of the short list chip. */
  full?: boolean;
  size?: "sm" | "md";
}) {
  const meta = MARKETING_STATUS_META[status];
  if (!full && !meta.short) return null;
  return (
    <StatusBadge tone={meta.tone} size={size}>
      {full ? meta.label : meta.short}
    </StatusBadge>
  );
}

export function PurchaseBadge({
  state,
  marketingStatus,
}: {
  state: CustomerPurchaseState;
  marketingStatus: CustomerMarketingStatus;
}) {
  if (state === "purchased") {
    return (
      <StatusBadge tone="neutral" icon={<Check />}>
        gekauft
      </StatusBadge>
    );
  }
  if (state === "no_purchase" && marketingStatus === "confirmed") {
    return (
      <StatusBadge tone="accent" icon={<Star />}>
        nicht gekauft
      </StatusBadge>
    );
  }
  return null;
}

export function SendBadge({ state }: { state: "draft" | "sent" | "none" }) {
  if (state === "draft") return <StatusBadge tone="info">Entwurf</StatusBadge>;
  if (state === "sent") return <StatusBadge tone="success">Gesendet</StatusBadge>;
  return null;
}
