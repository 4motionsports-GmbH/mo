"use client";

// The desk's „Briefe“ view (`?view=briefe`, migration 0074, docs/CAMPAIGNS.md
// §8): the campaign's letter recipients, one letter at a time — address from
// the latest completed order, AI draft, edit, PDF preview, release — and the
// batch steps (addresses, drafts, sending the released letters). Every letter
// is released by a person; „Freigegebene senden“ posts only released ones and
// the server re-checks every gate per letter. Self-loading (POST
// /api/admin/campaigns/letters { action: "list" }) so the desk does not ship
// every letter text on each render.

import * as React from "react";
import { CheckCircle2, Eye, FileText, MapPin, RefreshCw, Send, SkipForward, Sparkles, Undo2 } from "lucide-react";
import { eurFromCents, num, plural } from "@/lib/admin-format.mjs";
import { formatAdmin, ADMIN_DATE_TIME_SHORT } from "@/lib/admin-datetime.mjs";
import type { LetterDeskData, LetterDeskItem } from "@/lib/campaign-letters";
import {
  Button,
  Callout,
  DataTable,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  InfoTip,
  Input,
  SegmentedControl,
  Spinner,
  SplitPane,
  StatusBadge,
  Textarea,
  toast,
  useConfirm,
  type DataTableColumn,
  type StatusTone,
} from "../ui";
import { adminFetch, errorMessage } from "../lib/admin-fetch";
import { useAsyncAction } from "../lib/use-async-action";
import { useStepLoop } from "../lib/use-step-loop";
import { fetchPdf } from "../lib/fetch-pdf";

const PATH = "/api/admin/campaigns/letters";

type Filter = "offen" | "freigegeben" | "versendet" | "alle";

const STATUS: Record<LetterDeskItem["status"], { label: string; tone: StatusTone }> = {
  pending: { label: "Ohne Text", tone: "neutral" },
  drafted: { label: "Entwurf", tone: "info" },
  approved: { label: "Freigegeben", tone: "success" },
  sending: { label: "Wird gesendet", tone: "info" },
  sent: { label: "Versendet", tone: "success" },
  skipped: { label: "Übersprungen", tone: "neutral" },
  excluded: { label: "Ausgeschlossen", tone: "neutral" },
  failed: { label: "Fehler", tone: "destructive" },
};

const POSTED: Record<string, string> = {
  pending: "angelegt",
  submitted: "an Pingen übergeben",
  queued: "in der Warteschlange",
  printing: "wird gedruckt",
  printed: "gedruckt",
  posted: "bei der Post",
  failed: "Fehler bei Pingen",
  cancelled: "storniert",
  undeliverable: "unzustellbar",
};

const EXCLUDED: Record<string, string> = {
  widerspruch: "Widerspruch gegen Briefwerbung",
  einwilligung: "hat inzwischen eine E-Mail-Einwilligung",
  zielgruppe: "passt nicht mehr zur Zielgruppe",
  kein_kauf: "keine abgeschlossene Bestellung",
};

function inFilter(item: LetterDeskItem, f: Filter): boolean {
  if (f === "alle") return true;
  if (f === "offen") return item.status === "pending" || item.status === "drafted" || item.status === "failed";
  if (f === "freigegeben") return item.status === "approved" || item.status === "sending";
  return item.status === "sent";
}

/** Missing purchase address — the row already says „Adresse fehlt“; „Adressen holen“ fixes it. */
const ADDRESS_KEYS = new Set(["no_address", "not_purchase_address"]);

/** Refusals a release cannot outlive — everything else (address, cadence, budget, flag) is re-checked at the send. */
const APPROVE_BLOCKERS = new Set(["objection", "consent_now", "address_invalid", "no_text"]);

interface AddressStep { checked: number; filled: number; noOrder: number; noAddress: number; failed: number; remaining: number }
interface DraftStep { drafted: number; failed: number; remaining: number }
interface SendStep { sent: number; refused: Array<{ id: number; message: string }>; remaining: number }

