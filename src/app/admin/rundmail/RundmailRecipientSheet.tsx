"use client";

// One recipient of a Rundmail (`?recipient=<id>` in the „Versand“ tab): the
// status, the facts (sent, delivered, clicks, the orders counted in the
// window and their revenue), the timeline (sent → delivered → every click
// with its link → orders → bounce / complaint / unsubscribe) and every order
// after the mail inside the window — items, total, refunds, codes, „mit
// Code“ / „nach Klick“, and why an order does NOT count (cancelled, a later
// Rundmail). „Mail ansehen“ shows this person's mail: the frozen Rundmail
// personalised with their first name, links inert, no live unsubscribe link
// (POST /api/admin/rundmail/sent-email). GET /api/admin/rundmail/recipient.

import * as React from "react";
import Link from "next/link";
import { Ban, MailCheck, MailX, MousePointerClick, Send, ShieldAlert, ShoppingBag, UserMinus, UserRound } from "lucide-react";
import { ADMIN_DATE_TIME_SHORT, formatAdmin } from "@/lib/admin-datetime.mjs";
import { eur, eurFromCents, num } from "@/lib/admin-format.mjs";
import { adminTabHref } from "@/lib/admin-tabs.mjs";
import {
  ORDER_VERDICT_LABELS,
  notSentReasonLabel,
  recipientName,
  recipientState,
  rundmailWindowLabel,
  type RundmailWindowKey,
} from "@/lib/rundmail-analytics.mjs";
import type { RundmailRecipientDetail, RundmailRecipientOrder } from "@/lib/rundmail-analytics-store";
import {
  Callout,
  DescriptionItem,
  DescriptionList,
  Sheet,
  Skeleton,
  StatusBadge,
  Tooltip,
  buttonVariants,
  cn,
} from "../ui";
import { adminFetch, errorMessage } from "../lib/admin-fetch";
import { EmailPreviewButton } from "../EmailPreviewButton";

const ICONS = {
  sent: Send,
  delivered: MailCheck,
  click: MousePointerClick,
  order: ShoppingBag,
  bounce: MailX,
  complaint: ShieldAlert,
  unsubscribe: UserMinus,
  not_sent: Ban,
} as const;

const time = (value: string | null) => (value ? formatAdmin(value, ADMIN_DATE_TIME_SHORT) : "—");

