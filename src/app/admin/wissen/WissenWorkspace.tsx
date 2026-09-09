"use client";

// Client workspace for the "Wissen" tab — the Q&A review queue as a compact
// list: one row per entry (status, question, product, age), one entry expanded
// at a time into the editor (./QaEntryEditor). Toolbar: search over the
// entries, status tabs with counts, "Gespräche scannen" (the only token spend
// here — explicit click) and reload. j/k move the expanded entry, Esc closes.

import * as React from "react";
import { ChevronRight, RefreshCw, Sparkles, BookOpen } from "lucide-react";
import type { QaCounts, QaEntry, QaStatus } from "@/lib/qa-store";
import { ADMIN_DATE_PADDED, formatAdmin } from "@/lib/admin-datetime.mjs";
import { num } from "@/lib/admin-format.mjs";
import {
  Button,
  EmptyState,
  FilterBar,
  IconButton,
  InfoTip,
  Kbd,
  SearchInput,
  Tabs,
  TabsList,
  TabsTrigger,
  cn,
} from "../ui";
import { QaProductBadge, QaStatusBadge } from "./badges";
import { QaEntryEditor } from "./QaEntryEditor";
import { SCAN_BATCH, useQaQueue } from "./useQaQueue";

type StatusFilter = QaStatus | "all";

const FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: "open", label: "Offen" },
  { value: "answered", label: "Beantwortet" },
  { value: "published", label: "Veröffentlicht" },
  { value: "dismissed", label: "Verworfen" },
  { value: "all", label: "Alle" },
];

function matches(entry: QaEntry, q: string): boolean {
  if (!q) return true;
  const hay = [entry.question, entry.gapSummary, entry.productTitle, entry.productId, entry.answer]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => hay.includes(term));
}

