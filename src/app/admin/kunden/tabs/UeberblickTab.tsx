"use client";

// Überblick — the person at a glance: first the AI profile card („Aktuelles
// Kundenverständnis“ with its depth, the structured facts and the Art. 21
// objection — ProfilTab), then the computed figures (customer_facts: orders,
// value, rhythm, lifecycle, churn), where we know them from (Shopify, Mo,
// correspondence) and the e-mail language pin. Missing data is said plainly
// instead of left blank.

import * as React from "react";
import type { CustomerDetail } from "@/lib/customer-detail";
import { ADMIN_DATE, formatAdmin } from "@/lib/admin-datetime.mjs";
import { eur, eurFromCents, num } from "@/lib/admin-format.mjs";
import { SEGMENT_LABELS } from "@/lib/admin-customer-filter.mjs";
import Link from "next/link";
import type { SimilarCustomers } from "@/lib/customer-list-store";
import { adminTabHref } from "@/lib/admin-tabs.mjs";
import {
  DescriptionItem,
  DescriptionList,
  Disclosure,
  InfoTip,
  SegmentedControl,
  StatusBadge,
  buttonVariants,
} from "../../ui";
import { adminFetch } from "../../lib/admin-fetch";
import { useAsyncAction } from "../../lib/use-async-action";
import { useCustomerActions } from "../CustomerDetail";
import { CHURN_LABELS, VALUE_LABELS } from "../badges";
import { ProfilTab } from "./ProfilTab";

export function UeberblickTab({ customer }: { customer: CustomerDetail }) {
  const { refresh } = useCustomerActions();
  const f = customer.figures;
  const [language, setLanguage] = React.useState<"auto" | "de" | "en">(customer.languageOverride ?? "auto");

  const saveLanguage = useAsyncAction(
    (value: "auto" | "de" | "en") =>
      adminFetch("/api/admin/customers/language", {
        body: { customerId: customer.id, language: value === "auto" ? null : value },
      }),
    {
      errorToast: "Sprache nicht gespeichert",
      onSuccess: () => refresh(),
      // Back to the stored value — the control must not show a pin that was not saved.
      onError: () => setLanguage(customer.languageOverride ?? "auto"),
    }
  );

  const sources = [
    customer.isShopifyCustomer
      ? `Shopify${customer.shopifyCreatedAt ? ` seit ${formatAdmin(customer.shopifyCreatedAt, ADMIN_DATE)}` : ""}`
      : null,
    customer.sessions.length > 0 ? `Mo (${num(customer.sessions.length)} Gespräche)` : null,
    customer.correspondence.length > 0 ? `E-Mail (${num(customer.correspondence.length)} Nachrichten)` : null,
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-5">
      <ProfilTab customer={customer} />

      <section>
        <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
          Kennzahlen
          <InfoTip>
            Aus den Bestellungen und Kontakten berechnet (nächtlich und nach jeder neuen Bestellung).
            Lebenszyklus: Zeit seit dem letzten Kauf. Wertstufe: der teuerste einzelne Artikel, der je gekauft wurde.
            Abwanderungsrisiko: Zeit seit dem letzten Kauf gemessen am persönlichen Kaufrhythmus.
          </InfoTip>
          {f?.factsComputedAt && (
            <span className="text-xs font-normal text-muted-foreground">· Stand {formatAdmin(f.factsComputedAt, ADMIN_DATE)}</span>
          )}
        </h3>
        {!f || !f.factsComputedAt ? (
          <p className="text-sm text-muted-foreground">Noch nicht berechnet — die Kennzahlen entstehen beim nächsten nächtlichen Lauf.</p>
        ) : (
          <DescriptionList columns={3}>
            <DescriptionItem label="Bestellungen">{f.ordersCount > 0 ? num(f.ordersCount) : "Noch keine"}</DescriptionItem>
            <DescriptionItem label="Umsatz">{f.ordersCount > 0 ? eurFromCents(f.totalSpentCents) : "—"}</DescriptionItem>
            <DescriptionItem label="Ø Bestellwert">{f.aovCents != null ? eurFromCents(f.aovCents) : "—"}</DescriptionItem>
            <DescriptionItem label="Erster Kauf">{formatAdmin(f.firstOrderAt, ADMIN_DATE)}</DescriptionItem>
            <DescriptionItem label="Letzter Kauf">{formatAdmin(f.lastOrderAt, ADMIN_DATE)}</DescriptionItem>
            <DescriptionItem label="Kaufrhythmus">
              {f.medianIntervalDays != null ? `alle ~${num(Math.round(f.medianIntervalDays))} Tage` : "—"}
            </DescriptionItem>
            <DescriptionItem label="Lebenszyklus">
              {f.lifecycleSegment ? (SEGMENT_LABELS[f.lifecycleSegment as keyof typeof SEGMENT_LABELS] ?? f.lifecycleSegment) : f.ordersCount > 0 ? "—" : "Ohne Bestellung"}
            </DescriptionItem>
            <DescriptionItem label="Wertstufe">{f.valueTier ? VALUE_LABELS[f.valueTier] ?? f.valueTier : "—"}</DescriptionItem>
            <DescriptionItem label="Abwanderungsrisiko">
              {f.churnRisk ? (
                <StatusBadge tone={f.churnRisk === "hoch" ? "destructive" : f.churnRisk === "mittel" ? "warning" : "success"}>
                  {CHURN_LABELS[f.churnRisk] ?? f.churnRisk}
                </StatusBadge>
              ) : (
                "—"
              )}
            </DescriptionItem>
            {f.expectedNextOrderAt && (
              <DescriptionItem label="Nächster Kauf erwartet">{formatAdmin(f.expectedNextOrderAt, ADMIN_DATE)}</DescriptionItem>
            )}
            <DescriptionItem label="Kampagnen-Mails">
              {num(f.emailsSentCount)}
              {f.clicks90d > 0 && <span className="text-muted-foreground"> · {num(f.clicks90d)} Klicks (90 T.)</span>}
            </DescriptionItem>
            {f.boughtCategories.length > 0 && (
              <DescriptionItem label="Kategorien">{f.boughtCategories.slice(0, 6).join(", ")}</DescriptionItem>
            )}
            {customer.nextLikely.length > 0 && (
              <DescriptionItem
                label={
                  <span className="inline-flex items-center gap-1">
                    Wahrscheinlich als Nächstes
                    <InfoTip>Ergänzende Produkte zu dem, was die Person schon besitzt (aus den Produktdaten des Katalogs).</InfoTip>
                  </span>
                }
              >
                {customer.nextLikely.map((p) => `${p.name} (${eur(p.price)})`).join(", ")}
              </DescriptionItem>
            )}
          </DescriptionList>
        )}
      </section>

      <section className="flex flex-wrap items-start gap-x-8 gap-y-3">
        <div>
          <div className="mb-1 text-xs text-muted-foreground">Datenquellen</div>
          <div className="text-sm">{sources.length > 0 ? sources.join(" · ") : "Nur die E-Mail-Adresse"}</div>
          {customer.shopifyTags.length > 0 && (
            <div className="mt-1 text-xs text-muted-foreground">Shopify-Tags: {customer.shopifyTags.join(", ")}</div>
          )}
        </div>
        <div>
          <div className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
            Sprache für E-Mails
            <InfoTip>
              Automatisch aus dem Shopify-Profil (Sprache, sonst Land) oder dem letzten Gespräch mit Mo.
              Eine feste Wahl gilt für alle Kampagnen und die Einzelansprache.
            </InfoTip>
          </div>
          <SegmentedControl
            label="Sprache für E-Mails"
            value={language}
            disabled={saveLanguage.pending}
            onChange={(v) => {
              setLanguage(v);
              void saveLanguage.run(v);
            }}
            options={[
              { value: "auto", label: "Automatisch" },
              { value: "de", label: "Deutsch" },
              { value: "en", label: "Englisch" },
            ]}
          />
        </div>
      </section>

      {f && f.ordersCount > 0 && <SimilarCustomersSection customerId={customer.id} />}
    </div>
  );
}

