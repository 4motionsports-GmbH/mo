"use client";

// Status vocabulary of the Kampagne review card: language switch, opt-in,
// lifecycle segment and the hero A/B group — one table each, explained via
// tooltips instead of native title attributes.

import { AlertTriangle, PenLine } from "lucide-react";
import { campaignSegmentByKey } from "@/lib/campaign-segments.mjs";
import { num } from "@/lib/admin-format.mjs";
import { SegmentedControl, StatusBadge, Tooltip } from "../ui";
import { optInShort } from "./types";

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

/** The hero A/B group — a deterministic split by contact id so the KPI screen's
 * hero comparison gets both arms: even ids ship WITH a generated hero, odd ids
 * WITHOUT. Advisory; the send record stamps what actually shipped. */
export function AbGroupBadge({ contactId }: { contactId: number }) {
  const withHero = contactId % 2 === 0;
  return (
    <Tooltip content="A/B-Test für den KI-Hero: gerade Kontakt-IDs mit Hero senden, ungerade ohne — der KPI-Bereich vergleicht beide Gruppen.">
      <StatusBadge tone={withHero ? "info" : "neutral"} dot={false} tabIndex={0} className="cursor-help">
        {withHero ? "A/B: mit KI-Hero" : "A/B: ohne Hero"}
      </StatusBadge>
    </Tooltip>
  );
}

export function LowConfidenceBadge() {
  return (
    <Tooltip content="Die Empfehlungen basieren auf wenig Kaufkontext — bitte prüfen oder die Empfehlungsbasis anpassen.">
      <StatusBadge tone="warning" icon={<AlertTriangle />} tabIndex={0} className="cursor-help">
        Empfehlungen unsicher
      </StatusBadge>
    </Tooltip>
  );
}
