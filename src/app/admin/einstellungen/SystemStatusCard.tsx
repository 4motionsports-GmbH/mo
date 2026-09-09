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

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="size-4" aria-hidden /> Systemstatus
          <InfoTip>
            Welche Integrationen im Deployment konfiguriert sind und welche Freigaben (rechtliche
            Schalter) gesetzt sind — nur als „konfiguriert / nicht konfiguriert“, Werte werden nie
            angezeigt. Änderungen erfolgen über die Umgebungsvariablen des Deployments.
          </InfoTip>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-x-8 gap-y-6 sm:grid-cols-2">
        <StatusGroup title="Integrationen" rows={integrations} />
        <StatusGroup title="Freigaben" rows={gates} />
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
                <StatusBadge tone={r.on ? "success" : r.offTone ?? "neutral"}>{r.on ? onLabel : offLabel}</StatusBadge>
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}
