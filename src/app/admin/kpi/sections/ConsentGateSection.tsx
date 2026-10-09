// Einwilligung nach der Anmeldung — the consent popup the widget shows signed-in
// customers who have not decided yet: shown → accepted, plus decline/dismiss.
// Widget-emitted events (surface "signin") — measures the UI, not the DOI. The
// anonymous chat gate (surface "chat") was retired with the widget of
// 2026-10-01; its old events stay visible while they fall in the period.
// OPTIN_REWARD T6: the reward hint per variant, the welcome-voucher test
// (intention-to-treat per assigned variant against the control a) and the
// welcome codes redeemed in the order copy.

import type { ConsentGateCounts, ConsentGateFunnel } from "@/lib/kpi-store";
import type { ConsentExperimentKpis, WelcomeCodeStats } from "@/lib/kpi-consent-experiment-store";
import { RETIRED_CONSENT_GATE_SURFACES, consentVariantRates, rewardRenderGap } from "@/lib/kpi-widget-events.mjs";
import { variantDefinesReward } from "@/lib/consent-experiment.mjs";
import { releaseNotesFor } from "@/lib/kpi-releases.mjs";
import type { KpiRange } from "@/lib/kpi-range";
import { formatAdmin, ADMIN_DATE_PADDED } from "@/lib/admin-datetime.mjs";
import { num, ratio } from "@/lib/admin-format.mjs";
import { Callout, Stat, StatusBadge, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../ui";
import { FunnelBars } from "../FunnelBars";
import { Explain, FunnelLayout, KpiSection, StatGrid, SubHeading } from "../KpiSection";

const INFO = (
  <Explain>
    <p>
      Nach der Anmeldung fragt das Widget Kund:innen, die noch nicht entschieden haben, nach der
      Marketing-Einwilligung (Popup, Text aus <code>/api/consent-copy?surface=signin</code>): angezeigt →
      akzeptiert („Ja, Angebote aktivieren“). Wer schon für Angebote angemeldet ist (im Shop oder bei Mo),
      wird nicht gefragt, eine gesperrte Adresse (Abmeldung, Bounce, Beschwerde, Löschung) nie; wer in
      einer Sitzung abgelehnt hat oder das Popup in 3 Sitzungen gesehen hat, 30 Tage lang auch nicht.
      Seit dem Widget vom 08.10.2026 kann die Frage einen Gutschein-Hinweis tragen und in einer Variante
      erst nach einer Produktempfehlung im Chat-Fenster kommen statt als Popup („Wertmoment“) — beides nur,
      wenn der Server die Texte ausliefert; die Grenze von 3 Sitzungen in 30 Tagen zählt jede Platzierung.
    </p>
    <p>
      Alle vier Events sendet das Widget (<code>consent_gate_shown</code> / <code>_accepted</code> /{" "}
      <code>_declined</code> / <code>_dismissed</code>, <code>surface: signin</code>) — gemessen wird die
      Oberfläche, nicht die bestätigte Anmeldung. Gezählt werden Sitzungen mit ihrem letzten Stand
      (akzeptiert vor abgelehnt vor weggeklickt; seit dem 05.10.2026, vorher Klicks). Getrennt von den anderen Opt-in-Wegen (E-Mail-Capture,
      Shop). Das anonyme Chat-Gate (<code>surface: chat</code>) zeigt das Widget seit dem 01.10.2026 nicht
      mehr — das Anmelde-Popup hat es ersetzt.
    </p>
  </Explain>
);

const BY_WAY_INFO =
  "Sitzungen, nicht Events: je Sitzung zählt der letzte Stand (ein Akzeptieren mit anschließendem Wegklicken zählt einmal, als akzeptiert). „Über „Anmelden““ = im Chat angemeldet, „Über Shop-Login erkannt“ = vom Shop erkannt (App Proxy). „Opt-in (Server)“ = das vom Server gespeicherte Opt-in (email_capture_marketing_opted_in, trigger signin_optin) in derselben Sitzung.";

const VARIANT_INFO =
  "Sitzungen je Rahmen-Variante (Überschrift und Vorteile über dem Einwilligungstext) und Platzierung (Popup, nach der Anmeldung im Chat, Wertmoment). Akzeptanzrate = akzeptiert ÷ angezeigt; „akzeptiert ohne Anzeige“ ist nur ein Hinweis (Anzeige vor dem Zeitraum, älteres Widget). DOI-Quote = bestätigt ÷ verschickte DOI-Mails (bereits Abonnierte und nicht verschickte DOI-Mails zählen nicht; Opt-ins aus der Zeit, bevor der Versand festgehalten wurde, zählen als verschickt). Verglichen wird erst ab 100 Sitzungen je Zeile. Unbekannte Werte erscheinen als „unbekannt“. „… mit Gutschein-Hinweis“ unter „Angezeigt“ = Sitzungen, deren Anzeige den Gutschein-Hinweis trug (reward im Event); Varianten mit Gutschein sollten ihn bei jeder Anzeige tragen. „Wertmoment“ = die Frage nach einer Produktempfehlung statt des Popups (Variante c).";

/** @param days MARKETING_DOI_EXPIRY_DAYS (default 7) */
const experimentInfo = (days: number) =>
  `Vergleich nach zugeteilter Variante, nicht nach Anzeige. Grundlage sind alle angemeldeten Sitzungen, denen die Einwilligungsfrage angeboten werden durfte (echte Adresse, noch keine Entscheidung, nicht gesperrt, nicht pausiert), mit der Variante ihrer ersten Berechtigung (eine Sitzung, die schon vor dem Zeitraum berechtigt war, zählt nicht). Zielgröße: bestätigte Anmeldungen je berechtigter Sitzung (Opt-in höchstens ${num(days)} Tage nach der Berechtigung, Bestätigung höchstens ${num(days * 2)} Tage danach — der Bestätigungslink gilt ab seiner Mail; Sitzungen mit offener Frist zählen noch nicht). Variante a ist die Kontrollgruppe ohne Gutschein-Hinweis. Auch Abonnent:innen aus a erhalten den Willkommenscode des Shops — der Test misst die Wirkung des Hinweises im Chat, nicht die des Gutscheins. Belastbar erst ab der vorab festgelegten Zielgröße; 95-%-Intervall des Unterschieds.`;

const CODES_INFO =
  "Die Willkommenscodes verschickt heute ein Werkzeug in Shopify, nicht Mo — wie viele ausgegeben wurden, steht nur im Bericht dieser Automatisierung. „Eingelöst“ zählt Bestellungen der Bestellkopie mit einem Willkommenscode (Muster WELCOME_CODE_MATCH); ohne Muster „n/a“, keine Schätzung.";

const PLACEMENT_LABELS: Record<string, string> = {
  popup: "Popup",
  signin_return: "Nach Anmeldung im Chat",
  value_moment: "Wertmoment",
};

const WAY_LABELS: Record<"signin" | "shop" | "unknown", string> = {
  signin: "Über „Anmelden“",
  shop: "Über Shop-Login erkannt",
  unknown: "Ohne Anmelde-Event",
};

const CHAT_RETIRED = formatAdmin(`${RETIRED_CONSENT_GATE_SURFACES.chat}T12:00:00Z`, ADMIN_DATE_PADDED);

/** A difference of two rates in percentage points, signed — "+1,5 Pp.". */
function points(diff: number | null): string {
  if (diff == null) return "—";
  return `${diff > 0 ? "+" : ""}${num(diff * 100, 1)} Pp.`;
}

export function ConsentGateSection({
  funnel,
  experiment,
  codes,
  range,
}: {
  funnel: ConsentGateFunnel | null;
  experiment: ConsentExperimentKpis | null;
  codes: WelcomeCodeStats | null;
  range: KpiRange;
}) {
  const signin = funnel?.bySurface.signin;
  const chat = funnel?.bySurface.chat;
  const acceptRate = signin && signin.shown > 0 ? signin.accepted / signin.shown : null;
  const withoutSurface = funnel && signin && chat ? funnel.total.shown - signin.shown - chat.shown : 0;
  const empty = !funnel
    ? "Noch keine Daten."
    : funnel.total.shown === 0 && (experiment?.sessions ?? 0) === 0 && codes?.configured !== true
      ? "Noch keine Einwilligungs-Popup-Events im Zeitraum."
      : null;
  // A variant with a reward should carry the hint on every ask; the rest did not render it.
  const gaps = new Map<string, number>();
  for (const r of funnel?.byVariant ?? []) {
    const gap = rewardRenderGap(r, variantDefinesReward(r.variant));
    if (gap > 0) gaps.set(r.variant, (gaps.get(r.variant) ?? 0) + gap);
  }
  return (
    <KpiSection
      id="consent"
      title="Einwilligung nach der Anmeldung (Marketing-Opt-in)"
      info={INFO}
      empty={empty}
      notes={[
        ...releaseNotesFor("consent", range),
        withoutSurface > 0 && `${num(withoutSurface)} Anzeigen ohne surface-Angabe zählen in keiner Oberfläche.`,
        ...[...gaps].map(
          ([v, gap]) => `${num(gap)} Anzeigen von Variante ${v} ohne Gutschein-Hinweis (Text ungültig, Englisch oder Schalter aus).`
        ),
        experiment?.truncated && "Gutschein-Test auf die ersten 20.000 berechtigten Sitzungen begrenzt.",
      ]}
    >
      {funnel && signin && chat && (
        <>
          <FunnelLayout
            chart={
              <FunnelBars
                stages={[
                  { label: "Angezeigt", value: signin.shown },
                  { label: "Akzeptiert", value: signin.accepted },
                ]}
              />
            }
          >
            <Stat label="Angezeigt" value={num(signin.shown)} />
            <Stat
              label="Akzeptiert"
              value={num(signin.accepted)}
              hint={acceptRate == null ? undefined : `${ratio(acceptRate)} Akzeptanzrate`}
            />
            <Stat label="Abgelehnt" value={num(signin.declined)} />
            <Stat label="Weggeklickt" value={num(signin.dismissed)} />
          </FunnelLayout>

          {(funnel.signinByWay.signin.shown > 0 || funnel.signinByWay.shop.shown > 0 || funnel.signinByWay.unknown.shown > 0) && (
            <>
              <SubHeading info={BY_WAY_INFO}>Nach Anmeldeweg</SubHeading>
              <Table className="text-xs [&_td]:tabular-nums">
                <TableHeader>
                  <TableRow>
                    <TableHead>Weg</TableHead>
                    <TableHead align="right">Angezeigt</TableHead>
                    <TableHead align="right">Akzeptiert</TableHead>
                    <TableHead align="right">Akzeptanzrate</TableHead>
                    <TableHead align="right">Opt-in (Server)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(["signin", "shop", "unknown"] as const)
                    .filter((way) => way !== "unknown" || funnel.signinByWay.unknown.shown > 0)
                    .map((way) => {
                      const c = funnel.signinByWay[way];
                      return (
                        <TableRow key={way}>
                          <TableCell className="font-medium">{WAY_LABELS[way]}</TableCell>
                          <TableCell align="right">{num(c.shown)}</TableCell>
                          <TableCell align="right">{num(c.accepted)}</TableCell>
                          <TableCell align="right">{c.shown > 0 ? ratio(c.accepted / c.shown) : "—"}</TableCell>
                          <TableCell align="right">{num(c.optedIn)}</TableCell>
                        </TableRow>
                      );
                    })}
                </TableBody>
              </Table>
            </>
          )}

          {funnel.byVariant.some((r) => r.variant !== "ohne (älteres Widget)" && r.variant !== "unbekannt") && (
            <>
              <SubHeading info={VARIANT_INFO}>Nach Variante und Platzierung</SubHeading>
              <Table className="text-xs [&_td]:tabular-nums">
                <TableHeader>
                  <TableRow>
                    <TableHead>Variante</TableHead>
                    <TableHead>Platzierung</TableHead>
                    <TableHead align="right">Angezeigt</TableHead>
                    <TableHead align="right">Akzeptiert</TableHead>
                    <TableHead align="right">Akzeptanzrate</TableHead>
                    <TableHead align="right">Abgelehnt</TableHead>
                    <TableHead align="right">Akzeptiert ohne Anzeige</TableHead>
                    <TableHead align="right">Opt-ins (Server)</TableHead>
                    <TableHead align="right">Bereits angemeldet</TableHead>
                    <TableHead align="right">DOI-Quote</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {funnel.byVariant.map((r) => {
                    const rates = consentVariantRates(r);
                    return (
                      <TableRow key={`${r.variant}|${r.placement}`}>
                        <TableCell className="font-medium">{r.variant}</TableCell>
                        <TableCell>{PLACEMENT_LABELS[r.placement] ?? r.placement}</TableCell>
                        <TableCell align="right">
                          {num(r.shown)}
                          {r.rewardShown > 0 && (
                            <span className="block text-2xs text-muted-foreground">
                              {num(r.rewardShown)} mit Gutschein-Hinweis
                            </span>
                          )}
                        </TableCell>
                        <TableCell align="right">{num(r.accepted)}</TableCell>
                        <TableCell align="right">
                          {rates.acceptRate == null
                            ? "—"
                            : rates.comparable
                              ? ratio(rates.acceptRate)
                              : `${ratio(rates.acceptRate)} (zu wenige Sitzungen)`}
                        </TableCell>
                        <TableCell align="right">{num(r.declined)}</TableCell>
                        <TableCell align="right">{num(r.acceptedWithoutShown)}</TableCell>
                        <TableCell align="right">{num(r.optedIn)}</TableCell>
                        <TableCell align="right">{num(r.alreadyConfirmed)}</TableCell>
                        <TableCell align="right">
                          {rates.doiRate == null ? "—" : `${ratio(rates.doiRate)} (${num(r.doiConfirmed)}/${num(r.doiRequired)})`}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </>
          )}

          {experiment && <RewardExperiment kpis={experiment} />}

          <SubHeading info={CODES_INFO}>Willkommensgutscheine</SubHeading>
          <StatGrid cols={2}>
            <Stat label="Gutscheine ausgegeben" value="n/a" hint="nur in Shopify (Automatisierung)" />
            <Stat
              label="Gutscheine eingelöst"
              value={codes?.configured && codes.redeemed != null ? num(codes.redeemed) : "n/a"}
              hint={
                codes == null
                  ? "keine Daten (Abfrage fehlgeschlagen)"
                  : !codes.configured || codes.redeemed == null
                  ? "kein Muster (WELCOME_CODE_MATCH)"
                  : codes.orders > 0
                    ? `${ratio(codes.redeemed / codes.orders)} der Bestellungen`
                    : "keine Bestellungen im Zeitraum"
              }
            />
          </StatGrid>

          {chat.shown > 0 && (
            <>
              <SubHeading info={`Das Widget zeigt das anonyme Chat-Gate seit dem ${CHAT_RETIRED} nicht mehr; hier stehen nur ältere Events im Zeitraum.`}>
                Chat-Gate (anonym) — eingestellt
              </SubHeading>
              <StatGrid cols={2}>
                <SurfaceGateStat label="Chat-Gate (anonym)" counts={chat} />
              </StatGrid>
            </>
          )}
        </>
      )}
    </KpiSection>
  );
}

/**
 * The welcome-voucher test (OPTIN_REWARD T6): one headline per treatment
 * variant against the control, the arms and the excluded sessions — only with a
 * pre-registered test (CONSENT_REWARD_EXPERIMENT); otherwise a state callout.
 */
function RewardExperiment({ kpis }: { kpis: ConsentExperimentKpis }) {
  const exp = kpis.experiment;
  const ex = kpis.excluded;
  const excludedTotal = ex.mixed + ex.otherLocale + ex.beforeStart + ex.windowOpen + ex.unknownVariant;
  const byVariant = new Map(kpis.comparisons.map((c) => [c.variant, c]));
  return (
    <>
      <SubHeading info={experimentInfo(kpis.windowDays)}>Gutschein-Test: Varianten gegen Kontrollgruppe a</SubHeading>
      {!exp && kpis.armsSeen.length <= 1 && (
        <Callout tone="info" compact>
          Kein Gutschein-Test im Zeitraum — nur eine Variante aktiv.
        </Callout>
      )}
      {!exp && kpis.armsSeen.length > 1 && (
        <Callout tone="warning" compact>
          Mehrere Varianten aktiv, aber kein Test vorab festgelegt (CONSENT_REWARD_EXPERIMENT) — kein Vergleich.
        </Callout>
      )}
      {exp && (
        <div className="flex flex-col gap-2">
          {kpis.comparisons.map((c) => (
            <div key={c.variant} className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-medium">
                Bestätigte Anmeldungen je berechtigter Sitzung: {c.variant} vs. {exp.control}
              </span>
              <span className="tabular-nums">
                {c.appliedRate == null ? "—" : ratio(c.appliedRate)} vs. {c.holdoutRate == null ? "—" : ratio(c.holdoutRate)}
              </span>
              {c.progress.reached ? (
                <>
                  <StatusBadge tone="success" dot={false}>
                    belastbar
                  </StatusBadge>
                  <span className="tabular-nums text-muted-foreground">
                    95 %-Intervall {points(c.ciLow)} bis {points(c.ciHigh)} —{" "}
                    {c.significant ? "Unterschied gesichert" : "kein gesicherter Unterschied"}
                  </span>
                </>
              ) : (
                <StatusBadge tone="warning" dot={false}>
                  läuft ({num(c.progress.applied.n + c.progress.holdout.n)} /{" "}
                  {num(c.progress.applied.target + c.progress.holdout.target)})
                </StatusBadge>
              )}
            </div>
          ))}
          {exp.variants.some((v) => (kpis.arms[v]?.eligible ?? 0) > 0) && (
            <Table className="text-xs [&_td]:tabular-nums">
              <TableHeader>
                <TableRow>
                  <TableHead>Variante</TableHead>
                  <TableHead align="right">Berechtigte Sitzungen</TableHead>
                  <TableHead align="right">Opt-ins</TableHead>
                  <TableHead align="right">DOI-Mail verschickt</TableHead>
                  <TableHead align="right">Bestätigt</TableHead>
                  <TableHead align="right">Bestätigt je Sitzung</TableHead>
                  <TableHead align="right">Unterschied zu {exp.control}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {exp.variants.map((v) => {
                  const a = kpis.arms[v];
                  const c = byVariant.get(v);
                  return (
                    <TableRow key={v}>
                      <TableCell className="font-medium">{v}</TableCell>
                      <TableCell align="right">{num(a.closed)}</TableCell>
                      <TableCell align="right">{num(a.optedIn)}</TableCell>
                      <TableCell align="right">{num(a.doiSent)}</TableCell>
                      <TableCell align="right">{num(a.confirmed)}</TableCell>
                      <TableCell align="right">{a.closed > 0 ? ratio(a.confirmed / a.closed) : "—"}</TableCell>
                      <TableCell align="right">
                        {v === exp.control
                          ? "Kontrollgruppe"
                          : c?.diff == null
                            ? "—"
                            : `${points(c.diff)}${c.relLift == null ? "" : ` (${ratio(c.relLift, 0, { sign: true })})`}`}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
          {excludedTotal > 0 && (
            <p className="text-2xs text-muted-foreground">
              Ausgeschlossen: {num(ex.mixed)} gemischt · {num(ex.otherLocale)}{" "}
              {exp.locale === "de" ? "Englisch" : "andere Sprache"} · {num(ex.beforeStart)} vor Teststart ·{" "}
              {num(ex.windowOpen)} Bestätigungsfrist offen · {num(ex.unknownVariant)} unbekannte Variante
            </p>
          )}
        </div>
      )}
    </>
  );
}

function SurfaceGateStat({ label, counts }: { label: string; counts: ConsentGateCounts }) {
  const rate = counts.shown > 0 ? counts.accepted / counts.shown : null;
  return (
    <Stat
      label={label}
      value={`${num(counts.accepted)} / ${num(counts.shown)}`}
      hint={
        rate == null
          ? "akzeptiert / angezeigt"
          : `${ratio(rate)} Akzeptanzrate · ${num(counts.declined)} abgelehnt · ${num(counts.dismissed)} weggeklickt`
      }
    />
  );
}
