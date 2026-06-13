"use client";

// Client-side toolbar over the marketing contact list. Operates ENTIRELY on the
// array the server already fetched (listMarketingTargets) — no new data
// endpoints, no change to which contacts are listed. It only narrows / reorders
// what is rendered:
//
//   SEARCH  — substring match on email (case-insensitive)
//   FILTER  — by status bucket (chatted-not-purchased / open draft / sent /
//             purchased / unknown). Buckets can overlap (a contact may both be
//             "not purchased" and have an open draft); a card matches whichever
//             bucket is selected.
//   SORT    — by DOI-confirmed date (newest/oldest) or persona (A–Z).
//
// BULK DRAFTING — multi-select contacts (per-card checkboxes + a select-all-in-
// filter master) and QUEUE drafts for them at a chosen discount depth. Bulk means
// QUEUE-FOR-REVIEW, never auto-send: each queued draft is created by calling the
// SAME per-contact draft endpoint (/api/admin/marketing/draft) once per contact —
// the same eligibility re-check, idempotency and depth rules as the single-card
// flow. The admin still reviews and sends each one individually through the
// unchanged per-send path. There is deliberately NO bulk send here.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Sparkles, X } from "lucide-react";
import { CustomerCard, type MarketingTargetProps } from "./CustomerCard";
import { Button, Checkbox, Input, Label, Select, toast } from "./ui";
import {
  DISCOUNT_PERCENT_MIN,
  DISCOUNT_PERCENT_MAX,
  clampDiscountPercent,
} from "@/lib/discount-validation.mjs";
import type { StatusFilter } from "./marketing-filter";

type SortKey = "confirmed_desc" | "confirmed_asc" | "persona";

// How many per-contact draft requests run at once. Each draft is an Anthropic
// call (≤30s), so a small pool keeps the queue moving without hammering the
// route — and every request still goes through the unchanged single-draft path.
const BULK_CONCURRENCY = 4;

function matchesStatus(t: MarketingTargetProps, filter: StatusFilter): boolean {
  const send = t.latestSend;
  const isSent = send?.status === "sent";
  const hasDraft = Boolean(send) && !isSent;
  switch (filter) {
    case "all":
      return true;
    case "no_purchase":
      return t.purchase.status === "no_purchase";
    case "draft":
      return hasDraft;
    case "sent":
      return isSent;
    case "purchased":
      return t.purchase.status === "purchased";
    case "unknown":
      return t.purchase.status === "unknown";
  }
}

function confirmedTime(t: MarketingTargetProps): number {
  if (!t.confirmedAt) return Number.NaN;
  const ms = new Date(t.confirmedAt).getTime();
  return Number.isNaN(ms) ? Number.NaN : ms;
}

/** A contact can be bulk-DRAFTED only when it isn't already sent — mirroring the
 * single card, which offers "generate" for fresh/draft contacts but never for
 * sent (read-only) ones. */
function isSelectable(t: MarketingTargetProps): boolean {
  return t.latestSend?.status !== "sent";
}

