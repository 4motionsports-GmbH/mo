// Systemstatus — which integrations are wired up and which legal gates are
// open, as configured / not configured. Values come from the server (booleans
// only); no secret ever reaches the browser.

import { Activity } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, InfoTip, StatusBadge } from "../ui";
import type { SystemStatus } from "./types";

interface Row {
  label: string;
  env: string;
  on: boolean;
  /** Replaces the on-label (e.g. „25 / Tag“). */
  value?: string;
  /** Labels for the two states (default konfiguriert / nicht konfiguriert). */
  states?: [string, string];
  /** Tone when off — a missing integration is neutral, a closed gate is a warning. */
  offTone?: "neutral" | "warning";
}

export function SystemStatusCard({ status }: { status: SystemStatus }) {
  const integrations: Row[] = [
    { label: "Datenbank", env: "DATABASE_URL", on: status.db, offTone: "warning" },
    { label: "Shopify Admin API", env: "SHOPIFY_*", on: status.shopify },
    { label: "E-Mail-Versand (Resend)", env: "RESEND_API_KEY · CONTACT_FROM_EMAIL", on: status.resendSend },
    { label: "Resend-Webhook (Zustellung, Posteingang)", env: "RESEND_WEBHOOK_SECRET", on: status.resendWebhook },
    { label: "Postversand (Pingen)", env: "PINGEN_*", on: status.pingen },
    { label: "KI · Anthropic", env: "ANTHROPIC_API_KEY", on: status.anthropic },
    { label: "KI · OpenAI (Embeddings, Hero-Bilder)", env: "OPENAI_API_KEY", on: status.openai },
    { label: "Rate-Limits (Upstash KV)", env: "KV_REST_API_URL · KV_REST_API_TOKEN", on: status.kv, offTone: "warning" },
  ];
  const gates: Row[] = [
    {
      label: "Kampagnen-Versand",
      env: "CAMPAIGN_SENDS_APPROVED",
      on: status.campaignSendsApproved,
      states: ["Freigegeben", "Gesperrt"],
      offTone: "warning",
    },
    {
      label: "Single-Opt-in-Kontakte",
      env: "CAMPAIGN_ALLOW_SINGLE_OPT_IN",
      on: status.singleOptInAllowed,
      states: ["Erlaubt", "Nur Double-Opt-in"],
    },
    {
      label: "Brief-Versand",
      env: "PHYSICAL_MAIL_SENDS_APPROVED",
      on: status.physicalMailApproved,
      states: ["Freigegeben", "Gesperrt"],
      offTone: "warning",
    },
  ];

  const f = status.features;
  const onOff: [string, string] = ["An", "Aus"];
  const features: Row[] = [
    { label: "Kunden-Abgleich mit Shopify", env: "SHOPIFY_CUSTOMER_SYNC_ENABLED", on: f.customerSync, states: onOff, offTone: "warning" },
    { label: "Einwilligung → Shopify", env: "SHOPIFY_CONSENT_WRITEBACK", on: f.consentWriteback, states: onOff },
    { label: "Löschung → Shopify", env: "SHOPIFY_ERASURE_SYNC", on: f.erasureSync, states: onOff },
    { label: "Mo-Merkmale als Shopify-Tags", env: "SHOPIFY_WRITEBACK_ENABLED", on: f.insightsWriteback, states: onOff },
    { label: "KI-Profile für alle Kund:innen", env: "CUSTOMER_AI_PROFILE_SCOPE", on: f.aiProfilesAll, states: ["Alle", "Nur mit Einwilligung"] },
    { label: "„Einplanen“ (Versand später)", env: "CAMPAIGN_RELEASE_ENABLED", on: f.campaignRelease, states: onOff },
    {
      label: "Nächtliche Kampagnen-Entwürfe",
      env: "CAMPAIGN_AUTO_PREPARE_COUNT",
      on: f.autoPreparePerNight > 0,
      value: `${f.autoPreparePerNight} / Nacht`,
      states: onOff,
    },
    {
      label: "KI-Vorschläge im Eingang",
      env: "INBOX_AI_DAILY_LIMIT",
      on: f.inboxAiPerDay > 0,
      value: `${f.inboxAiPerDay} / Tag`,
      states: onOff,
    },
    { label: "Bestellstatus im Chat", env: "CHAT_ORDER_STATUS_ENABLED", on: f.chatOrderStatus, states: onOff },
    {
      label: "Pingen-Umgebung",
      env: "PINGEN_STAGING",
      on: !f.pingenStaging,
      states: ["Produktion", "Testumgebung (druckt nichts)"],
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="size-4" aria-hidden /> Systemstatus
          <InfoTip>
            Welche Integrationen im Deployment konfiguriert sind, welche Freigaben (rechtliche
            Schalter) gesetzt sind und welche Funktionen eingeschaltet sind — nur als „konfiguriert / nicht konfiguriert“, Werte werden nie
            angezeigt. Änderungen erfolgen über die Umgebungsvariablen des Deployments.
          </InfoTip>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-x-8 gap-y-6 sm:grid-cols-2">
        <StatusGroup title="Integrationen" rows={integrations} />
        <div className="flex flex-col gap-6">
          <StatusGroup title="Freigaben" rows={gates} />
          <StatusGroup title="Funktionen" rows={features} />
        </div>
      </CardContent>
    </Card>
  );
}

function StatusGroup({ title, rows }: { title: string; rows: Row[] }) {
  return (
    <div>
      <div className="mb-2 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</div>
      <dl className="flex flex-col">
        {rows.map((r) => {
          const [onLabel, offLabel] = r.states ?? ["Konfiguriert", "Nicht konfiguriert"];
          return (
            <div
              key={r.env}
              className="flex items-center justify-between gap-3 border-b border-border/60 py-1.5 last:border-0"
            >
              <dt className="min-w-0">
                <span className="block truncate text-sm text-foreground">{r.label}</span>
                <code className="block truncate text-2xs text-muted-foreground">{r.env}</code>
              </dt>
              <dd className="shrink-0">
                <StatusBadge tone={r.on ? "success" : r.offTone ?? "neutral"}>
                  {r.on ? (r.value ?? onLabel) : offLabel}
                </StatusBadge>
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}
