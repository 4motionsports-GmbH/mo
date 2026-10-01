"use client";

// Shopify-Abgleich — the customer platform's link to Shopify: the first full
// import (customers + orders, step by step with progress; the 5-minute cron
// continues when the page is closed), sync health (last reconcile, last
// webhook, mirrored customers, order copies), the flags, and the outbox of
// write-backs to Shopify (consent, new customers, erasure requests) with
// „Erneut versuchen“ for entries that gave up.

import * as React from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Store, X } from "lucide-react";
import type { SyncHealth, SyncRun } from "@/lib/shopify-sync";
import type { OutboxStats } from "@/lib/shopify-outbox";
import type { ShopifySyncFlags } from "@/lib/shopify-sync-flags";
import { outboxKindLabel } from "@/lib/outbox-core.mjs";
import { ADMIN_DATE_TIME_SHORT, formatAdmin } from "@/lib/admin-datetime.mjs";
import { num, relativeTime } from "@/lib/admin-format.mjs";
import {
  Button,
  Callout,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DescriptionItem,
  DescriptionList,
  Disclosure,
  InfoTip,
  StatusBadge,
  toast,
  useConfirm,
} from "../ui";
import { adminFetch, errorMessage } from "../lib/admin-fetch";
import { useStepLoop } from "../lib/use-step-loop";

export interface ShopifySyncCardProps {
  health: SyncHealth | null;
  runs: SyncRun[];
  outbox: OutboxStats | null;
  flags: ShopifySyncFlags;
}

interface StepResult {
  ok: boolean;
  done: boolean;
  waiting: boolean;
  run: SyncRun | null;
}

const RUN_KIND: Record<string, string> = {
  import_customers: "Import Kunden",
  import_orders: "Import Bestellungen",
  reconcile: "Nächtlicher Abgleich",
};

const RUN_STATUS: Record<string, { label: string; tone: "success" | "warning" | "destructive" | "info" | "neutral" }> = {
  running: { label: "Shopify bereitet vor", tone: "info" },
  processing: { label: "Wird übernommen", tone: "info" },
  done: { label: "Fertig", tone: "success" },
  failed: { label: "Fehlgeschlagen", tone: "destructive" },
  cancelled: { label: "Abgebrochen", tone: "neutral" },
};

function ImportRunner({ onFinished }: { onFinished: () => void }) {
  const [last, setLast] = React.useState<StepResult | null>(null);
  const loop = useStepLoop<StepResult>({
    path: "/api/admin/shopify/import",
    body: { action: "step" },
    onStep: setLast,
    isDone: (d) => d.done,
    isBusy: (d) => d.waiting,
    pollDelayMs: 4_000,
    onDone: onFinished,
  });
  const run = last?.run;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md bg-surface-2 px-3 py-2 text-xs">
      <RefreshCw className="size-3.5 animate-spin text-muted-foreground" aria-hidden />
      <span>
        {run ? `${RUN_KIND[run.kind] ?? run.kind}: ${RUN_STATUS[run.status]?.label ?? run.status}` : "Import läuft…"}
        {run && run.linesProcessed > 0 && (
          <>
            {" "}
            · {num(run.customersUpserted)} Kunden · {num(run.ordersUpserted)} Bestellungen
          </>
        )}
      </span>
      {loop.reconnecting && <StatusBadge tone="warning">Verbindung wird wiederhergestellt</StatusBadge>}
      {loop.error && <span className="text-destructive">{loop.error}</span>}
      {loop.paused || loop.error ? (
        <Button size="xs" variant="outline" onClick={loop.resume}>
          Fortsetzen
        </Button>
      ) : (
        <Button size="xs" variant="ghost" onClick={loop.pause}>
          Pause
        </Button>
      )}
    </div>
  );
}