export function MarketingList({
  targets,
  initialStatus = "all",
}: {
  targets: MarketingTargetProps[];
  /** Seeds the status filter — set by an Overview quick link's ?status= deep link. */
  initialStatus?: StatusFilter;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>(initialStatus);
  const [sort, setSort] = useState<SortKey>("confirmed_desc");

  // Bulk-select state: the chosen captureIds, the bulk discount depth, and a
  // guard so the action can't be double-fired.
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkDepth, setBulkDepth] = useState(0);
  const [bulkBusy, setBulkBusy] = useState(false);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = targets.filter(
      (t) => (q === "" || t.email.toLowerCase().includes(q)) && matchesStatus(t, status)
    );

    const sorted = [...filtered];
    sorted.sort((a, b) => {
      if (sort === "persona") {
        const pa = a.personaDisplay ?? "";
        const pb = b.personaDisplay ?? "";
        // Empty persona sorts last so labelled contacts lead.
        if (pa === "" && pb !== "") return 1;
        if (pb === "" && pa !== "") return -1;
        return pa.localeCompare(pb, "de");
      }
      // confirmed date — NaN (missing/invalid date) sorts last either way.
      const ta = confirmedTime(a);
      const tb = confirmedTime(b);
      const aNan = Number.isNaN(ta);
      const bNan = Number.isNaN(tb);
      if (aNan && bNan) return 0;
      if (aNan) return 1;
      if (bNan) return -1;
      return sort === "confirmed_desc" ? tb - ta : ta - tb;
    });
    return sorted;
  }, [targets, query, status, sort]);

  // Lookup for the bulk run + which of the visible contacts can be bulk-drafted.
  const byId = useMemo(() => new Map(targets.map((t) => [t.captureId, t])), [targets]);
  const selectableVisibleIds = useMemo(
    () => visible.filter(isSelectable).map((t) => t.captureId),
    [visible]
  );

  // Master ("select all in filter") tri-state over the currently-visible,
  // selectable contacts.
  const selectedVisibleCount = selectableVisibleIds.filter((id) => selected.has(id)).length;
  const allVisibleSelected =
    selectableVisibleIds.length > 0 && selectedVisibleCount === selectableVisibleIds.length;
  const someVisibleSelected = selectedVisibleCount > 0 && !allVisibleSelected;

  function toggleOne(id: number, next: boolean) {
    setSelected((prev) => {
      const copy = new Set(prev);
      if (next) copy.add(id);
      else copy.delete(id);
      return copy;
    });
  }

  function toggleAllInFilter() {
    setSelected((prev) => {
      const copy = new Set(prev);
      if (allVisibleSelected) {
        // Deselect everything currently visible.
        for (const id of selectableVisibleIds) copy.delete(id);
      } else {
        for (const id of selectableVisibleIds) copy.add(id);
      }
      return copy;
    });
  }

  function clearSelection() {
    setSelected(new Set());
  }

  async function draftOne(captureId: number): Promise<void> {
    const res = await fetch("/api/admin/marketing/draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // regenerate:false → an existing open draft at this exact depth is reused
      // untouched (idempotent); a different depth re-generates it, exactly like
      // the single-card flow. The server re-checks eligibility every time.
      body: JSON.stringify({ captureId, discountPercent: bulkDepth, regenerate: false }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(
        (json as { error?: { message?: string } })?.error?.message ?? `Fehler (${res.status})`
      );
    }
  }

  // Drives the per-contact draft calls through a small concurrency pool, with a
  // live progress toast and a per-contact partial-failure summary. NOTHING is
  // sent — each contact is only QUEUED as a reviewable draft.
  async function runBulkDraft() {
    const ids = [...selected].filter((id) => {
      const t = byId.get(id);
      return t != null && isSelectable(t);
    });
    if (ids.length === 0 || bulkBusy) return;

    setBulkBusy(true);
    const total = ids.length;
    let done = 0;
    let ok = 0;
    const failures: Array<{ email: string; message: string }> = [];

    const progressId = toast({
      variant: "info",
      title: "Entwürfe werden erstellt…",
      description: `0 / ${total}`,
      duration: 0,
    });

    const queue = [...ids];
    async function worker() {
      for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
        const t = byId.get(id);
        try {
          await draftOne(id);
          ok += 1;
        } catch (e) {
          failures.push({
            email: t?.email ?? `#${id}`,
            message: e instanceof Error ? e.message : "Unbekannter Fehler",
          });
        } finally {
          done += 1;
          toast.update(progressId, { description: `${done} / ${total}` });
        }
      }
    }

    try {
      await Promise.all(
        Array.from({ length: Math.min(BULK_CONCURRENCY, total) }, () => worker())
      );
    } finally {
      toast.dismiss(progressId);

      if (failures.length === 0) {
        toast({
          variant: "success",
          title: "Entwürfe erstellt",
          description: `${ok} Entwurf/Entwürfe zur Prüfung in die Warteschlange gestellt.`,
        });
      } else if (ok === 0) {
        toast({
          variant: "error",
          title: "Keine Entwürfe erstellt",
          description: `Alle ${total} fehlgeschlagen — z. B. ${failures[0].email}: ${failures[0].message}`,
        });
      } else {
        toast({
          variant: "warning",
          title: "Teilweise erstellt",
          description: `${ok} von ${total} erstellt, ${failures.length} fehlgeschlagen (z. B. ${failures[0].email}: ${failures[0].message}).`,
        });
      }

      clearSelection();
      setBulkBusy(false);
      // Reflect the freshly queued drafts (status badges, draft panels).
      router.refresh();
    }
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="min-w-[12rem] flex-1">
          <Label htmlFor="ms-search" className="mb-1.5 block text-muted-foreground">
            Suche (E-Mail)
          </Label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="ms-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="name@beispiel.de"
              className="pl-9"
            />
          </div>
        </div>

        <div className="w-44">
          <Label htmlFor="ms-status" className="mb-1.5 block text-muted-foreground">
            Status
          </Label>
          <Select
            id="ms-status"
            value={status}
            onChange={(e) => setStatus(e.target.value as StatusFilter)}
          >
            <option value="all">Alle</option>
            <option value="no_purchase">Beraten, nicht gekauft</option>
            <option value="draft">Offener Entwurf</option>
            <option value="sent">Gesendet</option>
            <option value="purchased">Hat gekauft</option>
            <option value="unknown">Kaufstatus unbekannt</option>
          </Select>
        </div>

        <div className="w-44">
          <Label htmlFor="ms-sort" className="mb-1.5 block text-muted-foreground">
            Sortierung
          </Label>
          <Select id="ms-sort" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            <option value="confirmed_desc">Bestätigt — neueste</option>
            <option value="confirmed_asc">Bestätigt — älteste</option>
            <option value="persona">Persona (A–Z)</option>
          </Select>
        </div>
      </div>

      {/* Select-all + count row. Only meaningful when there are selectable
          (not-yet-sent) contacts in view. */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {visible.length === targets.length
            ? `${targets.length} Kontakt(e)`
            : `${visible.length} von ${targets.length} Kontakt(en)`}
        </p>
        {selectableVisibleIds.length > 0 && (
          <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
            <Checkbox
              checked={allVisibleSelected}
              indeterminate={someVisibleSelected}
              onChange={toggleAllInFilter}
            />
            Alle ({selectableVisibleIds.length}) auswählen
          </label>
        )}
      </div>

      {visible.length === 0 ? (
        <div className="rounded-lg border border-border bg-card px-3.5 py-3 text-sm text-muted-foreground">
          Keine Kontakte für diese Suche/Filter.
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {visible.map((t) => (
            <CustomerCard
              key={t.captureId}
              target={t}
              selection={
                isSelectable(t)
                  ? {
                      selected: selected.has(t.captureId),
                      onSelectedChange: (next) => toggleOne(t.captureId, next),
                    }
                  : undefined
              }
            />
          ))}
        </div>
      )}

      {/* Sticky bulk action bar — appears only with a non-empty selection so it
          stays reachable while scrolling a long list. Responsive: wraps on
          narrow/tablet widths. */}
      {selected.size > 0 && (
        <BulkActionBar
          count={selected.size}
          depth={bulkDepth}
          setDepth={setBulkDepth}
          busy={bulkBusy}
          onRun={runBulkDraft}
          onClear={clearSelection}
        />
      )}
    </div>
  );
}

