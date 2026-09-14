"use client";

// Left rail of the desk: the GLOBAL contact search (`/`, all statuses — pull
// anyone into the queue), the filter chips with counts, the queue rows (name,
// kind chips, edit mark, verdict dot — triage from the list), the Postausgang
// strip (sends on their way) and the restorable „Übersprungen“ section.

import * as React from "react";
import { AlertTriangle, Check, RotateCw, X } from "lucide-react";
import { num } from "@/lib/admin-format.mjs";
import { campaignSegmentByKey } from "@/lib/campaign-segments.mjs";
import { QUEUE_FILTERS } from "@/lib/campaign-desk-core.mjs";
import {
  Button,
  Disclosure,
  EmptyState,
  IconButton,
  SearchInput,
  Spinner,
  StatusBadge,
  Tooltip,
  cn,
} from "../ui";
import { adminFetch } from "../lib/admin-fetch";
import {
  contactName,
  type CampaignContactHit,
  type CampaignQueueItemProps,
  type CampaignSkippedItemProps,
  type OutboxEntry,
  type QueueFilter,
} from "./types";
import type { ReviewVerdict } from "./useCampaignActions";

export const RAIL_SEARCH_ID = "ms-campaign-search";

const DOT: Record<ReviewVerdict, { className: string; label: string }> = {
  ready: { className: "bg-success", label: "Bereit" },
  hints: { className: "bg-warning", label: "Hinweise" },
  blocked: { className: "bg-destructive", label: "Blockiert" },
};

/** The kind chips of a row — only what deviates from the default. */
function rowChips(it: CampaignQueueItemProps): string[] {
  const chips: string[] = [];
  if (it.isTest) chips.push("Test");
  if (it.language === "en") chips.push("EN");
  const seg = it.segment ? campaignSegmentByKey(it.segment) : null;
  if (seg && seg.key !== "unbekannt") chips.push(seg.label);
  if (it.discountPercent > 0) chips.push(`${it.discountPercent} %`);
  if (it.bundle) chips.push("Set");
  if (it.heroUrl) chips.push("Hero");
  return chips;
}

