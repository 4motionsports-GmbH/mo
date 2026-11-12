"use client";

// The analysis of a released Rundmail — the „Versand“ tab below the progress
// (docs/ADMIN_DASHBOARD.md §3.2 „Rundmail“, docs/CAMPAIGNS.md §9.6):
//
//   Ergebnis     — the delivery figures (live from the workspace's polling)
//                  and the orders counted for the Rundmail in the chosen
//                  window (`?window=`): Besteller, Bestellungen, Umsatz,
//                  „mit Code“, „nach Klick“, Umsatz je Empfänger — the rule
//                  is rundmail-analytics.mjs; GET /api/admin/rundmail/analytics.
//   Verlauf      — one series at a time: mails per bucket during the send,
//                  clicks, orders or revenue per hour / day after it.
//   (children)   — the workspace's „Klicks je Link“, „Nicht gesendet — warum“
//                  and „Versendete Mail ansehen“, unchanged.
//   Empfänger    — every recipient, searchable, filtered, sorted and paged on
//                  the server, the CSV export; a row opens the recipient's
//                  sheet (RundmailRecipientSheet).
//
// Everything a colleague might link to is in the URL (window, list filter,
// search, sort, page, the open recipient — rundmail-analytics.mjs
// ANALYTICS_URL_KEYS), kept in sync with history.replaceState.

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { ADMIN_DATE_TIME_SHORT, formatAdmin } from "@/lib/admin-datetime.mjs";
import { eur, eurFromCents, num, ratio } from "@/lib/admin-format.mjs";
import {
  RUNDMAIL_WINDOWS,
  analyticsUrlEntries,
  bucketLabel,
  readAnalyticsUrlState,
  rundmailRates,
  rundmailWindowLabel,
  type AnalyticsUrlState,
  type RundmailWindowKey,
} from "@/lib/rundmail-analytics.mjs";
import type { MailingStats } from "@/lib/mailing-store";
import type { RundmailAnalyticsSeries, RundmailAnalyticsSummary } from "@/lib/rundmail-analytics-store";
import {
  Button,
  Callout,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  IconButton,
  InfoTip,
  Section,
  SegmentedControl,
  Skeleton,
  Stat,
} from "../ui";
import { adminFetch, errorMessage } from "../lib/admin-fetch";
import { TimeBarsChart } from "../kpi/charts";
import { RundmailRecipients } from "./RundmailRecipients";
import { RundmailRecipientSheet } from "./RundmailRecipientSheet";

/** While the Rundmail still sends, the figures refresh this often. */
const LIVE_REFRESH_MS = 30_000;

type Analytics = { summary: RundmailAnalyticsSummary; series: RundmailAnalyticsSeries };
type Metric = "send" | "clicks" | "orders" | "revenue";

/** The analysis state, read from the URL once and written back with replaceState. */
function useAnalyticsUrlState(): [AnalyticsUrlState, (patch: Partial<AnalyticsUrlState>) => void] {
  const params = useSearchParams();
  const [state, setState] = React.useState<AnalyticsUrlState>(() => readAnalyticsUrlState((k) => params.get(k)));
  React.useEffect(() => {
    const url = new URL(window.location.href);
    for (const [key, value] of analyticsUrlEntries(state)) {
      if (value === null) url.searchParams.delete(key);
      else url.searchParams.set(key, value);
    }
    if (url.toString() !== window.location.href) window.history.replaceState(window.history.state, "", url.toString());
  }, [state]);
  const update = React.useCallback((patch: Partial<AnalyticsUrlState>) => setState((s) => ({ ...s, ...patch })), []);
  return [state, update];
}

const STEP_TEXT: Record<number, string> = {
  1: "pro Minute",
  10: "pro 10 Minuten",
  60: "pro Stunde",
  1440: "pro Tag",
};

