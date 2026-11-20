"use client";

// Gutscheine — the Geschenkgutscheine from the shop and those issued by hand
// (not the newsletter welcome code; docs/GIFT_VOUCHERS.md). From the top:
// the setup notices (grouped callouts, „Einrichtung“ opens the check), the
// stats row, the toolbar (search, status, source, „Gutschein ausstellen“),
// the list (one server-rendered page, newest first) next to the selected
// voucher (VoucherDetail, loaded on demand), and „Einrichtung“ (SetupPanel:
// the setup check with Shopify and the operator settings).
//
// URL: ?status= ?quelle= ?q= ?seite= are filters (router.push — the server
// renders the page; the search is debounced), ?gutschein=<id> is the
// selection (history.replaceState), #einrichtung opens the setup.

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, FileText, Gift, Mail, Plus, Printer, SearchX } from "lucide-react";
import { adminTabHref } from "@/lib/admin-tabs.mjs";
import { eurFromCents, num, pct, plural } from "@/lib/admin-format.mjs";
import { ADMIN_DAY_MONTH, formatAdmin } from "@/lib/admin-datetime.mjs";
import {
  Button,
  Callout,
  DataTable,
  EmptyState,
  FilterBar,
  FilterGroup,
  Pagination,
  SearchInput,
  SegmentedControl,
  Select,
  SplitPane,
  Stat,
  StatusBadge,
  Tooltip,
  cn,
  toast,
  type DataTableColumn,
} from "../ui";
import { adminFetch, errorMessage } from "../lib/admin-fetch";
import {
  GUTSCHEINE_SOURCE_FILTERS,
  GUTSCHEINE_STATUS_FILTERS,
  activeGutscheineFilterCount,
  deliveryLabel,
  groupNotices,
  gutscheineFilterParams,
  printStatusLabel,
  printStatusTone,
  voucherOriginLabel,
  voucherStatusLabel,
  voucherStatusTone,
  type GutscheineFilter,
  type GutscheineSourceFilter,
  type GutscheineStatusFilter,
} from "./gutscheine-core.mjs";
import { VoucherDetail } from "./VoucherDetail";
import { IssueDialog } from "./IssueDialog";
import { SetupPanel } from "./SetupPanel";
import type { GutscheinRow, GutscheineSetup, GutscheineWorkspaceProps } from "./types";

const SELECT_CLASS = "h-8 w-auto min-w-[9rem] py-0 pr-8 text-xs";
const SETUP_ANCHOR = "einrichtung";

const NOTICE_TITLES = {
  error: "Ausstellen nicht möglich",
  warning: "Einrichtung unvollständig",
  info: undefined,
} as const;

const DELIVERY_ICONS = { pdf: FileText, email: Mail, print: Printer } as const;
const TONE_TEXT: Record<string, string> = {
  neutral: "text-muted-foreground",
  accent: "text-accent",
  success: "text-success",
  warning: "text-warning",
  info: "text-info",
  destructive: "text-destructive",
};

/** How the voucher travels (PDF, e-mail, card — coloured by the print job's state). */
function DeliveryIcon({ row }: { row: GutscheinRow }) {
  const Icon = DELIVERY_ICONS[row.delivery] ?? FileText;
  const label =
    row.delivery === "print"
      ? `Premium-Karte${row.printStatus ? ` · ${printStatusLabel(row.printStatus)}` : ""}`
      : deliveryLabel(row.delivery);
  const tone = row.delivery === "print" && row.printStatus ? printStatusTone(row.printStatus) : "neutral";
  return (
    <Tooltip content={label}>
      <span className={cn("inline-flex shrink-0", TONE_TEXT[tone])}>
        <Icon className="size-3.5" aria-hidden />
        <span className="sr-only">{label}</span>
      </span>
    </Tooltip>
  );
}

function syncSelectionParam(id: number | null) {
  const url = new URL(window.location.href);
  if (id === null) url.searchParams.delete("gutschein");
  else url.searchParams.set("gutschein", String(id));
  window.history.replaceState(window.history.state, "", url.toString());
}