export function LettersView({ campaignId, campaignName }: { campaignId: number; campaignName: string }) {
  const [data, setData] = React.useState<LetterDeskData | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [filter, setFilter] = React.useState<Filter>("offen");
  const [selectedId, setSelectedId] = React.useState<number | null>(null);
  const [run, setRun] = React.useState<string | null>(null);
  const { confirm, confirmDialog } = useConfirm();

  const load = React.useCallback(async () => {
    try {
      setData(await adminFetch<LetterDeskData>(PATH, { body: { action: "list", campaignId } }));
      setLoadError(null);
    } catch (err) {
      setLoadError(errorMessage(err));
    }
  }, [campaignId]);
  React.useEffect(() => {
    void load();
  }, [load]);

  const totals = React.useRef({ a: 0, d: 0, s: 0, r: 0 });
  const addressLoop = useStepLoop<AddressStep>({
    path: PATH,
    body: { action: "fill_addresses", campaignId },
    autoStart: false,
    isDone: (d) => d.remaining === 0 || d.checked === 0,
    onStep: (d) => {
      totals.current.a += d.filled;
      setRun(`Adressen: ${num(totals.current.a)} übernommen …`);
      void load();
    },
    onDone: () => {
      setRun(null);
      toast({ variant: "success", title: `Adressen geholt: ${num(totals.current.a)} übernommen` });
      void load();
    },
  });
  const draftLoop = useStepLoop<DraftStep>({
    path: PATH,
    body: { action: "draft", campaignId },
    autoStart: false,
    isDone: (d) => d.remaining === 0 || d.drafted === 0,
    onStep: (d) => {
      totals.current.d += d.drafted;
      setRun(`Entwürfe: ${num(totals.current.d)} geschrieben …`);
      void load();
    },
    onDone: () => {
      setRun(null);
      toast({ variant: "success", title: `${plural(totals.current.d, "Entwurf", "Entwürfe")} geschrieben` });
      void load();
    },
  });
  const sendLoop = useStepLoop<SendStep>({
    path: PATH,
    body: { action: "send_step", campaignId },
    autoStart: false,
    isDone: (d) => d.remaining === 0 || (d.sent === 0 && d.refused.length === 0),
    onStep: (d) => {
      totals.current.s += d.sent;
      totals.current.r += d.refused.length;
      setRun(`Versand: ${num(totals.current.s)} gesendet …`);
      void load();
    },
    onDone: () => {
      setRun(null);
      const { s, r } = totals.current;
      toast({
        variant: r > 0 ? "warning" : "success",
        title: `${plural(s, "Brief", "Briefe")} gesendet`,
        description: r > 0 ? `${plural(r, "Brief kam", "Briefe kamen")} mit Grund zurück in die Prüfung.` : undefined,
      });
      void load();
    },
  });
  const busy = addressLoop.running || draftLoop.running || sendLoop.running;
  const loopError = addressLoop.error ?? draftLoop.error ?? sendLoop.error;

  const startAddresses = () => {
    totals.current.a = 0;
    addressLoop.start();
  };
  const startDrafts = async () => {
    if (!data) return;
    const n = data.counts.pending;
    const ok = await confirm({
      title: `${plural(n, "Entwurf", "Entwürfe")} schreiben?`,
      description: "Ein KI-Aufruf je Brief (Kampagnen-Briefe in den KI-Kosten). Jeden Brief prüfst und gibst du danach einzeln frei.",
      confirmLabel: "Schreiben",
    });
    if (!ok) return;
    totals.current.d = 0;
    draftLoop.start();
  };
  const startSend = async () => {
    if (!data) return;
    const n = data.counts.approved;
    const allowed = data.affordable == null ? n : Math.min(n, data.affordable);
    const ok = await confirm({
      title: `${plural(allowed, "Brief", "Briefe")} senden?`,
      description: (
        <>
          ≈ {num(allowed)} × {eurFromCents(data.costCents)} = {eurFromCents(allowed * data.costCents)} Porto
          {data.affordable != null && data.affordable < n ? ` (das Budget reicht für ${num(data.affordable)})` : ""}.{" "}
          {data.staging ? "Pingen-Testumgebung — es wird nichts gedruckt." : "Die Briefe werden gedruckt und mit der Post verschickt."}{" "}
          Jeder Brief wird vor dem Versand noch einmal geprüft (Widerspruch, Einwilligung, Adresse, Abstand, Budget).
        </>
      ),
      confirmLabel: "Senden",
    });
    if (!ok) return;
    totals.current.s = 0;
    totals.current.r = 0;
    sendLoop.start();
  };

  const items = React.useMemo(() => (data?.items ?? []).filter((i) => inFilter(i, filter)), [data, filter]);
  const selected =
    (data?.items ?? []).find((i) => i.id === selectedId) ?? (items.length > 0 ? items[0] : null);

  if (!data) {
    return loadError ? (
      <Callout tone="destructive">{loadError}</Callout>
    ) : (
      <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
        <Spinner className="size-4" /> Briefe werden geladen …
      </div>
    );
  }
  const c = data.counts;
  const open = c.pending + c.drafted + c.failed;

  const columns: DataTableColumn<LetterDeskItem>[] = [
    {
      key: "name",
      header: "Empfänger:in",
      cell: (r) => (
        <div className="min-w-0">
          <div className="truncate font-medium">{r.name}</div>
          <div className="truncate text-xs text-muted-foreground">{r.addressLine ? r.addressLine.split(", ").slice(-2).join(", ") : "Adresse fehlt"}</div>
        </div>
      ),
      sortValue: (r) => r.name.toLowerCase(),
    },
    {
      key: "status",
      header: "Status",
      cell: (r) => (
        <div className="flex flex-wrap gap-1">
          <StatusBadge tone={STATUS[r.status].tone} dot={false}>
            {STATUS[r.status].label}
          </StatusBadge>
          {r.checks.blocked.some((b) => !ADDRESS_KEYS.has(b.key)) && (
            <StatusBadge tone="destructive" dot={false}>
              Blockiert
            </StatusBadge>
          )}
          {!r.checks.blocked.some((b) => !ADDRESS_KEYS.has(b.key)) && r.checks.hints.length > 0 && (
            <StatusBadge tone="warning" dot={false}>
              {plural(r.checks.hints.length, "Hinweis", "Hinweise")}
            </StatusBadge>
          )}
        </div>
      ),
      width: "11rem",
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl
          label="Briefe filtern"
          value={filter}
          onChange={(f) => setFilter(f)}
          options={[
            { value: "offen", label: `Offen ${num(open)}` },
            { value: "freigegeben", label: `Freigegeben ${num(c.approved + c.sending)}` },
            { value: "versendet", label: `Versendet ${num(c.sent)}` },
            { value: "alle", label: "Alle" },
          ]}
        />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={startAddresses} disabled={busy || !data.lettersOn || c.addressFetchable === 0 || !data.flagApproved} loading={addressLoop.running}>
            <MapPin /> Adressen holen ({num(c.addressFetchable)})
          </Button>
          <Button size="sm" variant="outline" onClick={() => void startDrafts()} disabled={busy || !data.lettersOn || c.pending === 0} loading={draftLoop.running}>
            <Sparkles /> Entwürfe schreiben ({num(c.pending)})
          </Button>
          <Button
            size="sm"
            onClick={() => void startSend()}
            disabled={busy || !data.lettersOn || c.approved === 0 || !data.flagApproved || !data.pingenConfigured || !data.campaignLive || data.affordable === 0}
            loading={sendLoop.running}
          >
            <Send /> Freigegebene senden ({num(c.approved)})
          </Button>
          <InfoTip>
            Adressen: die Lieferadresse der letzten abgeschlossenen Bestellung, nur für diese Empfänger:innen. Entwürfe:
            KI-Text je Brief, ohne Adresse, ohne Rabattcode. Senden: nur einzeln freigegebene Briefe; jeder wird vorher
            noch einmal geprüft (Widerspruch, Einwilligung, Adresse, Abstand zum letzten Brief, Budget).
          </InfoTip>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Porto bisher {eurFromCents(c.spentCents)} · ≈ {eurFromCents(data.costCents)} je Brief
        {data.budgetCents != null && (
          <>
            {" "}
            · Budget {eurFromCents(data.budgetCents)}
            {data.affordable != null && ` (reicht noch für ${plural(data.affordable, "Brief", "Briefe")})`}
          </>
        )}
        {c.addressMissing > 0 && ` · ${num(c.addressMissing)} ohne Kaufadresse`}
        {c.excluded + c.skipped > 0 && ` · ${num(c.excluded)} ausgeschlossen, ${num(c.skipped)} übersprungen`}
      </p>

      {!data.lettersOn && (
        <Callout tone="neutral">
          Briefe sind für diese Kampagne ausgeschaltet (Bearbeiten → Brief) — die vorhandenen Briefe bleiben sichtbar; es werden
          keine Entwürfe geschrieben, freigegeben oder gesendet.
        </Callout>
      )}
      {!data.flagApproved && (
        <Callout tone="warning">
          Briefversand ist nicht freigeschaltet (PHYSICAL_MAIL_SENDS_APPROVED) — Briefe lassen sich schreiben und freigeben,
          aber nicht senden; Adressen werden erst geholt, wenn er an ist.
        </Callout>
      )}
      {data.flagApproved && !data.pingenConfigured && <Callout tone="warning">Pingen ist nicht konfiguriert — Senden ist gesperrt.</Callout>}
      {!data.campaignLive && (
        <Callout tone="warning">
          Die Kampagne läuft gerade nicht (Entwurf, pausiert, beendet oder außerhalb ihres Zeitraums) — Briefe lassen sich
          vorbereiten und freigeben, gesendet wird erst, wenn sie läuft.
        </Callout>
      )}
      {data.staging && <Callout tone="info">Pingen-Testumgebung (PINGEN_STAGING) — es wird nichts gedruckt oder verschickt.</Callout>}
      {run && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
          <Spinner className="size-3.5" /> {run}
        </div>
      )}
      {loopError && <Callout tone="destructive">{loopError}</Callout>}

      {data.items.length === 0 ? (
        <EmptyState
          icon={<FileText />}
          title="Noch keine Brief-Empfänger:innen"
          description="Sie kommen mit „Zielgruppe aktualisieren“ (⋯-Menü) oder dem nächtlichen Abgleich — Personen mit abgeschlossener Bestellung, ohne Widerspruch gegen Briefwerbung."
        />
      ) : (
        <SplitPane
          listWidth="lg"
          listLabel="Briefe"
          list={
            <DataTable
              columns={columns}
              rows={items}
              rowKey={(r) => r.id}
              dense
              selectedKey={selected?.id ?? null}
              onRowClick={(r) => setSelectedId(r.id)}
              maxHeight="calc(100vh - 18rem)"
              empty={<p className="p-4 text-sm text-muted-foreground">Keine Briefe in dieser Auswahl.</p>}
            />
          }
          detail={
            selected ? (
              <LetterDetail key={selected.id} item={selected} campaignName={campaignName} onChanged={load} />
            ) : (
              <p className="text-sm text-muted-foreground">Links einen Brief auswählen.</p>
            )
          }
        />
      )}
      {confirmDialog}
    </div>
  );
}

