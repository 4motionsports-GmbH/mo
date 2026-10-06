// Anmelde-Popup — the widget's sign-in ask for anonymous visitors (2026-10-01):
// shown → „Anmelden“ → signed in at Shopify → signed in in the chat, per
// session, plus „Später“ / weggeklickt, where sign-ins start, and — for every
// session with a sign-in event — where its sign-in ended (docs/frontend/05 §12.1).

import type { LoginGateFunnel, SigninDiagnosis } from "@/lib/kpi-store";
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