export function ShopifySyncCard({ health, runs, outbox, flags }: ShopifySyncCardProps) {
  const router = useRouter();
  const { confirm, confirmDialog } = useConfirm();
  const activeRun = runs.find((r) => (r.kind === "import_customers" || r.kind === "import_orders") && (r.status === "running" || r.status === "processing"));
  const [importing, setImporting] = React.useState(Boolean(activeRun));
  const [busy, setBusy] = React.useState<null | "start" | "cancel" | number>(null);

  async function start() {
    const ok = await confirm({
      title: health?.importDone ? "Vollständigen Import erneut starten?" : "Shopify-Kundenstamm übernehmen?",
      description:
        "Alle Shopify-Kund:innen und ihre Bestellungen werden übernommen (Name, E-Mail, Sprache, Land, Tags, Einwilligung, Bestellungen mit Artikeln — keine Adressen, keine Telefonnummern). Das dauert je nach Größe einige Minuten; die Seite darf geschlossen werden. Es wird keine E-Mail verschickt.",
      confirmLabel: "Import starten",
    });
    if (!ok) return;
    setBusy("start");
    try {
      await adminFetch("/api/admin/shopify/import", { body: { action: "start" } });
      setImporting(true);
    } catch (e) {
      toast({ variant: "error", title: "Import nicht gestartet", description: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  }

  async function cancel() {
    setBusy("cancel");
    try {
      await adminFetch("/api/admin/shopify/import", { body: { action: "cancel" } });
      setImporting(false);
      router.refresh();
    } catch (e) {
      toast({ variant: "error", title: "Abbruch fehlgeschlagen", description: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  }

  async function retry(id: number) {
    setBusy(id);
    try {
      await adminFetch("/api/admin/shopify/outbox", { body: { id } });
      toast({ variant: "success", title: "Wird erneut versucht" });
      router.refresh();
    } catch (e) {
      toast({ variant: "error", title: "Nicht möglich", description: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  }

  const flagRows: Array<[string, string, boolean, string]> = [
    ["Kundenstamm abgleichen", "SHOPIFY_CUSTOMER_SYNC_ENABLED", flags.customerSync, "Import, Webhooks und nächtlicher Abgleich der Kund:innen und Bestellungen."],
    ["Einwilligung an Shopify zurückschreiben", "SHOPIFY_CONSENT_WRITEBACK", flags.consentWriteback, "An- und Abmeldungen aus Mo werden in Shopify übernommen; Mo-Abonnent:innen ohne Shopify-Konto werden dort angelegt."],
    ["Löschungen an Shopify weitergeben", "SHOPIFY_ERASURE_SYNC", flags.erasureSync, "Eine Löschung in Mo beantragt die Löschung der Kundendaten auch in Shopify."],
  ];

  return (
    <Card>
      {confirmDialog}
      <CardHeader className="flex flex-row flex-wrap items-center gap-2">
        <Store className="size-4 text-muted-foreground" aria-hidden />
        <CardTitle className="text-base">Shopify-Abgleich</CardTitle>
        <InfoTip>
          Shopify und Mo teilen sich Kundenstamm, Einwilligung und Löschung. Änderungen in Shopify kommen
          per Webhook sofort an, jede Nacht wird zusätzlich abgeglichen. Änderungen aus Mo gehen über eine
          Warteschlange zurück an Shopify (alle 5 Minuten, mit Wiederholung).
        </InfoTip>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!flags.configured && <Callout tone="warning">Shopify ist nicht konfiguriert (SHOPIFY_*).</Callout>}

        <div className="flex flex-wrap gap-1.5">
          {flagRows.map(([label, env, on, info]) => (
            <span key={env} className="inline-flex items-center gap-0.5">
              <StatusBadge tone={on ? "success" : "neutral"}>
                {label}: {on ? "an" : "aus"}
              </StatusBadge>
              <InfoTip>
                {info} ({env})
              </InfoTip>
            </span>
          ))}
          <span className="inline-flex items-center gap-0.5">
            <StatusBadge tone="neutral">KI-Profile: {flags.profileScope === "all" ? "alle" : "mit Einwilligung"}</StatusBadge>
            <InfoTip>CUSTOMER_AI_PROFILE_SCOPE — für wen KI-Profile entstehen.</InfoTip>
          </span>
        </div>

        <DescriptionList columns={3}>
          <DescriptionItem label="Kund:innen aus Shopify">{num(health?.mirroredCustomers ?? 0)}</DescriptionItem>
          <DescriptionItem label="Bestellungen (Kopie)">{num(health?.ledgerOrders ?? 0)}</DescriptionItem>
          <DescriptionItem label="Erster Import">
            {health?.lastImportAt ? formatAdmin(health.lastImportAt, ADMIN_DATE_TIME_SHORT) : "noch nicht"}
          </DescriptionItem>
          <DescriptionItem label="Nächtlicher Abgleich">
            {health?.lastReconcileAt ? relativeTime(health.lastReconcileAt) : "noch nie"}
          </DescriptionItem>
          <DescriptionItem label="Letzter Webhook">
            {health?.lastWebhookAt ? relativeTime(health.lastWebhookAt) : "noch keiner"}
            {health && health.webhooksLast24h > 0 && (
              <span className="text-muted-foreground"> · {num(health.webhooksLast24h)} in 24 h</span>
            )}
          </DescriptionItem>
          <DescriptionItem label="Warteschlange an Shopify">
            {outbox ? `${num(outbox.pending + outbox.failed)} offen · ${num(outbox.doneLast24h)} erledigt (24 h)` : "—"}
          </DescriptionItem>
        </DescriptionList>

        {importing ? (
          <div className="flex flex-col gap-2">
            <ImportRunner
              onFinished={() => {
                setImporting(false);
                toast({ variant: "success", title: "Import abgeschlossen", description: "Der Kundenstamm ist übernommen." });
                router.refresh();
              }}
            />
            <div>
              <Button size="xs" variant="ghost" onClick={() => void cancel()} loading={busy === "cancel"}>
                <X /> Import abbrechen
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant={health?.importDone ? "outline" : "default"}
              onClick={() => void start()}
              loading={busy === "start"}
              disabled={!flags.configured || !flags.customerSync}
            >
              {health?.importDone ? "Vollständig neu importieren" : "Kundenstamm übernehmen"}
            </Button>
            {!flags.customerSync && (
              <span className="text-xs text-muted-foreground">Erst SHOPIFY_CUSTOMER_SYNC_ENABLED einschalten.</span>
            )}
          </div>
        )}

        {outbox && outbox.deadRows.length > 0 && (
          <Callout tone="warning" title={`${num(outbox.dead)} Übertragungen an Shopify aufgegeben`}>
            <ul className="mt-1 flex flex-col gap-1">
              {outbox.deadRows.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-2 text-xs">
                  <span>{outboxKindLabel(r.kind)}</span>
                  <span className="text-muted-foreground">{formatAdmin(r.createdAt, ADMIN_DATE_TIME_SHORT)}</span>
                  {r.lastError && <span className="min-w-0 truncate text-muted-foreground">{r.lastError}</span>}
                  <Button size="xs" variant="outline" onClick={() => void retry(r.id)} loading={busy === r.id}>
                    Erneut versuchen
                  </Button>
                </li>
              ))}
            </ul>
          </Callout>
        )}

        {runs.length > 0 && (
          <Disclosure title="Letzte Läufe" framed={false}>
            <ul className="flex flex-col gap-1 text-xs">
              {runs.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-2">
                  <span className="tabular-nums text-muted-foreground">{formatAdmin(r.startedAt, ADMIN_DATE_TIME_SHORT)}</span>
                  <span>{RUN_KIND[r.kind] ?? r.kind}</span>
                  <StatusBadge tone={RUN_STATUS[r.status]?.tone ?? "neutral"}>{RUN_STATUS[r.status]?.label ?? r.status}</StatusBadge>
                  {(r.customersUpserted > 0 || r.ordersUpserted > 0) && (
                    <span className="text-muted-foreground">
                      {num(r.customersUpserted)} Kunden · {num(r.ordersUpserted)} Bestellungen
                    </span>
                  )}
                  {r.error && <span className="text-destructive">{r.error}</span>}
                </li>
              ))}
            </ul>
          </Disclosure>
        )}
      </CardContent>
    </Card>
  );
}
