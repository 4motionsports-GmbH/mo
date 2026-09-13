"use client";

// „Liste“ — the queue as a sortable table with multi-select and the bulk
// actions for the drafts that need work in one sitting: Überspringen (free,
// undoable), Neu generieren… and Rabatt setzen… (paid runs: confirmed with
// count and the cost estimate from the recorded ai_usage averages).

import * as React from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Percent, RefreshCw, SkipForward } from "lucide-react";
import { eur, num, plural, relativeTime } from "@/lib/admin-format.mjs";
import { campaignSegmentByKey } from "@/lib/campaign-segments.mjs";
import { sortRows } from "@/lib/admin-table.mjs";
import {
  Button,
  Checkbox,
  EmptyState,
  ProgressBar,
  Select,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  cn,
  useConfirm,
} from "../ui";
import { contactName, type CampaignCostsProps, type CampaignQueueItemProps } from "./types";
import type { BulkProgress, ReviewCheck, ReviewVerdict } from "./useCampaignActions";

type SortKey = "contact" | "segment" | "discount" | "checks" | "draft";
interface SortState {
  key: SortKey;
  dir: "asc" | "desc";
}

const VERDICT_RANK: Record<ReviewVerdict, number> = { blocked: 0, hints: 1, ready: 2 };

function SortHead({
  label,
  sortKey,
  sort,
  onToggle,
  className,
}: {
  label: string;
  sortKey: SortKey;
  sort: SortState;
  onToggle: (key: SortKey) => void;
  className?: string;
}) {
  const active = sort.key === sortKey;
  const Icon = active ? (sort.dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <TableHead className={className} aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        onClick={() => onToggle(sortKey)}
        className="inline-flex items-center gap-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {label}
        <Icon className={cn("size-3", !active && "opacity-40")} aria-hidden />
      </button>
    </TableHead>
  );
}

