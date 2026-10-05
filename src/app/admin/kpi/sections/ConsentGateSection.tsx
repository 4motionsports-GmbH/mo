// Einwilligung nach der Anmeldung — the consent popup the widget shows signed-in
// customers who have not decided yet: shown → accepted, plus decline/dismiss.
// Widget-emitted events (surface "signin") — measures the UI, not the DOI. The
// anonymous chat gate (surface "chat") was retired with the widget of
// 2026-10-01; its old events stay visible while they fall in the period.

import type { ConsentGateCounts, ConsentGateFunnel } from "@/lib/kpi-store";
import { RETIRED_CONSENT_GATE_SURFACES } from "@/lib/kpi-widget-events.mjs";
import { releaseNotesFor } from "@/lib/kpi-releases.mjs";
import type { KpiRange } from "@/lib/kpi-range";
import { formatAdmin, ADMIN_DATE_PADDED } from "@/lib/admin-datetime.mjs";
import { num, ratio } from "@/lib/admin-format.mjs";
import { Stat, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../ui";
import { StageFunnelChart } from "../charts";
import { Explain, FunnelLayout, KpiSection, StatGrid, SubHeading } from "../KpiSection";

const INFO = (
  <Explain>
    <p>
      Nach der Anmeldung fragt das Widget Kund:innen, die noch nicht entschieden haben, nach der
      Marketing-Einwilligung (Popup, Text aus <code>/api/consent-copy?surface=signin</code>): angezeigt →
      akzeptiert („Ja, Angebote aktivieren“). Wer schon für Angebote angemeldet ist (im Shop oder bei Mo),
      wird nicht gefragt; wer in einer Sitzung abgelehnt hat oder das Popup in 3 Sitzungen gesehen hat,
      30 Tage lang auch nicht.
    </p>
    <p>
      Alle vier Events sendet das Widget (<code>consent_gate_shown</code> / <code>_accepted</code> /{" "}
      <code>_declined</code> / <code>_dismissed</code>, <code>surface: signin</code>) — gemessen wird die
      Oberfläche, nicht die bestätigte Anmeldung. Getrennt von den anderen Opt-in-Wegen (E-Mail-Capture,
      Shop). Das anonyme Chat-Gate (<code>surface: chat</code>) zeigt das Widget seit dem 01.10.2026 nicht
      mehr — das Anmelde-Popup hat es ersetzt.
    </p>
  </Explain>
);

const BY_WAY_INFO =
  "Sitzungen, nicht Events: je Sitzung zählt der letzte Stand (ein Akzeptieren mit anschließendem Wegklicken zählt einmal, als akzeptiert). „Über „Anmelden““ = im Chat angemeldet, „Über Shop-Login erkannt“ = vom Shop erkannt (App Proxy). „Opt-in (Server)“ = das vom Server gespeicherte Opt-in (email_capture_marketing_opted_in, trigger signin_optin) in derselben Sitzung.";

const WAY_LABELS: Record<"signin" | "shop" | "unknown", string> = {
  signin: "Über „Anmelden“",
  shop: "Über Shop-Login erkannt",
  unknown: "Ohne Anmelde-Event",
};

const CHAT_RETIRED = formatAdmin(`${RETIRED_CONSENT_GATE_SURFACES.chat}T12:00:00Z`, ADMIN_DATE_PADDED);

export function ConsentGateSection({ funnel, range }: { funnel: ConsentGateFunnel | null; range: KpiRange }) {
  const signin = funnel?.bySurface.signin;
  const chat = funnel?.bySurface.chat;
  const acceptRate = signin && signin.shown > 0 ? signin.accepted / signin.shown : null;
  const withoutSurface = funnel && signin && chat ? funnel.total.shown - signin.shown - chat.shown : 0;
  const empty = !funnel
    ? "Noch keine Daten."
    : funnel.total.shown === 0
      ? "Noch keine Einwilligungs-Popup-Events im Zeitraum."
      : null;
  return (
    <KpiSection
      id="consent"
      title="Einwilligung nach der Anmeldung (Marketing-Opt-in)"
      info={INFO}
      empty={empty}
      notes={[
        ...releaseNotesFor("consent", range),
        withoutSurface > 0 && `${num(withoutSurface)} Anzeigen ohne surface-Angabe zählen in keiner Oberfläche.`,
      ]}
    >
      {funnel && signin && chat && (
        <>
          <FunnelLayout
            chart={
              <StageFunnelChart
                stages={[
                  { name: "Angezeigt", value: signin.shown },
                  { name: "Akzeptiert", value: signin.accepted },
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
