"use client";

// Aktivität — everything that happened with this person on one line:
// orders, Mo chats, campaign mails, consent changes and correspondence,
// newest first (lib/customer-timeline.mjs builds it on the server).

import { CreditCard, Mail, MailOpen, Megaphone, MessageCircle, ShieldCheck } from "lucide-react";
import type { CustomerDetail } from "@/lib/customer-detail";
import { ADMIN_DATE_TIME_SHORT, formatAdmin } from "@/lib/admin-datetime.mjs";
import { EmptyState } from "../../ui";

const ICONS = {
  order: CreditCard,
  chat: MessageCircle,
  campaign: Megaphone,
  consent: ShieldCheck,
  mail_in: MailOpen,
  mail_out: Mail,
} as const;

export function AktivitaetTab({ customer }: { customer: CustomerDetail }) {
  if (customer.timeline.length === 0) {
    return <EmptyState compact title="Noch keine Aktivität" description="Bestellungen, Gespräche, Mails und Einwilligungen erscheinen hier." />;
  }
  return (
    <ol className="relative flex flex-col gap-3 border-l border-border pl-5">
      {customer.timeline.map((e, i) => {
        const Icon = ICONS[e.kind];
        return (
          <li key={`${e.kind}-${e.at}-${i}`} className="relative">
            <span className="absolute -left-[1.85rem] top-0.5 flex size-5 items-center justify-center rounded-full border border-border bg-card text-muted-foreground">
              <Icon className="size-3" aria-hidden />
            </span>
            <div className="text-sm">{e.title}</div>
            <div className="text-xs text-muted-foreground">
              {formatAdmin(e.at, ADMIN_DATE_TIME_SHORT)}
              {e.detail && <> · {e.detail}</>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
