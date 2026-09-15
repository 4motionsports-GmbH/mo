"use client";

// Status vocabulary of the Kampagne desk: language switch, opt-in and
// lifecycle segment — one table each, explained via tooltips instead of
// native title attributes. (A/B group and low confidence are Prüfpunkte /
// Kontakt facts on the desk.)

import { PenLine } from "lucide-react";
import { campaignSegmentByKey } from "@/lib/campaign-segments.mjs";
import { OFFER_EXPIRING_SOON_HOURS, offerValidity, offerValidityLabel } from "@/lib/campaign-desk-core.mjs";
import { num } from "@/lib/admin-format.mjs";
import { ADMIN_DATE_TIME_SHORT, formatAdmin } from "@/lib/admin-datetime.mjs";
import { SegmentedControl, StatusBadge, Tooltip } from "../ui";
import { optInShort, type CampaignHistoryItemProps } from "./types";

/**
 * How long a sent offer (code, set — the earlier deadline) is still valid:
 * warning badge within the reminder window (OFFER_EXPIRING_SOON_HOURS), a
 * muted „noch 6 Tage" beyond it, „Abgelaufen" after, „—" without an offer.
 * The tooltip names what expires and the exact moment.
 */
export function OfferValidityBadge({ send }: { send: Pick<CampaignHistoryItemProps, "discountCode" | "discountExpiresAt" | "bundleExpiresAt"> }) {
  const v = offerValidity(send);
  if (v.state === "none") return <span className="text-muted-foreground">—</span>;
  const what = v.kinds.map((k) => (k === "discount" ? "Code" : "Set")).join(" + ");
  const detail = `${what} · bis ${formatAdmin(v.expiresAt, ADMIN_DATE_TIME_SHORT)}${
    v.state === "soon" ? ` · endet innerhalb von ${num(OFFER_EXPIRING_SOON_HOURS)} Std. — Zeit für eine Erinnerung` : ""
  }`;
  const label = offerValidityLabel(v);
  return (
    <Tooltip content={detail}>
      {v.state === "soon" ? (
        <StatusBadge tone="warning" tabIndex={0}>
          {label}
        </StatusBadge>
      ) : v.state === "expired" ? (
        <StatusBadge tone="neutral" dot={false} tabIndex={0}>
          {label}
        </StatusBadge>
      ) : (
        <span tabIndex={0} className="text-muted-foreground tabular-nums">
          {label}
        </span>
      )}
    </Tooltip>
  );
}

/** DE/EN switch for the card's email language. Shows the EFFECTIVE language
 * (normally derived from the Shopify profile — see campaign-language.mjs);
 * picking the other one pins it per contact and regenerates the text. */
export function LanguageToggle({
  language,
  overridden,
  disabled,
  onSelect,
}: {
  language: "de" | "en";
  overridden: boolean;
  disabled: boolean;
  onSelect: (language: "de" | "en") => void;
}) {
  return (
    <Tooltip
      content={
        overridden
          ? "Sprache manuell festgelegt (Sync ändert sie nicht mehr)."
          : "Sprache aus dem Shopify-Profil abgeleitet — Klick legt sie manuell fest und generiert den Text neu."
      }
    >
      <span className="inline-flex items-center gap-1">
        <SegmentedControl
          label="Sprache der E-Mail"
          value={language}
          onChange={onSelect}
          disabled={disabled}
          options={[
            { value: "de", label: "DE" },
            { value: "en", label: "EN" },
          ]}
        />
        {overridden && <PenLine className="size-3 text-muted-foreground" aria-label="Manuell festgelegt" />}
      </span>
    </Tooltip>
  );
}

export function OptInBadge({ level, blocked }: { level: string; blocked: boolean }) {
  if (level === "CONFIRMED_OPT_IN") {
    return <StatusBadge tone="success">Double-Opt-in</StatusBadge>;
  }
  return (
    <StatusBadge tone="warning">
      {optInShort(level)}
      {blocked ? " · Senden blockiert" : ""}
    </StatusBadge>
  );
}

/** Which lifecycle segment this draft was written for, and how old the purchase
 * was when it was written (see docs/REPURCHASE_ANALYSIS.md). */
export function SegmentBadge({ segment, days }: { segment: string | null; days: number | null }) {
  if (!segment) return null;
  const def = campaignSegmentByKey(segment);
  if (!def) return null;
  const age =
    typeof days === "number" && Number.isFinite(days) ? ` · vor ${num(Math.round(days))} T.` : "";
  return (
    <Tooltip content={def.reason}>
      <StatusBadge tone={def.sendable ? "neutral" : "warning"} dot={false} tabIndex={0} className="cursor-help">
        {def.label}
        {age}
      </StatusBadge>
    </Tooltip>
  );
}
