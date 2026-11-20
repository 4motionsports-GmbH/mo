"use client";

// „Einrichtung“ (a Disclosure at the bottom of „Gutscheine“, deep link
// #einrichtung): the setup check — database, switches, keys (presence only),
// Shopify scopes and products, printing, limits — as ✓ / ✗ rows grouped by
// topic (gutscheine-core.mjs buildGutscheineSetup; Shopify via GET
// /api/admin/gutscheine/setup, „Erneut prüfen“ re-reads the products), and
// the operator settings saved through POST /api/admin/gutscheine/settings.

import * as React from "react";
import { AlertTriangle, CheckCircle2, Info, RefreshCw, Save, XCircle } from "lucide-react";
import { plural } from "@/lib/admin-format.mjs";
import { ADMIN_DATE_TIME_SHORT, formatAdmin } from "@/lib/admin-datetime.mjs";
import { GIFT_VOUCHER_SETTING_LABELS } from "@/lib/gift-voucher-settings.mjs";
import type { GiftVoucherSettings } from "@/lib/gift-voucher-store";
import { Button, Callout, Checkbox, Disclosure, InfoTip, Spinner, cn } from "../ui";
import { adminFetch } from "../lib/admin-fetch";
import { useAsyncAction } from "../lib/use-async-action";
import { setupCounts, type SetupCheck } from "./gutscheine-core.mjs";
import type { GutscheineSetup } from "./types";

const GROUPS = ["Grundlagen", "Shopify", "Kartendruck", "Grenzen"] as const;

const SETTING_KEYS = ["salesEnabled", "aiSuggestions", "photoUploads", "reviewPrintWithPhoto"] as const;

const SETTING_INFO: Record<(typeof SETTING_KEYS)[number], string> = {
  salesEnabled:
    "Der Gutschein-Designer im Shop nimmt Bestellungen an — nur zusammen mit dem Hauptschalter GIFT_VOUCHERS_ENABLED. Aus: Die Seite zeigt einen Hinweis statt des Designers.",
  aiSuggestions:
    "„Mit Mo formulieren“ im Designer: drei KI-Vorschläge für die Nachricht, ohne persönliche Daten (braucht ANTHROPIC_API_KEY).",
  photoUploads: "Das Motiv „Eigenes Foto“: Kund:innen laden ein Foto hoch (braucht BLOB_READ_WRITE_TOKEN).",
  reviewPrintWithPhoto:
    "Eine Premium-Karte mit Kundenfoto wartet unter „Zu prüfen“, bis sie hier jemand freigibt — erst dann wird sie gedruckt.",
};

const STATE_ICON: Record<SetupCheck["state"], { icon: React.ReactNode; label: string }> = {
  ok: { icon: <CheckCircle2 className="size-4 text-success" aria-hidden />, label: "in Ordnung" },
  error: { icon: <XCircle className="size-4 text-destructive" aria-hidden />, label: "Problem" },
  warn: { icon: <AlertTriangle className="size-4 text-warning" aria-hidden />, label: "Hinweis" },
  info: { icon: <Info className="size-4 text-muted-foreground" aria-hidden />, label: "Info" },
  pending: { icon: <Spinner size="sm" />, label: "wird geprüft" },
};

function summaryText(checks: SetupCheck[]): string {
  const c = setupCounts(checks);
  const parts = [
    c.errors > 0 ? plural(c.errors, "Problem", "Probleme") : null,
    c.warnings > 0 ? plural(c.warnings, "Hinweis", "Hinweise") : null,
  ].filter(Boolean);
  if (parts.length > 0) return parts.join(" · ") + (c.pending > 0 ? " · Shopify wird geprüft …" : "");
  return c.pending > 0 ? "Shopify wird geprüft …" : "alles bereit";
}