/** People like this one (same value tier, shared bought categories) — loaded when opened. */
function SimilarCustomersSection({ customerId }: { customerId: number }) {
  const [data, setData] = React.useState<SimilarCustomers | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const load = React.useCallback(() => {
    if (data) return;
    adminFetch<SimilarCustomers>(`/api/admin/customers/similar?id=${customerId}`)
      .then(setData)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Nicht geladen"));
  }, [customerId, data]);
  const consented = data?.items.filter((i) => i.consented).length ?? 0;
  return (
    <Disclosure
      title="Ähnliche Kunden"
      meta={data ? `${num(data.items.length)}` : undefined}
      onOpenChange={(open) => {
        if (open) load();
      }}
      actions={
        <InfoTip>
          Gleiche Wertstufe und gemeinsame gekaufte Kategorien, zuerst die mit den meisten Gemeinsamkeiten. „Als
          Zielgruppe verwenden“ legt eine neue Kampagne mit genau diesen Merkmalen an — sie erreicht per E-Mail nur
          Personen mit Einwilligung.
        </InfoTip>
      }
    >
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : !data ? (
        <p className="text-xs text-muted-foreground">Lädt…</p>
      ) : data.items.length === 0 ? (
        <p className="text-xs text-muted-foreground">Keine ähnlichen Kunden gefunden.</p>
      ) : (
        <div className="flex flex-col gap-2">
          <ul className="flex flex-col gap-1 text-sm">
            {data.items.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-2">
                <Link href={adminTabHref("kunden", { customer: String(i.id) })} className="hover:underline">
                  {i.name ?? i.email}
                </Link>
                <span className="text-xs text-muted-foreground">{i.sharedCategories.slice(0, 3).join(", ")}</span>
                {!i.consented && (
                  <StatusBadge tone="neutral" dot={false}>
                    ohne Einwilligung
                  </StatusBadge>
                )}
              </li>
            ))}
          </ul>
          {data.audience && (
            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2 text-xs text-muted-foreground">
              <span>
                {num(consented)} von {num(data.items.length)} per E-Mail erreichbar.
              </span>
              <Link
                href={adminTabHref("kampagne", { edit: "new", audience: JSON.stringify(data.audience) })}
                className={`${buttonVariants({ variant: "outline", size: "xs" })} ml-auto`}
              >
                Als Zielgruppe verwenden
              </Link>
            </div>
          )}
        </div>
      )}
    </Disclosure>
  );
}
