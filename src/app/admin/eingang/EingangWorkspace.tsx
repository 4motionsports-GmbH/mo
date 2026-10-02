"use client";

// The Eingang — one ranked list on the left (grouped Jetzt / Diese Woche /
// Später, filterable by kind), the selected item on the right: the reason with
// its evidence, the customer mini-card (consent, figures, profile), the AI
// suggestion and the decisions. Nothing sends from here: „Entwurf übernehmen“
// creates an Einzelansprache draft for the campaign desk.
//
//   Keys (not while typing, no dialog open): J / K next / previous ·
//   Enter primary action · E erledigt · Z später (3 Tage) · D verwerfen · Esc

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BookOpen, CircleCheck, Inbox, RefreshCw, Send, Sparkles, TriangleAlert } from "lucide-react";
import type { InboxCounts, InboxItem } from "@/lib/inbox-store";
import type { UnmatchedInboundMessage } from "@/lib/email-messages-store";
import { SIGNAL_KINDS, signalGroup } from "@/lib/customer-signals.mjs";
import { adminTabHref } from "@/lib/admin-tabs.mjs";
import { eurFromCents, num, plural, relativeTime } from "@/lib/admin-format.mjs";
import { ADMIN_DATE, formatAdmin } from "@/lib/admin-datetime.mjs";
import { SEGMENT_LABELS } from "@/lib/admin-customer-filter.mjs";
import {
  Button,
  buttonVariants,
  Callout,
  Card,
  CardContent,
  EmptyState,
  InfoTip,
  Kbd,
  Menu,
  SegmentedControl,
  Select,
  Skeleton,
  SplitPane,
  StatusBadge,
  cn,
  toast,
} from "../ui";
import { adminFetch, errorMessage } from "../lib/admin-fetch";
import { UnmatchedInbound } from "./UnmatchedInbound";
import type { EingangSystemCards, InboxCustomerCard } from "./types";

type Status = "offen" | "zurueckgestellt" | "erledigt";
type Decision = "erledigt" | "verworfen" | "zurueckgestellt" | "wieder_offen";

const GROUPS: Array<{ key: string; label: string }> = [
  { key: "jetzt", label: "Jetzt" },
  { key: "woche", label: "Diese Woche" },
  { key: "spaeter", label: "Später" },
];

const DISMISS_REASONS = ["passt nicht", "schon erledigt", "falscher Zeitpunkt", "anderes"];

const KANAL_LABELS: Record<string, string> = {
  email: "E-Mail (Einzelansprache)",
  brief: "Brief",
  antwort: "Antwort",
  kampagne: "Kampagne",
  intern: "Intern prüfen",
  keine: "Nichts tun",
};

const kindLabel = (kind: string) => SIGNAL_KINDS[kind as keyof typeof SIGNAL_KINDS]?.label ?? kind;
const needsConsent = (kind: string) => SIGNAL_KINDS[kind as keyof typeof SIGNAL_KINDS]?.needsConsent === true;

function isTyping(el: HTMLElement | null): boolean {
  const tag = el?.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || Boolean(el?.isContentEditable);
}

function syncItemParam(id: number | null) {
  const url = new URL(window.location.href);
  if (id === null) url.searchParams.delete("item");
  else url.searchParams.set("item", String(id));
  window.history.replaceState(window.history.state, "", url.toString());
}

