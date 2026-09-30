"use client";

// Status vocabulary of the Kunden screen — one table per dimension so list rows,
// the detail header and filters never drift apart.

import { Check, Star } from "lucide-react";
import type { CustomerMarketingStatus, CustomerPurchaseState, CustomerSource } from "@/lib/customer-store";
import { ARCHETYPE_META } from "@/lib/persona";
import type { PersonaArchetype } from "@/lib/types";
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

export const SOURCE_META: Record<CustomerSource, { label: string; info: string }> = {
  chat: { label: "Chat", info: "Hat im Chat mit Mo die E-Mail hinterlassen." },
  shopify_account: { label: "Shopify-Konto", info: "Über die Anmeldung mit dem Shopify-Kundenkonto bekannt." },
  kampagne: { label: "Newsletter", info: "Newsletter-Abonnent aus Shopify (Kampagne) — noch nicht mit Mo gesprochen." },
};

/** Where the customer came from — shown for everyone who did not start in the chat. */
export function SourceBadge({ source }: { source: CustomerSource }) {
  if (source === "chat") return null;
  const meta = SOURCE_META[source];
  return (
    <Tooltip content={meta.info}>
      <StatusBadge tone="neutral" dot={false} tabIndex={0} className="cursor-help">
        {meta.label}
      </StatusBadge>
    </Tooltip>
  );
}

/** The profile's persona (short label), or nothing without one. */
export function PersonaBadge({ persona, size = "sm" }: { persona: string | null; size?: "sm" | "md" }) {
  const meta = persona ? ARCHETYPE_META[persona as PersonaArchetype] : null;
  if (!meta || meta.id === "unknown") return null;
  return (
    <Tooltip content={`Persona laut Kundenprofil: ${meta.label}`}>
      <StatusBadge tone="accent" dot={false} size={size} tabIndex={0} className="cursor-help">
        {meta.shortLabel}
      </StatusBadge>
    </Tooltip>
  );
}
