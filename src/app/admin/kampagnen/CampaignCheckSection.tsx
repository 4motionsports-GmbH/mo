"use client";

// „Prüfen & testen“ — the campaign editor's last section (docs/CAMPAIGNS.md
// §2.2): what the campaign will cost and take (campaign-sample-core
// campaignPlanEstimate over the live audience count and the recorded cost
// averages) and sample mails for three varied recipients, generated with the
// form's CURRENT settings and stored nowhere. A sample can go to the
// operator's own inbox as a Testkontakt — only under the saved settings.

import * as React from "react";
import { Eye, RefreshCw, Send, Sparkles } from "lucide-react";
import { campaignPlanEstimate } from "@/lib/campaign-sample-core.mjs";
import { SEGMENT_LABELS } from "@/lib/admin-customer-filter.mjs";
import { eur, num, plural, truncate } from "@/lib/admin-format.mjs";
import {
  Button,
  Callout,
  DescriptionItem,
  DescriptionList,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  InfoTip,
  Input,
  Spinner,
  StatusBadge,
  toast,
} from "../ui";
import { adminFetch, errorMessage } from "../lib/admin-fetch";
import { useAsyncAction } from "../lib/use-async-action";
import { EmailViewerDialog } from "../kampagne/EmailViewerDialog";
import type { EmailView } from "../kampagne/useCampaignActions";
import type { AudienceSpecProps, CampaignEditorOptions } from "./types";

/** The form's sample-relevant settings (what /api/admin/campaigns/sample validates). */
export interface SampleConfig {
  name: string;
  kind: "laufend" | "aktion";
  brief: string;
  endsAt: string | null;
  discountPercent: number;
  discountScope: "all" | "recommendations" | "set";
  discountValidUntil: string | null;
  designKey: string | null;
  textMode: string | null;
  moPromo: boolean;
  ctaKind: "mo_chat" | "shop";
  ctaUrl: string;
}

interface Candidate {
  customerId: number;
  name: string | null;
  email: string;
  language: "de" | "en";
  hasMoContact: boolean;
  lifecycleSegment: string | null;
  ordersCount: number;
}

interface Sample {
  customerId: number;
  language: "de" | "en";
  firstName: string | null;
  subject: string;
  body: string;
  html: string;
  recommendedProductIds: string[];
  productHighlights: Array<{ name: string; description: string }> | null;
  segment: string | null;
  segmentDays: number | null;
  lowConfidence: boolean;
  usedProfile: boolean;
  fingerprint: string;
}

type Slot =
  | { candidate: Candidate; state: "loading" }
  | { candidate: Candidate; state: "error"; message: string }
  | { candidate: Candidate; state: "done"; sample: Sample; configKey: string };

const TEST_INBOX_KEY = "ms-campaign-test-inbox";

function readTestInbox(): string {
  try {
    return window.localStorage.getItem(TEST_INBOX_KEY) ?? "";
  } catch {
    return "";
  }
}
function rememberTestInbox(email: string): void {
  try {
    window.localStorage.setItem(TEST_INBOX_KEY, email);
  } catch {
    /* private window — the field just starts empty next time */
  }
}

const segmentLabel = (s: string | null) =>
  (s && (SEGMENT_LABELS as Record<string, string>)[s]) || null;