export function EingangWorkspace({
  items: initialItems,
  counts,
  status,
  system,
  unmatched,
  initialItemId,
}: {
  items: InboxItem[];
  counts: InboxCounts;
  status: Status;
  system: EingangSystemCards;
  unmatched: UnmatchedInboundMessage[];
  initialItemId: number | null;
}) {
  const router = useRouter();
  const [items, setItems] = React.useState(initialItems);
  const [kind, setKind] = React.useState<string>("");
  const [selectedId, setSelectedId] = React.useState<number | null>(
    initialItemId && initialItems.some((i) => i.id === initialItemId) ? initialItemId : (initialItems[0]?.id ?? null)
  );
  const [running, setRunning] = React.useState(false);
  React.useEffect(() => setItems(initialItems), [initialItems]);

  const visible = React.useMemo(() => (kind ? items.filter((i) => i.kind === kind) : items), [items, kind]);
  const grouped = GROUPS.map((g) => ({ ...g, items: visible.filter((i) => signalGroup(i.kind) === g.key) })).filter(
    (g) => g.items.length > 0
  );
  const ordered = grouped.flatMap((g) => g.items);
  const current = ordered.find((i) => i.id === selectedId) ?? null;

  const select = React.useCallback((id: number | null) => {
    setSelectedId(id);
    syncItemParam(id);
  }, []);

  const removeAndAdvance = React.useCallback(
    (id: number) => {
      const idx = ordered.findIndex((i) => i.id === id);
      const next = ordered[idx + 1] ?? ordered[idx - 1] ?? null;
      setItems((list) => list.filter((i) => i.id !== id));
      select(next ? next.id : null);
    },
    [ordered, select]
  );

  const decide = React.useCallback(
    async (item: InboxItem, decision: Decision, opts: { snoozeDays?: number; note?: string } = {}) => {
      try {
        await adminFetch("/api/admin/inbox/decide", { body: { id: item.id, decision, ...opts } });
        removeAndAdvance(item.id);
        toast({
          variant: "success",
          title:
            decision === "erledigt"
              ? "Erledigt"
              : decision === "verworfen"
                ? "Verworfen"
                : decision === "wieder_offen"
                  ? "Wieder offen"
                  : `Zurückgestellt (${opts.snoozeDays ?? 3} Tage)`,
        });
      } catch (e) {
        toast({ variant: "error", title: "Nicht gespeichert", description: errorMessage(e) });
      }
    },
    [removeAndAdvance]
  );

  const runNow = async () => {
    setRunning(true);
    try {
      const res = await adminFetch<{ created: number; closed: number }>("/api/admin/inbox/run", { body: {} });
      toast({ variant: "success", title: "Eingang geprüft", description: `${num(res.created)} neu · ${num(res.closed)} erledigt sich von selbst.` });
      router.refresh();
    } catch (e) {
      toast({ variant: "error", title: "Prüfen fehlgeschlagen", description: errorMessage(e) });
    } finally {
      setRunning(false);
    }
  };

  const primaryRef = React.useRef<() => void>(() => {});

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTyping(e.target as HTMLElement | null)) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"], [role="menu"]')) return;
      const k = e.key.toLowerCase();
      const idx = current ? ordered.findIndex((i) => i.id === current.id) : -1;
      if (k === "j") {
        e.preventDefault();
        const next = ordered[Math.min(ordered.length - 1, idx + 1)];
        if (next) select(next.id);
      } else if (k === "k") {
        e.preventDefault();
        const prev = ordered[Math.max(0, idx - 1)];
        if (prev) select(prev.id);
      } else if (e.key === "Escape") {
        select(null);
      } else if (!current || status !== "offen") {
        return;
      } else if (e.key === "Enter") {
        e.preventDefault();
        primaryRef.current();
      } else if (k === "e") {
        e.preventDefault();
        void decide(current, "erledigt");
      } else if (k === "z") {
        e.preventDefault();
        void decide(current, "zurueckgestellt", { snoozeDays: 3 });
      } else if (k === "d") {
        e.preventDefault();
        void decide(current, "verworfen", { note: "anderes" });
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [current, ordered, select, decide, status]);

  const kindsInList = [...new Set(items.map((i) => i.kind))];

  return (
    <div className="flex flex-col gap-4">
      <SystemStrip system={system} />

      {unmatched.length > 0 && <UnmatchedInbound messages={unmatched} />}

      <div className="flex flex-wrap items-center gap-3">
        <SegmentedControl
          label="Status"
          value={status}
          onChange={(v) => router.push(adminTabHref("eingang", v === "offen" ? {} : { status: v }))}
          options={[
            { value: "offen", label: `Offen ${num(counts.open)}` },
            { value: "zurueckgestellt", label: `Später ${num(counts.snoozed)}` },
            { value: "erledigt", label: "Erledigt" },
          ]}
        />
        <div className="w-60">
          <Select aria-label="Art" value={kind} onChange={(e) => setKind(e.target.value)} className="h-8 py-0 pr-8 text-xs">
            <option value="">Alle Arten</option>
            {kindsInList.map((k) => (
              <option key={k} value={k}>
                {kindLabel(k)} ({num(items.filter((i) => i.kind === k).length)})
              </option>
            ))}
          </Select>
        </div>
        <span className="hidden items-center gap-1 text-2xs text-muted-foreground lg:inline-flex">
          <Kbd>J</Kbd>/<Kbd>K</Kbd> wechseln · <Kbd>Enter</Kbd> Aktion · <Kbd>E</Kbd> erledigt · <Kbd>Z</Kbd> später · <Kbd>D</Kbd> verwerfen
        </span>
        <Button variant="outline" size="sm" className="ml-auto" onClick={() => void runNow()} loading={running}>
          <RefreshCw /> Jetzt prüfen
        </Button>
      </div>

      <SplitPane
        listWidth="md"
        listLabel="Eingang"
        stickyTopClassName="lg:top-[4.5rem] lg:max-h-[calc(100vh-5.5rem)]"
        list={
          <div className="flex max-h-full flex-col rounded-lg border border-border bg-card">
            <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
              {ordered.length === 0 ? (
                <EmptyState
                  plain
                  compact
                  icon={<CircleCheck />}
                  title={status === "offen" ? "Alles erledigt" : "Nichts hier"}
                  description={status === "offen" ? "Neue Hinweise entstehen stündlich aus Bestellungen, Gesprächen und Mails." : undefined}
                />
              ) : (
                grouped.map((g) => (
                  <section key={g.key} className="mb-2">
                    <h3 className="px-2 pb-1 pt-2 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">{g.label}</h3>
                    <ul className="flex flex-col gap-0.5">
                      {g.items.map((i) => (
                        <li key={i.id}>
                          <button
                            type="button"
                            onClick={() => select(i.id)}
                            aria-pressed={i.id === selectedId}
                            className={cn(
                              "flex w-full flex-col rounded-md px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                              i.id === selectedId ? "bg-accent-soft" : "hover:bg-secondary/70"
                            )}
                          >
                            <span className="flex items-center gap-2">
                              <span
                                className={cn(
                                  "size-1.5 shrink-0 rounded-full",
                                  i.priority >= 80 ? "bg-destructive" : i.priority >= 55 ? "bg-warning" : "bg-muted-foreground"
                                )}
                                aria-hidden
                              />
                              <span className="truncate text-sm font-medium">{i.title}</span>
                              {i.suggestion && <Sparkles className="size-3 shrink-0 text-muted-foreground" aria-label="Vorschlag vorhanden" />}
                              <span className="ml-auto shrink-0 text-2xs text-muted-foreground">{relativeTime(i.createdAt)}</span>
                            </span>
                            <span className="truncate pl-3.5 text-xs text-muted-foreground">
                              {i.customerName ?? i.customerEmail ?? "System"} · {i.reason}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))
              )}
            </div>
          </div>
        }
        detail={
          current ? (
            <ItemDetail
              key={current.id}
              item={current}
              status={status}
              primaryRef={primaryRef}
              onDecide={decide}
              onAccepted={(contactId) => {
                removeAndAdvance(current.id);
                router.push(adminTabHref("kampagne", { campaign: "einzelansprache", contact: String(contactId) }));
              }}
              onSuggestion={(s) => setItems((list) => list.map((x) => (x.id === current.id ? { ...x, suggestion: s } : x)))}
            />
          ) : (
            <EmptyState icon={<Inbox />} title="Eintrag auswählen" description="Links einen Hinweis wählen — oder mit J / K durchgehen." className="min-h-[16rem]" />
          )
        }
      />
    </div>
  );
}

function SystemStrip({ system }: { system: EingangSystemCards }) {
  const drafted = system.campaigns.reduce((s, c) => s + c.drafted, 0);
  return (
    <div className="flex flex-col gap-2">
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardContent className="flex items-start gap-3 p-3 pt-3">
            <Send className="mt-0.5 size-4 text-muted-foreground" aria-hidden />
            <div className="min-w-0 text-sm">
              <div className="font-medium">{drafted > 0 ? `${plural(drafted, "Entwurf", "Entwürfe")} zur Prüfung` : "Keine Entwürfe offen"}</div>
              <div className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                {system.campaigns.map((c) => (
                  <Link key={c.id} href={adminTabHref("kampagne", { campaign: c.slug })} className="hover:text-foreground hover:underline">
                    {c.name} {num(c.drafted)}
                  </Link>
                ))}
                {system.campaigns.length === 0 && (
                  <Link href={adminTabHref("kampagne")} className="hover:text-foreground hover:underline">
                    Zu den Kampagnen
                  </Link>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-start gap-3 p-3 pt-3">
            <BookOpen className="mt-0.5 size-4 text-muted-foreground" aria-hidden />
            <div className="text-sm">
              <Link href={adminTabHref("wissen")} className="font-medium hover:underline">
                {system.qaOpen > 0 ? `${plural(system.qaOpen, "offene Wissensfrage", "offene Wissensfragen")}` : "Wissen: nichts offen"}
              </Link>
              {(system.runningReports > 0 || system.runningImprovementRuns > 0) && (
                <div className="text-xs text-muted-foreground">
                  {system.runningReports > 0 && <>Analyse läuft · </>}
                  {system.runningImprovementRuns > 0 && <>Verbesserungslauf läuft</>}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
        <Card className="xl:col-span-2">
          <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-1 p-3 pt-3 text-sm">
            <span>
              <strong className="tabular-nums">{system.strip.chats == null ? "—" : num(system.strip.chats)}</strong>{" "}
              <span className="text-muted-foreground">Gespräche</span>
            </span>
            <span>
              <strong className="tabular-nums">{num(system.strip.campaignMails)}</strong>{" "}
              <span className="text-muted-foreground">Kampagnen-Mails</span>
            </span>
            <span>
              <strong className="tabular-nums">{num(system.strip.newSubscribers)}</strong>{" "}
              <span className="text-muted-foreground">neu angemeldet</span>
            </span>
            <span className="text-xs text-muted-foreground">letzte 30 Tage</span>
            <Link href={adminTabHref("kpi")} className="ml-auto text-xs text-muted-foreground hover:text-foreground hover:underline">
              Alle KPIs
            </Link>
          </CardContent>
        </Card>
      </div>
      {system.syncProblems.length > 0 && (
        <Callout
          tone="warning"
          compact
          title="Shopify-Abgleich braucht Aufmerksamkeit"
          action={
            <Link href={adminTabHref("einstellungen")} className={buttonVariants({ size: "xs", variant: "outline" })}>
              Einstellungen
            </Link>
          }
        >
          {system.syncProblems.join(" ")}
        </Callout>
      )}
    </div>
  );
}

function evidenceLines(item: InboxItem): string[] {
  const e = item.evidence as Record<string, unknown>;
  const lines: string[] = [];
  if (Array.isArray(e.products) && e.products.length) lines.push(`Produkte: ${(e.products as string[]).join(", ")}`);
  if (typeof e.lastOrderAt === "string") lines.push(`Letzter Kauf: ${formatAdmin(e.lastOrderAt, ADMIN_DATE)}`);
  if (typeof e.lastChatAt === "string") lines.push(`Gespräch: ${formatAdmin(e.lastChatAt, ADMIN_DATE)}`);
  if (typeof e.endsAt === "string") lines.push(`Läuft ab: ${formatAdmin(e.endsAt, ADMIN_DATE)}`);
  if (typeof e.deadline === "string") lines.push(`Frist: ${formatAdmin(e.deadline, ADMIN_DATE)}`);
  return lines;
}

function ItemDetail({
  item,
  status,
  primaryRef,
  onDecide,
  onAccepted,
  onSuggestion,
}: {
  item: InboxItem;
  status: Status;
  primaryRef: React.MutableRefObject<() => void>;
  onDecide: (item: InboxItem, decision: Decision, opts?: { snoozeDays?: number; note?: string }) => Promise<void>;
  onAccepted: (contactId: number) => void;
  onSuggestion: (s: InboxItem["suggestion"]) => void;
}) {
  const router = useRouter();
  const [customer, setCustomer] = React.useState<InboxCustomerCard | null>(null);
  const [loading, setLoading] = React.useState(item.customerId != null);
  const [busy, setBusy] = React.useState<null | "accept" | "suggest">(null);

  React.useEffect(() => {
    if (item.customerId == null) return;
    const controller = new AbortController();
    adminFetch<{ customer: InboxCustomerCard | null }>(`/api/admin/inbox/item?id=${item.id}`, { signal: controller.signal })
      .then((json) => {
        if (!controller.signal.aborted) setCustomer(json.customer);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [item.id, item.customerId]);

  const customerHref = item.customerId != null ? adminTabHref("kunden", { customer: String(item.customerId) }) : null;
  const canMail = Boolean(customer?.sendable);
  const s = item.suggestion;

  const accept = async () => {
    setBusy("accept");
    try {
      const json = await adminFetch<{ contactId: number; drafted: boolean }>("/api/admin/inbox/accept", { body: { id: item.id } });
      toast({ variant: "success", title: json.drafted ? "Entwurf bereit" : "In der Einzelansprache" });
      onAccepted(json.contactId);
    } catch (e) {
      toast({ variant: "error", title: "Übernehmen nicht möglich", description: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  };

  const suggest = async () => {
    setBusy("suggest");
    try {
      const json = await adminFetch<{ suggestion: InboxItem["suggestion"] }>("/api/admin/inbox/suggest", { body: { id: item.id } });
      onSuggestion(json.suggestion);
    } catch (e) {
      toast({ variant: "error", title: "Kein Vorschlag", description: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  };

  // The primary action per kind (Enter).
  const mailAction = needsConsent(item.kind) || (s?.kanal === "email" && canMail);
  let primary: { label: string; run: () => void; disabled?: boolean } | null = null;
  if (mailAction && canMail) primary = { label: "Entwurf übernehmen", run: () => void accept() };
  else if (customerHref) primary = { label: item.kind === "antwort_offen" ? "Antworten" : item.kind === "datenauskunft" ? "Daten bereitstellen" : "Kunde öffnen", run: () => router.push(customerHref) };
  React.useEffect(() => {
    primaryRef.current = primary ? primary.run : () => {};
  });

  return (
    <Card className="overflow-hidden">
      <CardContent className="flex flex-col gap-4 p-5 pt-5">
        <div className="flex flex-wrap items-start gap-2">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold">{item.title}</h2>
            <p className="text-xs text-muted-foreground">
              {item.customerName ?? item.customerEmail ?? "System"} · {relativeTime(item.createdAt)}
              {item.expiresAt && <> · bis {formatAdmin(item.expiresAt, ADMIN_DATE)}</>}
            </p>
          </div>
          <StatusBadge tone={item.priority >= 80 ? "destructive" : item.priority >= 55 ? "warning" : "neutral"}>
            Priorität {num(item.priority)}
          </StatusBadge>
        </div>

        <p className="text-sm">{item.reason}</p>
        {evidenceLines(item).length > 0 && (
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {evidenceLines(item).map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        )}

        {item.customerId != null && (
          <section className="rounded-md border border-border bg-surface-2 p-3 text-sm">
            {loading ? (
              <Skeleton className="h-12 w-full" />
            ) : customer ? (
              <div className="flex flex-col gap-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  {customerHref && (
                    <Link href={customerHref} className="font-medium hover:underline">
                      {customer.name ?? customer.email}
                    </Link>
                  )}
                  <StatusBadge tone={customer.sendable ? "success" : "neutral"}>{customer.consentLabel}</StatusBadge>
                  {!customer.isShopifyCustomer && <StatusBadge tone="info">Interessent</StatusBadge>}
                  {customer.persona && <StatusBadge tone="accent" dot={false}>{customer.persona}</StatusBadge>}
                </div>
                {customer.figures && (
                  <div className="text-xs text-muted-foreground">
                    {customer.figures.factsComputedAt == null
                      ? "Kennzahlen werden heute Nacht berechnet"
                      : customer.figures.ordersCount > 0
                        ? `${plural(customer.figures.ordersCount, "Bestellung", "Bestellungen")} · ${eurFromCents(customer.figures.totalSpentCents)}`
                        : "Noch keine Bestellung"}
                    {customer.figures.lastOrderAt && <> · zuletzt {formatAdmin(customer.figures.lastOrderAt, ADMIN_DATE)}</>}
                    {customer.figures.lifecycleSegment && (
                      <> · {SEGMENT_LABELS[customer.figures.lifecycleSegment as keyof typeof SEGMENT_LABELS] ?? customer.figures.lifecycleSegment}</>
                    )}
                    {customer.figures.conversationsCount > 0 && <> · {plural(customer.figures.conversationsCount, "Gespräch", "Gespräche")} mit Mo</>}
                  </div>
                )}
                {customer.profileExcerpt && <p className="line-clamp-3 text-xs">{customer.profileExcerpt}</p>}
                {!customer.sendable && needsConsent(item.kind) && (
                  <p className="text-xs text-muted-foreground">Keine Einwilligung für E-Mail-Werbung — nur ansehen oder Brief.</p>
                )}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Kunde nicht mehr vorhanden.</p>
            )}
          </section>
        )}

        {item.customerId != null && (
          <section className="flex flex-col gap-2">
            <div className="flex items-center gap-1.5 text-sm font-semibold">
              Vorschlag
              <InfoTip>
                Von der KI aus Anlass, Kennzahlen und Profil — beachtet Einwilligung und Widersprüche. Es wird
                nichts gesendet: „Entwurf übernehmen“ legt eine Einzelansprache an, die du im Prüftisch prüfst.
              </InfoTip>
              <Button size="xs" variant="ghost" className="ml-auto" onClick={() => void suggest()} loading={busy === "suggest"}>
                <Sparkles /> {s ? "Neu erzeugen" : "Vorschlag erzeugen"}
              </Button>
            </div>
            {s ? (
              <div className="flex flex-col gap-2 rounded-md border border-border p-3 text-sm">
                <p>{s.warum}</p>
                <p>
                  <StatusBadge tone="neutral" dot={false}>{KANAL_LABELS[s.kanal] ?? s.kanal}</StatusBadge> <span className="font-medium">{s.aktion}</span>
                </p>
                {s.betreff && <p className="text-xs text-muted-foreground">Betreff: „{s.betreff}“</p>}
                {s.text && <p className="whitespace-pre-wrap rounded bg-surface-2 p-2 text-xs">{s.text}</p>}
                {s.rabatt && (
                  <p className="text-xs">
                    Rabatt {num(s.rabatt.prozent)} % — {s.rabatt.begruendung}
                  </p>
                )}
                {s.produkte && s.produkte.length > 0 && <p className="text-xs text-muted-foreground">Produkte: {s.produkte.join(", ")}</p>}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Noch kein Vorschlag.</p>
            )}
          </section>
        )}

        {status === "offen" && (
          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
            {primary && (
              <Button onClick={primary.run} loading={busy === "accept"} disabled={primary.disabled}>
                {primary.label}
              </Button>
            )}
            {customerHref && primary?.label === "Entwurf übernehmen" && (
              <Link href={customerHref} className={buttonVariants({ variant: "outline" })}>
                Kunde öffnen
              </Link>
            )}
            <Button variant="secondary" onClick={() => void onDecide(item, "erledigt")}>
              <CircleCheck /> Erledigt
            </Button>
            <Menu
              label="Später"
              trigger={<Button variant="ghost">Später</Button>}
              items={[3, 7, 30].map((d) => ({
                key: `s${d}`,
                label: `In ${d} Tagen`,
                onSelect: () => void onDecide(item, "zurueckgestellt", { snoozeDays: d }),
              }))}
            />
            <Menu
              label="Verwerfen"
              trigger={
                <Button variant="ghost" className="text-destructive">
                  <TriangleAlert /> Verwerfen
                </Button>
              }
              items={DISMISS_REASONS.map((r) => ({
                key: r,
                label: r,
                onSelect: () => void onDecide(item, "verworfen", { note: r }),
              }))}
            />
          </div>
        )}
        {status !== "offen" && (
          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3 text-xs text-muted-foreground">
            {item.decision && (
              <span>
                Entscheidung: {item.decision}
                {item.decisionNote ? ` (${item.decisionNote})` : ""}
                {item.decidedAt ? ` · ${formatAdmin(item.decidedAt, ADMIN_DATE)}` : ""}
              </span>
            )}
            <Button size="sm" variant="outline" className="ml-auto" onClick={() => void onDecide(item, "wieder_offen")}>
              Wieder öffnen
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
