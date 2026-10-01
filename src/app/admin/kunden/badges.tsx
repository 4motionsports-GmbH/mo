"use client";

// Status vocabulary of the Kunden screen — one table per dimension so list rows,
// the detail header and filters never drift apart.

import { MessageCircle, ShoppingBag } from "lucide-react";
import type { CustomerSource } from "@/lib/customer-store";
import { ARCHETYPE_META } from "@/lib/persona";
import type { PersonaArchetype } from "@/lib/types";
import { SEGMENT_LABELS } from "@/lib/admin-customer-filter.mjs";
import { StatusBadge, Tooltip, type StatusTone } from "../ui";

export const TIER_INFO: Record<1 | 2 | 3, string> = {
  1: "Tier 1 · anonym — nur eine Chat-Session, keine E-Mail hinterlassen.",
  2: "Tier 2 · E-Mail bekannt — im Chat mit Einwilligung hinterlassen.",
  3: "Tier 3 · angemeldet — mit dem Shopify-Kundenkonto verknüpft.",
};

export function TierBadge({ tier, size = "sm" }: { tier: 1 | 2 | 3; size?: "sm" | "md" }) {
  return (
    <Tooltip content={TIER_INFO[tier]}>
      <StatusBadge tone={tier === 3 ? "info" : "neutral"} dot={false} size={size} tabIndex={0} className="cursor-help">
        Tier {tier}
      </StatusBadge>
    </Tooltip>
  );
}

export type ConsentStateKey = "subscribed" | "pending" | "unsubscribed" | "not_subscribed";

export const CONSENT_META: Record<ConsentStateKey, { short: string; label: string; tone: StatusTone }> = {
  subscribed: { short: "Einwilligung", label: "Angemeldet für E-Mail-Werbung", tone: "success" },
  pending: { short: "Bestätigung offen", label: "Bestätigung ausstehend (Double-Opt-in)", tone: "warning" },
  unsubscribed: { short: "Abgemeldet", label: "Von E-Mail-Werbung abgemeldet", tone: "destructive" },
  not_subscribed: { short: "Ohne Einwilligung", label: "Keine Einwilligung für E-Mail-Werbung", tone: "neutral" },
};

const BLOCK_LABELS: Record<string, string> = {
  bounce: "Adresse unzustellbar",
  complaint: "Spam-Beschwerde",
  erasure: "Gelöscht",
};

/** The one e-mail consent (Shopify + Mo); a hard block wins. */
export function ConsentBadge({
  state,
  blockReason,
  full = false,
  size = "sm",
}: {
  state: ConsentStateKey;
  blockReason?: string | null;
  full?: boolean;
  size?: "sm" | "md";
}) {
  if (blockReason) {
    return (
      <StatusBadge tone="destructive" size={size}>
        {BLOCK_LABELS[blockReason] ?? "Gesperrt"}
      </StatusBadge>
    );
  }
  const meta = CONSENT_META[state] ?? CONSENT_META.not_subscribed;
  if (!full && state === "not_subscribed") return null;
  return (
    <StatusBadge tone={meta.tone} size={size}>
      {full ? meta.label : meta.short}
    </StatusBadge>
  );
}

/** Talked to Mo (n chats) vs. never. */
export function MoBadge({ conversations }: { conversations: number }) {
  if (conversations <= 0) return null;
  return (
    <Tooltip content={`${conversations} ${conversations === 1 ? "Gespräch" : "Gespräche"} mit Mo`}>
      <StatusBadge tone="accent" dot={false} icon={<MessageCircle />} tabIndex={0} className="cursor-help">
        Mo{conversations > 1 ? ` ${conversations}×` : ""}
      </StatusBadge>
    </Tooltip>
  );
}

/** Shopify customer vs. Mo-only lead. */
export function ShopBadge({ isShopify }: { isShopify: boolean }) {
  return isShopify ? (
    <Tooltip content="Kunde im Shopify-Shop">
      <StatusBadge tone="neutral" dot={false} icon={<ShoppingBag />} tabIndex={0} className="cursor-help">
        Shop
      </StatusBadge>
    </Tooltip>
  ) : (
    <Tooltip content="Interessent — hat mit Mo gesprochen, ist aber (noch) kein Shopify-Kunde">
      <StatusBadge tone="info" dot={false} tabIndex={0} className="cursor-help">
        Interessent
      </StatusBadge>
    </Tooltip>
  );
}

const SEGMENT_TONE: Record<string, StatusTone> = {
  frisch: "info",
  ausbauen_frueh: "success",
  ausbauen: "success",
  weiterentwickeln: "accent",
  zurueckholen: "warning",
  ruhen: "neutral",
};

export function SegmentBadge({ segment }: { segment: string | null }) {
  if (!segment) return null;
  return (
    <StatusBadge tone={SEGMENT_TONE[segment] ?? "neutral"} dot={false}>
      {SEGMENT_LABELS[segment as keyof typeof SEGMENT_LABELS] ?? segment}
    </StatusBadge>
  );
}

export const VALUE_LABELS: Record<string, string> = {
  klein: "Kleinteile",
  komponente: "Komponenten",
  grossgeraet: "Großgeräte",
};

export const CHURN_LABELS: Record<string, string> = { niedrig: "niedrig", mittel: "mittel", hoch: "hoch" };

export function ChurnBadge({ risk }: { risk: string | null }) {
  if (risk !== "hoch" && risk !== "mittel") return null;
  return (
    <Tooltip content={`Abwanderungsrisiko ${risk} — gemessen am persönlichen Kaufrhythmus`}>
      <StatusBadge tone={risk === "hoch" ? "destructive" : "warning"} tabIndex={0} className="cursor-help">
        Abwanderung {risk}
      </StatusBadge>
    </Tooltip>
  );
}

export const SOURCE_META: Record<CustomerSource, { label: string; info: string }> = {
  chat: { label: "Chat", info: "Zuerst im Chat mit Mo bekannt geworden." },
  shopify: { label: "Shopify", info: "Aus dem Shopify-Kundenstamm übernommen." },
  shopify_account: { label: "Shopify-Konto", info: "Über die Anmeldung mit dem Shopify-Kundenkonto bekannt." },
  kampagne: { label: "Newsletter", info: "Newsletter-Abonnent aus Shopify." },
};

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
