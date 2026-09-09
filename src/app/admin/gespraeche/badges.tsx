"use client";

// Status vocabulary of the Gespräche screen — tier, outcome signals and the
// cached-analysis badges, one table each so list rows and the detail header
// never drift apart. Identity guardrail: a tier is a label, never a person.

import { AlertTriangle, Mail, ShoppingCart, Wrench } from "lucide-react";
import { ARCHETYPE_META } from "@/lib/persona";
import type { PersonaArchetype } from "@/lib/types";
import {
  TIER_LABELS,
  CATEGORY_LABELS,
  QUALITY_LABELS,
  QUALITY_IS_NEGATIVE,
} from "@/lib/conversation-analysis-core.mjs";
import type { AdminConversationListItem, AdminTier } from "@/lib/admin-conversations";
import { StatusBadge, Tooltip, type StatusTone } from "../ui";

export const TOOL_LABELS: Record<string, string> = {
  update_customer_profile: "Profil",
  search_products: "Suche",
  show_product: "Produkt",
  compare_products: "Vergleich",
  add_to_cart: "Warenkorb",
  suggest_showroom: "Showroom",
  show_contact_form: "Kontakt",
  offer_email_summary: "E-Mail",
};

const TIER_TONE: Record<AdminTier, StatusTone> = {
  anonymous: "neutral",
  "email-only": "info",
  "signed-in": "success",
};

const TIER_INFO: Record<AdminTier, string> = {
  anonymous: "Anonym — keine E-Mail hinterlassen, kein Kundenkonto.",
  "email-only": "E-Mail im Chat hinterlassen (mit Einwilligung), kein Kundenkonto.",
  "signed-in": "Mit dem Shopify-Kundenkonto angemeldet.",
};

export function personaLabel(label: string | null): string | null {
  if (!label) return null;
  const meta = ARCHETYPE_META[label as PersonaArchetype];
  return meta ? meta.shortLabel : label;
}

/** `interactive` adds the keyboard-reachable tooltip; off inside list buttons. */
export function TierBadge({
  tier,
  size = "sm",
  interactive = false,
}: {
  tier: AdminTier;
  size?: "sm" | "md";
  interactive?: boolean;
}) {
  const badge = (
    <StatusBadge
      tone={TIER_TONE[tier]}
      dot={false}
      size={size}
      tabIndex={interactive ? 0 : undefined}
      aria-label={interactive ? undefined : TIER_INFO[tier]}
    >
      {(TIER_LABELS as Record<string, string>)[tier] ?? tier}
    </StatusBadge>
  );
  if (!interactive) return badge;
  return <Tooltip content={TIER_INFO[tier]}>{badge}</Tooltip>;
}

type OutcomeFlags = Pick<
  AdminConversationListItem,
  "checkoutOffered" | "cartUsed" | "emailCaptured" | "toolsFired" | "noReply"
>;

export function OutcomeChips({
  item,
  size = "sm",
  interactive = false,
}: {
  item: OutcomeFlags;
  size?: "sm" | "md";
  interactive?: boolean;
}) {
  const chip = (tone: StatusTone, icon: React.ReactNode, label: string, explain: string) => {
    const badge = (
      <StatusBadge
        tone={tone}
        dot={false}
        icon={icon}
        size={size}
        tabIndex={interactive ? 0 : undefined}
        aria-label={interactive ? undefined : `${label} — ${explain}`}
      >
        {label}
      </StatusBadge>
    );
    return interactive ? <Tooltip content={explain}>{badge}</Tooltip> : badge;
  };
  const tools = item.toolsFired.map((t) => TOOL_LABELS[t] ?? t).join(", ");
  return (
    <span className="flex flex-wrap items-center gap-1">
      {item.noReply &&
        chip("destructive", <AlertTriangle />, "keine Antwort", "Kunde schrieb, aber Mo antwortete nicht")}
      {item.cartUsed &&
        chip("success", <ShoppingCart />, "Cart genutzt", "Warenkorb-/Checkout-Link geklickt")}
      {!item.cartUsed &&
        item.checkoutOffered &&
        chip("neutral", <ShoppingCart />, "Cart angeboten", "Warenkorb-Button angeboten (add_to_cart)")}
      {item.emailCaptured && chip("info", <Mail />, "E-Mail", "E-Mail erfasst")}
      {item.toolsFired.length > 0 &&
        chip("neutral", <Wrench />, `${item.toolsFired.length} Tool${item.toolsFired.length === 1 ? "" : "s"}`, tools)}
    </span>
  );
}

export function AnalysisBadges({
  category,
  quality,
  size = "sm",
}: {
  category: string | null;
  quality: string | null;
  size?: "sm" | "md";
}) {
  const catLabel = category ? ((CATEGORY_LABELS as Record<string, string>)[category] ?? category) : null;
  const negative = quality ? Boolean((QUALITY_IS_NEGATIVE as Record<string, boolean>)[quality]) : false;
  if (!catLabel && !quality) return null;
  return (
    <span className="flex flex-wrap items-center gap-1">
      {catLabel && (
        <StatusBadge tone="accent" dot={false} size={size}>
          {catLabel}
        </StatusBadge>
      )}
      {quality && (
        <StatusBadge tone={negative ? "warning" : "neutral"} dot={false} size={size}>
          {(QUALITY_LABELS as Record<string, string>)[quality] ?? quality}
        </StatusBadge>
      )}
    </span>
  );
}
