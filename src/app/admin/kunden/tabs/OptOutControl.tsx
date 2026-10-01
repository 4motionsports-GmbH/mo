"use client";

// Werbe-Einwilligung — the ONE e-mail consent (shared with Shopify) at a
// glance: state, level, since when and where it came from, the block list
// state, the history, and the manual controls: "Abmelden" on request and
// "Abmeldung aufheben" when an unsubscribe was a mistake or has been taken
// back. Neither sends an e-mail; both reach Shopify through the outbox.
// Server side: /api/admin/customers/marketing-optout (lib/marketing-optout.ts).

import * as React from "react";
import { MailCheck, MailX } from "lucide-react";
import type { CustomerDetail } from "@/lib/customer-detail";
import { ADMIN_DATE_TIME_SHORT, formatAdmin } from "@/lib/admin-datetime.mjs";
import { Button, Callout, DescriptionItem, DescriptionList, Disclosure, InfoTip, toast, useConfirm } from "../../ui";
import { adminFetch } from "../../lib/admin-fetch";
import { useAsyncAction } from "../../lib/use-async-action";
import { useCustomerActions } from "../CustomerDetail";

const STATE_SHORT: Record<string, string> = {
  subscribed: "angemeldet",
  pending: "Bestätigung ausstehend",
  unsubscribed: "abgemeldet",
  not_subscribed: "keine Einwilligung",
};

export function OptOutControl({ customer }: { customer: CustomerDetail }) {
  const { refresh } = useCustomerActions();
  const { confirm, confirmDialog } = useConfirm();
  const optOut = customer.optOut;

  const run = useAsyncAction(
    async (action: "optout" | "lift") => ({
      action,
      ...(await adminFetch<{ ok: true; restoredContacts?: number }>(
        "/api/admin/customers/marketing-optout",
        { body: { customerId: customer.id, action, confirm: true } }
      )),
    }),
    {
      errorToast: "Änderung fehlgeschlagen",
      onSuccess: (json) => {
        const action = json.action;
        toast({
          variant: "success",
          title: action === "lift" ? "Abmeldung aufgehoben" : "Abgemeldet",
          description:
            action === "lift" && json.restoredContacts
              ? `${customer.email} — zurück in ${json.restoredContacts === 1 ? "der Kampagne" : "den Kampagnen"}`
              : customer.email,
        });
        refresh();
      },
    }
  );

  async function onOptOut() {
    const ok = await confirm({
      title: "Werbung an diese Person stoppen?",
      description:
        "Die Person wird von E-Mail-Werbung abgemeldet — bei Mo und in Shopify (eine gemeinsame Einwilligung). Offene Kampagnen-Entwürfe verlassen sofort die Warteschlange. Es wird keine E-Mail verschickt. Rückgängig über „Abmeldung aufheben“.",
      confirmLabel: "Abmelden",
      tone: "destructive",
    });
    if (ok) void run.run("optout");
  }

  async function onLift() {
    const ok = await confirm({
      title: "Abmeldung aufheben?",
      description:
        "Nur wenn die Abmeldung ein Versehen war oder die Person ausdrücklich wieder Werbung möchte. Die frühere Einwilligung gilt wieder (auch in Shopify), offene Kampagnen-Empfänger kehren in die Warteschlange zurück. Es wird keine E-Mail verschickt; die Änderung wird protokolliert.",
      confirmLabel: "Abmeldung aufheben",
    });
    if (ok) void run.run("lift");
  }

  if (!optOut) return null; // no DB, or no real e-mail address (Shopify placeholder)

  return (
    <section className="flex flex-col gap-3">
      {confirmDialog}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          Werbe-Einwilligung
          <InfoTip>
            Eine Einwilligung für Shopify und Mo: Anmeldung im Shop, an der Kasse, im Chat oder über
            das Formular zählt überall; eine Abmeldung (Link in einer Mail, im Shop, manuell,
            Spam-Beschwerde) gilt ebenfalls überall. Abmelden und Aufheben verschicken keine E-Mail.
          </InfoTip>
        </div>
        {!optOut.blocked && (
          <Button
            variant="ghost"
            size="xs"
            onClick={() => void onOptOut()}
            loading={run.pending}
            className="text-destructive"
          >
            <MailX /> Abmelden
          </Button>
        )}
      </div>

      <DescriptionList columns={3}>
        <DescriptionItem label="E-Mail-Werbung">{customer.consent.label}</DescriptionItem>
        <DescriptionItem label="Seit">{formatAdmin(customer.consent.at, ADMIN_DATE_TIME_SHORT)}</DescriptionItem>
        <DescriptionItem label="Quelle">{customer.consent.sourceLabel ?? "—"}</DescriptionItem>
      </DescriptionList>

      {customer.consent.history.length > 0 && (
        <Disclosure title={`Verlauf (${customer.consent.history.length})`} framed={false}>
          <ul className="flex flex-col gap-1 text-xs">
            {customer.consent.history.map((h) => (
              <li key={h.id} className="flex flex-wrap gap-x-2">
                <span className="tabular-nums text-muted-foreground">{formatAdmin(h.occurredAt, ADMIN_DATE_TIME_SHORT)}</span>
                <span>{STATE_SHORT[h.state] ?? h.state}</span>
                <span className="text-muted-foreground">
                  {h.sourceLabel}
                  {h.level === "confirmed_opt_in" ? " · DOI" : ""}
                  {h.note ? ` · ${h.note}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </Disclosure>
      )}

      {optOut.blocked && (
        <Callout
          tone="warning"
          compact
          title={`Abgemeldet${optOut.since ? ` seit ${formatAdmin(optOut.since, ADMIN_DATE_TIME_SHORT)}` : ""}`}
          action={
            optOut.canLift ? (
              <Button variant="outline" size="xs" onClick={() => void onLift()} loading={run.pending}>
                <MailCheck /> Abmeldung aufheben
              </Button>
            ) : undefined
          }
        >
          {optOut.label}
          {!optOut.canLift && optOut.liftBlockedWhy ? ` — ${optOut.liftBlockedWhy}` : ""}
        </Callout>
      )}
    </section>
  );
}
