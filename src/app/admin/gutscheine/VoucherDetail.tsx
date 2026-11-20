"use client";

// One Geschenkgutschein (right pane of „Gutscheine“): header (number, status,
// value), the state callouts (Achtung, Zu prüfen, Fehler, Gesperrt), the facts
// (value, balance + „Abgleichen“, valid until, the code „•••• last4“ +
// „Code anzeigen“, order, buyer, Für / Von, message, design + photo,
// delivery, e-mail), the internal note, the Premium-Karte's print job and
// the actions. Loads itself (GET /api/admin/gutscheine/item, audited); every
// action goes through POST /api/admin/gutscheine/action and answers the
// fresh detail. Sends (issue, resend, print) and the irreversible „Sperren“
// are confirmed.

import * as React from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FileDown,
  Gift,
  Mail,
  Printer,
  RefreshCw,
  RotateCcw,
  Send,
  X,
} from "lucide-react";
import { adminTabHref } from "@/lib/admin-tabs.mjs";
import { eurFromCents, num } from "@/lib/admin-format.mjs";
import { ADMIN_DATE, ADMIN_DATE_TIME_SHORT, formatAdmin } from "@/lib/admin-datetime.mjs";
import {
  Button,
  Callout,
  Card,
  CardContent,
  DescriptionItem,
  DescriptionList,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  IconButton,
  InfoTip,
  Input,
  Skeleton,
  StatusBadge,
  Textarea,
  toast,
  useConfirm,
} from "../ui";
import { adminFetch, errorMessage } from "../lib/admin-fetch";
import { useAsyncAction } from "../lib/use-async-action";
import { downloadFile } from "./download";
import {
  DEACTIVATION_REASON_MAX,
  NOTE_MAX,
  PRINT_PROVIDER_LABELS,
  attentionHint,
  attentionLabel,
  deliveryLabel,
  holdReasonHint,
  holdReasonLabel,
  mailStatusLabel,
  printJobActions,
  printStatusLabel,
  printStatusTone,
  voucherActions,
  voucherOriginLabel,
  voucherStatusLabel,
  voucherStatusTone,
  type GutscheinAction,
} from "./gutscheine-core.mjs";
import type { GutscheinDetail, GutscheinPrintJobView, GutscheineEnv } from "./types";

const ITEM_PATH = "/api/admin/gutscheine/item";
const ACTION_PATH = "/api/admin/gutscheine/action";

interface ActionAnswer {
  ok: true;
  detail?: GutscheinDetail | null;
  balanceCents?: number;
}

const SUCCESS_TITLES: Partial<Record<GutscheinAction, string>> = {
  issue_held: "Gutschein ausgestellt",
  reject: "Gutschein abgelehnt",
  retry: "Neuer Versuch geplant",
  resend_mail: "E-Mail wird erneut gesendet",
  deactivate: "Gutschein gesperrt",
  sync_balance: "Restguthaben abgeglichen",
  note: "Notiz gespeichert",
  clear_attention: "Als geklärt markiert",
  print_release: "Druck freigegeben",
  print_submit: "Karte an print.one übergeben",
  print_cancel: "Druckauftrag storniert",
  print_done: "Als versendet markiert",
};

