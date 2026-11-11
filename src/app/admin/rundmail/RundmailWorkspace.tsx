"use client";

// The Rundmail workspace (Kampagnen → a campaign of kind „Rundmail“,
// docs/CAMPAIGNS.md §9): ONE content for the whole audience, reviewed by a
// person once and sent identically to everyone.
//
//   Inhalt          — subject, preview line, language and the block editor with
//                     the live preview („Mit KI gestalten“ — the KI-Gestalter
//                     panel, with subject / preview-line suggestions —,
//                     „Vorlage laden“, „Rückgängig“ in several steps).
//   Prüfen & senden — every check (content, deliverability, sender, legal
//                     gate, audience), the test mail (required for the current
//                     version), pace, and „Jetzt senden“ / „Planen“.
//   Versand         — progress, delivery, clicks per link, the reasons people
//                     were skipped; pause, continue, cancel. While the page is
//                     open it drives the sending (the cron does every minute).
//
// The content is frozen at the release; afterwards only the progress changes.

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  CircleAlert,
  Info,
  LayoutTemplate,
  Pause,
  Play,
  Save,
  Send,
  TriangleAlert,
  Undo2,
  XCircle,
} from "lucide-react";
import { ADMIN_DATE_TIME_SHORT, formatAdmin } from "@/lib/admin-datetime.mjs";
import { num, plural, ratio } from "@/lib/admin-format.mjs";
import { adminTabHref } from "@/lib/admin-tabs.mjs";
import { CAMPAIGN_PHASE_LABELS } from "@/lib/campaign-def.mjs";
import { MAILING_RATES, MAILING_RATE_LABELS, mailingProgress, minutesLeft } from "@/lib/mailing-core.mjs";
import { stripMoBlocks, validateMailTemplateDoc } from "@/lib/mail-template-doc.mjs";
import {
  Button,
  Callout,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  Field,
  InfoTip,
  Input,
  Menu,
  ProgressBar,
  SegmentedControl,
  StatusBadge,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  buttonVariants,
  toast,
  useConfirm,
} from "../ui";
import { adminFetch, errorMessage } from "../lib/admin-fetch";
import { EmailPreviewButton } from "../EmailPreviewButton";
import { BlockEditor, type MailDoc } from "../vorlagen/BlockEditor";
import { DesignerPanel, DesignerToggle } from "../vorlagen/DesignerPanel";
import { LivePreview } from "../vorlagen/LivePreview";
import { useDesignerSession } from "../vorlagen/use-designer-session";
import { useDocHistory } from "../vorlagen/use-doc-history";

type RateKey = keyof typeof MAILING_RATES;

export interface RundmailMailing {
  campaignId: number;
  subject: string;
  preheader: string | null;
  doc: MailDoc;
  language: "de" | "en";
  sourceTemplateId: number | null;
  rate: RateKey;
  engagedFirst: boolean;
  contentVersion: number;
  testVersion: number | null;
  testSentAt: string | null;
  testSentTo: number | null;
  frozenVersion: number | null;
  frozenAt: string | null;
  frozenFrom: string | null;
  links: Array<{ url: string }>;
  materializedAt: string | null;
  finishedAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
}

export interface RundmailStats {
  total: number;
  pending: number;
  sending: number;
  sent: number;
  suppressed: number;
  skipped: number;
  failed: number;
  excluded: number;
  skippedByReason: Record<string, number>;
  delivered: number;
  bounced: number;
  bouncedHard: number;
  complained: number;
  clicked: number;
  unsubscribed: number;
  linkClicks: Array<{ index: number; clicks: number; recipients: number }>;
  unclearBatches: number;
  lastSentAt: string | null;
}

interface Check {
  key: string;
  level: "error" | "warning" | "info";
  message: string;
  blockId?: string | null;
}
interface Evaluation {
  ok: boolean;
  errors: Check[];
  warnings: Check[];
  infos: Check[];
  audience: { total: number; confirmed: number } | null;
}

const REASON_LABELS: Record<string, string> = {
  keine_einwilligung: "Keine Einwilligung (mehr)",
  kein_doi: "Kein nachweisbares Double-Opt-in",
  gesperrt: "Gesperrt (Abmeldung, Bounce, Beschwerde)",
  zu_haeufig: "Sperrfrist (zuletzt angeschrieben)",
  doppelt: "Adresse doppelt",
  ungueltige_adresse: "Ungültige Adresse",
  versand_fehler: "Von Resend abgelehnt",
  versand_unklar: "Ergebnis unklar — in Resend prüfen",
  abgebrochen: "Abgebrochen",
  zielgruppe: "Passt nicht mehr zur Zielgruppe",
};

