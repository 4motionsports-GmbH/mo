"use client";

// Per-CUSTOMER card for the admin dashboard's Kunden tab — grouped by person
// (email), not by session. Shows the session timeline (each transcript opens in
// a Dialog), the cached Shopify purchase history (as a table), the persona(s),
// and the regenerated "current understanding" summary. Returning customers
// (more than one session) are clearly badged.
//
// On-demand actions (all gating server-side; this is just the operator UI):
//   Käufe aktualisieren            → POST /api/admin/customers/purchases
//   Kundenverständnis generieren   → POST /api/admin/customers/profile
//                                    (an Anthropic pass — costs tokens; the
//                                    response usage is shown after each run)
//   Personalisierte E-Mail         → POST /api/admin/customers/marketing-draft
//                                    (full-customer context + admin special
//                                    instructions), then the SAME edit/send
//                                    endpoints as the Marketing tab:
//                                    /api/admin/marketing/update + /send.
//
// Presentation only: this is the Session-A re-skin onto the shared admin UI kit
// (Card/Badge/Button/Input/Textarea/Dialog/Table/Toast). Every control behavior
// is preserved exactly — the SAME endpoints and payloads, the discount lockout
// (depth or instructions changed → Send disabled → ↻ Neu generieren), the
// MO-XXXX placeholder preview, read-only sent rows, and the per-run token-cost
// disclosure on the profile (honest cost, kept verbatim).

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ExternalLink,
  Gift,
  MessageSquare,
  Plus,
  RotateCcw,
  Save,
  Search,
  Send,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import {
  DISCOUNT_PERCENT_MIN,
  DISCOUNT_PERCENT_MAX,
  clampDiscountPercent,
} from "@/lib/discount-validation.mjs";
import {
  Badge,
  type BadgeProps,
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Markdown,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
  toast,
} from "./ui";

interface TranscriptMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  toolName: string | null;
}

export interface CustomerSessionProps {
  conversationId: number;
  createdAt: string | null;
  personaDisplay: string | null;
  messageCount: number;
  transcript: TranscriptMessage[];
}

interface OrderHistoryItem {
  title: string | null;
  handle: string | null;
  quantity: number;
}

interface OrderHistoryEntry {
  name: string;
  createdAt: string;
  totalAmount: string | null;
  currencyCode: string | null;
  financialStatus: string | null;
  items: OrderHistoryItem[];
}

export interface OrderHistoryProps {
  orders: OrderHistoryEntry[];
  truncated: boolean;
  fetchedAt: string;
}

/** The customer's latest marketing_sends row (open draft preferred), as the
 * Kunden tab needs it. Sent rows are read-only history. */
export interface CustomerMarketingSendProps {
  id: number;
  status: "draft" | "approved" | "sent";
  subject: string | null;
  draftedText: string | null;
  discountPercent: number;
  discountCode: string | null;
  discountExpiresAt: string | null;
  /** The instructions snapshot this draft was generated with. */
  adminInstructions: string | null;
  sentAt: string | null;
}

/** One bundle offer (S10/S11) in the per-customer list. */
export interface CustomerBundleProps {
  id: number;
  title: string | null;
  status: "pending" | "active" | "expired" | "failed";
  components: Array<{ productId: string; title: string; quantity: number }>;
  /** Decimal Money strings. */
  componentsSum: string;
  bundlePrice: string;
  currency: string;
  cartUrl: string | null;
  /** The tracked purchase link (/api/r/<token>). */
  redirectUrl: string | null;
  createdAt: string | null;
  expiresAt: string | null;
  error: string | null;
  /** sent_at of the linked marketing send (→ "Versendet"), if it was sent. */
  emailSentAt: string | null;
  /** The tracked link reported ≥1 click (redeemed/engagement signal). */
  clicked: boolean;
}

export interface CustomerProps {
  id: number;
  email: string;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  transactionalConsent: boolean;
  marketingStatus: "none" | "pending" | "confirmed" | "unsubscribed";
  /** Admin special instructions for the next generated email (editable). */
  adminInstructions: string | null;
  /** Latest marketing send row for this customer's email, if any. */
  marketingSend: CustomerMarketingSendProps | null;
  profileSummary: string | null;
  profileSummaryUpdatedAt: string | null;
  purchaseSummary: OrderHistoryProps | null;
  purchaseSummaryUpdatedAt: string | null;
  /** One-time welcome discount (issued on first DOI confirmation). */
  welcomeCode: string | null;
  welcomeCodeExpiresAt: string | null;
  welcomeIssuedAt: string | null;
  /** Live Shopify redemption check (read_orders); null = unknown. */
  welcomeRedeemed: boolean | null;
  sessions: CustomerSessionProps[];
  /** This customer's bundle offers (S10/S11), newest first. */
  bundles: CustomerBundleProps[];
}

interface ProfileUsage {
  inputTokens: number;
  outputTokens: number;
  approxCostUsd: number;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("de-DE");
}

function reportError(e: unknown) {
  toast({
    variant: "error",
    title: "Fehler",
    description: e instanceof Error ? e.message : "Unbekannter Fehler",
  });
}

const MARKETING_STATUS: Record<
  CustomerProps["marketingStatus"],
  { label: string; variant: BadgeProps["variant"] }
> = {
  none: { label: "Kein Marketing", variant: "secondary" },
  pending: { label: "DOI ausstehend", variant: "secondary" },
  confirmed: { label: "Marketing bestätigt", variant: "success" },
  unsubscribed: { label: "Abgemeldet", variant: "destructive" },
};