export function RundmailAnalytics({
  campaignId,
  campaignName,
  stats,
  sending,
  children,
}: {
  campaignId: number;
  campaignName: string;
  /** The workspace's live figures (getMailingStats, polled while sending). */
  stats: MailingStats;
  /** Still sending: the figures refresh every 30 seconds. */
  sending: boolean;
  /** The workspace's „Klicks je Link“, „Nicht gesendet — warum“, „Versendete Mail ansehen“. */
  children?: React.ReactNode;
}) {
  const [state, update] = useAnalyticsUrlState();
  const [data, setData] = React.useState<Analytics | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [version, setVersion] = React.useState(0);
  const [tick, setTick] = React.useState(0);
  const [metric, setMetric] = React.useState<Metric>("clicks");

  React.useEffect(() => {
    if (!sending) return;
    const handle = setInterval(() => setTick((t) => t + 1), LIVE_REFRESH_MS);
    return () => clearInterval(handle);
  }, [sending]);

  React.useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    adminFetch<Analytics>(`/api/admin/rundmail/analytics?campaignId=${campaignId}&window=${state.window}`, {
      signal: controller.signal,
    })
      .then((json) => {
        if (controller.signal.aborted) return;
        setData(json);
        setError(null);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(errorMessage(err));
        setLoading(false);
      });
    return () => controller.abort();
  }, [campaignId, state.window, version, tick]);

  const s = data?.summary.window === state.window ? data.summary : null;
  const rates = rundmailRates({
    sent: stats.sent,
    clicked: stats.clicked,
    bounced: stats.bounced,
    complained: stats.complained,
    unsubscribed: stats.unsubscribed,
    buyers: s?.buyers ?? 0,
    revenueCents: s?.revenueCents ?? 0,
  });
  const pending = (value: React.ReactNode) => (s ? value : <Skeleton className="mt-1 h-6 w-20" />);
  const windowLabel = rundmailWindowLabel(state.window);
  const notSent = stats.suppressed + stats.skipped + stats.failed;

  return (
    <div className="flex flex-col gap-6">
      <Section
        level={3}
        title="Ergebnis"
        info={
          <>
            Zustellung, Bounces und Beschwerden meldet Resend (Webhook). Klicks zählt Mo selbst über die Links der Mail —
            Öffnungen werden bewusst nicht gemessen (kein Öffnungs-Pixel). Harte Bounces und Beschwerden sperren die Adresse
            automatisch. Alle Quoten beziehen sich auf die gesendeten Mails.
          </>
        }
        actions={
          <>
            <SegmentedControl<RundmailWindowKey>
              label="Zeitraum für Bestellungen"
              value={state.window}
              onChange={(w) => update({ window: w, page: 1 })}
              options={RUNDMAIL_WINDOWS.map((w) => ({ value: w.key as RundmailWindowKey, label: w.label }))}
            />
            <IconButton label="Aktualisieren" size="icon-sm" variant="ghost" onClick={() => setVersion((v) => v + 1)} disabled={loading}>
              <RefreshCw className={loading ? "animate-spin" : undefined} />
            </IconButton>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <div>
            <p className="mb-2 text-xs font-semibold text-muted-foreground">Zustellung und Klicks</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
              <Stat size="sm" label="Zugestellt" value={num(stats.delivered)} hint={stats.sent ? `${ratio(stats.delivered / stats.sent)} der gesendeten` : undefined} />
              <Stat size="sm" label="Geklickt" value={num(stats.clicked)} hint={rates.clickRate != null ? `Klickrate ${ratio(rates.clickRate)}` : undefined} />
              <Stat
                size="sm"
                label="Bounces"
                value={num(stats.bounced)}
                hint={rates.bounceRate != null ? `${ratio(rates.bounceRate)}${stats.bouncedHard ? ` · ${num(stats.bouncedHard)} hart` : ""}` : undefined}
              />
              <Stat
                size="sm"
                label="Beschwerden"
                value={num(stats.complained)}
                hint={rates.complaintRate != null ? ratio(rates.complaintRate, 2) : undefined}
                info="Spam-Meldungen. Über 0,3 % gefährdet die Zustellung aller Mails — dann Zielgruppe und Inhalt prüfen."
              />
              <Stat size="sm" label="Abmeldungen" value={num(stats.unsubscribed)} hint={rates.unsubscribeRate != null ? `Abmelderate ${ratio(rates.unsubscribeRate, 2)}` : undefined} />
            </div>
          </div>

          <div>
            <p className="mb-2 flex items-center gap-1 text-xs font-semibold text-muted-foreground">
              {state.window === "heute" ? "Bestellungen seit dem Versand" : `Bestellungen bis ${windowLabel} nach dem Versand`}
              <InfoTip label="Wie Bestellungen zählen" panelClassName="max-w-md">
                Eine Bestellung zählt für diese Rundmail, wenn die Person sie nach ihrer Mail und innerhalb des gewählten
                Zeitraums aufgegeben hat — gemessen ab dem Zeitpunkt, an dem ihre Mail rausging. Bekam sie danach noch eine
                Rundmail, zählt eine spätere Bestellung für die spätere (letzte Berührung) — keine Bestellung zählt doppelt.
                Stornierte Bestellungen zählen nicht, Erstattungen werden vom Umsatz abgezogen. „mit Code“: mit einem
                Gutschein-Code dieser Rundmail bestellt — der härteste Beleg. „nach Klick“: nach einem Klick in dieser Mail
                bestellt. Ohne Code und Klick ist eine Bestellung im Zeitraum ein Hinweis, kein Beweis. Persönliche
                Kampagnen-Mails zählen über ihre eigenen Codes im KPI-Bereich.
              </InfoTip>
            </p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
              <Stat
                size="sm"
                label="Besteller"
                value={pending(num(s?.buyers))}
                hint={s && rates.conversion != null ? `Conversion ${ratio(rates.conversion)}` : undefined}
                info="Personen mit mindestens einer gezählten Bestellung. Conversion = Besteller ÷ gesendete Mails."
              />
              <Stat size="sm" label="Bestellungen" value={pending(num(s?.orders))} />
              <Stat size="sm" label="Umsatz" value={pending(eurFromCents(s?.revenueCents))} hint={s ? "abzüglich Erstattungen" : undefined} />
              <Stat
                size="sm"
                label="davon mit Code"
                value={pending(s && s.codes.length === 0 ? "—" : num(s?.codeOrders))}
                hint={s ? (s.codes.length === 0 ? "kein Gutschein-Code in der Mail" : eurFromCents(s.codeRevenueCents)) : undefined}
                info={
                  s && s.codes.length > 0 ? (
                    <>
                      Bestellungen der Empfänger:innen mit {s.codes.length === 1 ? "dem Code" : "einem der Codes"} {s.codes.join(", ")}.
                      {s.codeOrdersAll != null &&
                        ` Insgesamt ${num(s.codeOrdersAll)} Bestellungen mit dem Code im selben Zeitraum (${eurFromCents(s.codeRevenueAllCents)}) — auch von Personen, die die Mail nicht bekommen haben (weitergeleitet, geteilt).`}
                    </>
                  ) : (
                    "Codes aus den Gutschein-Blöcken der Mail und ihren /discount/-Links."
                  )
                }
              />
              <Stat size="sm" label="davon nach Klick" value={pending(num(s?.clickOrders))} hint={s ? eurFromCents(s.clickRevenueCents) : undefined} />
              <Stat size="sm" label="Umsatz je Empfänger" value={pending(eurFromCents(rates.revenuePerRecipientCents))} hint={s ? "pro gesendeter Mail" : undefined} />
            </div>
            {s?.measuredUntil && (
              <p className="mt-2 text-2xs text-muted-foreground">
                Gemessen bis {formatAdmin(s.measuredUntil, ADMIN_DATE_TIME_SHORT)}
                {s.windowOpen ? " — der Zeitraum läuft noch, es können Bestellungen dazukommen." : " — Zeitraum abgeschlossen."}
              </p>
            )}
          </div>

          {error && (
            <Callout
              tone="destructive"
              compact
              action={
                <Button variant="outline" size="xs" onClick={() => setVersion((v) => v + 1)}>
                  Erneut laden
                </Button>
              }
            >
              {error}
            </Callout>
          )}
        </div>
      </Section>

      <ActivityCard series={data?.series ?? null} loading={loading && !data} metric={metric} onMetric={setMetric} />

      {children && (
        <Card>
          <CardContent className="flex flex-col gap-4 pt-4">{children}</CardContent>
        </Card>
      )}

      <RundmailRecipients
        campaignId={campaignId}
        state={state}
        update={update}
        version={version}
        counts={{
          all: stats.total,
          sent: stats.sent,
          delivered: stats.delivered,
          clicked: stats.clicked,
          ordered: s?.buyers ?? null,
          bounced: stats.bounced,
          complained: stats.complained,
          unsubscribed: stats.unsubscribed,
          not_sent: notSent,
        }}
        reasons={stats.skippedByReason}
        onOpen={(contactId) => update({ recipient: contactId })}
      />

      <RundmailRecipientSheet
        campaignId={campaignId}
        campaignName={campaignName}
        contactId={state.recipient}
        windowKey={state.window}
        onClose={() => update({ recipient: null })}
      />
    </div>
  );
}