export function QueueRail({
  items,
  currentContactId,
  filter,
  filterCounts,
  verdictOf,
  busyIds,
  outbox,
  skipped,
  restoring,
  onFilter,
  onSelect,
  onUnskip,
  onDraft,
  onRetrySend,
  onDismissOutbox,
}: {
  items: CampaignQueueItemProps[];
  currentContactId: number | null;
  filter: QueueFilter;
  filterCounts: Record<string, number>;
  verdictOf: (item: CampaignQueueItemProps) => ReviewVerdict;
  busyIds: Record<number, string>;
  outbox: OutboxEntry[];
  skipped: CampaignSkippedItemProps[];
  restoring: Set<number>;
  onFilter: (filter: QueueFilter) => void;
  onSelect: (contactId: number) => void;
  onUnskip: (contactId: number) => void;
  onDraft: (contactId: number) => void;
  onRetrySend: (contactId: number) => void;
  onDismissOutbox: (contactId: number) => void;
}) {
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<CampaignContactHit[]>([]);
  const [searching, setSearching] = React.useState(false);
  const searchSeq = React.useRef(0);
  const listRef = React.useRef<HTMLUListElement | null>(null);

  // Search-as-you-type over ALL campaign contacts (any status), debounced;
  // results clear below 2 chars.
  React.useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      searchSeq.current++;
      setResults([]);
      setSearching(false);
      return;
    }
    const seq = ++searchSeq.current;
    setSearching(true);
    const handle = setTimeout(async () => {
      try {
        const json = await adminFetch<{ contacts?: CampaignContactHit[] }>(
          "/api/admin/campaign/contacts",
          { body: { query: q } }
        );
        if (seq !== searchSeq.current) return;
        setResults(json.contacts ?? []);
      } catch {
        // Non-fatal: an empty result list; the next keystroke retries.
        if (seq === searchSeq.current) setResults([]);
      } finally {
        if (seq === searchSeq.current) setSearching(false);
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [query]);

  // Keep the active row in view when the selection moves by keyboard.
  React.useEffect(() => {
    if (currentContactId === null) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-contact="${currentContactId}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [currentContactId]);

  const statusAction = (c: CampaignContactHit) => {
    const pending = restoring.has(c.id);
    switch (c.status) {
      case "drafted":
        return (
          <Button
            variant="outline"
            size="xs"
            onClick={() => {
              onSelect(c.id);
              setQuery("");
            }}
          >
            Öffnen
          </Button>
        );
      case "pending":
      case "draft_failed":
        return (
          <Button variant="outline" size="xs" loading={pending} onClick={() => onDraft(c.id)}>
            Entwurf erstellen
          </Button>
        );
      case "skipped":
        return (
          <Button variant="outline" size="xs" loading={pending} onClick={() => onUnskip(c.id)}>
            Wiederherstellen
          </Button>
        );
      case "sent":
        return <StatusBadge tone="success">Gesendet</StatusBadge>;
      case "suppressed":
        return <StatusBadge tone="warning">Unterdrückt</StatusBadge>;
      default:
        return <StatusBadge tone="neutral">{c.status}</StatusBadge>;
    }
  };

  const showResults = query.trim().length >= 2;

  return (
    <div className="flex min-h-0 flex-col rounded-lg border border-border bg-card text-sm lg:h-full">
      {/* Search */}
      <div className="border-b border-border p-2">
        <SearchInput
          id={RAIL_SEARCH_ID}
          value={query}
          onValueChange={setQuery}
          placeholder="Kontakt suchen…"
          shortcut="/"
          size="sm"
          aria-label="Alle Kampagnen-Kontakte durchsuchen"
        />
        {showResults && (
          <div className="mt-1.5">
            {searching ? (
              <div className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
                <Spinner size="xs" /> Sucht…
              </div>
            ) : results.length === 0 ? (
              <div className="px-1 text-xs text-muted-foreground">Keine Treffer.</div>
            ) : (
              <ul className="space-y-1">
                {results.map((c) => (
                  <li
                    key={c.id}
                    className="flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1.5"
                  >
                    <span className="min-w-0">
                      <span className="flex items-center gap-1 text-xs font-medium">
                        <span className="truncate">{contactName(c)}</span>
                        {c.isTest && (
                          <StatusBadge tone="accent" dot={false}>
                            Test
                          </StatusBadge>
                        )}
                      </span>
                      <span className="block truncate text-2xs text-muted-foreground">{c.email}</span>
                    </span>
                    {statusAction(c)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* Filter chips */}
      <div
        role="radiogroup"
        aria-label="Warteschlange filtern"
        className="flex flex-wrap gap-1 border-b border-border px-2 py-1.5"
      >
        {QUEUE_FILTERS.map((f) => {
          const count = filterCounts[f.key] ?? 0;
          const active = filter === f.key;
          return (
            <button
              key={f.key}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onFilter(f.key)}
              className={cn(
                "inline-flex h-6 items-center gap-1 rounded-md border px-1.5 text-2xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active
                  ? "border-accent/40 bg-accent-soft text-accent"
                  : "border-border bg-card text-muted-foreground hover:bg-secondary hover:text-foreground",
                !active && count === 0 && f.key !== "all" && "opacity-50"
              )}
            >
              {f.label}
              <span className="tabular-nums opacity-80">{num(count)}</span>
            </button>
          );
        })}
      </div>

      {/* Queue */}
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-between px-3 pb-1 pt-2 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
          <span>Warteschlange</span>
          <span className="tabular-nums">{num(items.length)}</span>
        </div>
        {items.length === 0 ? (
          <div className="px-2 pb-2">
            <EmptyState plain compact title={filter === "all" ? "Leer." : "Nichts in diesem Filter."} />
          </div>
        ) : (
          <ul ref={listRef} className="min-h-0 flex-1 space-y-px overflow-y-auto px-1.5 pb-2">
            {items.map((it, i) => {
              const active = it.contactId === currentContactId;
              const verdict = verdictOf(it);
              const dot = DOT[verdict];
              const chips = rowChips(it);
              const busy = busyIds[it.contactId];
              return (
                <li key={it.contactId}>
                  <button
                    type="button"
                    data-contact={it.contactId}
                    onClick={() => onSelect(it.contactId)}
                    aria-current={active ? "true" : undefined}
                    className={cn(
                      "flex w-full flex-col gap-0.5 rounded-md px-2 py-1 text-start text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                      active ? "bg-accent-soft text-foreground" : "hover:bg-secondary/70"
                    )}
                  >
                    <span className="flex w-full items-center gap-1.5">
                      <span className="w-5 shrink-0 tabular-nums text-muted-foreground">{i + 1}</span>
                      <span className={cn("min-w-0 flex-1 truncate", active && "font-medium")}>
                        {contactName(it)}
                      </span>
                      {it.edited && (
                        <span className="shrink-0 text-muted-foreground" aria-label="Manuell bearbeitet">
                          ✎
                        </span>
                      )}
                      {busy ? (
                        <Spinner size="xs" label="In Arbeit" />
                      ) : (
                        <span
                          className={cn("size-2 shrink-0 rounded-full", dot.className)}
                          role="img"
                          aria-label={dot.label}
                        />
                      )}
                    </span>
                    {chips.length > 0 && (
                      <span className="block truncate pl-[1.625rem] text-2xs text-muted-foreground">
                        {chips.join(" · ")}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Postausgang */}
      {outbox.length > 0 && (
        <div className="border-t border-border px-2 py-1.5">
          <div className="flex items-center justify-between px-1 pb-1 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
            <span>Postausgang</span>
            <span className="tabular-nums">{num(outbox.length)}</span>
          </div>
          <ul className="space-y-0.5">
            {outbox.map((e) => (
              <li
                key={e.contactId}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs",
                  e.state === "failed" && "bg-destructive/10"
                )}
              >
                {e.state === "sending" ? (
                  <Spinner size="xs" label="Wird gesendet" />
                ) : e.state === "sent" ? (
                  <Check className="size-3.5 shrink-0 text-success" aria-label="Gesendet" />
                ) : (
                  <AlertTriangle className="size-3.5 shrink-0 text-destructive" aria-label="Fehlgeschlagen" />
                )}
                <span className="min-w-0 flex-1 truncate">
                  {e.name}
                  <span className="text-muted-foreground">
                    {e.state === "sending" ? " · sendet…" : e.state === "sent" ? " · gesendet" : ""}
                  </span>
                </span>
                {e.state === "failed" && (
                  <>
                    <Tooltip content={e.error ?? "Versand fehlgeschlagen"}>
                      <IconButton
                        label="Erneut senden"
                        size="icon-sm"
                        tooltip={false}
                        onClick={() => onRetrySend(e.contactId)}
                      >
                        <RotateCw />
                      </IconButton>
                    </Tooltip>
                    <IconButton
                      label="Aus dem Postausgang entfernen"
                      size="icon-sm"
                      tooltip={false}
                      onClick={() => onDismissOutbox(e.contactId)}
                    >
                      <X />
                    </IconButton>
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Übersprungen */}
      <div className="border-t border-border px-3 py-1">
        <Disclosure title="Übersprungen" meta={num(skipped.length)} framed={false}>
          {skipped.length === 0 ? (
            <div className="text-xs text-muted-foreground">Keine übersprungenen Kontakte.</div>
          ) : (
            <ul className="max-h-40 space-y-1 overflow-y-auto">
              {skipped.map((s) => (
                <li
                  key={s.contactId}
                  className="flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1"
                >
                  <span className="flex min-w-0 items-center gap-1 text-xs">
                    <span className="truncate">{contactName(s)}</span>
                    {s.isTest && (
                      <StatusBadge tone="accent" dot={false}>
                        Test
                      </StatusBadge>
                    )}
                  </span>
                  <Button
                    variant="outline"
                    size="xs"
                    loading={restoring.has(s.contactId)}
                    onClick={() => onUnskip(s.contactId)}
                  >
                    Wiederherstellen
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Disclosure>
      </div>
    </div>
  );
}