export function ListView({
  items,
  checksOf,
  verdictOf,
  busyIds,
  heroDesignActive,
  costs,
  bulkProgress,
  onOpen,
  onBulkSkip,
  onBulkRegenerate,
}: {
  items: CampaignQueueItemProps[];
  checksOf: (contactId: number) => ReviewCheck[];
  verdictOf: (item: CampaignQueueItemProps) => ReviewVerdict;
  busyIds: Record<number, string>;
  heroDesignActive: boolean;
  costs: CampaignCostsProps;
  bulkProgress: BulkProgress | null;
  onOpen: (contactId: number) => void;
  onBulkSkip: (ids: number[]) => Promise<void>;
  onBulkRegenerate: (ids: number[], depth?: number) => Promise<void>;
}) {
  const [selected, setSelected] = React.useState<Set<number>>(() => new Set());
  const [sort, setSort] = React.useState<SortState>({ key: "checks", dir: "asc" });
  const [depth, setDepth] = React.useState("10");
  const { confirm, confirmDialog } = useConfirm();

  // Selection follows the queue: cards that left it drop out.
  React.useEffect(() => {
    setSelected((prev) => {
      const ids = new Set(items.map((it) => it.contactId));
      const next = new Set([...prev].filter((id) => ids.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [items]);

  const rows = React.useMemo(() => {
    const getValue = (it: CampaignQueueItemProps): unknown => {
      switch (sort.key) {
        case "contact":
          return contactName(it).toLowerCase();
        case "segment":
          return it.segment ? (campaignSegmentByKey(it.segment)?.label ?? "") : "";
        case "discount":
          return it.discountPercent;
        case "checks":
          return VERDICT_RANK[verdictOf(it)];
        case "draft":
          return it.draftUpdatedAt ? new Date(it.draftUpdatedAt).getTime() : 0;
      }
    };
    return sortRows(items, getValue, sort.dir) as CampaignQueueItemProps[];
  }, [items, sort, verdictOf]);

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.contactId));
  const ids = [...selected];
  const busy = bulkProgress !== null;

  const runRegenerate = async (withDepth: boolean) => {
    const d = withDepth ? Number(depth) : undefined;
    const cost = costs.draftEur === null ? null : costs.draftEur * ids.length;
    const ok = await confirm({
      title: withDepth ? `Rabatt ${d} % für ${plural(ids.length, "Entwurf", "Entwürfe")} setzen?` : `${plural(ids.length, "Entwurf", "Entwürfe")} neu generieren?`,
      description: `${withDepth ? "Setzt die Rabatt-Tiefe und generiert" : "Generiert"} den Text jedes ausgewählten Entwurfs neu — manuelle Änderungen an Betreff und Text gehen dabei verloren. Geschätzte Kosten: ${
        cost === null ? "noch keine Daten" : `≈ ${eur(cost)}`
      } (${ids.length} × KI-Aufruf).`,
      confirmLabel: withDepth ? "Rabatt setzen" : "Neu generieren",
    });
    if (!ok) return;
    await onBulkRegenerate(ids, d);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs">
        <span className="font-medium tabular-nums">
          {ids.length > 0 ? `${num(ids.length)} von ${num(rows.length)} ausgewählt` : `${num(rows.length)} Entwürfe`}
        </span>
        {ids.length > 0 && (
          <>
            <Button variant="outline" size="xs" disabled={busy} onClick={() => void onBulkSkip(ids).then(() => setSelected(new Set()))}>
              <SkipForward /> Überspringen
            </Button>
            <Button variant="outline" size="xs" disabled={busy} onClick={() => void runRegenerate(false)}>
              <RefreshCw /> Neu generieren…
            </Button>
            <span className="inline-flex items-center gap-1">
              <Select
                value={depth}
                onChange={(e) => setDepth(e.target.value)}
                className="h-7 w-auto min-w-[5rem] py-0 pr-7 text-xs"
                aria-label="Rabatt-Tiefe für die Auswahl"
                disabled={busy}
              >
                {["0", "5", "10", "15", "20"].map((v) => (
                  <option key={v} value={v}>
                    {v} %
                  </option>
                ))}
              </Select>
              <Button variant="outline" size="xs" disabled={busy} onClick={() => void runRegenerate(true)}>
                <Percent /> Rabatt setzen…
              </Button>
            </span>
            <Button variant="ghost" size="xs" disabled={busy} onClick={() => setSelected(new Set())}>
              Auswahl aufheben
            </Button>
          </>
        )}
        {bulkProgress && (
          <span className="ml-auto flex items-center gap-2 text-muted-foreground">
            <ProgressBar
              value={bulkProgress.total > 0 ? (bulkProgress.done / bulkProgress.total) * 100 : 0}
              label={bulkProgress.label}
              className="w-24"
            />
            <span className="tabular-nums">
              {bulkProgress.label} {num(bulkProgress.done)}/{num(bulkProgress.total)}
            </span>
          </span>
        )}
      </div>

      <div className="rounded-lg border border-border bg-card">
        {rows.length === 0 ? (
          <EmptyState plain compact title="Keine Entwürfe in der Warteschlange." />
        ) : (
          <Table className="text-xs">
            <TableHeader>
              <TableRow>
                <TableHead className="w-8 px-2">
                  <Checkbox
                    aria-label="Alle auswählen"
                    checked={allSelected}
                    indeterminate={ids.length > 0 && !allSelected}
                    onChange={(e) =>
                      setSelected(e.target.checked ? new Set(rows.map((r) => r.contactId)) : new Set())
                    }
                  />
                </TableHead>
                <SortHead label="Kontakt" sortKey="contact" sort={sort} onToggle={toggleSort} />
                <SortHead label="Segment" sortKey="segment" sort={sort} onToggle={toggleSort} className="hidden md:table-cell" />
                <TableHead className="hidden xl:table-cell">Sprache</TableHead>
                <SortHead label="Rabatt" sortKey="discount" sort={sort} onToggle={toggleSort} />
                <TableHead className="hidden xl:table-cell">Set</TableHead>
                {heroDesignActive && <TableHead className="hidden xl:table-cell">Hero</TableHead>}
                <SortHead label="Prüfung" sortKey="checks" sort={sort} onToggle={toggleSort} />
                <SortHead label="Entwurf" sortKey="draft" sort={sort} onToggle={toggleSort} className="hidden md:table-cell" />
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((it) => {
                const verdict = verdictOf(it);
                const checks = checksOf(it.contactId).filter((c) => c.level !== "info");
                const seg = it.segment ? campaignSegmentByKey(it.segment) : null;
                const isSelected = selected.has(it.contactId);
                return (
                  <TableRow
                    key={it.contactId}
                    className={cn(isSelected && "bg-accent-soft/60")}
                    aria-selected={isSelected}
                  >
                    <TableCell className="px-2">
                      <Checkbox
                        aria-label={`${contactName(it)} auswählen`}
                        checked={isSelected}
                        onChange={(e) =>
                          setSelected((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(it.contactId);
                            else next.delete(it.contactId);
                            return next;
                          })
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <span className="block truncate font-medium">{contactName(it)}</span>
                      <span className="block truncate text-2xs text-muted-foreground">{it.email}</span>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {seg ? (
                        <StatusBadge tone={seg.sendable ? "neutral" : "warning"} dot={false}>
                          {seg.label}
                        </StatusBadge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden xl:table-cell">{it.language.toUpperCase()}</TableCell>
                    <TableCell className="tabular-nums">{it.discountPercent > 0 ? `${it.discountPercent} %` : "—"}</TableCell>
                    <TableCell className="hidden xl:table-cell">
                      {it.bundle ? <span className="truncate">{it.bundle.title}</span> : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    {heroDesignActive && (
                      <TableCell className="hidden xl:table-cell">
                        {it.heroUrl ? (
                          <StatusBadge tone="success" dot={false}>KI-Hero</StatusBadge>
                        ) : it.contactId % 2 === 0 ? (
                          <StatusBadge tone="warning" dot={false}>A ohne</StatusBadge>
                        ) : (
                          <span className="text-muted-foreground">B</span>
                        )}
                      </TableCell>
                    )}
                    <TableCell>
                      <span className="flex flex-wrap items-center gap-1">
                        {busyIds[it.contactId] ? (
                          <StatusBadge tone="info" pulse>
                            In Arbeit
                          </StatusBadge>
                        ) : (
                          <StatusBadge tone={verdict === "ready" ? "success" : verdict === "hints" ? "warning" : "destructive"}>
                            {verdict === "ready" ? "Bereit" : verdict === "hints" ? "Hinweise" : "Blockiert"}
                          </StatusBadge>
                        )}
                        {checks.length > 0 && (
                          <span className="hidden max-w-[12rem] truncate text-muted-foreground 2xl:inline">
                            {checks.map((c) => c.title).join(" · ")}
                          </span>
                        )}
                      </span>
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">
                      {relativeTime(it.draftUpdatedAt)}
                      {it.edited ? " · ✎" : ""}
                    </TableCell>
                    <TableCell align="right">
                      <Button variant="outline" size="xs" onClick={() => onOpen(it.contactId)}>
                        Öffnen
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>
      {confirmDialog}
    </div>
  );
}
