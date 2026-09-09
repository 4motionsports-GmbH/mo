"use client";

// Filter bar of the Gespräche screen. Search applies on Enter (it spans ALL
// chats and bypasses the date window — one server round trip per search, not
// per keystroke); everything else navigates immediately. State lives in the
// URL (g* params) — the workspace hands us the resolved filter and a `go`.

import * as React from "react";
import { CATEGORY_LABELS, QUALITY_LABELS } from "@/lib/conversation-analysis-core.mjs";
import type { AdminTier } from "@/lib/admin-conversations";
import {
  Button,
  Checkbox,
  FilterBar,
  FilterChip,
  FilterGroup,
  InfoTip,
  Input,
  SearchInput,
  SegmentedControl,
  Select,
} from "../ui";
import type { ConversationFilterState } from "./types";

type PresetKey = "7d" | "30d" | "90d" | "custom";
const PRESETS: ReadonlyArray<{ value: PresetKey; label: string }> = [
  { value: "7d", label: "7 Tage" },
  { value: "30d", label: "30 Tage" },
  { value: "90d", label: "90 Tage" },
  { value: "custom", label: "Zeitraum…" },
];

const SELECT_CLASS = "h-8 w-auto min-w-[8rem] py-0 pr-8 text-xs";

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

export function ConversationFilters({
  filter,
  pending,
  activeCount,
  go,
  onReset,
  end,
}: {
  filter: ConversationFilterState;
  pending: boolean;
  activeCount: number;
  go: (next: Partial<ConversationFilterState>) => void;
  onReset: () => void;
  end?: React.ReactNode;
}) {
  const [showCustom, setShowCustom] = React.useState(filter.preset === "custom");
  const [cFrom, setCFrom] = React.useState(filter.from);
  const [cTo, setCTo] = React.useState(filter.to);
  // Local draft of the search input — applied on Enter, so typing doesn't fire
  // a server re-render per keystroke.
  const [qDraft, setQDraft] = React.useState(filter.q ?? "");

  React.useEffect(() => {
    setCFrom(filter.from);
    setCTo(filter.to);
    setShowCustom(filter.preset === "custom");
  }, [filter.from, filter.to, filter.preset]);
  React.useEffect(() => {
    setQDraft(filter.q ?? "");
  }, [filter.q]);

  const customValid = Boolean(cFrom && cTo && cFrom <= cTo);
  const applySearch = () => {
    const q = qDraft.trim();
    if ((q || null) === filter.q) return;
    go({ q: q.length > 0 ? q : null, page: 1 });
  };

  return (
    <div className="flex flex-col gap-2">
      <FilterBar activeCount={activeCount} onReset={onReset} end={end}>
        <SearchInput
          id="gespraeche-search"
          value={qDraft}
          onValueChange={(v) => {
            setQDraft(v);
            if (v === "" && filter.q) go({ q: null, page: 1 });
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              applySearch();
            }
          }}
          onBlur={applySearch}
          placeholder="Alle Gespräche durchsuchen — Wörter, Namen, IDs, E-Mail, Tags …"
          aria-label="Gespräche durchsuchen"
          size="sm"
          containerClassName="w-full sm:w-80"
          disabled={pending}
        />
        <SegmentedControl
          label="Zeitraum"
          value={filter.preset as PresetKey}
          options={PRESETS}
          disabled={pending}
          onChange={(value) => {
            if (value === "custom") {
              setShowCustom(true);
              return;
            }
            setShowCustom(false);
            go({ preset: value, page: 1 });
          }}
        />
        <FilterGroup label="Tier" htmlFor="gespraeche-tier">
          <Select
            id="gespraeche-tier"
            value={filter.tier ?? ""}
            disabled={pending}
            className={SELECT_CLASS}
            onChange={(e) => go({ tier: (e.target.value || null) as AdminTier | null, page: 1 })}
          >
            <option value="">Alle</option>
            <option value="anonymous">Anonym</option>
            <option value="email-only">E-Mail</option>
            <option value="signed-in">Angemeldet</option>
          </Select>
        </FilterGroup>
        <FilterGroup label="Kategorie" htmlFor="gespraeche-category">
          <Select
            id="gespraeche-category"
            value={filter.category ?? ""}
            disabled={pending}
            className={SELECT_CLASS}
            onChange={(e) => go({ category: e.target.value || null, page: 1 })}
          >
            <option value="">Alle</option>
            {Object.entries(CATEGORY_LABELS as Record<string, string>).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </Select>
        </FilterGroup>
        <FilterGroup label="Qualität" htmlFor="gespraeche-quality">
          <Select
            id="gespraeche-quality"
            value={filter.quality ?? ""}
            disabled={pending}
            className={SELECT_CLASS}
            onChange={(e) => go({ quality: e.target.value || null, page: 1 })}
          >
            <option value="">Alle</option>
            {Object.entries(QUALITY_LABELS as Record<string, string>).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </Select>
        </FilterGroup>
        <label className="flex h-8 items-center gap-1.5 text-xs text-muted-foreground">
          {/* Uncontrolled + keyed: the box flips immediately, the server value
              re-seeds it after the navigation. */}
          <Checkbox
            key={String(filter.hasError)}
            defaultChecked={filter.hasError}
            disabled={pending}
            onChange={(e) => go({ hasError: e.target.checked, page: 1 })}
          />
          nur ohne Bot-Antwort
        </label>
      </FilterBar>

      {(filter.q || showCustom) && (
        <div className="flex flex-wrap items-center gap-2">
          {filter.q && (
            <>
              <FilterChip onRemove={() => go({ q: null, page: 1 })} removeLabel="Suche zurücksetzen">
                Suche: „{filter.q}“ · alle Zeiträume
              </FilterChip>
              <InfoTip label="Wie die Suche arbeitet">
                Suche nach „{filter.q}“ über <strong>alle</strong> Gespräche — der Zeitraum wird
                ignoriert. Jeder Begriff muss vorkommen: in Nachrichten, IDs, Persona, Analyse
                (Zusammenfassung, Kategorie, Tags) oder der E-Mail / Shopify-Kundennummer der
                verknüpften Person.
              </InfoTip>
            </>
          )}
          {showCustom && (
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1 text-2xs text-muted-foreground">
                Von
                <Input
                  type="date"
                  value={cFrom}
                  max={cTo || todayYmd()}
                  onChange={(e) => setCFrom(e.target.value)}
                  className="h-8 w-auto text-xs"
                />
              </label>
              <label className="flex flex-col gap-1 text-2xs text-muted-foreground">
                Bis
                <Input
                  type="date"
                  value={cTo}
                  min={cFrom}
                  max={todayYmd()}
                  onChange={(e) => setCTo(e.target.value)}
                  className="h-8 w-auto text-xs"
                />
              </label>
              <Button
                size="sm"
                variant="secondary"
                disabled={pending || !customValid}
                onClick={() => go({ preset: "custom", from: cFrom, to: cTo, page: 1 })}
              >
                Anwenden
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