export function WissenWorkspace({
  initialEntries,
  initialCounts,
  initialScanCandidates,
}: {
  initialEntries: QaEntry[];
  initialCounts: QaCounts;
  initialScanCandidates: number;
}) {
  const queue = useQaQueue({
    entries: initialEntries,
    counts: initialCounts,
    scanCandidates: initialScanCandidates,
  });
  const [filter, setFilter] = React.useState<StatusFilter>("open");
  const [query, setQuery] = React.useState("");
  const [expandedId, setExpandedId] = React.useState<number | null>(null);

  const q = query.trim();
  const visible = queue.entries.filter((e) => (filter === "all" || e.status === filter) && matches(e, q));
  const total = queue.counts.open + queue.counts.answered + queue.counts.published + queue.counts.dismissed;

  // j / k move the expanded entry through the visible list, Esc collapses.
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el?.isContentEditable) return;
      if (document.querySelector('[role="dialog"]')) return;
      if (e.key === "Escape") {
        setExpandedId(null);
        return;
      }
      if (e.key !== "j" && e.key !== "k") return;
      if (visible.length === 0) return;
      e.preventDefault();
      const index = visible.findIndex((v) => v.id === expandedId);
      const nextIndex =
        index === -1
          ? e.key === "j"
            ? 0
            : visible.length - 1
          : Math.min(visible.length - 1, Math.max(0, index + (e.key === "j" ? 1 : -1)));
      const next = visible[nextIndex];
      setExpandedId(next.id);
      document.getElementById(`qa-entry-${next.id}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [visible, expandedId]);

  const scanLabel = queue.scan.pending
    ? "Scanne …"
    : queue.scanCandidates > 0
      ? `Gespräche scannen (${num(Math.min(SCAN_BATCH, queue.scanCandidates))} von ${num(queue.scanCandidates)})`
      : "Keine neuen Gespräche zu scannen";

  return (
    <div className="flex flex-col gap-4">
      <FilterBar
        activeCount={q ? 1 : 0}
        onReset={() => setQuery("")}
        end={
          <>
            <span className="hidden items-center gap-1 text-xs text-muted-foreground xl:flex">
              <Kbd>J</Kbd>/<Kbd>K</Kbd> Eintrag wechseln
            </span>
            <Button
              onClick={() => void queue.scan.run()}
              loading={queue.scan.pending}
              disabled={queue.scanCandidates === 0}
            >
              {!queue.scan.pending && <Sparkles />}
              {scanLabel}
            </Button>
            <InfoTip label="Woher die Fragen kommen">
              Quelle: Gespräche mit „Offener Bedarf“/„Abgesprungen“ oder Übergabe ans
              Kontaktformular. Der Scan entwirft je Gespräch eine präzise Frage (KI, kostet
              Tokens — nur auf Klick). Veröffentlichen schreibt Produkt-Fragen in das
              Shopify-Metafeld <code>custom.qa</code> (Q&A-Tab der Produktseite + Mos
              Produktwissen); Fragen ohne Produkt landen in Mos allgemeiner Wissensbasis.
            </InfoTip>
            <IconButton label="Neu laden" size="icon-sm" onClick={() => void queue.reload()}>
              <RefreshCw />
            </IconButton>
          </>
        }
      >
        <SearchInput
          id="wissen-search"
          value={query}
          onValueChange={setQuery}
          placeholder="Frage, Lücke, Produkt …"
          aria-label="Einträge durchsuchen"
          size="sm"
          containerClassName="w-full sm:w-72"
        />
      </FilterBar>

      <Tabs value={filter} onValueChange={(v) => setFilter(v as StatusFilter)}>
        <TabsList variant="underline">
          {FILTERS.map((f) => (
            <TabsTrigger
              key={f.value}
              value={f.value}
              badge={num(f.value === "all" ? total : queue.counts[f.value as QaStatus] ?? 0)}
            >
              {f.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {visible.length === 0 ? (
        <EmptyState
          icon={<BookOpen />}
          title={q ? "Keine Einträge passen zur Suche." : "Keine Einträge in dieser Ansicht."}
          description={
            q
              ? undefined
              : "Nutze „Gespräche scannen“, um neue Wissenslücken aus den Beratungen zu ziehen."
          }
          action={
            !q && queue.scanCandidates > 0 ? (
              <Button size="sm" onClick={() => void queue.scan.run()} loading={queue.scan.pending}>
                {!queue.scan.pending && <Sparkles />}
                {scanLabel}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {visible.map((entry) => {
            const expanded = entry.id === expandedId;
            return (
              <li
                key={entry.id}
                id={`qa-entry-${entry.id}`}
                className={cn(
                  "rounded-lg border bg-card transition-colors",
                  expanded ? "border-accent/50 shadow-sm" : "border-border hover:border-accent/40"
                )}
              >
                <button
                  type="button"
                  aria-expanded={expanded}
                  aria-controls={expanded ? `qa-editor-${entry.id}` : undefined}
                  onClick={() => setExpandedId(expanded ? null : entry.id)}
                  className="flex w-full items-start gap-3 rounded-lg px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <ChevronRight
                    className={cn("mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-90")}
                    aria-hidden
                  />
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className={cn("text-sm font-medium text-foreground", !expanded && "truncate")}>
                      {entry.question}
                    </span>
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-muted-foreground">
                      <QaStatusBadge status={entry.status} />
                      <QaProductBadge productId={entry.productId} productTitle={entry.productTitle} />
                      <span>
                        #{entry.id} · {formatAdmin(entry.createdAt, ADMIN_DATE_PADDED)}
                        {entry.conversationId != null ? ` · aus Gespräch #${entry.conversationId}` : ""}
                      </span>
                      {!expanded && !entry.answer && entry.status === "open" && (
                        <span className="italic">ohne Antwort</span>
                      )}
                    </span>
                  </span>
                </button>
                {expanded && (
                  <div id={`qa-editor-${entry.id}`}>
                    <QaEntryEditor
                      key={`${entry.id}:${entry.updatedAt}`}
                      entry={entry}
                      onChanged={queue.reload}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
