"use client";

// Werbe-Einwilligung — the person's marketing state at a glance (chat
// newsletter, Shopify newsletter / Kampagne, local block) with the manual
// controls: "Abmelden" on request and "Abmeldung aufheben" when an
// unsubscribe was a mistake or has been taken back. Neither sends an e-mail.
// Server side: /api/admin/customers/marketing-optout (lib/marketing-optout.ts).

import * as React from "react";
import { MailCheck, MailX } from "lucide-react";
import type { CustomerDetail } from "@/lib/customer-detail";
import { ADMIN_DATE_TIME_SHORT, formatAdmin } from "@/lib/admin-datetime.mjs";
import { Button, Callout, DescriptionItem, DescriptionList, InfoTip, toast, useConfirm } from "../../ui";
import { adminFetch } from "../../lib/admin-fetch";
import { useAsyncAction } from "../../lib/use-async-action";
import { useCustomerActions } from "../CustomerDetail";

const CHAT_STATUS: Record<CustomerDetail["marketingStatus"], string> = {
  confirmed: "Bestätigt (Double-Opt-in)",
  pending: "Bestätigung ausstehend",
  none: "Keine Einwilligung",
  unsubscribed: "Abgemeldet",
};

function newsletterLabel(status: string | undefined): string {
  if (!status) return "Kein Abonnent";
  if (status === "suppressed") return "Unterdrückt — erhält keine Kampagnen-Mails";
  return "Abonniert";
}

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
              ? `${customer.email} — zurück in der Kampagnen-Warteschlange`
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
        "Die Adresse kommt auf die Sperrliste (Grund: manuell). Es gehen keine Marketing- oder Kampagnen-Mails mehr an sie, der Kampagnen-Kontakt verlässt sofort die Warteschlange. Es wird keine E-Mail verschickt. Rückgängig über „Abmeldung aufheben“.",
      confirmLabel: "Abmelden",
      tone: "destructive",
    });
    if (ok) void run.run("optout");
  }

  async function onLift() {
    const ok = await confirm({
      title: "Abmeldung aufheben?",
      description:
        "Nur wenn die Abmeldung ein Versehen war oder die Person ausdrücklich wieder Werbung möchte. Die Sperre wird entfernt, eine frühere Double-Opt-in-Bestätigung gilt wieder und der Kampagnen-Kontakt kehrt in die Warteschlange zurück. Es wird keine E-Mail verschickt; die Änderung wird protokolliert.",
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
            Chat-Newsletter = Einwilligung aus dem Mo-Chat (Double-Opt-in). Shopify-Newsletter = Abonnent
            im Shop, Grundlage der Kampagne. Eine Abmeldung (Link in einer Mail, manuell, Bounce,
            Spam-Beschwerde) sperrt beide Kanäle. Abmelden und Aufheben verschicken keine E-Mail.
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

      <DescriptionList columns={2}>
        <DescriptionItem label="Chat-Newsletter">{CHAT_STATUS[customer.marketingStatus]}</DescriptionItem>
        <DescriptionItem label="Shopify-Newsletter (Kampagne)">
          {newsletterLabel(customer.newsletter?.status)}
        </DescriptionItem>
      </DescriptionList>

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
