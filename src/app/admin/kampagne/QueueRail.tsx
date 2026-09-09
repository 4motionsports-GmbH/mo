"use client";

// Left rail of the queue view: the GLOBAL contact search (all statuses — pull
// anyone into the queue), the queue list (click to jump) and the restorable
// "Übersprungen" section.

import * as React from "react";
import { AlertTriangle } from "lucide-react";
import { num } from "@/lib/admin-format.mjs";
import { Button, Disclosure, EmptyState, SearchInput, Spinner, StatusBadge, Tooltip } from "../ui";
import { adminFetch } from "../lib/admin-fetch";
import {
  contactName,
  type CampaignContactHit,
  type CampaignQueueItemProps,
  type CampaignSkippedItemProps,
} from "./types";

export function QueueRail({
  items,
  currentContactId,
  skipped,
  busy,
  onJump,
  onUnskip,
  onDraft,
}: {
  items: CampaignQueueItemProps[];
  currentContactId: number | null;
  skipped: CampaignSkippedItemProps[];
  busy: boolean;
  onJump: (contactId: number) => void;
  onUnskip: (contactId: number) => void;
  onDraft: (contactId: number) => void;
}) {
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<CampaignContactHit[]>([]);
  const [searching, setSearching] = React.useState(false);
  const searchSeq = React.useRef(0);

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

  const statusAction = (c: CampaignContactHit) => {
    switch (c.status) {
      case "drafted":
        return (
          <Button variant="outline" size="xs" onClick={() => onJump(c.id)}>
            Öffnen
          </Button>
        );
      case "pending":
      case "draft_failed":
        return (
          <Button variant="outline" size="xs" disabled={busy} onClick={() => onDraft(c.id)}>
            Entwurf erstellen
          </Button>
        );
      case "skipped":
        return (
          <Button variant="outline" size="xs" disabled={busy} onClick={() => onUnskip(c.id)}>
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
    <div className="flex max-h-full flex-col gap-3 rounded-lg border border-border bg-card p-3 text-sm">
      <div>
        <SearchInput
          value={query}
          onValueChange={setQuery}
          placeholder="Alle Kontakte durchsuchen…"
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
                      <span className="block truncate text-xs font-medium">{contactName(c)}</span>
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

      <div className="min-h-0 flex-1">
        <div className="mb-1 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
          Warteschlange ({num(items.length)})
        </div>
        {items.length === 0 ? (
          <EmptyState plain compact title="Leer." />
        ) : (
          <ul className="max-h-[50vh] space-y-0.5 overflow-y-auto">
            {items.map((it, i) => {
              const active = it.contactId === currentContactId;
              return (
                <li key={it.contactId}>
                  <button
                    type="button"
                    onClick={() => onJump(it.contactId)}
                    aria-current={active ? "true" : undefined}
                    className={`flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-start text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
                      active ? "bg-accent-soft font-medium text-foreground" : "hover:bg-secondary/70"
                    }`}
                  >
                    <span className="w-5 shrink-0 tabular-nums text-muted-foreground">{i + 1}.</span>
                    <span className="min-w-0 flex-1 truncate">{contactName(it)}</span>
                    {it.optInLevel !== "CONFIRMED_OPT_IN" && (
                      <Tooltip content="Kein nachweisbares Double-Opt-in">
                        <span className="inline-flex shrink-0 text-warning" tabIndex={-1}>
                          <AlertTriangle className="size-3.5" aria-label="Kein nachweisbares Double-Opt-in" />
                        </span>
                      </Tooltip>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <Disclosure title="Übersprungen" meta={num(skipped.length)} framed={false}>
        {skipped.length === 0 ? (
          <div className="text-xs text-muted-foreground">Keine übersprungenen Kontakte.</div>
        ) : (
          <ul className="space-y-1">
            {skipped.map((s) => (
              <li
                key={s.contactId}
                className="flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1.5"
              >
                <span className="min-w-0 truncate text-xs">{contactName(s)}</span>
                <Button variant="outline" size="xs" disabled={busy} onClick={() => onUnskip(s.contactId)}>
                  Wiederherstellen
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Disclosure>
    </div>
  );
}