function BulkActionBar({
  count,
  depth,
  setDepth,
  busy,
  onRun,
  onClear,
}: {
  count: number;
  depth: number;
  setDepth: (v: number) => void;
  busy: boolean;
  onRun: () => void;
  onClear: () => void;
}) {
  return (
    <div className="sticky bottom-4 z-30 mt-4">
      <div
        role="region"
        aria-label="Sammelaktion für ausgewählte Kontakte"
        className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-4 gap-y-3 rounded-xl border border-border bg-popover/95 px-4 py-3 text-popover-foreground shadow-lg backdrop-blur"
      >
        <span className="text-sm font-semibold">
          {count} ausgewählt
        </span>

        <div className="flex items-center gap-2">
          <Label htmlFor="ms-bulk-depth" className="text-xs text-muted-foreground">
            Rabatt (%)
          </Label>
          <Input
            id="ms-bulk-depth"
            type="number"
            inputMode="numeric"
            min={DISCOUNT_PERCENT_MIN}
            max={DISCOUNT_PERCENT_MAX}
            step={1}
            value={depth}
            disabled={busy}
            onChange={(e) => setDepth(clampDiscountPercent(e.target.valueAsNumber))}
            className="w-20"
          />
        </div>

        <p className="order-last w-full text-xs text-muted-foreground sm:order-none sm:w-auto sm:flex-1 sm:min-w-[12rem]">
          Erstellt je Kontakt einen Entwurf zur Prüfung — es wird{" "}
          <strong className="text-foreground">nichts gesendet</strong>.
        </p>

        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onClear} disabled={busy}>
            <X /> Auswahl aufheben
          </Button>
          <Button onClick={onRun} disabled={busy}>
            <Sparkles /> {busy ? "Erstelle…" : "Entwürfe erstellen"}
          </Button>
        </div>
      </div>
    </div>
  );
}
