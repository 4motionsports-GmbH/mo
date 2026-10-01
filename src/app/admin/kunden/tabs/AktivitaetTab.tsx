"use client";

// Aktivität — everything that happened with this person on one line:
// orders, Mo chats, campaign mails, consent changes and correspondence,
// newest first (lib/customer-timeline.mjs builds it on the server). On top,
// „Frag Mo“: a question about this person, answered from the record with
// the entries it rests on (lib/customer-ask.ts).

import * as React from "react";
import { CreditCard, Mail, MailOpen, Megaphone, MessageCircle, ShieldCheck, Sparkles } from "lucide-react";
import type { CustomerDetail } from "@/lib/customer-detail";
import type { AskCitation } from "@/lib/customer-ask";
import { ADMIN_DATE, ADMIN_DATE_TIME_SHORT, formatAdmin } from "@/lib/admin-datetime.mjs";
import { Button, EmptyState, InfoTip, Input } from "../../ui";
import { adminFetch } from "../../lib/admin-fetch";
import { useAsyncAction } from "../../lib/use-async-action";

const ICONS = {
  order: CreditCard,
  chat: MessageCircle,
  campaign: Megaphone,
  consent: ShieldCheck,
  mail_in: MailOpen,
  mail_out: Mail,
} as const;

interface AskAnswer {
  answer: string;
  confident: boolean;
  citations: AskCitation[];
  sourcesTotal: number;
  sourcesUsed: number;
}

function FragMo({ customerId }: { customerId: number }) {
  const [question, setQuestion] = React.useState("");
  const [answer, setAnswer] = React.useState<AskAnswer | null>(null);
  const ask = useAsyncAction(async () => {
    const res = await adminFetch<AskAnswer>("/api/admin/customers/ask", { body: { customerId, question } });
    setAnswer(res);
    return res;
  });
  return (
    <section className="flex flex-col gap-2 rounded-lg border border-border bg-surface-2 p-3">
      <div className="flex items-center gap-1 text-sm font-semibold">
        Frag Mo
        <InfoTip>
          Eine Frage zu dieser Person, beantwortet nur aus ihrer Akte — Bestellungen mit Varianten, Gespräche, Mails,
          Kampagnen und Einwilligung. Die Antwort nennt die Einträge, auf die sie sich stützt. Kostet einen KI-Aufruf.
        </InfoTip>
      </div>
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (question.trim().length >= 3) void ask.run();
        }}
      >
        <div className="min-w-0 flex-1">
          <Input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            maxLength={500}
            placeholder="z. B. Welche Größe hat sie zuletzt bestellt?"
            aria-label="Frage zu dieser Person"
            className="h-8 text-sm"
          />
        </div>
        <Button type="submit" size="sm" loading={ask.pending} disabled={question.trim().length < 3}>
          {!ask.pending && <Sparkles />} Fragen
        </Button>
      </form>
      {answer && (
        <div className="flex flex-col gap-1.5">
          <p className="text-sm">{answer.answer}</p>
          {answer.citations.length > 0 && (
            <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground">
              {answer.citations.map((c) => (
                <li key={c.n}>
                  [{c.n}] {formatAdmin(c.at, ADMIN_DATE)} · {c.kindLabel} · {c.title}
                </li>
              ))}
            </ul>
          )}
          {answer.sourcesUsed < answer.sourcesTotal && (
            <p className="text-2xs text-muted-foreground">
              Berücksichtigt: die neuesten {answer.sourcesUsed} von {answer.sourcesTotal} Einträgen.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

export function AktivitaetTab({ customer }: { customer: CustomerDetail }) {
  if (customer.timeline.length === 0) {
    return <EmptyState compact title="Noch keine Aktivität" description="Bestellungen, Gespräche, Mails und Einwilligungen erscheinen hier." />;
  }
  return (
    <div className="flex flex-col gap-4">
      <FragMo key={customer.id} customerId={customer.id} />
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
    </div>
  );
}