export function RundmailRecipientSheet({
  campaignId,
  campaignName,
  contactId,
  windowKey,
  onClose,
}: {
  campaignId: number;
  campaignName: string;
  contactId: number | null;
  /** The attribution window of the analysis. */
  windowKey: RundmailWindowKey;
  onClose: () => void;
}) {
  const [detail, setDetail] = React.useState<RundmailRecipientDetail | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (contactId == null) return;
    const controller = new AbortController();
    setError(null);
    adminFetch<{ recipient: RundmailRecipientDetail }>(
      `/api/admin/rundmail/recipient?campaignId=${campaignId}&contactId=${contactId}&window=${windowKey}`,
      { signal: controller.signal }
    )
      .then((json) => {
        if (!controller.signal.aborted) setDetail(json.recipient);
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setError(errorMessage(err));
      });
    return () => controller.abort();
  }, [campaignId, contactId, windowKey]);

  const shown = detail && detail.contactId === contactId && detail.window === windowKey ? detail : null;
  const name = shown ? recipientName(shown) : "";
  const chip = shown
    ? recipientState({
        status: shown.status,
        excludedReason: shown.excludedReason,
        sentAt: shown.send?.sentAt ?? null,
        deliveredAt: shown.send?.deliveredAt ?? null,
        bouncedAt: shown.send?.bouncedAt ?? null,
        bounceType: shown.send?.bounceType ?? null,
        complainedAt: shown.send?.complainedAt ?? null,
        clickedAt: shown.send?.clickedAt ?? null,
      })
    : null;

  return (
    <Sheet
      open={contactId != null}
      onOpenChange={(open) => !open && onClose()}
      size="lg"
      title={shown ? name || shown.email : "Empfänger:in"}
      description={shown ? (name ? shown.email : `Rundmail „${campaignName}“`) : `Rundmail „${campaignName}“`}
      actions={
        shown && (
          <div className="flex items-center gap-1.5">
            {shown.send && (
              <EmailPreviewButton
                path="/api/admin/rundmail/sent-email"
                getPayload={() => ({ contactId: shown.contactId })}
                title={shown.send.subject ? `„${shown.send.subject}“ an ${shown.email}` : `Rundmail an ${shown.email}`}
                description="Genau diese Mail ging an diese Person — personalisiert mit dem Vornamen aus dem Kundenprofil. Links und Abmelde-Link sind in der Vorschau inaktiv; es wird nichts gezählt."
                label="Mail ansehen"
                size="sm"
              />
            )}
            {shown.customerId && (
              <Link href={adminTabHref("kunden", { customer: String(shown.customerId) })} className={buttonVariants({ variant: "ghost", size: "sm" })}>
                <UserRound aria-hidden /> Kundenprofil
              </Link>
            )}
          </div>
        )
      }
    >
      {error ? (
        <Callout tone="destructive" compact>
          {error}
        </Callout>
      ) : !shown ? (
        <div className="flex flex-col gap-3" aria-busy="true">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center gap-2">
            {chip && (
              <StatusBadge tone={chip.tone} size="md">
                {chip.label}
              </StatusBadge>
            )}
            {shown.send?.subject && <span className="min-w-0 truncate text-sm text-muted-foreground">„{shown.send.subject}“</span>}
          </div>

          {!shown.send ? (
            <Callout tone={shown.status === "pending" || shown.status === "sending" ? "info" : "neutral"} compact>
              {shown.status === "pending"
                ? "Noch nicht gesendet — die Person ist in der Warteschlange."
                : shown.status === "sending"
                  ? "Wird gerade gesendet."
                  : `Nicht gesendet: ${notSentReasonLabel(shown.excludedReason)}.`}
            </Callout>
          ) : (
            <DescriptionList columns={3}>
              <DescriptionItem label="Gesendet">{time(shown.send.sentAt)}</DescriptionItem>
              <DescriptionItem label="Zugestellt">{time(shown.send.deliveredAt)}</DescriptionItem>
              <DescriptionItem label="Erster Klick">{time(shown.send.clickedAt)}</DescriptionItem>
              <DescriptionItem label="Klicks">{num(shown.clicks.length)}</DescriptionItem>
              <DescriptionItem label={`Bestellungen · ${rundmailWindowLabel(windowKey)}`}>
                {num(shown.totals.orders)}
                {shown.totals.codeOrders > 0 ? ` · ${num(shown.totals.codeOrders)} mit Code` : ""}
              </DescriptionItem>
              <DescriptionItem label="Umsatz">{eurFromCents(shown.totals.revenueCents)}</DescriptionItem>
            </DescriptionList>
          )}

          {shown.timeline.length > 0 && (
            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold">Verlauf</h3>
              <ol className="relative flex flex-col gap-3 border-l border-border pl-5">
                {shown.timeline.map((e, i) => {
                  const Icon = ICONS[e.kind];
                  return (
                    <li key={`${e.kind}-${e.at}-${i}`} className="relative">
                      <span
                        className={cn(
                          "absolute -left-[1.85rem] top-0.5 flex size-5 items-center justify-center rounded-full border border-border bg-card",
                          e.kind === "order" ? "text-success" : e.kind === "bounce" || e.kind === "complaint" ? "text-destructive" : "text-muted-foreground"
                        )}
                      >
                        <Icon className="size-3" aria-hidden />
                      </span>
                      <div className="text-sm">{e.title}</div>
                      <div className="text-xs text-muted-foreground">
                        {e.at ? time(e.at) : "—"}
                        {e.detail && <> · {e.detail}</>}
                      </div>
                    </li>
                  );
                })}
              </ol>
              {shown.clicks.length >= 100 && <p className="text-2xs text-muted-foreground">Die ersten 100 Klicks.</p>}
            </section>
          )}

          {shown.send && (
            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold">
                Bestellungen nach der Mail · {rundmailWindowLabel(windowKey)}
              </h3>
              {shown.orders.length === 0 ? (
                <p className="text-sm text-muted-foreground">Keine Bestellung in diesem Zeitraum.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {shown.orders.map((o) => (
                    <OrderCard key={o.id} order={o} codes={shown.codes} />
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>
      )}
    </Sheet>
  );
}

function OrderCard({ order: o, codes }: { order: RundmailRecipientOrder; codes: string[] }) {
  const codeSet = new Set(codes);
  const note =
    o.verdict === "spaetere_rundmail" && o.laterRundmail
      ? `zählt für die spätere Rundmail „${o.laterRundmail.name}“`
      : ORDER_VERDICT_LABELS[o.verdict];
  return (
    <li className={cn("rounded-md border border-border p-3 text-sm", !o.counts && "bg-surface-2")}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="font-medium">
          {o.orderName ?? "Bestellung"} <span className="font-normal text-muted-foreground">· {time(o.processedAt)}</span>
        </span>
        <span className={cn("tabular-nums font-semibold", !o.counts && "text-muted-foreground line-through")}>
          {eurFromCents(o.netCents)}
        </span>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {o.counts ? (
          <StatusBadge tone="success">zählt</StatusBadge>
        ) : (
          <StatusBadge tone={o.verdict === "storniert" ? "warning" : "neutral"}>{note}</StatusBadge>
        )}
        {o.withCode && (
          <StatusBadge tone="success" dot={false}>
            mit Code
          </StatusBadge>
        )}
        {o.afterClick && (
          <StatusBadge tone="accent" dot={false}>
            nach Klick
          </StatusBadge>
        )}
        {o.refundedCents > 0 && (
          <Tooltip content={`Bestellt ${eurFromCents(o.totalCents)}, erstattet ${eurFromCents(o.refundedCents)}`}>
            <span tabIndex={0} className="text-2xs text-muted-foreground">
              erstattet {eurFromCents(o.refundedCents)}
            </span>
          </Tooltip>
        )}
      </div>
      {o.items.length > 0 && (
        <ul className="mt-2 flex flex-col gap-0.5 text-xs text-muted-foreground">
          {o.items.map((it, i) => (
            <li key={i} className="flex justify-between gap-3">
              <span className="min-w-0 truncate">
                {num(it.quantity)} × {it.title}
                {it.variantTitle ? ` (${it.variantTitle})` : ""}
              </span>
              {it.unitPrice != null && <span className="shrink-0 tabular-nums">{eur(it.unitPrice)}</span>}
            </li>
          ))}
        </ul>
      )}
      {o.discountCodes.length > 0 && (
        <p className="mt-1.5 text-xs text-muted-foreground">
          Codes:{" "}
          {o.discountCodes.map((c, i) => (
            <React.Fragment key={`${c}-${i}`}>
              {i > 0 && ", "}
              <code className={cn("text-xs", codeSet.has(c.trim().toUpperCase()) && "font-semibold text-foreground")}>{c}</code>
            </React.Fragment>
          ))}
        </p>
      )}
    </li>
  );
}