export function CustomerProfileCard({
  customer,
}: {
  customer: CustomerProps;
}) {
  const router = useRouter();
  const isReturning = customer.sessions.length > 1;

  const [purchases, setPurchases] = useState<OrderHistoryProps | null>(customer.purchaseSummary);
  const [purchasesUpdatedAt, setPurchasesUpdatedAt] = useState<string | null>(
    customer.purchaseSummaryUpdatedAt
  );
  const [profile, setProfile] = useState<string | null>(customer.profileSummary);
  const [profileUpdatedAt, setProfileUpdatedAt] = useState<string | null>(
    customer.profileSummaryUpdatedAt
  );
  const [lastUsage, setLastUsage] = useState<ProfileUsage | null>(null);
  const [busy, setBusy] = useState<null | "purchases" | "profile">(null);

  async function call(path: string): Promise<unknown> {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customerId: customer.id }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(
        (json as { error?: { message?: string } })?.error?.message ?? `Fehler (${res.status})`
      );
    }
    return json;
  }

  async function onRefreshPurchases() {
    setBusy("purchases");
    try {
      const json = (await call("/api/admin/customers/purchases")) as {
        purchaseSummary?: OrderHistoryProps;
      };
      if (json.purchaseSummary) {
        setPurchases(json.purchaseSummary);
        setPurchasesUpdatedAt(new Date().toISOString());
      }
      toast({
        variant: "success",
        title: "Käufe aktualisiert",
        description: customer.email,
      });
      router.refresh();
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(null);
    }
  }

  async function onGenerateProfile() {
    setBusy("profile");
    try {
      const json = (await call("/api/admin/customers/profile")) as {
        profileSummary?: string;
        usage?: ProfileUsage;
        warning?: string;
      };
      if (json.profileSummary) {
        setProfile(json.profileSummary);
        setProfileUpdatedAt(new Date().toISOString());
      }
      if (json.usage) setLastUsage(json.usage);
      if (json.warning) {
        toast({ variant: "warning", title: "Hinweis", description: json.warning });
      } else {
        toast({
          variant: "success",
          title: "Kundenverständnis generiert",
          description: customer.email,
        });
      }
      router.refresh();
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(null);
    }
  }

  const marketingStatus = MARKETING_STATUS[customer.marketingStatus];

  return (
    <Card className="p-5">
      {/* Header: email + first/last seen on the left, status badges on the right */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[15px] font-semibold">{customer.email}</div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            Zuerst gesehen: {fmtDate(customer.firstSeenAt)} · Zuletzt:{" "}
            {fmtDate(customer.lastSeenAt)}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {isReturning ? (
            <Badge variant="accent" title="Mehrere Sessions unter derselben E-Mail">
              <RotateCcw className="size-3" /> Wiederkehrend · {customer.sessions.length} Sessions
            </Badge>
          ) : (
            <Badge variant="secondary">
              {customer.sessions.length === 1 ? "1 Session" : "Keine Session verknüpft"}
            </Badge>
          )}
          <Badge variant={marketingStatus.variant}>{marketingStatus.label}</Badge>
        </div>
      </div>

      {/* Session timeline */}
      <Section title={`Gesprächs-Timeline (${customer.sessions.length})`}>
        {customer.sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            <em>
              Keine Konversation verknüpft — die E-Mail wurde erfasst, aber die zugehörige Session
              ist nicht (mehr) gespeichert.
            </em>
          </p>
        ) : (
          <ol className="relative ml-1 border-l border-border">
            {customer.sessions.map((s, i) => (
              <SessionTimelineItem key={s.conversationId} session={s} index={i} email={customer.email} />
            ))}
          </ol>
        )}
      </Section>

      {/* Purchase history (Shopify) — proper table */}
      <Section
        title="Kaufhistorie (Shopify)"
        meta={purchasesUpdatedAt ? `Stand: ${fmtDate(purchasesUpdatedAt)}` : "noch nicht geladen"}
        action={
          <Button variant="secondary" size="sm" onClick={onRefreshPurchases} disabled={busy !== null}>
            <RotateCcw /> {busy === "purchases" ? "Lade…" : "Käufe aktualisieren"}
          </Button>
        }
      >
        <PurchaseHistory purchases={purchases} />
      </Section>

      {/* Welcome discount — the automatic issuance feature was retired
          pre-launch; this section is now a read-only historical view of codes
          that were issued while the feature was live. */}
      <Section title="Willkommensrabatt">
        {customer.welcomeIssuedAt ? (
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="info">
              <Gift className="size-3" /> Ausgestellt am {fmtDate(customer.welcomeIssuedAt)}
            </Badge>
            {customer.welcomeCode && (
              <span className="text-sm">
                Code: <code className="rounded bg-muted px-1 py-0.5">{customer.welcomeCode}</code>
                {customer.welcomeCodeExpiresAt
                  ? ` (gültig bis ${fmtDate(customer.welcomeCodeExpiresAt)})`
                  : ""}
              </span>
            )}
            {customer.welcomeRedeemed === true ? (
              <Badge variant="success">✓ Eingelöst</Badge>
            ) : customer.welcomeRedeemed === false ? (
              <Badge variant="warning">Noch nicht eingelöst</Badge>
            ) : (
              <Badge variant="secondary" title="Shopify nicht erreichbar/konfiguriert">
                Einlösung unbekannt
              </Badge>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            <em>
              Kein Willkommenscode. Rabattcodes werden manuell über das Dashboard
              vergeben.
            </em>
          </p>
        )}
      </Section>

      {/* Current understanding — the regenerated profile, in its own Card. The
          per-run token-cost line is kept verbatim (honest cost disclosure). */}
      <Section
        title="Aktuelles Kundenverständnis"
        meta={profileUpdatedAt ? `Stand: ${fmtDate(profileUpdatedAt)}` : undefined}
        action={
          <Button size="sm" onClick={onGenerateProfile} disabled={busy !== null}>
            <Sparkles />{" "}
            {busy === "profile"
              ? "Generiere…"
              : profile
                ? "Neu generieren"
                : "Kundenverständnis generieren"}
          </Button>
        }
      >
        <Card className="bg-muted/40 p-4 shadow-none">
          {profile ? (
            <Markdown content={profile} />
          ) : (
            <p className="text-sm text-muted-foreground">
              <em>Noch kein Profil generiert.</em>
            </p>
          )}
          <p className="mt-3 text-[11px] text-muted-foreground">
            Jede Generierung ist ein KI-Durchlauf (Anthropic Claude) über alle verknüpften Gespräche
            + Kaufhistorie und kostet Tokens.
            {lastUsage
              ? ` Letzter Lauf: ${lastUsage.inputTokens.toLocaleString("de-DE")} Input- / ` +
                `${lastUsage.outputTokens.toLocaleString("de-DE")} Output-Tokens` +
                ` (~$${lastUsage.approxCostUsd.toFixed(3)}).`
              : ""}
          </p>
        </Card>
      </Section>

      {/* Personalised marketing email (full-customer context) */}
      <MarketingEmailSection customer={customer} />
    </Card>
  );
}

/** A titled section with a top border, an optional meta string and an optional
 * right-aligned action — the repeated layout used across the card. */
function Section({
  title,
  meta,
  action,
  children,
}: {
  title: React.ReactNode;
  meta?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-4 border-t border-border pt-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-medium text-muted-foreground">
          {title}
          {meta ? <span className="font-normal"> · {meta}</span> : null}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

const FINANCIAL_STATUS: Record<string, { label: string; variant: BadgeProps["variant"] }> = {
  PAID: { label: "Bezahlt", variant: "success" },
  PARTIALLY_PAID: { label: "Teilw. bezahlt", variant: "warning" },
  PENDING: { label: "Ausstehend", variant: "warning" },
  AUTHORIZED: { label: "Autorisiert", variant: "info" },
  REFUNDED: { label: "Erstattet", variant: "secondary" },
  PARTIALLY_REFUNDED: { label: "Teilw. erstattet", variant: "secondary" },
  VOIDED: { label: "Storniert", variant: "destructive" },
  EXPIRED: { label: "Abgelaufen", variant: "secondary" },
};

function FinancialStatusBadge({ status }: { status: string | null }) {
  if (!status) return <Badge variant="secondary">—</Badge>;
  const meta = FINANCIAL_STATUS[status.toUpperCase()];
  return <Badge variant={meta?.variant ?? "secondary"}>{meta?.label ?? status}</Badge>;
}

function PurchaseHistory({ purchases }: { purchases: OrderHistoryProps | null }) {
  if (!purchases) {
    return (
      <p className="text-sm text-muted-foreground">
        <em>Noch keine Kaufhistorie geladen.</em>
      </p>
    );
  }
  if (purchases.orders.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Keine Bestellungen unter dieser E-Mail gefunden.
      </p>
    );
  }
  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Artikel</TableHead>
            <TableHead align="right">Menge</TableHead>
            <TableHead>Datum</TableHead>
            <TableHead align="right">Summe</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {purchases.orders.map((o) => {
            const qty = o.items.reduce((s, it) => s + it.quantity, 0);
            const itemsLabel =
              o.items.length > 0
                ? o.items.map((it) => it.title ?? it.handle ?? "Artikel").join(", ")
                : "(keine Positionen)";
            return (
              <TableRow key={o.name + o.createdAt}>
                <TableCell>
                  <div className="font-medium">{itemsLabel}</div>
                  <div className="text-xs text-muted-foreground">{o.name}</div>
                </TableCell>
                <TableCell align="right">{qty || "—"}</TableCell>
                <TableCell>{fmtDate(o.createdAt)}</TableCell>
                <TableCell align="right">
                  {o.totalAmount ? `${o.totalAmount} ${o.currencyCode ?? ""}`.trim() : "—"}
                </TableCell>
                <TableCell>
                  <FinancialStatusBadge status={o.financialStatus} />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {purchases.truncated && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          Liste ggf. gekürzt (nur die neuesten Bestellungen).
        </p>
      )}
    </>
  );
}

function SessionTimelineItem({
  session,
  index,
  email,
}: {
  session: CustomerSessionProps;
  index: number;
  email: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <li className="relative mb-4 pl-5 last:mb-0">
      {/* Timeline dot */}
      <span className="absolute -left-[5px] top-1.5 size-2.5 rounded-full border-2 border-card bg-accent" />
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-sm font-semibold">Session {index + 1}</span>
        <span className="text-xs text-muted-foreground">
          {fmtDate(session.createdAt)}
          {session.personaDisplay ? ` · ${session.personaDisplay}` : ""}
        </span>
        <Badge variant="secondary">{session.messageCount} Nachrichten</Badge>
        <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setOpen(true)}>
          <MessageSquare /> Transkript ({session.transcript.length})
        </Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              Session {index + 1} · {fmtDate(session.createdAt)} · {email}
            </DialogTitle>
          </DialogHeader>
          <div className="mt-3 max-h-[60vh] overflow-y-auto rounded-lg bg-muted/50 p-3 text-sm leading-relaxed">
            {session.transcript.length === 0 ? (
              <em className="text-muted-foreground">Kein lesbares Transkript.</em>
            ) : (
              session.transcript.map((m, i) => (
                <p key={i} className="mb-2 last:mb-0">
                  <strong className={m.role === "user" ? "text-foreground" : "text-accent"}>
                    {m.role === "user" ? "Kunde" : "Berater"}:
                  </strong>{" "}
                  {m.content}
                </p>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </li>
  );
}

const MARKETING_BLOCKED_NOTE: Record<Exclude<CustomerProps["marketingStatus"], "confirmed">, string> = {
  none: "Keine Marketing-Einwilligung — es kann keine Marketing-E-Mail generiert werden.",
  pending: "Double-Opt-In noch nicht bestätigt — bis dahin keine Marketing-E-Mail.",
  unsubscribed: "Abgemeldet — es wird keine Marketing-E-Mail mehr generiert oder gesendet.",
};

/**
 * The per-customer email workflow: special instructions + discount depth →
 * "Personalisierte E-Mail generieren" (full-customer context) → edit → approve
 * & send. Editing and sending reuse the Marketing tab's endpoints, so the send
 * path (eligibility, unsubscribe, mint-at-send, tracking, logging) is the same
 * single audited pipeline. All gating is server-side; this is presentation only.
 */
function MarketingEmailSection({ customer }: { customer: CustomerProps }) {
  const router = useRouter();
  const [send, setSend] = useState<CustomerMarketingSendProps | null>(customer.marketingSend);
  // The admin's special instructions. Prefer the snapshot of an OPEN draft (so
  // the editor shows what the visible text was generated with), then the
  // customer's saved value.
  const [instructions, setInstructions] = useState<string>(
    (customer.marketingSend && customer.marketingSend.status !== "sent"
      ? customer.marketingSend.adminInstructions
      : null) ??
      customer.adminInstructions ??
      ""
  );
  const isSent = send?.status === "sent";
  const hasDraft = Boolean(send) && !isSent;

  const [subject, setSubject] = useState(hasDraft ? (send?.subject ?? "") : "");
  const [body, setBody] = useState(hasDraft ? (send?.draftedText ?? "") : "");
  const [discountPercent, setDiscountPercent] = useState<number>(
    hasDraft ? (send?.discountPercent ?? 0) : 0
  );
  const [busy, setBusy] = useState<null | "draft" | "save" | "send" | "delete">(null);

  if (customer.marketingStatus !== "confirmed") {
    return (
      <Section title="Personalisierte E-Mail (Mo)">
        <p className="text-sm text-muted-foreground">
          <em>{MARKETING_BLOCKED_NOTE[customer.marketingStatus]}</em>
        </p>
      </Section>
    );
  }

  // Depth or instructions changed vs. the open draft ⇒ the visible text was
  // generated with other inputs — force a re-generate before sending.
  const needsRegenerate =
    hasDraft &&
    send != null &&
    (discountPercent !== send.discountPercent ||
      instructions.trim() !== (send.adminInstructions ?? ""));

  async function call(path: string, payload: unknown): Promise<unknown> {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(
        (json as { error?: { message?: string } })?.error?.message ?? `Fehler (${res.status})`
      );
    }
    return json;
  }

  async function onGenerate() {
    setBusy("draft");
    try {
      const json = (await call("/api/admin/customers/marketing-draft", {
        customerId: customer.id,
        discountPercent,
        adminInstructions: instructions.trim() || null,
        // Overwrite an existing open draft; after a SENT mail this creates a
        // fresh one (the sent row stays as immutable history).
        regenerate: hasDraft,
      })) as { send?: CustomerMarketingSendProps };
      if (json.send) {
        setSend(json.send);
        setSubject(json.send.subject ?? "");
        setBody(json.send.draftedText ?? "");
        setDiscountPercent(json.send.discountPercent ?? 0);
        setInstructions(json.send.adminInstructions ?? "");
      }
      toast({ variant: "success", title: "Entwurf generiert", description: customer.email });
      router.refresh();
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(null);
    }
  }

  async function onSave() {
    if (!send) return;
    setBusy("save");
    try {
      await call("/api/admin/marketing/update", { sendId: send.id, subject, body });
      toast({ variant: "success", title: "Entwurf gespeichert" });
      router.refresh();
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(null);
    }
  }

  async function onDelete() {
    if (!send) return;
    if (!confirm("Diesen Entwurf wirklich löschen? Er kann nicht wiederhergestellt werden.")) return;
    setBusy("delete");
    try {
      await call("/api/admin/marketing/delete", { sendId: send.id });
      // Back to the "generate" view — the placeholder/preview lived on the row.
      setSend(null);
      setSubject("");
      setBody("");
      setDiscountPercent(0);
      toast({ variant: "success", title: "Entwurf gelöscht", description: customer.email });
      router.refresh();
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(null);
    }
  }

  async function onSend() {
    if (!send) return;
    if (needsRegenerate) {
      toast({
        variant: "warning",
        title: "Rabatt oder Hinweise geändert",
        description: "Bitte zuerst neu generieren, damit Text und Eingaben übereinstimmen.",
      });
      return;
    }
    if (!confirm(`E-Mail an ${customer.email} wirklich senden?`)) return;
    setBusy("send");
    try {
      // Persist any unsaved edits first so the sent mail matches the textarea.
      await call("/api/admin/marketing/update", { sendId: send.id, subject, body });
      await call("/api/admin/marketing/send", { sendId: send.id });
      setSend({ ...send, status: "sent", subject, draftedText: body, sentAt: new Date().toISOString() });
      toast({ variant: "success", title: "E-Mail gesendet", description: customer.email });
      router.refresh();
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(null);
    }
  }

  const discountId = `ms-customer-discount-${customer.id}`;

  return (
    <Section title="Personalisierte E-Mail (Mo) — aus dem GESAMTEN Kundenkontext">
      {isSent && send && (
        <div className="mb-4">
          <Badge variant="success">✓ Gesendet am {fmtDate(send.sentAt)}</Badge>
          <div className="mt-2 text-xs text-muted-foreground">
            Betreff: <strong className="text-foreground">{send.subject || "—"}</strong>
            {send.discountPercent > 0 && (
              <>
                {" "}
                · Rabatt: {send.discountPercent} %
                {send.discountCode ? (
                  <>
                    {" "}
                    · Code:{" "}
                    <code className="rounded bg-muted px-1 py-0.5">{send.discountCode}</code>
                  </>
                ) : null}
              </>
            )}
          </div>
          <details className="mt-2">
            <summary className="cursor-pointer text-xs font-medium text-accent">
              Gesendeten Text anzeigen
            </summary>
            <Markdown
              content={send.draftedText}
              className="mt-2 rounded-lg bg-muted/50 p-3"
            />
          </details>
          <p className="mt-2 text-xs text-muted-foreground">
            Du kannst unten jederzeit eine neue personalisierte E-Mail generieren.
          </p>
        </div>
      )}

      {/* Bundle offer — a NEW block ABOVE the special-additions field. The
          created bundle (if any) is attached to the email and rendered as a
          special-offer block at send time. */}
      <BundleOfferSection
        customerId={customer.id}
        customerEmail={customer.email}
        sendId={send && send.status !== "sent" ? send.id : null}
        initialBundles={customer.bundles}
      />

      {/* Special instructions — operator guidance woven into the next draft. */}
      <Label htmlFor={`ms-instructions-${customer.id}`} className="mb-1.5 block text-muted-foreground">
        Besondere Hinweise für diese E-Mail (optional)
      </Label>
      <Textarea
        id={`ms-instructions-${customer.id}`}
        value={instructions}
        onChange={(e) => setInstructions(e.target.value)}
        rows={3}
        maxLength={2000}
        disabled={busy !== null}
        className="resize-y"
        placeholder={
          'z. B. "Erwähne die neue Rudergeräte-Linie", "Bundle anbieten", ' +
          '"Sie hatte nach Lieferung nach Österreich gefragt"'
        }
      />
      <p className="mb-3 mt-1 text-[11px] text-muted-foreground">
        Wird der KI als Team-Anweisung mitgegeben (klar getrennt von den Kundendaten) und am Entwurf
        gespeichert (Audit-Trail).
      </p>

      {/* Numeric discount input: whole percent 0–50, DEFAULT 0. 0 = no code
          minted, no discount block in the email; >0 mints the unique MS5- code
          at send time. Bounds mirror the server (lib/discount-validation.mjs). */}
      <div>
        <Label htmlFor={discountId} className="mb-1.5 block text-muted-foreground">
          Persönlicher Rabatt (%)
        </Label>
        <div className="flex items-center gap-2">
          <Input
            id={discountId}
            type="number"
            inputMode="numeric"
            min={DISCOUNT_PERCENT_MIN}
            max={DISCOUNT_PERCENT_MAX}
            step={1}
            value={discountPercent}
            disabled={busy !== null}
            onChange={(e) => setDiscountPercent(clampDiscountPercent(e.target.valueAsNumber))}
            className="w-24"
          />
          <span className="text-xs text-muted-foreground">
            {discountPercent === 0
              ? "0 = kein Rabatt, kein Code"
              : `${DISCOUNT_PERCENT_MIN}–${DISCOUNT_PERCENT_MAX} %`}
          </span>
        </div>
      </div>

      {hasDraft ? (
        <div className="mt-3">
          <Badge variant="info">Entwurf — noch nicht gesendet</Badge>

          {needsRegenerate ? (
            <div className="my-2 flex flex-wrap items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
              <span>Rabatt oder Hinweise geändert — der aktuelle Text passt nicht mehr.</span>
              <Button variant="secondary" size="sm" onClick={onGenerate} disabled={busy !== null}>
                <RotateCcw /> {busy === "draft" ? "Generiere…" : "Neu generieren"}
              </Button>
            </div>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">
              {discountPercent > 0
                ? `Vorschau mit Platzhalter-Code MO-XXXX. Den Platzhalter im Text bitte nicht ändern — er wird beim Versand durch den echten, einmaligen ${discountPercent}%-Code (7 Tage gültig) ersetzt.`
                : "Kein Rabatt gewählt — der Text nennt keinen Code, der Warenkorb-Link enthält keinen Rabatt."}
            </p>
          )}

          <Label htmlFor={`ms-customer-subject-${customer.id}`} className="mb-1 mt-3 block text-muted-foreground">
            Betreff
          </Label>
          <Input
            id={`ms-customer-subject-${customer.id}`}
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          />

          <Label htmlFor={`ms-customer-body-${customer.id}`} className="mb-1 mt-3 block text-muted-foreground">
            E-Mail-Text (bearbeitbar)
          </Label>
          <Textarea
            id={`ms-customer-body-${customer.id}`}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={10}
            className="resize-y"
          />

          <div className="mt-2 text-xs text-muted-foreground">
            Beim Versand werden Warenkorb-Button &amp; Abmeldelink automatisch angehängt
            {discountPercent > 0 ? " und der einmalige Rabattcode erzeugt" : ""}. Gesendet wird nur
            an bestätigte, nicht abgemeldete Adressen.
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="secondary" onClick={onSave} disabled={busy !== null}>
              <Save /> {busy === "save" ? "Speichere…" : "Entwurf speichern"}
            </Button>
            <Button
              onClick={onSend}
              disabled={busy !== null || needsRegenerate}
              title={needsRegenerate ? "Bitte zuerst neu generieren" : undefined}
            >
              <Send /> {busy === "send" ? "Sende…" : "Freigeben & senden"}
            </Button>
            <Button
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={onDelete}
              disabled={busy !== null}
            >
              <Trash2 /> {busy === "delete" ? "Lösche…" : "Entwurf löschen"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3">
          <p className="mb-3 text-xs text-muted-foreground">
            Der Entwurf nutzt ALLES zu diesem Kunden: alle verknüpften Gespräche, das aktuelle
            Kundenverständnis und die Kaufhistorie (bereits Gekauftes wird nicht erneut empfohlen).
            Ein KI-Durchlauf — kostet Tokens.
          </p>
          <Button onClick={onGenerate} disabled={busy === "draft"}>
            <Sparkles />{" "}
            {busy === "draft"
              ? "Generiere Entwurf…"
              : isSent
                ? "Neue personalisierte E-Mail generieren"
                : "Personalisierte E-Mail generieren"}
          </Button>
        </div>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Bundle offer composer + per-customer bundle list (S11). A block above the
// special-additions field in the personalized-email flow. Workflow: suggest (AI)
// → edit composition (remove / add-by-search) → set price/title/expiry → create
// (S10 createBundleOffer). A created, active bundle is attached to the email and
// rendered as a special-offer block at send time. Endpoints unchanged; this is
// the Session-A re-skin only.
// ---------------------------------------------------------------------------

const DEFAULT_BUNDLE_TITLE = "Dein persönliches Set";
const DEFAULT_EXPIRY_DAYS = 7;
const BUNDLE_MIN = 2;
const BUNDLE_MAX = 5;

interface ComposerComponent {
  productId: string;
  title: string;
  imageUrl: string | null;
  unitPrice: number;
  currency: string;
  inStock: boolean;
  rationale?: string;
}

interface CatalogSearchHit {
  productId: string;
  title: string;
  imageUrl: string | null;
  unitPrice: number;
  currency: string;
  inStock: boolean;
}

/** Loose shape of the bundle/catalog admin JSON responses (only the fields the
 * composer reads). */
interface BundleApiResponse {
  ok?: boolean;
  error?: { code?: string; message?: string };
  offenders?: string[];
  redirectUrl?: string | null;
  title?: string;
  components?: ComposerComponent[];
  products?: CatalogSearchHit[];
  offer?: {
    id: number;
    title: string | null;
    status: CustomerBundleProps["status"];
    components?: Array<{ productId: string; title: string; quantity: number }>;
    componentsSum: string;
    bundlePrice: string;
    currency: string;
    cartUrl: string | null;
    createdAt: string | null;
    expiresAt: string | null;
    error: string | null;
  };
}

function fmtMoney(value: number | string, currency = "EUR"): string {
  const n = typeof value === "number" ? value : Number(String(value).replace(",", "."));
  if (!Number.isFinite(n)) return String(value);
  return n.toLocaleString("de-DE", { style: "currency", currency });
}

function BundleStatusBadge({ b }: { b: CustomerBundleProps }) {
  if (b.status === "failed") return <Badge variant="destructive">Fehlgeschlagen</Badge>;
  if (b.status === "expired") return <Badge variant="secondary">Abgelaufen</Badge>;
  if (b.status === "pending") return <Badge variant="warning">Wird erstellt…</Badge>;
  if (b.emailSentAt) return <Badge variant="success">Versendet</Badge>;
  return <Badge variant="info">Aktiv</Badge>;
}

function BundleOfferSection({
  customerId,
  customerEmail,
  sendId,
  initialBundles,
}: {
  customerId: number;
  customerEmail: string;
  /** The open (un-sent) draft id, so a created bundle attaches to it. */
  sendId: number | null;
  initialBundles: CustomerBundleProps[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [components, setComponents] = useState<ComposerComponent[]>([]);
  const [title, setTitle] = useState(DEFAULT_BUNDLE_TITLE);
  const [price, setPrice] = useState<string>("");
  const [priceEdited, setPriceEdited] = useState(false);
  const [expiryDays, setExpiryDays] = useState<number>(DEFAULT_EXPIRY_DAYS);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CatalogSearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState<null | "suggest" | "create">(null);
  // Monotonic token so an out-of-order debounced response can't clobber a newer
  // one (the operator types fast; an early request may resolve last).
  const searchSeq = useRef(0);
  const [bundles, setBundles] = useState<CustomerBundleProps[]>(initialBundles);

  const componentSum = components.reduce((s, c) => s + c.unitPrice, 0);
  const priceNum = Number(price.replace(",", "."));
  const priceValid = Number.isFinite(priceNum) && priceNum > 0;
  const aboveSum = priceValid && priceNum > componentSum + 0.0001;
  const countOk = components.length >= BUNDLE_MIN && components.length <= BUNDLE_MAX;

  // Keep the price defaulted to the live component sum until the admin edits it.
  function applyComponents(next: ComposerComponent[]) {
    setComponents(next);
    if (!priceEdited) {
      const sum = next.reduce((s, c) => s + c.unitPrice, 0);
      setPrice(next.length ? sum.toFixed(2) : "");
    }
  }

  async function post(
    path: string,
    payload: unknown
  ): Promise<{ ok: boolean; status: number; json: BundleApiResponse }> {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = (await res.json().catch(() => ({}))) as BundleApiResponse;
    return { ok: res.ok, status: res.status, json };
  }

  async function onSuggest() {
    setBusy("suggest");
    try {
      const { ok, json } = await post("/api/admin/bundles/suggest", { customerId });
      if (!ok) {
        toast({ variant: "error", title: "Fehler", description: json?.error?.message ?? "Vorschlag fehlgeschlagen." });
        return;
      }
      const next: ComposerComponent[] = (json.components ?? []).map((c: ComposerComponent) => ({
        productId: c.productId,
        title: c.title,
        imageUrl: c.imageUrl,
        unitPrice: c.unitPrice,
        currency: c.currency,
        inStock: c.inStock,
        rationale: c.rationale,
      }));
      applyComponents(next);
      if (json.title && (!title || title === DEFAULT_BUNDLE_TITLE)) setTitle(json.title);
      toast({
        variant: "success",
        title: "KI-Vorschlag erstellt",
        description: `${next.length} Produkte — du kannst frei anpassen.`,
      });
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(null);
    }
  }

  // Search-as-you-type over the synced catalog. Debounced so each keystroke
  // doesn't fire a request; the backend handles case-insensitive +
  // umlaut-tolerant matching. Results clear below a 2-char query (a single
  // letter is too coarse to be useful and would just dump the cap).
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      searchSeq.current++; // invalidate any in-flight response for a longer query
      setResults([]);
      setSearching(false);
      return;
    }
    const seq = ++searchSeq.current;
    setSearching(true);
    const handle = setTimeout(async () => {
      try {
        const { ok, json } = await post("/api/admin/catalog/search", { query: q });
        if (seq !== searchSeq.current) return; // a newer query superseded this one
        if (!ok) {
          toast({ variant: "error", title: "Fehler", description: json?.error?.message ?? "Suche fehlgeschlagen." });
          return;
        }
        setResults(json.products ?? []);
      } catch (e) {
        if (seq === searchSeq.current) reportError(e);
      } finally {
        if (seq === searchSeq.current) setSearching(false);
      }
    }, 250);
    return () => clearTimeout(handle);
    // `post` is a stable local helper; re-running only on query change is intended.
  }, [query]);

  function addProduct(hit: CatalogSearchHit) {
    if (components.some((c) => c.productId === hit.productId)) return;
    applyComponents([...components, { ...hit }]);
  }

  function removeProduct(productId: string) {
    applyComponents(components.filter((c) => c.productId !== productId));
  }

  async function onCreate() {
    if (!countOk) {
      toast({ variant: "warning", title: "Ungültige Auswahl", description: `Ein Bundle braucht ${BUNDLE_MIN}–${BUNDLE_MAX} Produkte.` });
      return;
    }
    if (!priceValid) {
      toast({ variant: "warning", title: "Preis fehlt", description: "Bitte einen Bundle-Preis größer als 0 € angeben." });
      return;
    }
    setBusy("create");
    try {
      const { ok, json } = await post("/api/admin/bundles/create", {
        customerId,
        components: components.map((c) => ({ productId: c.productId })),
        bundlePriceOverride: priceNum,
        title: title.trim() || DEFAULT_BUNDLE_TITLE,
        expiryDays,
        ...(sendId != null ? { marketingSendId: sendId } : {}),
      });
      if (!ok || !json.ok) {
        const code = json?.error?.code;
        const base = json?.error?.message ?? "Bundle-Erstellung fehlgeschlagen.";
        const offenders: string[] = json?.offenders ?? [];
        toast({
          variant: "error",
          title: "Fehler",
          description:
            code === "sold_out" && offenders.length
              ? `${base} Ausverkauft: ${offenders.join(", ")}. Bitte entfernen und erneut versuchen.`
              : base,
        });
        return;
      }
      const offer = json.offer;
      if (!offer) {
        toast({ variant: "error", title: "Fehler", description: "Bundle erstellt, aber die Antwort enthielt keine Angebotsdaten." });
        return;
      }
      const created: CustomerBundleProps = {
        id: offer.id,
        title: offer.title,
        status: offer.status,
        components: (offer.components ?? []).map((c: { productId: string; title: string; quantity: number }) => ({
          productId: c.productId,
          title: c.title,
          quantity: c.quantity,
        })),
        componentsSum: offer.componentsSum,
        bundlePrice: offer.bundlePrice,
        currency: offer.currency,
        cartUrl: offer.cartUrl,
        redirectUrl: json.redirectUrl ?? null,
        createdAt: offer.createdAt,
        expiresAt: offer.expiresAt,
        error: offer.error,
        emailSentAt: null,
        clicked: false,
      };
      setBundles([created, ...bundles]);
      // Reset the composer for the next bundle.
      applyComponents([]);
      setComponents([]);
      setTitle(DEFAULT_BUNDLE_TITLE);
      setPrice("");
      setPriceEdited(false);
      setResults([]);
      setQuery("");
      toast({
        variant: "success",
        title: "Bundle erstellt",
        description:
          sendId != null
            ? "An die E-Mail angehängt. Tipp: E-Mail neu generieren, damit der Text das Set erwähnt."
            : "Es wird an die nächste generierte E-Mail angehängt.",
      });
      router.refresh();
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(null);
    }
  }

  async function onArchive(id: number) {
    if (!confirm("Dieses Bundle wirklich archivieren? Der Angebots-Link wird ungültig.")) return;
    try {
      const { ok, json } = await post("/api/admin/bundles/archive", { id });
      if (!ok || !json.ok) {
        toast({ variant: "error", title: "Fehler", description: json?.error?.message ?? "Archivieren fehlgeschlagen." });
        return;
      }
      setBundles((prev) => prev.map((b) => (b.id === id ? { ...b, status: "expired" as const } : b)));
      toast({ variant: "success", title: "Bundle archiviert" });
      router.refresh();
    } catch (e) {
      reportError(e);
    }
  }

  // DELETE a draft/unsent bundle — only the never-published states (pending /
  // failed). An active/published or expired offer uses Archive instead (the
  // server enforces this; the button only appears for deletable rows).
  async function onDelete(id: number) {
    if (!confirm("Dieses Bundle wirklich löschen? Es kann nicht wiederhergestellt werden.")) return;
    try {
      const { ok, json } = await post("/api/admin/bundles/delete", { id });
      if (!ok || !json.ok) {
        toast({ variant: "error", title: "Fehler", description: json?.error?.message ?? "Löschen fehlgeschlagen." });
        return;
      }
      setBundles((prev) => prev.filter((b) => b.id !== id));
      toast({ variant: "success", title: "Bundle gelöscht" });
      router.refresh();
    } catch (e) {
      reportError(e);
    }
  }

  return (
    <Card className="mb-4 p-3 shadow-none">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1 text-left text-sm font-semibold text-foreground"
      >
        <Gift className="size-4" /> Bundle-Angebot
        {bundles.length > 0 && (
          <span className="font-normal text-muted-foreground">· {bundles.length} vorhanden</span>
        )}
        <span className="ml-auto text-muted-foreground">{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div className="mt-3">
          {/* Composer */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Button onClick={onSuggest} disabled={busy !== null}>
              <Sparkles /> {busy === "suggest" ? "Schlage vor…" : "Bundle vorschlagen"}
            </Button>
            <span className="text-[11px] text-muted-foreground">
              KI-Durchlauf über Profil, Gespräche &amp; Käufe — kostet Tokens.
            </span>
          </div>

          {/* Editable composition */}
          {components.length > 0 && (
            <div className="mb-3 flex flex-col gap-1.5">
              {components.map((c) => (
                <div
                  key={c.productId}
                  className="flex items-center gap-2.5 rounded-lg bg-muted/50 px-2.5 py-1.5"
                >
                  {c.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={c.imageUrl}
                      alt={c.title}
                      width={36}
                      height={36}
                      className="size-9 rounded-md object-cover"
                    />
                  ) : (
                    <div className="size-9 rounded-md bg-muted" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold">{c.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {fmtMoney(c.unitPrice, c.currency)}
                      {c.rationale ? ` · ${c.rationale}` : ""}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    title="Entfernen"
                    aria-label={`${c.title} aus dem Bundle entfernen`}
                    onClick={() => removeProduct(c.productId)}
                  >
                    <X />
                  </Button>
                </div>
              ))}
              <div className="text-right text-sm text-muted-foreground">
                Komponentensumme: <strong className="text-foreground">{fmtMoney(componentSum)}</strong>
              </div>
            </div>
          )}

          {/* Add product by name search — filters the synced catalog as you type */}
          <div className="mb-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Produkt suchen (Name)…"
                className="pl-9 pr-16"
                aria-label="Produkt im Katalog suchen"
              />
              {searching && (
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                  Suche…
                </span>
              )}
            </div>
            {results.length > 0 && (
              <div className="mt-1.5 flex flex-col gap-1">
                {results.map((r) => {
                  const added = components.some((c) => c.productId === r.productId);
                  return (
                    <div
                      key={r.productId}
                      className="flex items-center gap-2 rounded-md border border-border bg-card px-2 py-1 text-sm"
                    >
                      {r.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={r.imageUrl}
                          alt={r.title}
                          width={28}
                          height={28}
                          className="size-7 shrink-0 rounded object-cover"
                        />
                      ) : (
                        <div className="size-7 shrink-0 rounded bg-muted" />
                      )}
                      <span className="min-w-0 flex-1">
                        {r.title} <span className="text-muted-foreground">· {fmtMoney(r.unitPrice, r.currency)}</span>
                        {!r.inStock && <span className="text-destructive"> · ausverkauft</span>}
                      </span>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => addProduct(r)}
                        disabled={added || !r.inStock}
                        title={!r.inStock ? "Ausverkauft — nicht hinzufügbar" : undefined}
                      >
                        {added ? "✓ drin" : <><Plus /> hinzufügen</>}
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
            {query.trim().length >= 2 && !searching && results.length === 0 && (
              <div className="mt-1.5 text-xs text-muted-foreground">
                Keine Treffer für „{query.trim()}“.
              </div>
            )}
          </div>

          {/* Price / title / expiry */}
          {components.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-3">
              <div>
                <Label className="mb-1 block text-muted-foreground">Bundle-Preis (€)</Label>
                <Input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step={0.01}
                  value={price}
                  onChange={(e) => {
                    setPrice(e.target.value);
                    setPriceEdited(true);
                  }}
                  className={`w-28 ${priceValid ? "" : "border-destructive"}`}
                />
              </div>
              <div className="min-w-[10rem] flex-1">
                <Label className="mb-1 block text-muted-foreground">Titel</Label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} />
              </div>
              <div>
                <Label className="mb-1 block text-muted-foreground">Gültig (Tage)</Label>
                <Input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  step={1}
                  value={expiryDays}
                  onChange={(e) =>
                    setExpiryDays(Math.max(1, Math.floor(e.target.valueAsNumber || DEFAULT_EXPIRY_DAYS)))
                  }
                  className="w-20"
                />
              </div>
            </div>
          )}

          {aboveSum && (
            <p className="mb-3 text-xs text-warning">
              ⚠ Preis über der Komponentensumme ({fmtMoney(componentSum)}) — es wird KEINE
              „statt“-Zeile angezeigt (das Bundle ist nicht günstiger als die Einzelprodukte).
            </p>
          )}

          {components.length > 0 && (
            <Button onClick={onCreate} disabled={busy !== null || !countOk || !priceValid}>
              {busy === "create" ? "Erstelle…" : "Bundle erstellen"}
            </Button>
          )}

          {/* Per-customer bundle list */}
          {bundles.length > 0 && (
            <div className="mt-4 border-t border-border pt-3">
              <div className="mb-2 text-xs font-medium text-muted-foreground">
                Bundles für {customerEmail} ({bundles.length})
              </div>
              <div className="flex flex-col gap-2">
                {bundles.map((b) => (
                  <div key={b.id} className="rounded-lg bg-muted/50 px-3 py-2 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <strong>{b.title ?? "Bundle"}</strong>
                      <BundleStatusBadge b={b} />
                      {b.clicked && <Badge variant="accent">↗ Klick erfasst</Badge>}
                      <span className="text-muted-foreground">
                        {fmtMoney(b.bundlePrice, b.currency)}
                        {Number(b.bundlePrice) < Number(b.componentsSum)
                          ? ` (statt ${fmtMoney(b.componentsSum, b.currency)})`
                          : ""}
                      </span>
                    </div>
                    <div className="mt-0.5 text-muted-foreground">
                      {b.components.map((c) => c.title).join(" + ")}
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      Erstellt {fmtDate(b.createdAt)}
                      {b.expiresAt ? ` · läuft ab ${fmtDate(b.expiresAt)}` : ""}
                    </div>
                    {b.status === "failed" && b.error && (
                      <div className="mt-1 text-xs text-destructive">{b.error}</div>
                    )}
                    {(b.status === "pending" || b.status === "failed") && (
                      // Never-published DRAFT — deletable (active/expired use Archive).
                      <div className="mt-1.5">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => onDelete(b.id)}
                        >
                          <Trash2 className="size-3.5" /> Löschen
                        </Button>
                      </div>
                    )}
                    {b.status === "active" && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-2.5">
                        {b.redirectUrl && (
                          <a
                            href={b.redirectUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
                          >
                            <ExternalLink className="size-3.5" /> Angebots-Link
                          </a>
                        )}
                        <Button variant="secondary" size="sm" onClick={() => onArchive(b.id)}>
                          Archivieren
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