export function GutscheineWorkspace({
  dbReady,
  tablesExist,
  rows,
  total,
  pageSize,
  filter,
  summary,
  settings,
  env,
  designs,
  initialSetup,
  initialId,
}: GutscheineWorkspaceProps) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const ready = dbReady && tablesExist;

  const [selectedId, setSelectedId] = React.useState<number | null>(initialId);
  // A new ?gutschein= from the server (e.g. after „Gutschein ausstellen“) selects it.
  React.useEffect(() => {
    if (initialId !== null) setSelectedId(initialId);
  }, [initialId]);
  const [query, setQuery] = React.useState(filter.q);
  // True while the operator has typed something the URL does not carry yet.
  const typing = React.useRef(false);
  // A search from elsewhere (a link, back / forward) shows up in the box — but
  // never overwrites what is being typed while an older answer arrives.
  React.useEffect(() => {
    if (!typing.current) setQuery(filter.q);
  }, [filter.q]);
  const [issueOpen, setIssueOpen] = React.useState(false);
  const [setup, setSetup] = React.useState<GutscheineSetup>(initialSetup);
  const [setupOpen, setSetupOpen] = React.useState(false);
  const [rechecking, setRechecking] = React.useState(false);

  const navigate = React.useCallback(
    (next: GutscheineFilter) => {
      const href = adminTabHref(
        "gutscheine",
        gutscheineFilterParams(next, { gutschein: selectedId !== null ? String(selectedId) : undefined })
      );
      startTransition(() => router.push(href, { scroll: false }));
    },
    [router, selectedId]
  );

  // Search as you type (debounced) — the server filters.
  React.useEffect(() => {
    if (!typing.current) return;
    if (query.trim() === filter.q) {
      typing.current = false;
      return;
    }
    const handle = setTimeout(() => {
      typing.current = false;
      navigate({ ...filter, q: query.trim(), page: 1 });
    }, 350);
    return () => clearTimeout(handle);
  }, [query, filter, navigate]);
  const onQueryChange = (value: string) => {
    typing.current = true;
    setQuery(value);
  };

  const select = React.useCallback((id: number | null) => {
    setSelectedId(id);
    syncSelectionParam(id);
  }, []);

  // The Shopify half of the setup check loads after the page (never holds it up).
  const loadSetup = React.useCallback(async (fresh: boolean) => {
    try {
      setSetup(await adminFetch<GutscheineSetup>(`/api/admin/gutscheine/setup${fresh ? "?fresh=1" : ""}`));
    } catch (e) {
      if (fresh) toast({ variant: "error", title: "Prüfung fehlgeschlagen", description: errorMessage(e) });
    }
  }, []);
  React.useEffect(() => {
    void loadSetup(false);
  }, [loadSetup]);

  const recheck = async () => {
    setRechecking(true);
    try {
      await loadSetup(true);
    } finally {
      setRechecking(false);
    }
  };

  const openSetup = React.useCallback(() => {
    setSetupOpen(true);
    window.requestAnimationFrame(() =>
      document.getElementById(SETUP_ANCHOR)?.scrollIntoView({ behavior: "smooth", block: "start" })
    );
  }, []);
  React.useEffect(() => {
    const onHash = () => {
      if (window.location.hash === `#${SETUP_ANCHOR}`) openSetup();
    };
    onHash();
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [openSetup]);

  const resetFilters = () => {
    typing.current = false;
    setQuery("");
    navigate({ status: "", quelle: "", q: "", page: 1 });
  };

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const filtered = activeGutscheineFilterCount(filter) > 0;
  const redeemedShare = summary.issuedCents > 0 ? (summary.redeemedCents / summary.issuedCents) * 100 : null;
  const draftShare = summary.draftCount30d > 0 ? (summary.soldCount30d / summary.draftCount30d) * 100 : null;
  const statusCount = (value: GutscheineStatusFilter) =>
    value === "held" ? summary.heldCount : value === "achtung" ? summary.attentionCount : null;

  // Two compact columns — the list rail of the SplitPane is 380 px wide.
  const columns: DataTableColumn<GutscheinRow>[] = [
    {
      key: "voucher",
      header: "Gutschein",
      cell: (r) => (
        <div className="min-w-0 max-w-[15rem]">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="font-medium tabular-nums">{r.number}</span>
            <StatusBadge tone={voucherStatusTone(r.status)}>{voucherStatusLabel(r.status)}</StatusBadge>
            {r.attention && <AlertTriangle className="size-3.5 shrink-0 text-warning" aria-label="Achtung" />}
          </div>
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            <DeliveryIcon row={r} />
            <span className="truncate">
              {formatAdmin(r.createdAt, ADMIN_DAY_MONTH)} · {voucherOriginLabel(r)}
              {r.recipientName ? ` · für ${r.recipientName}` : ""}
            </span>
          </div>
        </div>
      ),
    },
    {
      key: "amount",
      header: "Wert",
      align: "right",
      cell: (r) => (
        <div className="whitespace-nowrap">
          <div className="font-medium">{eurFromCents(r.amountCents)}</div>
          <div className="text-xs text-muted-foreground">
            {r.balanceCents !== null && (r.status === "issued" || r.status === "deactivated") ? `Rest ${eurFromCents(r.balanceCents)}` : "\u00a0"}
          </div>
        </div>
      ),
    },
  ];

  const emptyList = !dbReady ? (
    <EmptyState compact plain icon={<Gift />} title="Keine Datenbank" description="Ohne DATABASE_URL gibt es keine Gutscheine." />
  ) : !tablesExist ? (
    <EmptyState compact plain icon={<Gift />} title="Migration 0083 fehlt" description="Bitte zuerst ausführen — danach erscheinen hier die Gutscheine." />
  ) : filtered ? (
    <EmptyState
      compact
      plain
      icon={<SearchX />}
      title="Keine Gutscheine für diese Auswahl"
      action={
        <Button size="sm" variant="outline" onClick={resetFilters}>
          Filter zurücksetzen
        </Button>
      }
    />
  ) : (
    <EmptyState
      compact
      plain
      icon={<Gift />}
      title="Noch keine Gutscheine"
      description="Sie entstehen mit Bestellungen im Shop oder mit „Gutschein ausstellen“."
    />
  );

  return (
    <div className="flex flex-col gap-4">
      {groupNotices(setup.notices).map((g, i) => (
        <Callout
          key={g.level}
          tone={g.level === "error" ? "destructive" : g.level === "warning" ? "warning" : "info"}
          title={NOTICE_TITLES[g.level]}
          compact={g.level === "info"}
          action={
            i === 0 ? (
              <Button size="xs" variant="outline" onClick={openSetup}>
                Einrichtung
              </Button>
            ) : undefined
          }
        >
          {g.items.length === 1 ? (
            g.items[0].text
          ) : (
            <ul className="flex list-disc flex-col gap-0.5 pl-4">
              {g.items.map((n) => (
                <li key={n.key}>{n.text}</li>
              ))}
            </ul>
          )}
        </Callout>
      ))}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          size="sm"
          label="Verkauft (30 Tage)"
          value={num(summary.soldCount30d)}
          hint={eurFromCents(summary.soldCents30d)}
          info="Gutscheine aus Shop-Bestellungen der letzten 30 Tage (ohne stornierte und abgelehnte) — Anzahl und Wert."
        />
        <Stat
          size="sm"
          label="Ausgestellt gesamt"
          value={eurFromCents(summary.issuedCents)}
          hint={plural(summary.issuedCount, "Gutschein", "Gutscheine")}
          info="Alles, was je als Shopify-Geschenkkarte ausgestellt wurde — aus dem Shop und von Hand."
        />
        <Stat
          size="sm"
          label="Offenes Guthaben"
          value={eurFromCents(summary.openBalanceCents)}
          info="Restguthaben aktiver, nicht abgelaufener Gutscheine — Stand des letzten Abgleichs mit Shopify (täglich, oder „Abgleichen“ im Gutschein)."
        />
        <Stat
          size="sm"
          label="Eingelöst"
          value={redeemedShare === null ? "—" : pct(redeemedShare, 0)}
          hint={eurFromCents(summary.redeemedCents)}
          info="Anteil des ausgestellten Werts, der im Shop schon ausgegeben wurde (laut letztem Abgleich)."
        />
        <Stat
          size="sm"
          label="Zu prüfen"
          value={num(summary.heldCount)}
          hint={summary.attentionCount > 0 ? `${num(summary.attentionCount)} mit „Achtung“` : undefined}
          href={adminTabHref("gutscheine", { status: "held" })}
          info="Bezahlte Gutscheine, die Mo angehalten hat (z. B. ausgeschaltet, Betrugsrisiko, Tageslimit) — „Ausstellen“ oder „Ablehnen“."
        />
        <Stat
          size="sm"
          label="Druckaufträge offen"
          value={num(summary.openPrintJobs)}
          info="Premium-Karten, die noch nicht verschickt sind: zu prüfen, wartend, übermittelt oder im Druck."
        />
        <Stat
          size="sm"
          label="Entwürfe (30 Tage)"
          value={num(summary.draftCount30d)}
          hint={draftShare === null ? undefined : `${pct(draftShare, 0)} gekauft`}
          info="Im Gutschein-Designer mit „Jetzt kaufen“ angelegte Entwürfe der letzten 30 Tage. „gekauft“ = verkaufte Gutscheine je Entwurf (grob: ein Entwurf kann mehrere Gutscheine ergeben, abgebrochene Käufe bleiben Entwürfe)."
          className="col-span-2"
        />
      </div>

      <FilterBar
        activeCount={activeGutscheineFilterCount(filter)}
        onReset={resetFilters}
        end={
          <>
            <span className="text-xs tabular-nums text-muted-foreground" aria-live="polite">
              {pending ? "Lädt…" : plural(total, "Gutschein", "Gutscheine")}
            </span>
            <Button size="sm" onClick={() => setIssueOpen(true)} disabled={!ready}>
              <Plus aria-hidden /> Gutschein ausstellen
            </Button>
          </>
        }
      >
        <SearchInput
          value={query}
          onValueChange={onQueryChange}
          placeholder="Nr., Name, E-Mail, Bestellung, Code"
          size="sm"
          maxLength={100}
          containerClassName="w-72"
          aria-label="Gutscheine suchen (Nummer, Bestellung, Name, E-Mail, letzte 4 Zeichen des Codes)"
        />
        <FilterGroup label="Status" htmlFor="gv-status">
          <Select
            id="gv-status"
            value={filter.status}
            onChange={(e) => navigate({ ...filter, status: e.target.value as GutscheineStatusFilter, page: 1 })}
            className={SELECT_CLASS}
          >
            {GUTSCHEINE_STATUS_FILTERS.map((o) => {
              const n = statusCount(o.value);
              return (
                <option key={o.value || "alle"} value={o.value}>
                  {n ? `${o.label} (${num(n)})` : o.label}
                </option>
              );
            })}
          </Select>
        </FilterGroup>
        <SegmentedControl<"alle" | Exclude<GutscheineSourceFilter, "">>
          label="Quelle"
          value={filter.quelle || "alle"}
          onChange={(v) => navigate({ ...filter, quelle: v === "alle" ? "" : v, page: 1 })}
          options={GUTSCHEINE_SOURCE_FILTERS.map((o) => ({
            value: (o.value || "alle") as "alle" | Exclude<GutscheineSourceFilter, "">,
            label: o.label,
          }))}
        />
      </FilterBar>

      <SplitPane
        listWidth="lg"
        listLabel="Gutscheine"
        stickyTopClassName="lg:top-[4.5rem] lg:max-h-[calc(100vh-5.5rem)]"
        list={
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(r) => r.id}
            clientSort={false}
            dense
            selectedKey={selectedId}
            onRowClick={(r) => select(r.id)}
            maxHeight="calc(100vh - 9.5rem)"
            caption="Gutscheine"
            className={pending ? "opacity-70 transition-opacity" : undefined}
            empty={emptyList}
            footer={
              total > pageSize ? (
                <Pagination
                  page={filter.page}
                  pageCount={pageCount}
                  total={total}
                  pageSize={pageSize}
                  onPageChange={(p) => navigate({ ...filter, page: p })}
                  compact
                  itemLabel="Gutscheine"
                />
              ) : undefined
            }
          />
        }
        detail={
          selectedId !== null ? (
            <VoucherDetail
              key={selectedId}
              id={selectedId}
              env={env}
              onChanged={() => router.refresh()}
              onClose={() => select(null)}
            />
          ) : (
            <EmptyState
              icon={<Gift />}
              title="Gutschein auswählen"
              description="Links einen Gutschein wählen — oder einen neuen ausstellen."
              className="min-h-[16rem]"
            />
          )
        }
      />

      <div id={SETUP_ANCHOR} className="scroll-mt-20">
        <SetupPanel
          setup={setup}
          settings={settings}
          dbReady={dbReady}
          open={setupOpen}
          onOpenChange={setSetupOpen}
          rechecking={rechecking}
          onRecheck={() => void recheck()}
          onSaved={() => {
            router.refresh();
            void loadSetup(false);
          }}
        />
      </div>

      <IssueDialog
        open={issueOpen}
        onOpenChange={setIssueOpen}
        env={env}
        designs={designs}
        onIssued={(id) => {
          setIssueOpen(false);
          setSelectedId(id);
          startTransition(() => router.push(adminTabHref("gutscheine", { gutschein: String(id) }), { scroll: false }));
        }}
      />
    </div>
  );
}