function LetterDetail({
  item,
  campaignName,
  onChanged,
}: {
  item: LetterDeskItem;
  campaignName: string;
  onChanged: () => Promise<void>;
}) {
  const [subject, setSubject] = React.useState(item.subject ?? "");
  const [body, setBody] = React.useState(item.body ?? "");
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);
  const dirty = subject !== (item.subject ?? "") || body !== (item.body ?? "");
  const editable = ["pending", "drafted", "approved", "failed"].includes(item.status);

  React.useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const act = useAsyncAction(
    async (action: string, extra: Record<string, unknown> = {}) => {
      await adminFetch(PATH, { body: { action, id: item.id, ...extra } });
      await onChanged();
    },
    { errorToast: "Aktion nicht möglich" }
  );
  const preview = useAsyncAction(
    async () => {
      const blob = await fetchPdf(`${PATH}/preview`, { id: item.id, subject, body });
      setPreviewUrl(URL.createObjectURL(blob));
    },
    { errorToast: "Vorschau nicht möglich" }
  );

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">{item.name}</span>
        <span className="truncate text-xs text-muted-foreground">{item.email}</span>
        <StatusBadge tone={STATUS[item.status].tone} dot={false}>
          {STATUS[item.status].label}
        </StatusBadge>
        {item.language === "en" && (
          <StatusBadge tone="info" dot={false}>
            EN
          </StatusBadge>
        )}
      </div>

      <div className="flex items-start gap-1.5 text-xs">
        <MapPin className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        {item.addressLine ? (
          <span>{item.addressLine}</span>
        ) : (
          <span className="text-muted-foreground">
            Keine Adresse aus einer abgeschlossenen Bestellung — „Adressen holen“.
          </span>
        )}
      </div>

      {item.status === "excluded" && item.excludedReason && (
        <Callout tone="neutral">Ausgeschlossen: {EXCLUDED[item.excludedReason] ?? item.excludedReason}.</Callout>
      )}
      {item.status === "sent" && (
        <Callout tone="success">
          Versendet {item.sentAt ? formatAdmin(item.sentAt, ADMIN_DATE_TIME_SHORT) : ""}
          {item.letterStatus ? ` — ${POSTED[item.letterStatus] ?? item.letterStatus}` : ""}
          {item.pageCount ? ` · ${plural(item.pageCount, "Seite", "Seiten")}` : ""}
          {item.costCents != null ? ` · ${eurFromCents(item.costCents)}` : ""}.
        </Callout>
      )}
      {item.error && editable && <Callout tone="destructive">Zurück aus dem Versand: {item.error}</Callout>}
      {editable && item.checks.blocked.map((b) => (
        <Callout key={b.key} tone={ADDRESS_KEYS.has(b.key) ? "warning" : "destructive"}>
          {b.title}
        </Callout>
      ))}
      {editable && item.checks.hints.length > 0 && (
        <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground">
          {item.checks.hints.map((h) => (
            <li key={h.key}>• {h.title}</li>
          ))}
        </ul>
      )}

      {item.status === "pending" && !item.body ? (
        <div className="flex flex-col items-start gap-2 py-2">
          <p className="text-sm text-muted-foreground">Noch kein Text für diesen Brief.</p>
          <Button size="sm" variant="outline" onClick={() => void act.run("redraft")} loading={act.pending}>
            <Sparkles /> Entwurf schreiben
          </Button>
        </div>
      ) : (
        <>
          <Field label="Betreff">
            <Input value={subject} maxLength={200} disabled={!editable} onChange={(e) => setSubject(e.target.value)} />
          </Field>
          <Field
            label="Brieftext"
            info={`Gedruckt für „${campaignName}“. Widerspruchshinweis (Art. 21 DSGVO), Absender und Datenschutz stehen fest im Fuß jeder Seite — nicht in den Text schreiben.`}
          >
            <Textarea rows={14} value={body} maxLength={8000} disabled={!editable} onChange={(e) => setBody(e.target.value)} />
          </Field>
        </>
      )}

      <div className="flex flex-wrap gap-1.5">
        {editable && dirty && (
          <Button size="sm" onClick={() => void act.run("save", { subject, body })} loading={act.pending}>
            Speichern
          </Button>
        )}
        {item.body && (
          <Button size="sm" variant="outline" onClick={() => void preview.run()} loading={preview.pending}>
            <Eye /> Vorschau
          </Button>
        )}
        {item.status === "drafted" && !dirty && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => void act.run("approve")}
            loading={act.pending}
            disabled={item.checks.blocked.some((b) => APPROVE_BLOCKERS.has(b.key))}
          >
            <CheckCircle2 /> Freigeben
          </Button>
        )}
        {item.status === "approved" && (
          <Button size="sm" variant="outline" onClick={() => void act.run("unapprove")} loading={act.pending}>
            <Undo2 /> Zurücknehmen
          </Button>
        )}
        {editable && item.body && (
          <Button size="sm" variant="ghost" onClick={() => void act.run("redraft")} loading={act.pending}>
            <RefreshCw /> Neu schreiben
          </Button>
        )}
        {editable && (
          <Button size="sm" variant="ghost" onClick={() => void act.run("skip")} loading={act.pending}>
            <SkipForward /> Überspringen
          </Button>
        )}
        {item.status === "skipped" && (
          <Button size="sm" variant="outline" onClick={() => void act.run("unskip")} loading={act.pending}>
            <Undo2 /> Wieder aufnehmen
          </Button>
        )}
      </div>

      <Dialog open={previewUrl !== null} onOpenChange={(o) => !o && setPreviewUrl(null)}>
        <DialogContent size="lg" className="flex flex-col" style={{ height: "90vh" }}>
          <DialogHeader>
            <DialogTitle>{subject || "Brief"}</DialogTitle>
            <DialogDescription>So wird der Brief gedruckt (A4, Adressfeld links).</DialogDescription>
          </DialogHeader>
          {previewUrl && (
            <iframe title="Brief-Vorschau" src={previewUrl} className="min-h-0 w-full flex-1 rounded-md border border-border bg-white" />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