const PHASE_TONE: Record<string, "success" | "warning" | "neutral" | "destructive" | "info"> = {
  laeuft: "success",
  geplant: "info",
  abgelaufen: "destructive",
  pausiert: "warning",
  entwurf: "neutral",
  beendet: "neutral",
  archiviert: "neutral",
};

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="min-w-0 rounded-md bg-surface-2 px-3 py-2">
      <dt className="flex items-center gap-1 truncate text-2xs text-muted-foreground">
        {label}
        {hint && <InfoTip>{hint}</InfoTip>}
      </dt>
      <dd className="text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function CheckList({ evaluation }: { evaluation: Evaluation }) {
  const rows: Array<{ c: Check; icon: React.ReactNode; cls: string }> = [
    ...evaluation.errors.map((c) => ({ c, icon: <XCircle className="size-4 shrink-0 text-destructive" aria-hidden />, cls: "" })),
    ...evaluation.warnings.map((c) => ({ c, icon: <TriangleAlert className="size-4 shrink-0 text-warning" aria-hidden />, cls: "" })),
    ...evaluation.infos.map((c) => ({ c, icon: <Info className="size-4 shrink-0 text-muted-foreground" aria-hidden />, cls: "text-muted-foreground" })),
  ];
  return (
    <ul className="flex flex-col gap-1.5">
      {evaluation.ok && (
        <li className="flex items-start gap-2 text-sm font-medium">
          <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden /> Alle Pflicht-Prüfungen bestanden.
        </li>
      )}
      {rows.map(({ c, icon, cls }, i) => (
        <li key={`${c.key}-${i}`} className={`flex items-start gap-2 text-sm ${cls}`}>
          {icon}
          <span>{c.message}</span>
        </li>
      ))}
    </ul>
  );
}

/** The workspace tabs, in the URL as `?view=`. */
const RUNDMAIL_VIEWS = ["inhalt", "pruefen", "versand"] as const;