/** „Verlauf“: one series at a time — the send, or clicks / orders / revenue after it. */
function ActivityCard({
  series,
  loading,
  metric,
  onMetric,
}: {
  series: RundmailAnalyticsSeries | null;
  loading: boolean;
  metric: Metric;
  onMetric: (m: Metric) => void;
}) {
  const activityStep = series?.activity.granularity === "day" ? 1440 : 60;
  const view =
    metric === "send"
      ? {
          points: series?.send.points ?? [],
          step: series?.send.stepMinutes ?? 10,
          kind: "count" as const,
          label: "Mails",
          caption: `Gesendete Mails ${STEP_TEXT[series?.send.stepMinutes ?? 10] ?? ""}`,
        }
      : {
          points: (series?.activity.points ?? []).map((p) => ({
            t: p.t,
            value: metric === "clicks" ? p.clicks : metric === "orders" ? p.orders : p.revenueCents / 100,
          })),
          step: activityStep,
          kind: metric === "revenue" ? ("eur" as const) : ("count" as const),
          label: metric === "clicks" ? "Klicks" : metric === "orders" ? "Bestellungen" : "Umsatz",
          caption: `${metric === "clicks" ? "Klicks" : metric === "orders" ? "Gezählte Bestellungen" : "Umsatz der gezählten Bestellungen"} ${STEP_TEXT[activityStep]}`,
        };
  const hasData = view.points.some((p) => p.value > 0);
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-1.5">
            Verlauf
            <InfoTip panelClassName="max-w-md">
              Versand: wie viele Mails pro Minute, 10 Minuten oder Stunde rausgingen. Klicks: jeder Klick auf einen Link der
              Mail. Bestellungen und Umsatz: die gezählten Bestellungen (Zeitraum, letzte Berührung) nach Bestellzeit. Bis
              vier Tage pro Stunde, darüber pro Tag — Berliner Zeit.
            </InfoTip>
          </CardTitle>
          <SegmentedControl<Metric>
            label="Kennzahl im Verlauf"
            value={metric}
            onChange={onMetric}
            options={[
              { value: "send", label: "Versand" },
              { value: "clicks", label: "Klicks" },
              { value: "orders", label: "Bestellungen" },
              { value: "revenue", label: "Umsatz" },
            ]}
          />
        </div>
      </CardHeader>
      <CardContent>
        <p className="mb-2 text-2xs text-muted-foreground">{view.caption}</p>
        {loading ? (
          <Skeleton className="h-[200px] w-full rounded-lg" />
        ) : hasData ? (
          <>
            <div aria-hidden>
              <TimeBarsChart points={view.points} stepMinutes={view.step} valueKind={view.kind} seriesLabel={view.label} />
            </div>
            <table className="sr-only">
              <caption>{view.caption}</caption>
              <thead>
                <tr>
                  <th scope="col">Zeit</th>
                  <th scope="col">{view.label}</th>
                </tr>
              </thead>
              <tbody>
                {view.points
                  .filter((p) => p.value > 0)
                  .map((p) => (
                    <tr key={p.t}>
                      <td>{bucketLabel(p.t, view.step)}</td>
                      <td>{view.kind === "eur" ? eur(p.value) : num(p.value)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </>
        ) : (
          <EmptyState compact plain title="Noch keine Werte für diesen Zeitraum." />
        )}
      </CardContent>
    </Card>
  );
}
