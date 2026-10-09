// Anmelde-Popup — the widget's sign-in ask for anonymous visitors (2026-10-01):
// shown → „Anmelden“ → signed in at Shopify → signed in in the chat, per
// session, plus „Später“ / weggeklickt, where sign-ins start, the same sessions
// with and without the reward teaser and by served variant (OPTIN_REWARD T6),
// and — for every session with a sign-in event — where its sign-in ended
// (docs/frontend/05 §12.1).

import type { LoginGateFunnel, LoginServedVariantRow, LoginTeaserRow, SigninDiagnosis } from "@/lib/kpi-store";
import type { KpiRange } from "@/lib/kpi-range";
import { SIGNIN_DIAGNOSIS } from "@/lib/kpi-widget-events.mjs";
import { releaseNotesFor } from "@/lib/kpi-releases.mjs";
import { num, ratio } from "@/lib/admin-format.mjs";
import { InfoTip, Stat, StatusBadge, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../ui";
import { FunnelBars } from "../FunnelBars";
import { Explain, FunnelLayout, KpiSection, StatGrid, SubHeading } from "../KpiSection";

const INFO = (
  <Explain>
    <p>
      Etwa 0,7 Sekunden nach dem Senden einer Nachricht bittet das Widget anonyme Besucher:innen, sich
      anzumelden — während die Antwort noch lädt, nicht erst danach; höchstens ein Popup pro Browser-Tab
      (gemeinsam mit dem Einwilligungs-Popup), nie im Sprachmodus: Popup angezeigt → „Anmelden“ → bei
      Shopify angemeldet → im Chat angemeldet. Ein „Angezeigt“ kann deshalb zu einer Antwort gehören, die
      danach fehlschlug.
    </p>
    <p>
      Gezählt werden Sitzungen. Die ersten Stufen meldet das Widget (<code>login_gate_*</code>); „Bei
      Shopify angemeldet“ und „Im Chat angemeldet“ misst der Server in derselben Sitzung nach dem Klick
      (<code>account_signin_succeeded</code>, <code>account_signin_linked</code>). Erst die letzte Stufe zählt:
      seit dem 03.10.2026 gilt eine Anmeldung im Chat nur, wenn das Widget den Einmal-Code einlöst. „Später“
      pausiert das Popup 24 Stunden auf dem Gerät; „Weggeklickt“ (Esc, Klick daneben) nicht.
    </p>
  </Explain>
);

const DIAGNOSIS_INFO =
  "Jede Sitzung mit einem Anmelde-Event im Zeitraum, eingeordnet nach der Stelle, an der ihre Anmeldung endete — aus Widget- und Server-Events derselben Sitzung (Herkunft egal: Popup, Begrüßung, Kopfzeile, Shop-Erkennung). Die Ursachen sind die wahrscheinlichen laut Frontend-Doku (05 §12.1).";

const TEASER_INFO =
  "Sitzungen nach ihrem ersten Anmelde-Popup: mit Gutschein-Hinweis oder ohne. „Ohne“ umfasst Variante a, Englisch und Sitzungen, in denen der Text nicht innerhalb von 1,2 Sekunden ankam — deshalb kein sauberer Vergleich. Belastbar ist die Tabelle je Variante (die Variante, die der Server dieser Sitzung ausgeliefert hat). „Opt-in danach“ und „Bestätigt“: in derselben Sitzung nach dem Klick auf „Anmelden“. Die Begrüßungskarte meldet keinen Hinweis.";

const SERVED_INFO =
  "Dieselben Sitzungen nach der Variante, die der Server ihnen mit dem Einwilligungstext ausgeliefert hat (consent_copy_served — nur, solange mehrere Varianten aktiv sind; Sitzungen ohne diese Angabe fehlen hier), unabhängig davon, ob der Hinweis erschien. „Mit Hinweis“ = davon mit Gutschein-Hinweis im ersten Popup.";

const RESULT_LABELS: Record<string, string> = {
  ok: "ok (Code eingelöst)",
  link_failed: "link_failed",
  login_required: "login_required",
  error: "error",
};

export function LoginGateSection({
  funnel,
  diagnosis,
  range,
}: {
  funnel: LoginGateFunnel | null;
  diagnosis: SigninDiagnosis | null;
  range: KpiRange;
}) {
  const starts = funnel ? funnel.startsBySource.login_gate + funnel.startsBySource.other : 0;
  const empty = !funnel
    ? "Noch keine Daten."
    : funnel.shown === 0 && starts === 0 && (diagnosis?.sessions ?? 0) === 0
      ? "Noch keine Anmelde-Popup-Events im Zeitraum."
      : null;
  const r = funnel?.rates;
  const diagnosisRows = diagnosis
    ? SIGNIN_DIAGNOSIS.map((d) => ({ ...d, count: diagnosis.byOutcome[d.key] ?? 0 })).filter((d) => d.count > 0)
    : [];
  return (
    <KpiSection
      id="anmelde-popup"
      title="Anmelde-Popup (anonyme Besucher:innen)"
      info={INFO}
      empty={empty}
      notes={[
        ...releaseNotesFor("anmelde-popup", range),
        funnel != null &&
          funnel.rates.unlinked > 0 &&
          `${num(funnel.rates.unlinked)} Sitzungen aus dem Popup haben sich bei Shopify angemeldet, aber nicht im Chat — wo es hängt, zeigt die Diagnose.`,
        diagnosis?.truncated && "Diagnose auf die ersten 20.000 Sitzungen begrenzt.",
      ]}
    >
      {funnel && r && (
        <>
          <FunnelLayout
            chart={
              <FunnelBars
                stages={[
                  { label: "Angezeigt", value: funnel.shown },
                  { label: "„Anmelden“", value: funnel.clicked },
                  { label: "Bei Shopify", value: funnel.signedIn },
                  { label: "Im Chat", value: funnel.linked },
                ]}
              />
            }
          >
            <Stat label="Angezeigt" value={num(funnel.shown)} hint="Sitzungen" />
            <Stat
              label="„Anmelden“ geklickt"
              value={num(funnel.clicked)}
              hint={r.clickRate == null ? undefined : `${ratio(r.clickRate)} der Anzeigen`}
            />
            <Stat
              label="Bei Shopify angemeldet"
              value={num(funnel.signedIn)}
              hint={r.signInRate == null ? undefined : `${ratio(r.signInRate)} der Klicks`}
            />
            <Stat
              label="Im Chat angemeldet"
              value={num(funnel.linked)}
              hint={r.overallRate == null ? undefined : `${ratio(r.overallRate)} der Anzeigen`}
            />
            <Stat
              label="„Später“"
              value={num(funnel.declined)}
              hint={r.declineRate == null ? "24 h pausiert" : `${ratio(r.declineRate)} · 24 h pausiert`}
            />
            <Stat
              label="Weggeklickt"
              value={num(funnel.dismissed)}
              hint={r.dismissRate == null ? undefined : `${ratio(r.dismissRate)} der Anzeigen`}
            />
          </FunnelLayout>

          <SubHeading info="Alle Anmeldestarts im Zeitraum nach Herkunft (account_signin_started, Feld source vom Widget).">
            Anmeldestarts nach Herkunft
          </SubHeading>
          <StatGrid cols={2}>
            <Stat label="Aus dem Popup" value={num(funnel.startsBySource.login_gate)} />
            <Stat label="Begrüßung oder Kopfzeile" value={num(funnel.startsBySource.other)} />
          </StatGrid>

          {funnel.byTeaser.some((t) => t.hint !== "ohne Hinweis") && (
            <>
              <SubHeading info={TEASER_INFO}>Mit und ohne Gutschein-Hinweis</SubHeading>
              <Table className="text-xs [&_td]:tabular-nums">
                <TableHeader>
                  <TableRow>
                    <TableHead>Hinweis</TableHead>
                    <TableHead>Variante</TableHead>
                    <TeaserHeads />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {funnel.byTeaser.map((t) => (
                    <TableRow key={`${t.hint}|${t.variant}`}>
                      <TableCell className="font-medium">{t.hint}</TableCell>
                      <TableCell>{t.variant}</TableCell>
                      <TeaserCells row={t} />
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          )}

          {funnel.byServedVariant.length > 0 && (
            <>
              <SubHeading info={SERVED_INFO}>Nach ausgelieferter Variante</SubHeading>
              <Table className="text-xs [&_td]:tabular-nums">
                <TableHeader>
                  <TableRow>
                    <TableHead>Variante</TableHead>
                    <TableHead align="right">Mit Hinweis</TableHead>
                    <TeaserHeads />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {funnel.byServedVariant.map((t) => (
                    <TableRow key={t.variant}>
                      <TableCell className="font-medium">{t.variant}</TableCell>
                      <TableCell align="right">{num(t.withTeaser)}</TableCell>
                      <TeaserCells row={t} />
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          )}
        </>
      )}

      {diagnosis && diagnosisRows.length > 0 && (
        <>
          <SubHeading info={DIAGNOSIS_INFO}>Diagnose: wo Anmeldungen enden</SubHeading>
          <Table className="text-xs">
            <TableHeader>
              <TableRow>
                <TableHead>Ergebnis</TableHead>
                <TableHead>Wahrscheinliche Ursache</TableHead>
                <TableHead align="right">Sitzungen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {diagnosisRows.map((d) => (
                <TableRow key={d.key}>
                  <TableCell>
                    <StatusBadge tone={d.ok ? "success" : "warning"} dot={false}>
                      {d.label}
                    </StatusBadge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{d.cause}</TableCell>
                  <TableCell align="right" className="tabular-nums">
                    {num(d.count)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {diagnosis.returnResults.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-2xs text-muted-foreground">
              Rückkehr laut Widget (account_signin_return):
              {diagnosis.returnResults.map((x) => (
                <code key={x.result} className="rounded bg-surface-2 px-1.5 py-0.5">
                  {RESULT_LABELS[x.result] ?? x.result} {num(x.count)}
                </code>
              ))}
              <InfoTip label="Was die Rückkehr-Ergebnisse bedeuten">
                „ok“ sendet das Widget erst nach dem eingelösten Code; „link_failed“ deckt einen abgelehnten oder
                fehlenden Code, eine andere Sitzung und eine Störung ab; „login_required“ sollte nie vorkommen.
              </InfoTip>
            </div>
          )}
        </>
      )}
    </KpiSection>
  );
}

/** The shared count columns of the two teaser tables. */
function TeaserHeads() {
  return (
    <>
      <TableHead align="right">Angezeigt</TableHead>
      <TableHead align="right">„Anmelden“</TableHead>
      <TableHead align="right">Im Chat angemeldet</TableHead>
      <TableHead align="right">Anmelderate (im Chat ÷ angezeigt)</TableHead>
      <TableHead align="right">Opt-in danach</TableHead>
      <TableHead align="right">Bestätigt</TableHead>
    </>
  );
}

function TeaserCells({ row }: { row: LoginTeaserRow | LoginServedVariantRow }) {
  return (
    <>
      <TableCell align="right">{num(row.shown)}</TableCell>
      <TableCell align="right">{num(row.clicked)}</TableCell>
      <TableCell align="right">{num(row.linked)}</TableCell>
      <TableCell align="right">{row.rates.overallRate == null ? "—" : ratio(row.rates.overallRate)}</TableCell>
      <TableCell align="right">{num(row.optedIn)}</TableCell>
      <TableCell align="right">{num(row.confirmed)}</TableCell>
    </>
  );
}