export function RundmailWorkspace({
  campaign,
  initialMailing,
  initialStats,
  sendsApproved,
  allowSingleOptIn,
  sender,
  uploadConfigured,
  aiConfigured,
  templates,
  initialView,
}: {
  campaign: {
    id: number;
    name: string;
    slug: string;
    status: "entwurf" | "aktiv" | "pausiert" | "beendet" | "archiviert";
    phase: string;
    startsAt: string | null;
    endsAt: string | null;
    audienceText: string;
  };
  initialMailing: RundmailMailing;
  initialStats: RundmailStats;
  sendsApproved: boolean;
  allowSingleOptIn: boolean;
  sender: { ok: true; from: string; replyTo: string | null } | { ok: false; message: string };
  uploadConfigured: boolean;
  aiConfigured: boolean;
  templates: Array<{ id: number; name: string }>;
  initialView?: string;
}) {
  const router = useRouter();
  const { confirm, confirmDialog } = useConfirm();
  const [mailing, setMailing] = React.useState<RundmailMailing>(initialMailing);
  const [stats, setStats] = React.useState<RundmailStats>(initialStats);
  const [status, setStatus] = React.useState(campaign.status);
  const [subject, setSubject] = React.useState(initialMailing.subject);
  const [preheader, setPreheader] = React.useState(initialMailing.preheader ?? "");
  const [language, setLanguage] = React.useState<"de" | "en">(initialMailing.language);
  // The content with its „Rückgängig“ steps (every AI result and „Vorlage laden“ is one).
  const { doc, setDoc, replaceDoc, undo, resetDoc, undoSteps } = useDocHistory<MailDoc>(initialMailing.doc);
  const [designerOpen, setDesignerOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [evaluation, setEvaluation] = React.useState<Evaluation | null>(null);
  const [checking, setChecking] = React.useState(false);
  const [testTo, setTestTo] = React.useState("");
  const [testName, setTestName] = React.useState("Alex");
  const [testing, setTesting] = React.useState(false);
  const [when, setWhen] = React.useState<"now" | "later">("now");
  const [startsAt, setStartsAt] = React.useState(toLocalInput(campaign.startsAt));
  const [releasing, setReleasing] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);

  const frozen = Boolean(mailing.frozenAt);
  const designer = useDesignerSession({
    use: "bulk",
    doc,
    context: { subject, preheader },
    // A result that arrives after the release is dropped: the content is fixed.
    onResult: (result) => {
      if (!frozen) replaceDoc(stripMoBlocks(result.doc));
    },
  });
  const { abort: abortDesigner } = designer;
  React.useEffect(() => {
    if (frozen) abortDesigner();
  }, [frozen, abortDesigner]);
  const dirty =
    !frozen &&
    (subject !== mailing.subject ||
      preheader !== (mailing.preheader ?? "") ||
      language !== mailing.language ||
      JSON.stringify(doc) !== JSON.stringify(mailing.doc));
  const tested = mailing.testVersion === mailing.contentVersion && !dirty;
  const issues = React.useMemo(() => validateMailTemplateDoc(doc, "bulk"), [doc]);
  const progress = mailingProgress(stats);
  const sendingNow = status === "aktiv" && frozen && !mailing.finishedAt;
  const planned = sendingNow && campaign.startsAt != null && new Date(campaign.startsAt) > new Date() && stats.sent === 0;
  const defaultTab = !frozen ? "inhalt" : "versand";
  const [tab, setTab] = React.useState(
    initialView && (RUNDMAIL_VIEWS as readonly string[]).includes(initialView) ? initialView : defaultTab
  );
  // The tab is linkable (`?view=`), kept in sync without a server render.
  React.useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("view") === tab) return;
    url.searchParams.set("view", tab);
    window.history.replaceState(window.history.state, "", url.toString());
  }, [tab]);

  // ── data refresh + driving the send while the page is open ──
  const refresh = React.useCallback(async () => {
    const json = await adminFetch<{ mailing: RundmailMailing; stats: RundmailStats; campaign: { status: typeof status } }>(
      "/api/admin/rundmail",
      { body: { campaignId: campaign.id, action: "state" } }
    );
    setMailing(json.mailing);
    setStats(json.stats);
    setStatus(json.campaign.status);
  }, [campaign.id]);

  const stepping = React.useRef(false);
  React.useEffect(() => {
    if (!sendingNow) return;
    let alive = true;
    const tick = async () => {
      if (stepping.current || !alive) return;
      stepping.current = true;
      try {
        const due = !campaign.startsAt || new Date(campaign.startsAt) <= new Date();
        if (due) {
          const json = await adminFetch<{ stats: RundmailStats; mailing: RundmailMailing }>("/api/admin/rundmail", {
            body: { campaignId: campaign.id, action: "step" },
          });
          if (!alive) return;
          setStats(json.stats);
          if (json.mailing) setMailing(json.mailing);
        }
        await refresh();
      } catch {
        // The cron keeps sending; the page just retries.
      } finally {
        stepping.current = false;
      }
    };
    void tick();
    const handle = setInterval(() => void tick(), 6000);
    return () => {
      alive = false;
      clearInterval(handle);
    };
  }, [sendingNow, campaign.id, campaign.startsAt, refresh]);

  // ── actions ──
  const save = async (): Promise<RundmailMailing | null> => {
    setSaving(true);
    try {
      const json = await adminFetch<{ mailing: RundmailMailing }>("/api/admin/rundmail", {
        body: {
          campaignId: campaign.id,
          action: "save",
          subject,
          preheader,
          language,
          doc,
          rate: mailing.rate,
          engagedFirst: mailing.engagedFirst,
          expectedVersion: mailing.contentVersion,
        },
      });
      setMailing(json.mailing);
      resetDoc(json.mailing.doc);
      setEvaluation(null);
      toast({ variant: "success", title: "Gespeichert", description: "Für den Versand bitte erneut eine Testmail schicken." });
      return json.mailing;
    } catch (err) {
      toast({ variant: "error", title: "Nicht gespeichert", description: errorMessage(err) });
      return null;
    } finally {
      setSaving(false);
    }
  };

  const runChecks = async () => {
    setChecking(true);
    try {
      const json = await adminFetch<{ evaluation: Evaluation }>("/api/admin/rundmail", {
        body: { campaignId: campaign.id, action: "checks" },
      });
      setEvaluation(json.evaluation);
    } catch (err) {
      toast({ variant: "error", title: "Prüfung fehlgeschlagen", description: errorMessage(err) });
    } finally {
      setChecking(false);
    }
  };

  React.useEffect(() => {
    if (tab === "pruefen" && !evaluation && !frozen) void runChecks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const sendTest = async () => {
    setTesting(true);
    try {
      const json = await adminFetch<{ sentTo: string[] }>("/api/admin/rundmail", {
        body: { campaignId: campaign.id, action: "test", addresses: testTo, firstName: testName, expectedVersion: mailing.contentVersion },
      });
      toast({ variant: "success", title: "Testmail gesendet", description: `An ${json.sentTo.join(", ")} — bitte auf Handy und Rechner ansehen.` });
      await refresh();
      await runChecks();
    } catch (err) {
      toast({ variant: "error", title: "Testmail fehlgeschlagen", description: errorMessage(err) });
    } finally {
      setTesting(false);
    }
  };

  const setPacing = async (rate: RateKey, engagedFirst: boolean) => {
    try {
      const json = await adminFetch<{ mailing: RundmailMailing }>("/api/admin/rundmail", {
        body: { campaignId: campaign.id, action: "pacing", rate, engagedFirst },
      });
      setMailing(json.mailing);
    } catch (err) {
      toast({ variant: "error", title: "Nicht gespeichert", description: errorMessage(err) });
    }
  };

  const release = async () => {
    const reach = evaluation?.audience ? (allowSingleOptIn ? evaluation.audience.total : evaluation.audience.confirmed) : null;
    const at = when === "later" && startsAt ? new Date(startsAt).toISOString() : null;
    const ok = await confirm({
      title: at ? "Rundmail planen?" : "Rundmail jetzt senden?",
      description: [
        `„${mailing.subject}“ geht${reach != null ? ` an etwa ${num(reach)} Empfänger:innen` : " an die Zielgruppe"}`,
        sender.ok ? ` von ${sender.from}` : "",
        at ? `, ab ${formatAdmin(at, ADMIN_DATE_TIME_SHORT)}.` : ", sofort.",
        " Der Inhalt ist danach fest. Pausieren und Abbrechen bleiben jederzeit möglich.",
      ].join(""),
      confirmLabel: at ? "Planen" : "Jetzt senden",
    });
    if (!ok) return;
    setReleasing(true);
    try {
      await adminFetch("/api/admin/rundmail", {
        body: { campaignId: campaign.id, action: "release", startsAt: at, expectedVersion: mailing.contentVersion },
      });
      toast({ variant: "success", title: at ? "Rundmail geplant" : "Versand gestartet" });
      await refresh();
      setTab("versand");
      router.refresh();
    } catch (err) {
      toast({ variant: "error", title: "Nicht freigegeben", description: errorMessage(err) });
      await runChecks();
    } finally {
      setReleasing(false);
    }
  };

  const control = async (action: "pause" | "resume" | "cancel" | "unschedule") => {
    if (action === "cancel") {
      const ok = await confirm({
        title: "Rundmail abbrechen?",
        description: `${num(stats.pending)} noch nicht gesendete Mails werden nicht mehr verschickt. Schon gesendete bleiben gesendet.`,
        confirmLabel: "Abbrechen",
        tone: "destructive",
      });
      if (!ok) return;
    }
    if (action === "unschedule") {
      const ok = await confirm({
        title: "Planung zurücknehmen?",
        description: "Die Rundmail wird wieder ein Entwurf — Inhalt bearbeiten, neu testen und erneut freigeben.",
        confirmLabel: "Zurücknehmen",
      });
      if (!ok) return;
    }
    setBusy(action);
    try {
      await adminFetch("/api/admin/rundmail", { body: { campaignId: campaign.id, action, confirm: true } });
      await refresh();
      router.refresh();
      toast({
        variant: "success",
        title: { pause: "Pausiert", resume: "Fortgesetzt", cancel: "Abgebrochen", unschedule: "Zurückgenommen" }[action],
      });
    } catch (err) {
      toast({ variant: "error", title: "Nicht möglich", description: errorMessage(err) });
    } finally {
      setBusy(null);
    }
  };

  const loadTemplate = async (id: number) => {
    try {
      const json = await adminFetch<{ template: { doc: MailDoc; name: string } }>("/api/admin/vorlagen", { body: { action: "get", id } });
      replaceDoc(stripMoBlocks(json.template.doc));
      toast({ variant: "success", title: `Vorlage „${json.template.name}“ übernommen`, description: "Noch nicht gespeichert — „Rückgängig“ holt den alten Stand zurück." });
    } catch (err) {
      toast({ variant: "error", title: "Vorlage nicht geladen", description: errorMessage(err) });
    }
  };

  const phaseLabel = CAMPAIGN_PHASE_LABELS[campaign.phase as keyof typeof CAMPAIGN_PHASE_LABELS] ?? campaign.phase;
  const reasons = Object.entries(stats.skippedByReason).filter(([, n]) => n > 0);

  return (
    <div className="flex flex-col gap-4">
      {/* header */}
      <div className="flex flex-wrap items-start gap-3">
        <Link href={adminTabHref("kampagne")} className={buttonVariants({ variant: "ghost", size: "sm" })}>
          <ArrowLeft /> Kampagnen
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-lg font-semibold">{campaign.name}</h2>
            <StatusBadge tone="accent" dot={false}>
              Rundmail
            </StatusBadge>
            <StatusBadge tone={PHASE_TONE[mailing.finishedAt ? "beendet" : campaign.phase] ?? "neutral"}>
              {mailing.finishedAt ? "Versendet" : planned ? "Geplant" : phaseLabel}
            </StatusBadge>
            {!sendsApproved && <StatusBadge tone="destructive">Versand gesperrt</StatusBadge>}
          </div>
          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
            {campaign.audienceText}
            {sender.ok ? ` · Absender: ${sender.from}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {status === "entwurf" && (
            <Link href={adminTabHref("kampagne", { edit: String(campaign.id) })} className={buttonVariants({ variant: "outline", size: "sm" })}>
              Zielgruppe & Absender
            </Link>
          )}
          {planned && (
            <Button size="sm" variant="outline" onClick={() => void control("unschedule")} loading={busy === "unschedule"}>
              Planung zurücknehmen
            </Button>
          )}
          {status === "aktiv" && frozen && !mailing.finishedAt && !planned && (
            <Button size="sm" variant="outline" onClick={() => void control("pause")} loading={busy === "pause"}>
              <Pause /> Pausieren
            </Button>
          )}
          {status === "pausiert" && (
            <Button size="sm" onClick={() => void control("resume")} loading={busy === "resume"} disabled={!sendsApproved}>
              <Play /> Fortsetzen
            </Button>
          )}
          {status === "pausiert" && stats.sent === 0 && (
            <Button size="sm" variant="outline" onClick={() => void control("unschedule")} loading={busy === "unschedule"}>
              Zurück zum Entwurf
            </Button>
          )}
          {(status === "aktiv" || status === "pausiert") && frozen && !mailing.finishedAt && (
            <Button size="sm" variant="ghost" onClick={() => void control("cancel")} loading={busy === "cancel"}>
              <XCircle /> Abbrechen
            </Button>
          )}
        </div>
      </div>

      {!sender.ok && <Callout tone="destructive">{sender.message}</Callout>}
      {mailing.lastError && (status === "pausiert" || sendingNow) && (
        <Callout tone={status === "pausiert" ? "destructive" : "warning"} title={status === "pausiert" ? "Versand pausiert" : "Hinweis vom Versand"}>
          {mailing.lastError}
        </Callout>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList variant="underline">
          <TabsTrigger value="inhalt">Inhalt</TabsTrigger>
          <TabsTrigger value="pruefen" badge={frozen ? undefined : tested ? undefined : "!"}>
            Prüfen & senden
          </TabsTrigger>
          <TabsTrigger value="versand">Versand</TabsTrigger>
        </TabsList>

        {/* ── Inhalt ── */}
        <TabsContent value="inhalt" className="pt-4">
          {frozen ? (
            <Callout tone="info" title="Freigegeben — der Inhalt ist fest" className="mb-4">
              Jede Empfängerin, jeder Empfänger bekommt genau diesen Inhalt (nur Anrede, Abmelde- und Klick-Links sind persönlich).
              <div className="mt-2">
                <EmailPreviewButton
                  path="/api/admin/rundmail/frozen"
                  getPayload={() => ({ campaignId: campaign.id })}
                  title={`Rundmail „${campaign.name}“`}
                  description="So geht die Mail an alle — hier mit dem Beispiel-Vornamen „Alex“; alle Links sind in der Vorschau inaktiv."
                  label="Versendete Mail ansehen"
                  size="sm"
                />
              </div>
            </Callout>
          ) : (
            <>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                {dirty ? (
                  <StatusBadge tone="warning">Ungespeichert</StatusBadge>
                ) : (
                  <span className="text-xs text-muted-foreground">Gespeichert · Version {mailing.contentVersion}</span>
                )}
                <div className="ml-auto flex flex-wrap items-center gap-2">
                  {undoSteps > 0 && (
                    <Button size="sm" variant="ghost" onClick={undo}>
                      <Undo2 /> Rückgängig
                    </Button>
                  )}
                  {templates.length > 0 && (
                    <Menu
                      label="Vorlage laden"
                      trigger={
                        <Button size="sm" variant="outline">
                          <LayoutTemplate /> Vorlage laden
                        </Button>
                      }
                      items={templates.map((t) => ({ key: String(t.id), label: t.name, onSelect: () => void loadTemplate(t.id) }))}
                    />
                  )}
                  <DesignerToggle
                    open={designerOpen}
                    onToggle={() => setDesignerOpen((o) => !o)}
                    aiConfigured={aiConfigured}
                    running={designer.running}
                  />
                  <Button size="sm" onClick={() => void save()} loading={saving} disabled={!dirty}>
                    <Save /> Speichern
                  </Button>
                </div>
              </div>
            </>
          )}

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
            <div className="flex min-w-0 flex-col gap-3">
              {designerOpen && aiConfigured && !frozen && (
                <DesignerPanel
                  session={designer}
                  use="bulk"
                  onClose={() => setDesignerOpen(false)}
                  fields={{
                    subject,
                    preheader,
                    onSubject: (value) => setSubject(value.slice(0, 150)),
                    onPreheader: (value) => setPreheader(value.slice(0, 150)),
                    disabled: frozen,
                  }}
                />
              )}
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                <Field
                  label="Betreff"
                  required
                  info="Am besten unter 60 Zeichen, ohne GROSSBUCHSTABEN und mit höchstens einem Ausrufezeichen. Platzhalter {{vorname|Ersatz}} möglich, z. B. „{{vorname|Hey}}, die Black Week ist da“."
                >
                  <Input value={subject} maxLength={150} onChange={(e) => setSubject(e.target.value)} disabled={frozen} placeholder="z. B. Black Week: 25 % auf alles" />
                </Field>
                <Field label="Sprache" info="Sprache der festen Texte (Abmelde-Hinweis, Gutschein, Countdown). Die Zielgruppe lässt sich in „Zielgruppe & Absender“ nach Sprache filtern.">
                  <SegmentedControl
                    label="Sprache"
                    size="sm"
                    value={language}
                    onChange={setLanguage}
                    options={[
                      { value: "de", label: "Deutsch" },
                      { value: "en", label: "Englisch" },
                    ]}
                    disabled={frozen}
                  />
                </Field>
              </div>
              <Field label="Vorschauzeile" info="Steht im Posteingang neben dem Betreff (Preheader) — ergänzt ihn, wiederholt ihn nicht.">
                <Input value={preheader} maxLength={150} onChange={(e) => setPreheader(e.target.value)} disabled={frozen} placeholder="z. B. Nur bis Sonntag — mit dem Code BLACKWEEK25" />
              </Field>
              <BlockEditor doc={doc} onChange={setDoc} use="bulk" issues={issues} uploadConfigured={uploadConfigured} disabled={frozen} />
            </div>
            <div className="flex min-w-0 flex-col gap-2 xl:sticky xl:top-4 xl:self-start">
              <p className="text-sm font-semibold">Vorschau</p>
              <LivePreview doc={doc} use="bulk" subject={subject} preheader={preheader} language={language} title={`Vorschau ${campaign.name}`} />
            </div>
          </div>
        </TabsContent>

        {/* ── Prüfen & senden ── */}
        <TabsContent value="pruefen" className="pt-4">
          {frozen ? (
            <Callout tone="info">Die Rundmail ist freigegeben{mailing.frozenAt ? ` (${formatAdmin(mailing.frozenAt, ADMIN_DATE_TIME_SHORT)})` : ""} — den Fortschritt zeigt „Versand“.</Callout>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <CircleAlert className="size-4" aria-hidden /> Prüfungen
                    <InfoTip>
                      Alles, was eine Maschine vor dem Versand prüfen kann: Inhalt, Zustellbarkeit (Spamfilter, Gmail-Kürzung),
                      Absender, Versand-Freigabe und Zielgruppe. Rote Punkte verhindern das Senden. Einwilligung, Sperren und
                      Sperrfrist prüft der Versand zusätzlich bei jeder einzelnen Mail.
                    </InfoTip>
                    <Button size="xs" variant="ghost" className="ml-auto" onClick={() => void runChecks()} loading={checking}>
                      Erneut prüfen
                    </Button>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {dirty && <Callout tone="warning" compact className="mb-3">Ungespeicherte Änderungen — erst im Inhalt speichern.</Callout>}
                  {evaluation ? <CheckList evaluation={evaluation} /> : <p className="text-sm text-muted-foreground">Prüfe …</p>}
                </CardContent>
              </Card>

              <div className="flex flex-col gap-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Send className="size-4" aria-hidden /> Testmail
                      <InfoTip>
                        Pflicht vor dem Versand: der aktuelle Stand an deine eigenen Adressen — genau so, wie er an alle geht
                        (gleicher Absender, Abmelde-Link). Auf dem Handy und am Rechner ansehen, Links anklicken. Nach jeder
                        Änderung neu. Tipp: zusätzlich an eine Adresse von mail-tester.com schicken — die Bewertung (Ziel: 9/10
                        oder besser) zeigt Spam-Risiken.
                      </InfoTip>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-3">
                    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
                      <Field label="An (bis zu 5 Adressen)">
                        <Input value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="du@motionsports.de, …" disabled={dirty} />
                      </Field>
                      <Field label="Vorname zum Testen" info="Leer = die Anrede ohne Namen.">
                        <Input value={testName} onChange={(e) => setTestName(e.target.value)} disabled={dirty} />
                      </Field>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button size="sm" variant="outline" onClick={() => void sendTest()} loading={testing} disabled={dirty || !testTo.trim() || !mailing.subject.trim()}>
                        Testmail senden
                      </Button>
                      {mailing.testSentAt && (
                        <span className="text-xs text-muted-foreground">
                          Letzte: {formatAdmin(mailing.testSentAt, ADMIN_DATE_TIME_SHORT)}
                          {tested ? " · aktueller Stand ✓" : " · veraltet (Inhalt geändert)"}
                        </span>
                      )}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Play className="size-4" aria-hidden /> Senden
                      <InfoTip>
                        Der Versand läuft im Hintergrund in Paketen (Resend), im gewählten Tempo, auch wenn diese Seite zu ist.
                        Die Zielgruppe wird beim Start frisch ermittelt: neue Abonnent:innen sind dabei, Abgemeldete nicht.
                        Engagierte zuerst: wer zuletzt geklickt oder gekauft hat, bekommt die Mail zuerst — das stärkt die
                        Zustellung bei großen Mengen.
                      </InfoTip>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-3">
                    <Field label="Tempo">
                      <SegmentedControl
                        label="Tempo"
                        size="sm"
                        value={mailing.rate}
                        onChange={(rate) => void setPacing(rate, mailing.engagedFirst)}
                        options={(Object.keys(MAILING_RATES) as RateKey[]).map((k) => ({
                          value: k,
                          label: MAILING_RATE_LABELS[k].split(" — ")[0],
                        }))}
                      />
                    </Field>
                    <p className="-mt-2 text-2xs text-muted-foreground">{MAILING_RATE_LABELS[mailing.rate]}</p>
                    <Field label="Engagierte zuerst" inline className="w-fit">
                      <Checkbox checked={mailing.engagedFirst} onChange={(e) => void setPacing(mailing.rate, e.target.checked)} />
                    </Field>
                    <Field label="Zeitpunkt">
                      <SegmentedControl
                        label="Zeitpunkt"
                        size="sm"
                        value={when}
                        onChange={setWhen}
                        options={[
                          { value: "now", label: "Jetzt" },
                          { value: "later", label: "Planen" },
                        ]}
                      />
                    </Field>
                    {when === "later" && (
                      <Field label="Start" info="Höchstens 60 Tage im Voraus. Bis zum Start lässt sich die Planung zurücknehmen.">
                        <Input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
                      </Field>
                    )}
                    <Button
                      onClick={() => void release()}
                      loading={releasing}
                      disabled={dirty || !evaluation?.ok || !tested || (when === "later" && !startsAt)}
                    >
                      <Send /> {when === "later" ? "Planen" : "Jetzt senden"}
                    </Button>
                    {!evaluation?.ok && evaluation && <p className="text-2xs text-destructive">Erst alle roten Punkte der Prüfung beheben.</p>}
                  </CardContent>
                </Card>
              </div>
            </div>
          )}
        </TabsContent>

        {/* ── Versand ── */}
        <TabsContent value="versand" className="pt-4">
          {!frozen ? (
            <Callout tone="neutral">Noch nicht freigegeben — erst unter „Prüfen & senden“ testen und senden.</Callout>
          ) : (
            <div className="flex flex-col gap-4">
              <Card>
                <CardContent className="flex flex-col gap-3 pt-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-sm font-semibold">
                      {mailing.finishedAt
                        ? `Fertig — ${num(stats.sent)} Mails versendet`
                        : planned && campaign.startsAt
                          ? `Geplant für ${formatAdmin(campaign.startsAt, ADMIN_DATE_TIME_SHORT)}`
                          : status === "pausiert"
                            ? "Pausiert"
                            : !mailing.materializedAt
                              ? "Startet …"
                              : `Läuft — noch etwa ${num(minutesLeft(progress.open, MAILING_RATES[mailing.rate]))} Min.`}
                    </p>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {num(progress.done)} / {num(progress.total)} ({num(progress.percent)} %)
                    </span>
                  </div>
                  <ProgressBar value={progress.percent} label="Fortschritt" tone={status === "pausiert" ? "warning" : mailing.finishedAt ? "success" : "accent"} />
                  <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                    <Stat label="Empfänger" value={num(stats.total)} hint="Beim Start frisch ermittelt: Kund:innen mit Einwilligung, die zur Zielgruppe passen." />
                    <Stat label="Gesendet" value={num(stats.sent)} />
                    <Stat label="Ausstehend" value={num(stats.pending + stats.sending)} />
                    <Stat label="Übersprungen" value={num(stats.suppressed + stats.skipped)} hint="Beim Versand geprüft: Einwilligung, Double-Opt-in, Sperrliste, Sperrfrist, doppelte Adressen." />
                    <Stat label="Fehler" value={num(stats.failed)} hint="Von Resend abgelehnte oder ungültige Adressen, Pakete mit unklarem Ergebnis." />
                  </dl>
                </CardContent>
              </Card>

              {stats.unclearBatches > 0 && (
                <Callout tone="warning" title="Ergebnis unklar">
                  {num(stats.unclearBatches)} Paket(e) konnten nach Netzwerkfehlern nicht eindeutig zugeordnet werden und wurden zur Sicherheit
                  nicht erneut gesendet (keine doppelten Mails). In Resend → Emails nach dem Tag „campaign={campaign.id}“ prüfen.
                </Callout>
              )}

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    Ergebnis
                    <InfoTip>
                      Zustellung, Bounces und Beschwerden meldet Resend (Webhook). Klicks zählt Mo selbst über die Links der Mail —
                      ohne Öffnungs-Pixel. Harte Bounces und Beschwerden sperren die Adresse automatisch.
                    </InfoTip>
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                    <Stat label="Zugestellt" value={num(stats.delivered)} />
                    <Stat label="Geklickt" value={`${num(stats.clicked)} (${ratio(stats.sent ? stats.clicked / stats.sent : null)})`} />
                    <Stat label="Bounces" value={`${num(stats.bounced)}${stats.bouncedHard ? ` · ${num(stats.bouncedHard)} hart` : ""}`} />
                    <Stat label="Beschwerden" value={num(stats.complained)} hint="Spam-Meldungen. Über 0,3 % gefährdet die Zustellung aller Mails — dann Zielgruppe und Inhalt prüfen." />
                    <Stat label="Abmeldungen" value={num(stats.unsubscribed)} />
                  </dl>
                  {mailing.links.length > 0 && (
                    <div>
                      <p className="mb-1.5 text-xs font-semibold">Klicks je Link</p>
                      <ul className="flex flex-col gap-1">
                        {mailing.links.map((l, i) => {
                          const c = stats.linkClicks.find((x) => x.index === i);
                          return (
                            <li key={i} className="flex items-center gap-3 rounded-md border border-border px-2.5 py-1.5 text-xs">
                              <span className="min-w-0 flex-1 truncate">
                                {l.url.replace(/^https?:\/\//, "").replace(/[?#].*$/, "")}
                              </span>
                              <span className="shrink-0 tabular-nums text-muted-foreground">
                                {plural(c?.recipients ?? 0, "Person", "Personen")} · {plural(c?.clicks ?? 0, "Klick", "Klicks")}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}
                  {reasons.length > 0 && (
                    <div>
                      <p className="mb-1.5 text-xs font-semibold">Nicht gesendet — warum</p>
                      <ul className="grid gap-1 sm:grid-cols-2">
                        {reasons.map(([k, n]) => (
                          <li key={k} className="flex items-center justify-between gap-3 rounded-md bg-surface-2 px-2.5 py-1.5 text-xs">
                            <span>{REASON_LABELS[k] ?? k}</span>
                            <span className="tabular-nums">{num(n)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div>
                    <EmailPreviewButton
                      path="/api/admin/rundmail/frozen"
                      getPayload={() => ({ campaignId: campaign.id })}
                      title={`Rundmail „${campaign.name}“`}
                      description="So geht die Mail an alle — hier mit dem Beispiel-Vornamen „Alex“; alle Links sind in der Vorschau inaktiv."
                      label="Versendete Mail ansehen"
                      size="sm"
                    />
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {confirmDialog}
    </div>
  );
}