export function VoucherDetail({
  id,
  env,
  onChanged,
  onClose,
}: {
  id: number;
  env: GutscheineEnv;
  /** After an action: refresh the list and the stats. */
  onChanged: () => void;
  onClose: () => void;
}) {
  const [detail, setDetail] = React.useState<GutscheinDetail | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [code, setCode] = React.useState<string | null>(null);
  const [note, setNote] = React.useState("");
  const [dialog, setDialog] = React.useState<null | "deactivate" | "reject">(null);
  const [busy, setBusy] = React.useState<GutscheinAction | null>(null);
  const [photoMissing, setPhotoMissing] = React.useState(false);
  const { confirm, confirmDialog } = useConfirm();

  React.useEffect(() => {
    const controller = new AbortController();
    adminFetch<GutscheinDetail>(`${ITEM_PATH}?id=${id}`, { signal: controller.signal })
      .then((d) => {
        if (controller.signal.aborted) return;
        setDetail(d);
        setNote(d.voucher.adminNote ?? "");
        setLoadError(null);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setLoadError(errorMessage(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [id]);

  const action = useAsyncAction(
    async (name: GutscheinAction, extra: Record<string, unknown> = {}) => {
      setBusy(name);
      try {
        const res = await adminFetch<ActionAnswer>(ACTION_PATH, { body: { action: name, id, ...extra } });
        return { name, res };
      } finally {
        setBusy(null);
      }
    },
    {
      errorToast: "Aktion nicht möglich",
      onSuccess: ({ name, res }) => {
        if (res.detail) {
          setDetail(res.detail);
          if (name === "note") setNote(res.detail.voucher.adminNote ?? "");
        }
        const title = SUCCESS_TITLES[name];
        if (title) toast({ variant: "success", title });
        onChanged();
      },
    }
  );
  const run = (name: GutscheinAction, extra: Record<string, unknown> = {}) => action.run(name, extra);
  const isBusy = (name: GutscheinAction) => action.pending && busy === name;

  const reveal = useAsyncAction(
    async () => adminFetch<{ ok: true; code: string }>(ACTION_PATH, { body: { action: "reveal_code", id } }),
    { errorToast: "Code nicht verfügbar", onSuccess: (r) => setCode(r.code) }
  );
  const download = useAsyncAction(async (path: string, name: string) => downloadFile(path, name), {
    errorToast: "Download nicht möglich",
  });

  if (loading && !detail) {
    return (
      <Card>
        <CardContent className="flex flex-col gap-3 p-5 pt-5">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-72" />
          <Skeleton className="h-32 w-full" />
        </CardContent>
      </Card>
    );
  }
  if (!detail) {
    return (
      <EmptyState
        icon={<Gift />}
        title="Gutschein nicht gefunden"
        description={loadError ?? undefined}
        className="min-h-[16rem]"
        action={
          <Button size="sm" variant="outline" onClick={onClose}>
            Auswahl aufheben
          </Button>
        }
      />
    );
  }

  const v = detail.voucher;
  const job = detail.printJob;
  const acts = voucherActions(v);
  const jobActs = job
    ? printJobActions(job, v, { gateOpen: env.printSendsApproved, printOneConfigured: env.printOneConfigured })
    : null;
  const mailTarget = v.source === "shop" ? v.buyerEmail : v.delivery === "email" ? v.recipientEmail : null;
  const noteDirty = note.trim() !== (v.adminNote ?? "").trim();

  const issueHeld = async () => {
    const ok = await confirm({
      title: `Gutschein über ${eurFromCents(v.amountCents)} jetzt ausstellen?`,
      description: `Die Geschenkkarte wird in Shopify angelegt und ist sofort im Shop einlösbar.${
        mailTarget ? ` Die E-Mail mit dem Gutschein geht an ${mailTarget}.` : ""
      }${job ? " Die Premium-Karte folgt über den Druckauftrag." : ""}`,
      confirmLabel: "Ausstellen",
    });
    if (ok) await run("issue_held");
  };
  const resendMail = async () => {
    if (!mailTarget) return;
    const ok = await confirm({
      title: "E-Mail erneut senden?",
      description: `Der Gutschein geht noch einmal an ${mailTarget} — mit einem neuen Download-Link; der alte Link funktioniert dann nicht mehr.`,
      confirmLabel: "Senden",
    });
    if (ok) await run("resend_mail");
  };
  const submitPrint = async (pj: GutscheinPrintJobView) => {
    const a = pj.address;
    const ok = await confirm({
      title: "Karte jetzt drucken?",
      description: `print.one druckt die Premium-Karte und schickt sie${a ? ` an ${a.name}, ${a.postalCode} ${a.city}` : ""} — ≈ ${eurFromCents(
        env.cardCostCents
      )} für Druck und Porto. Die Adresse geht dafür an print.one.`,
      confirmLabel: "Drucken",
    });
    if (ok) await run("print_submit");
  };
  const cancelPrint = async (pj: GutscheinPrintJobView) => {
    const ok = await confirm({
      title: "Druckauftrag stornieren?",
      description:
        pj.provider === "printone" && pj.providerOrderId
          ? "print.one wird gebeten, den Auftrag zu stornieren — das geht nur, solange die Karte noch nicht gedruckt wird."
          : "Die Karte wird nicht gedruckt. Der Gutschein selbst bleibt gültig.",
      confirmLabel: "Stornieren",
      tone: "destructive",
    });
    if (ok) await run("print_cancel");
  };

  const originLine =
    v.source === "shop"
      ? `Shop${v.shopifyOrderName ? ` · Bestellung ${v.shopifyOrderName}` : ""}`
      : `Von Hand · ${voucherOriginLabel(v)}`;

  return (
    <Card className="overflow-hidden">
      <CardContent className="flex flex-col gap-4 p-5 pt-5">
        {/* Header */}
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold tabular-nums">{v.number}</h2>
              <StatusBadge tone={voucherStatusTone(v.status)}>{voucherStatusLabel(v.status)}</StatusBadge>
              {v.attention && (
                <StatusBadge tone="warning" dot={false} icon={<AlertTriangle className="size-3" aria-hidden />}>
                  Achtung
                </StatusBadge>
              )}
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {originLine} · erstellt {formatAdmin(v.createdAt, ADMIN_DATE_TIME_SHORT)}
            </p>
          </div>
          <div className="text-right">
            <div className="text-2xl font-semibold tabular-nums tracking-tight">{eurFromCents(v.amountCents)}</div>
            {v.balanceCents !== null && v.issuedAt && (
              <div className="text-xs tabular-nums text-muted-foreground">Rest {eurFromCents(v.balanceCents)}</div>
            )}
          </div>
          <IconButton label="Auswahl schließen" size="icon-sm" onClick={onClose} className="-mr-2 -mt-1">
            <X />
          </IconButton>
        </div>

        {/* States */}
        {v.attention && (
          <Callout
            tone="warning"
            title={`Achtung: ${attentionLabel(v.attention)}`}
            action={
              <Button size="xs" variant="outline" onClick={() => void run("clear_attention")} loading={isBusy("clear_attention")}>
                <CheckCircle2 aria-hidden /> Als geklärt markieren
              </Button>
            }
          >
            {attentionHint(v.attention)}
          </Callout>
        )}
        {v.status === "held" && (
          <Callout tone="warning" title={`Zu prüfen: ${holdReasonLabel(v.holdReason)}`}>
            {holdReasonHint(v.holdReason) || "Ausstellen oder ablehnen."}
          </Callout>
        )}
        {(v.status === "failed" || (v.lastError && v.status !== "issued" && v.status !== "cancelled" && v.status !== "rejected")) && (
          <Callout tone="destructive" title={v.status === "failed" ? "Ausstellen fehlgeschlagen" : "Letzter Fehler"}>
            {v.lastError ?? "Unbekannter Fehler."}
            {v.attempts > 0 && <> · {num(v.attempts)} Versuche</>}
            {v.nextAttemptAt && v.status !== "failed" && <> · nächster Versuch {formatAdmin(v.nextAttemptAt, ADMIN_DATE_TIME_SHORT)}</>}
          </Callout>
        )}
        {v.status === "deactivated" && (
          <Callout tone="neutral" title={`Gesperrt${v.deactivatedAt ? ` am ${formatAdmin(v.deactivatedAt, ADMIN_DATE)}` : ""}`}>
            {v.deactivationReason ?? "Ohne Grund."}
          </Callout>
        )}
        {v.personalDataPurgedAt && (
          <Callout tone="neutral" compact>
            Namen, Texte und E-Mail-Adressen wurden am {formatAdmin(v.personalDataPurgedAt, ADMIN_DATE)} gelöscht
            (Aufbewahrungsfrist).
          </Callout>
        )}

        {/* Facts */}
        <DescriptionList columns={2}>
          <DescriptionItem label="Wert">{eurFromCents(v.amountCents)}</DescriptionItem>
          <DescriptionItem
            label="Restguthaben"
            info="Aus Shopify — täglich abgeglichen, „Abgleichen“ holt den Stand sofort."
          >
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="tabular-nums">{v.balanceCents === null ? "—" : eurFromCents(v.balanceCents)}</span>
              {v.balanceCheckedAt && (
                <span className="text-xs text-muted-foreground">Stand {formatAdmin(v.balanceCheckedAt, ADMIN_DATE_TIME_SHORT)}</span>
              )}
              {acts.syncBalance && (
                <Button size="xs" variant="ghost" onClick={() => void run("sync_balance")} loading={isBusy("sync_balance")}>
                  <RefreshCw aria-hidden /> Abgleichen
                </Button>
              )}
            </span>
          </DescriptionItem>
          <DescriptionItem label="Gültig bis">
            {v.expiresOn ? formatAdmin(v.expiresOn, ADMIN_DATE) : v.issuedAt ? "unbegrenzt" : "—"}
          </DescriptionItem>
          <DescriptionItem
            label="Code"
            info="Nur die letzten vier Zeichen sind gespeichert lesbar. „Code anzeigen“ entschlüsselt den ganzen Code — das wird protokolliert."
          >
            {!v.hasCode ? (
              <span className="text-muted-foreground">{v.codeLast4 ? `•••• •••• •••• ${v.codeLast4}` : "—"}</span>
            ) : code ? (
              <span className="flex flex-wrap items-center gap-1">
                <code className="rounded-md border border-border bg-surface-2 px-2 py-0.5 font-mono text-sm tracking-wider">{code}</code>
                <IconButton
                  label="Code kopieren"
                  size="icon-sm"
                  onClick={() => {
                    void navigator.clipboard
                      ?.writeText(code.replace(/\s+/g, ""))
                      .then(() => toast({ variant: "success", title: "Code kopiert" }))
                      .catch(() => toast({ variant: "error", title: "Kopieren nicht möglich" }));
                  }}
                >
                  <Copy />
                </IconButton>
                <IconButton label="Code verbergen" size="icon-sm" onClick={() => setCode(null)}>
                  <EyeOff />
                </IconButton>
              </span>
            ) : (
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-mono tracking-wider text-muted-foreground">•••• •••• •••• {v.codeLast4 ?? "????"}</span>
                <Button size="xs" variant="outline" onClick={() => void reveal.run()} loading={reveal.pending}>
                  <Eye aria-hidden /> Code anzeigen
                </Button>
              </span>
            )}
          </DescriptionItem>
          <DescriptionItem label={v.source === "shop" ? "Bestellung" : "Anlass"}>
            {v.source === "shop" ? (
              detail.orderUrl ? (
                <a
                  href={detail.orderUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-medium text-accent hover:underline"
                >
                  {v.shopifyOrderName ?? "Bestellung"} <ExternalLink className="size-3.5" aria-hidden />
                  <span className="sr-only">(in Shopify öffnen)</span>
                </a>
              ) : (
                (v.shopifyOrderName ?? "—")
              )
            ) : (
              <span className="flex flex-col">
                <span>{voucherOriginLabel(v)}</span>
                <span className="text-xs text-muted-foreground">von Hand ausgestellt{v.createdBy ? ` (${v.createdBy})` : ""}</span>
              </span>
            )}
          </DescriptionItem>
          {v.source === "shop" && (
            <DescriptionItem label="Käufer">
              {v.buyerName || v.buyerEmail ? (
                <span className="flex flex-col">
                  {v.buyerName && <span>{v.buyerName}</span>}
                  {v.buyerEmail && <span className="truncate text-xs text-muted-foreground">{v.buyerEmail}</span>}
                  {v.customerId !== null && (
                    <Link href={adminTabHref("kunden", { customer: String(v.customerId) })} className="text-xs text-accent hover:underline">
                      Kunde öffnen
                    </Link>
                  )}
                </span>
              ) : (
                "—"
              )}
            </DescriptionItem>
          )}
          <DescriptionItem label="Für">{v.recipientName ?? "—"}</DescriptionItem>
          <DescriptionItem label="Von">{v.senderName ?? "—"}</DescriptionItem>
          <DescriptionItem label="Nachricht" className="sm:col-span-2" valueClassName="whitespace-pre-wrap">
            {v.message ?? "—"}
          </DescriptionItem>
          <DescriptionItem label="Motiv">
            <span className="flex items-center gap-3">
              {v.photoPathname && !photoMissing && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`/api/admin/gutscheine/photo?id=${v.id}`}
                  alt="Foto des Gutscheins"
                  className="h-14 w-auto max-w-[6rem] rounded-md border border-border bg-surface-2 object-cover"
                  onError={() => setPhotoMissing(true)}
                />
              )}
              <span>
                {detail.designName}
                {v.photoPathname && photoMissing && <span className="text-xs text-muted-foreground"> · Foto nicht verfügbar</span>}
              </span>
            </span>
          </DescriptionItem>
          <DescriptionItem label="Versand">
            {deliveryLabel(v.delivery)}
            {v.delivery === "email" && v.recipientEmail && <span className="text-muted-foreground"> an {v.recipientEmail}</span>}
          </DescriptionItem>
          <DescriptionItem label="E-Mail">
            {mailStatusLabel(v.mailStatus)}
            {v.mailedAt && <span className="text-muted-foreground"> · {formatAdmin(v.mailedAt, ADMIN_DATE_TIME_SHORT)}</span>}
            {v.mailStatus !== "sent" && v.mailAttempts > 0 && <span className="text-muted-foreground"> · {num(v.mailAttempts)} Versuche</span>}
          </DescriptionItem>
          <DescriptionItem label="Ausgestellt">
            {v.issuedAt ? formatAdmin(v.issuedAt, ADMIN_DATE_TIME_SHORT) : "—"}
          </DescriptionItem>
        </DescriptionList>

        <Field
          label="Interne Notiz"
          info="Nur hier im Admin sichtbar — nie auf dem Gutschein oder in einer E-Mail."
          labelEnd={
            noteDirty ? (
              <Button size="xs" onClick={() => void run("note", { note })} loading={isBusy("note")}>
                Speichern
              </Button>
            ) : undefined
          }
        >
          <Textarea rows={2} value={note} maxLength={NOTE_MAX} onChange={(e) => setNote(e.target.value)} placeholder="z. B. Ticket-Nummer, Absprache mit der Kundin" />
        </Field>

        {job && jobActs && (
          <PrintJobCard
            job={job}
            acts={jobActs}
            isBusy={isBusy}
            onRun={(name) => void run(name)}
            onSubmit={() => void submitPrint(job)}
            onCancel={() => void cancelPrint(job)}
            onDownload={(side) =>
              void download.run(`/api/admin/gutscheine/print-file?id=${v.id}&side=${side}`, `Gutschein-${v.number}-${side === "outside" ? "aussen" : "innen"}.jpg`)
            }
            downloading={download.pending}
            costEstimateCents={env.cardCostCents}
          />
        )}

        {/* Actions */}
        {(acts.issueHeld || acts.reject || acts.retry || acts.pdf || acts.resendMail || acts.deactivate) && (
          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
            {acts.issueHeld && (
              <Button onClick={() => void issueHeld()} loading={isBusy("issue_held")}>
                <Gift aria-hidden /> Ausstellen
              </Button>
            )}
            {acts.retry && (
              <Button onClick={() => void run("retry")} loading={isBusy("retry")}>
                <RotateCcw aria-hidden /> Erneut versuchen
              </Button>
            )}
            {acts.pdf && (
              <Button
                variant="outline"
                onClick={() => void download.run(`/api/admin/gutscheine/pdf?id=${v.id}`, `Gutschein-${v.number}.pdf`)}
                loading={download.pending}
              >
                <FileDown aria-hidden /> PDF herunterladen
              </Button>
            )}
            {acts.resendMail && (
              <Button
                variant="outline"
                onClick={() => void resendMail()}
                loading={isBusy("resend_mail")}
                disabled={!env.emailConfigured}
              >
                <Mail aria-hidden /> E-Mail erneut senden
              </Button>
            )}
            {acts.reject && (
              <Button variant="ghost" className="[&_svg]:text-destructive" onClick={() => setDialog("reject")}>
                <Ban aria-hidden /> Ablehnen
              </Button>
            )}
            {acts.deactivate && (
              <Button variant="ghost" className="ml-auto [&_svg]:text-destructive" onClick={() => setDialog("deactivate")}>
                <Ban aria-hidden /> Sperren
              </Button>
            )}
          </div>
        )}

        <ReasonDialog
          open={dialog === "deactivate"}
          onOpenChange={(o) => !o && setDialog(null)}
          title={`Gutschein ${v.number} sperren?`}
          description={`Die Geschenkkarte wird in Shopify deaktiviert und ist dann nicht mehr einlösbar — das lässt sich nicht rückgängig machen.${
            v.balanceCents !== null ? ` Restguthaben: ${eurFromCents(v.balanceCents)}.` : ""
          }`}
          label="Grund"
          required
          maxLength={DEACTIVATION_REASON_MAX}
          placeholder="z. B. Bestellung erstattet"
          confirmLabel="Sperren"
          pending={isBusy("deactivate")}
          onConfirm={async (reason) => {
            const r = await run("deactivate", { reason });
            if (r) setDialog(null);
          }}
        />
        <ReasonDialog
          open={dialog === "reject"}
          onOpenChange={(o) => !o && setDialog(null)}
          title={`Gutschein ${v.number} ablehnen?`}
          description="Es wird keine Geschenkkarte ausgestellt. Eine Erstattung läuft über Shopify."
          label="Notiz (optional)"
          maxLength={NOTE_MAX}
          placeholder="z. B. Betrugsverdacht, Bestellung erstattet"
          confirmLabel="Ablehnen"
          pending={isBusy("reject")}
          onConfirm={async (text) => {
            const r = await run("reject", { note: text });
            if (r) setDialog(null);
          }}
        />
        {confirmDialog}
      </CardContent>
    </Card>
  );
}

function PrintJobCard({
  job,
  acts,
  isBusy,
  onRun,
  onSubmit,
  onCancel,
  onDownload,
  downloading,
  costEstimateCents,
}: {
  job: GutscheinPrintJobView;
  acts: ReturnType<typeof printJobActions>;
  isBusy: (name: GutscheinAction) => boolean;
  onRun: (name: GutscheinAction) => void;
  onSubmit: () => void;
  onCancel: () => void;
  onDownload: (side: "outside" | "inside") => void;
  downloading: boolean;
  costEstimateCents: number;
}) {
  const a = job.address;
  const anyAction = acts.release || acts.submit || acts.files || acts.done || acts.cancel;
  return (
    <section className="flex flex-col gap-3 rounded-md border border-border bg-surface-2 p-3" aria-label="Premium-Karte">
      <div className="flex flex-wrap items-center gap-2">
        <Printer className="size-4 text-muted-foreground" aria-hidden />
        <h3 className="text-sm font-semibold">Premium-Karte</h3>
        <StatusBadge tone={printStatusTone(job.status)}>{printStatusLabel(job.status)}</StatusBadge>
        <span className="text-xs text-muted-foreground">{PRINT_PROVIDER_LABELS[job.provider]}</span>
        <InfoTip panelClassName="max-w-sm">
          Gefaltete Karte 14 × 14 cm im Umschlag. „Zu prüfen“: eine Karte mit Kundenfoto wartet auf „Freigeben“. Über
          print.one geht sie erst mit der Freigabe GIFT_VOUCHER_PRINT_SENDS_APPROVED hinaus (Mo übermittelt wartende
          Karten alle 5 Minuten, „Jetzt drucken“ sofort); „Von Hand“: Druckdateien herunterladen, drucken, verschicken und
          „Als versendet markieren“.
        </InfoTip>
      </div>
      <div className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
        <div className="min-w-0">
          <div className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">Empfänger</div>
          {a ? (
            <address className="mt-0.5 not-italic">
              {a.name}
              <br />
              {a.addressLine1}
              {a.addressLine2 && (
                <>
                  <br />
                  {a.addressLine2}
                </>
              )}
              <br />
              {a.postalCode} {a.city}
              {a.country !== "DE" && <> · {a.country}</>}
            </address>
          ) : (
            <p className="mt-0.5 text-muted-foreground">Keine Adresse</p>
          )}
        </div>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
          <dt className="text-muted-foreground">Kosten</dt>
          <dd className="tabular-nums">
            {job.costCents !== null
              ? eurFromCents(job.costCents)
              : job.provider === "printone" && !["sent", "failed", "cancelled", "done"].includes(job.status)
                ? `≈ ${eurFromCents(costEstimateCents)}`
                : "—"}
          </dd>
          {job.providerOrderId && (
            <>
              <dt className="text-muted-foreground">Auftrag</dt>
              <dd className="truncate font-mono">{job.providerOrderId}</dd>
            </>
          )}
          {job.providerStatus && (
            <>
              <dt className="text-muted-foreground">print.one</dt>
              <dd className="truncate">{job.providerStatus}</dd>
            </>
          )}
          {job.submittedAt && (
            <>
              <dt className="text-muted-foreground">Übermittelt</dt>
              <dd>{formatAdmin(job.submittedAt, ADMIN_DATE_TIME_SHORT)}</dd>
            </>
          )}
          {job.sentAt && (
            <>
              <dt className="text-muted-foreground">Versendet</dt>
              <dd>{formatAdmin(job.sentAt, ADMIN_DATE_TIME_SHORT)}</dd>
            </>
          )}
          <dt className="text-muted-foreground">Angelegt</dt>
          <dd>{formatAdmin(job.createdAt, ADMIN_DATE_TIME_SHORT)}</dd>
        </dl>
      </div>
      {job.error && (
        <Callout tone="destructive" compact>
          {job.error}
        </Callout>
      )}
      {acts.submitBlocked && (
        <Callout tone="neutral" compact>
          „Jetzt drucken“ gesperrt: {acts.submitBlocked}
        </Callout>
      )}
      {anyAction && (
        <div className="flex flex-wrap items-center gap-2">
          {acts.release && (
            <Button size="sm" onClick={() => onRun("print_release")} loading={isBusy("print_release")}>
              <CheckCircle2 aria-hidden /> Freigeben
            </Button>
          )}
          {acts.submit && (
            <Button size="sm" onClick={onSubmit} loading={isBusy("print_submit")} disabled={acts.submitBlocked !== null}>
              <Send aria-hidden /> Jetzt drucken
            </Button>
          )}
          {acts.files && (
            <>
              <Button size="sm" variant="outline" onClick={() => onDownload("outside")} loading={downloading}>
                <Download aria-hidden /> Außenseite
              </Button>
              <Button size="sm" variant="outline" onClick={() => onDownload("inside")} loading={downloading}>
                <Download aria-hidden /> Innenseite
              </Button>
            </>
          )}
          {acts.done && (
            <Button size="sm" variant="outline" onClick={() => onRun("print_done")} loading={isBusy("print_done")}>
              <CheckCircle2 aria-hidden /> Als versendet markieren
            </Button>
          )}
          {acts.cancel && (
            <Button size="sm" variant="ghost" className="ml-auto [&_svg]:text-destructive" onClick={onCancel} loading={isBusy("print_cancel")}>
              <X aria-hidden /> Stornieren
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

/** A confirmation with one text input (Sperren: required reason; Ablehnen: optional note). */
function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  label,
  required = false,
  maxLength,
  placeholder,
  confirmLabel,
  pending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  label: string;
  required?: boolean;
  maxLength: number;
  placeholder: string;
  confirmLabel: string;
  pending: boolean;
  onConfirm: (text: string) => Promise<void>;
}) {
  const [text, setText] = React.useState("");
  React.useEffect(() => {
    if (open) setText("");
  }, [open]);
  const tooShort = required && text.trim().length < 3;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form
          className="mt-4 flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!tooShort) void onConfirm(text.trim());
          }}
        >
          <Field label={label} required={required}>
            {required ? (
              <Input value={text} maxLength={maxLength} onChange={(e) => setText(e.target.value)} placeholder={placeholder} data-autofocus="" />
            ) : (
              <Textarea rows={3} value={text} maxLength={maxLength} onChange={(e) => setText(e.target.value)} placeholder={placeholder} data-autofocus="" />
            )}
          </Field>
          <DialogFooter className="mt-0">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Abbrechen
            </Button>
            <Button type="submit" variant="destructive" loading={pending} disabled={tooShort}>
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