export function SetupPanel({
  setup,
  settings,
  dbReady,
  open,
  onOpenChange,
  rechecking,
  onRecheck,
  onSaved,
}: {
  setup: GutscheineSetup;
  settings: GiftVoucherSettings;
  dbReady: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rechecking: boolean;
  onRecheck: () => void;
  onSaved: (settings: GiftVoucherSettings) => void;
}) {
  const [saved, setSaved] = React.useState(settings);
  const [form, setForm] = React.useState(settings);
  React.useEffect(() => {
    setSaved(settings);
    setForm(settings);
  }, [settings]);
  const dirty = SETTING_KEYS.some((k) => form[k] !== saved[k]);

  const save = useAsyncAction(
    async () => adminFetch<{ ok: true; settings: GiftVoucherSettings }>("/api/admin/gutscheine/settings", { body: form }),
    {
      errorToast: "Nicht gespeichert",
      successToast: "Einstellungen gespeichert",
      onSuccess: (r) => {
        setSaved(r.settings);
        setForm(r.settings);
        onSaved(r.settings);
      },
    }
  );

  const counts = setupCounts(setup.checks);
  return (
    <Disclosure
      title="Einrichtung"
      meta={summaryText(setup.checks)}
      open={open}
      onOpenChange={onOpenChange}
      actions={
        <Button size="xs" variant="ghost" onClick={onRecheck} loading={rechecking} disabled={counts.pending > 0 && !rechecking}>
          <RefreshCw aria-hidden /> Erneut prüfen
        </Button>
      }
    >
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-5">
          {GROUPS.map((group) => {
            const rows = setup.checks.filter((c) => c.group === group);
            if (rows.length === 0) return null;
            return (
              <div key={group}>
                <div className="mb-1.5 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">{group}</div>
                <ul className="flex flex-col">
                  {rows.map((c) => (
                    <li key={c.key} className="flex items-start gap-2.5 border-b border-border/60 py-1.5 last:border-0">
                      <span className="mt-0.5 shrink-0">
                        {STATE_ICON[c.state].icon}
                        <span className="sr-only">{STATE_ICON[c.state].label}: </span>
                      </span>
                      <span className="min-w-0 text-sm">
                        <span className="font-medium text-foreground">{c.label}</span>
                        <span className={cn("block text-xs", c.state === "error" ? "text-destructive" : "text-muted-foreground")}>
                          {c.detail}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
          {setup.checkedAt && (
            <div className="text-2xs text-muted-foreground">Geprüft {formatAdmin(setup.checkedAt, ADMIN_DATE_TIME_SHORT)}</div>
          )}
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-1.5 text-sm font-semibold">
            Einstellungen
            <InfoTip panelClassName="max-w-sm">
              Gelten sofort für neue Bestellungen und den Gutschein-Designer im Shop (spätestens nach einer Minute). Die
              Umgebungsvariablen (Hauptschalter, Grenzen, Druckfreigabe) ändern sich nur im Deployment.
            </InfoTip>
          </div>
          {!dbReady && (
            <Callout tone="warning" compact>
              Ohne Datenbank gelten die Standardwerte — speichern geht nicht.
            </Callout>
          )}
          <div className="flex flex-col gap-2.5">
            {SETTING_KEYS.map((key) => (
              <div key={key} className="flex items-center gap-1.5">
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <Checkbox
                    checked={form[key]}
                    disabled={!dbReady || save.pending}
                    onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.checked }))}
                  />
                  {GIFT_VOUCHER_SETTING_LABELS[key]}
                </label>
                <InfoTip label={`Was „${GIFT_VOUCHER_SETTING_LABELS[key]}“ bedeutet`} panelClassName="max-w-sm">
                  {SETTING_INFO[key]}
                </InfoTip>
              </div>
            ))}
          </div>
          <div>
            <Button size="sm" onClick={() => void save.run()} loading={save.pending} disabled={!dbReady || !dirty}>
              <Save aria-hidden /> Speichern
            </Button>
          </div>
        </div>
      </div>
    </Disclosure>
  );
}