export function CampaignCheckSection({
  campaignId,
  audience,
  config,
  configKey,
  dirty,
  recipients,
  counting,
  heroMode,
  dailyTarget,
  autoPreparePerDay,
  startsAt,
  endsAt,
  options,
}: {
  /** null = a new, unsaved campaign (samples yes, test send after saving). */
  campaignId: number | null;
  audience: AudienceSpecProps;
  config: SampleConfig;
  /** Stable key of `config` — a sample made under another key is outdated. */
  configKey: string;
  /** The form differs from the saved campaign. */
  dirty: boolean;
  /** Live audience count (with consent); null while unknown. */
  recipients: number | null;
  /** The count is being fetched. */
  counting: boolean;
  heroMode: "none" | "default" | "ai_ab" | "ai_all";
  dailyTarget: number | null;
  autoPreparePerDay: number;
  startsAt: string | null;
  endsAt: string | null;
  options: CampaignEditorOptions;
}) {
  const [slots, setSlots] = React.useState<Slot[]>([]);
  const [picking, setPicking] = React.useState(false);
  const [pickNote, setPickNote] = React.useState<string | null>(null);
  const [view, setView] = React.useState<EmailView | null>(null);
  const [testFor, setTestFor] = React.useState<Sample | null>(null);
  const [inbox, setInbox] = React.useState("");

  // „now“ for the window is read after mount (render must stay pure).
  const [now, setNow] = React.useState<Date | null>(null);
  React.useEffect(() => setNow(new Date()), [recipients, startsAt, endsAt]);
  const estimate = React.useMemo(
    () =>
      now && recipients != null
        ? campaignPlanEstimate({
            recipients,
            heroMode,
            draftEur: options.costs.draftEur,
            heroEur: options.costs.heroEur,
            dailyTarget,
            autoPreparePerDay,
            autoPrepareBudget: options.autoPrepareBudget,
            startsAt,
            endsAt,
            now,
          })
        : null,
    [now, recipients, heroMode, options.costs, options.autoPrepareBudget, dailyTarget, autoPreparePerDay, startsAt, endsAt]
  );

  // Revoke the blob URL of a closed preview.
  React.useEffect(() => {
    const url = view?.url;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [view]);

  const generateOne = React.useCallback(
    async (candidate: Candidate) => {
      setSlots((prev) =>
        prev.map((s) => (s.candidate.customerId === candidate.customerId ? { candidate, state: "loading" } : s))
      );
      const key = configKey;
      try {
        const json = await adminFetch<{ sample: Sample }>("/api/admin/campaigns/sample", {
          body: { action: "generate", campaignId, config, customerId: candidate.customerId, language: candidate.language },
        });
        setSlots((prev) =>
          prev.map((s) =>
            s.candidate.customerId === candidate.customerId
              ? { candidate, state: "done", sample: json.sample, configKey: key }
              : s
          )
        );
      } catch (err) {
        setSlots((prev) =>
          prev.map((s) =>
            s.candidate.customerId === candidate.customerId
              ? { candidate, state: "error", message: errorMessage(err) }
              : s
          )
        );
      }
    },
    [campaignId, config, configKey]
  );

  const generateAll = async () => {
    setPicking(true);
    setPickNote(null);
    try {
      const json = await adminFetch<{ total: number; candidates: Candidate[] }>("/api/admin/campaigns/sample", {
        body: { action: "pick", audience },
      });
      if (json.candidates.length === 0) {
        setSlots([]);
        setPickNote("Die Zielgruppe ist leer — keine Muster möglich.");
        return;
      }
      setSlots(json.candidates.map((candidate) => ({ candidate, state: "loading" })));
      setPicking(false);
      await Promise.all(json.candidates.map((c) => generateOne(c)));
    } catch (err) {
      toast({ variant: "error", title: "Muster nicht möglich", description: errorMessage(err) });
    } finally {
      setPicking(false);
    }
  };

  const openTest = (sample: Sample) => {
    setInbox((v) => v || readTestInbox());
    setTestFor(sample);
  };

  const sendTest = useAsyncAction(
    async (sample: Sample, to: string) =>
      adminFetch<{ sentTo: string }>("/api/admin/campaigns/sample", {
        body: { action: "send_test", campaignId, to, sample },
      }),
    {
      errorToast: false,
      onSuccess: (r) => {
        rememberTestInbox(r.sentTo);
        setTestFor(null);
        toast({
          variant: "success",
          title: `Test gesendet an ${r.sentTo}`,
          description: "Der Testkontakt steht im Prüftisch dieser Kampagne.",
        });
      },
    }
  );

  const busy = picking || slots.some((s) => s.state === "loading");
  const testBlocked = campaignId === null
    ? "Testversand gibt es nach dem ersten Speichern."
    : dirty
      ? "Ungespeicherte Änderungen — erst speichern, dann das Muster neu schreiben."
      : null;

  return (
    <section className="flex flex-col gap-3">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold">
        Prüfen &amp; testen
        <InfoTip>
          Bevor die Kampagne startet: was sie kostet und wie lange die Prüfung dauert, dazu Mustermails für drei
          unterschiedliche Empfänger:innen der Zielgruppe — mit den Einstellungen im Formular, auch ungespeichert.
          Muster werden nirgends gespeichert; nur der KI-Aufruf wird gezählt.
        </InfoTip>
      </h3>

      <div className="rounded-md border border-border bg-card p-3">
        {estimate ? (
          <DescriptionList columns={3}>
            <DescriptionItem label="Empfänger:innen">{num(estimate.recipients)}</DescriptionItem>
            <DescriptionItem
              label="KI-Texte"
              info={
                options.costs.draftEur == null
                  ? "Noch keine Entwürfe erzeugt — es gibt keinen Durchschnitt."
                  : `Ein Entwurf pro Empfänger:in × Durchschnitt der letzten Entwürfe (${eur(options.costs.draftEur, 4)} pro Mail).`
              }
            >
              {estimate.draftCostEur == null ? "unbekannt" : `≈ ${eur(estimate.draftCostEur)}`}
            </DescriptionItem>
            <DescriptionItem
              label="KI-Titelbilder"
              info={
                options.costs.heroEur == null
                  ? "Noch keine KI-Titelbilder erzeugt — es gibt keinen Durchschnitt."
                  : `„A/B“ = jede zweite Mail, „alle“ = jede Mail × Durchschnitt pro Bild (${eur(options.costs.heroEur, 3)}).`
              }
            >
              {estimate.heroImages === 0
                ? "keine"
                : estimate.heroCostEur == null
                  ? `${num(estimate.heroImages)} Bilder, Kosten unbekannt`
                  : `≈ ${eur(estimate.heroCostEur)} (${num(estimate.heroImages)} Bilder)`}
            </DescriptionItem>
            <DescriptionItem
              label="Prüfzeit"
              info={
                estimate.reviewPerDayAssumed
                  ? `Ohne Tagesziel gerechnet mit ${num(estimate.reviewPerDay)} geprüften Mails pro Tag.`
                  : "Empfänger:innen ÷ Tagesziel."
              }
            >
              {estimate.recipients === 0
                ? "—"
                : `${plural(estimate.reviewDays, "Tag", "Tage")} bei ${num(estimate.reviewPerDay)} / Tag`}
            </DescriptionItem>
            <DescriptionItem label="Zeitraum" info="Vom Start (oder heute) bis zum Ende der Kampagne.">
              {estimate.windowDays == null ? "offen" : `noch ${plural(estimate.windowDays, "Tag", "Tage")}`}
            </DescriptionItem>
            <DescriptionItem
              label="Vorbereitung"
              info="Mit „Automatisch vorbereiten“: Nächte, bis die nächtliche Vorbereitung alle Entwürfe geschrieben hat (höchstens das gemeinsame Kontingent pro Nacht). Sonst „Vorbereiten“ im Prüftisch."
            >
              {estimate.prepareNights == null
                ? "im Prüftisch"
                : `${plural(estimate.prepareNights, "Nacht", "Nächte")} bei ${num(estimate.nightly)} / Nacht`}
            </DescriptionItem>
          </DescriptionList>
        ) : counting || (recipients != null && !now) ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Spinner className="size-3.5" /> Zielgruppe wird gezählt …
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Die Zielgruppe ist gerade nicht abrufbar — keine Schätzung.</p>
        )}
      </div>

      {estimate?.warnings.includes("ended") && (
        <Callout tone="warning">Das Ende der Kampagne liegt in der Vergangenheit.</Callout>
      )}
      {estimate?.warnings.includes("review_too_slow") && estimate.windowDays != null && (
        <Callout tone="warning">
          Bei {num(estimate.reviewPerDay)} geprüften Mails pro Tag braucht der Prüftisch{" "}
          {plural(estimate.reviewDays, "Tag", "Tage")}, der Zeitraum hat {plural(estimate.windowDays, "Tag", "Tage")}.
          Tagesziel erhöhen, die Zielgruppe eingrenzen oder das Ende verschieben.
        </Callout>
      )}
      {estimate?.warnings.includes("prepare_too_slow") && estimate.prepareNights != null && estimate.windowDays != null && (
        <Callout tone="info">
          Die nächtliche Vorbereitung braucht {plural(estimate.prepareNights, "Nacht", "Nächte")} für alle Entwürfe, der
          Zeitraum hat {plural(estimate.windowDays, "Tag", "Tage")} — den Rest über „Vorbereiten“ im Prüftisch.
        </Callout>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => void generateAll()}
          loading={picking}
          disabled={busy || recipients === 0}
        >
          <Sparkles /> {slots.length > 0 ? "Neue Muster" : "Muster erzeugen"}
        </Button>
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          Drei Mustermails
          <InfoTip>
            Drei möglichst unterschiedliche Personen aus der Zielgruppe (Sprache, Mo-Gespräch, Lebenszyklus,
            Bestellungen). Text und Empfehlungen entstehen wie im Prüftisch; KI-Titelbilder und Sets kommen erst dort
            dazu. Der Code steht als Platzhalter (MO-XXXX) — echte Codes entstehen erst beim Senden.
          </InfoTip>
        </span>
      </div>
      {pickNote && <p className="text-xs text-muted-foreground">{pickNote}</p>}

      {slots.length > 0 && (
        <ul className="grid gap-3 md:grid-cols-3" aria-label="Mustermails">
          {slots.map((slot) => (
            <SampleCard
              key={slot.candidate.customerId}
              slot={slot}
              outdated={slot.state === "done" && slot.configKey !== configKey}
              onRegenerate={() => void generateOne(slot.candidate)}
              onView={(s) =>
                setView({
                  title: s.subject,
                  description: `Muster für ${slot.candidate.name ?? slot.candidate.email} — nicht gespeichert, Links ohne Funktion.`,
                  url: URL.createObjectURL(new Blob([s.html], { type: "text/html" })),
                })
              }
              onTest={openTest}
            />
          ))}
        </ul>
      )}

      <EmailViewerDialog view={view} onClose={() => setView(null)} />

      <Dialog
        open={testFor !== null}
        onOpenChange={(o) => {
          if (o) return;
          setTestFor(null);
          sendTest.reset();
        }}
      >
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>An Testpostfach senden</DialogTitle>
            <DialogDescription>
              Geht als Testkontakt dieser Kampagne raus — mit echtem Code, Tracking und Abmeldelink, ohne KPIs.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            {testBlocked && <Callout tone="warning">{testBlocked}</Callout>}
            <Field label="Testpostfach" required info="Deine eigene Adresse. Sie wird in diesem Browser für den nächsten Test gemerkt.">
              <Input
                type="email"
                data-autofocus
                value={inbox}
                onChange={(e) => setInbox(e.target.value)}
                placeholder="name@motionsports.de"
              />
            </Field>
            {sendTest.error && <Callout tone="destructive">{sendTest.error}</Callout>}
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setTestFor(null)}>
              Abbrechen
            </Button>
            <Button
              size="sm"
              loading={sendTest.pending}
              disabled={Boolean(testBlocked) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inbox.trim())}
              onClick={() => testFor && void sendTest.run(testFor, inbox.trim())}
            >
              <Send /> Senden
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function SampleCard({
  slot,
  outdated,
  onRegenerate,
  onView,
  onTest,
}: {
  slot: Slot;
  outdated: boolean;
  onRegenerate: () => void;
  onView: (s: Sample) => void;
  onTest: (s: Sample) => void;
}) {
  const c = slot.candidate;
  const segment = segmentLabel(c.lifecycleSegment);
  return (
    <li className="flex min-w-0 flex-col gap-2 rounded-md border border-border bg-card p-3">
      <div className="flex min-w-0 flex-col gap-1">
        <span className="truncate text-sm font-medium">{c.name ?? c.email}</span>
        <div className="flex flex-wrap gap-1">
          <StatusBadge tone={c.language === "en" ? "info" : "neutral"} dot={false}>
            {c.language.toUpperCase()}
          </StatusBadge>
          {c.hasMoContact && (
            <StatusBadge tone="accent" dot={false}>
              Mo
            </StatusBadge>
          )}
          {segment && (
            <StatusBadge tone="neutral" dot={false}>
              {segment}
            </StatusBadge>
          )}
          <StatusBadge tone="neutral" dot={false}>
            {plural(c.ordersCount, "Bestellung", "Bestellungen")}
          </StatusBadge>
        </div>
      </div>
      {slot.state === "loading" && (
        <div className="flex flex-1 items-center gap-2 py-6 text-xs text-muted-foreground">
          <Spinner className="size-3.5" /> Wird geschrieben …
        </div>
      )}
      {slot.state === "error" && (
        <>
          <Callout tone="destructive">{slot.message}</Callout>
          <div>
            <Button size="xs" variant="outline" onClick={onRegenerate}>
              <RefreshCw /> Erneut
            </Button>
          </div>
        </>
      )}
      {slot.state === "done" && (
        <>
          <div className="flex min-w-0 flex-1 flex-col gap-1 border-t border-border pt-2">
            <span className="text-sm font-semibold">{slot.sample.subject}</span>
            <p className="line-clamp-4 text-xs text-muted-foreground">
              {truncate(slot.sample.body.replace(/\s+/g, " ").trim(), 320)}
            </p>
            <div className="flex flex-wrap gap-1">
              {outdated && (
                <StatusBadge tone="warning" dot={false}>
                  Einstellungen geändert
                </StatusBadge>
              )}
              {!slot.sample.usedProfile && (
                <StatusBadge tone="neutral" dot={false}>
                  ohne KI-Profil
                </StatusBadge>
              )}
              {slot.sample.lowConfidence && (
                <StatusBadge tone="neutral" dot={false}>
                  Empfehlungen unsicher
                </StatusBadge>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Button size="xs" variant="outline" onClick={() => onView(slot.sample)}>
              <Eye /> Ansehen
            </Button>
            <Button size="xs" variant="outline" onClick={() => onTest(slot.sample)}>
              <Send /> Testpostfach …
            </Button>
            <Button size="xs" variant="ghost" onClick={onRegenerate}>
              <RefreshCw /> Neu schreiben
            </Button>
          </div>
        </>
      )}
    </li>
  );
}
