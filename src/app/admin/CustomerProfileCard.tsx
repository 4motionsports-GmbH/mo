"use client";

// Per-CUSTOMER card for the admin dashboard's Kunden tab — grouped by person
// (email), not by session. Shows the session timeline (each transcript
// viewable), the cached Shopify purchase history, the persona(s), and the
// regenerated "current understanding" summary. Returning customers (more than
// one session) are clearly marked.
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

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  DISCOUNT_PERCENT_MIN,
  DISCOUNT_PERCENT_MAX,
  clampDiscountPercent,
} from "@/lib/discount-validation.mjs";

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

const MARKETING_STATUS_LABEL: Record<CustomerProps["marketingStatus"], string> = {
  none: "Kein Marketing",
  pending: "DOI ausstehend",
  confirmed: "Marketing bestätigt",
  unsubscribed: "Abgemeldet",
};

export function CustomerProfileCard({
  customer,
  // Whether the automatic welcome-discount issuance is currently enabled
  // (WELCOME_DISCOUNT_ENABLED, default off). Historical issued/redeemed data
  // stays visible either way — disabled only changes the labelling.
  welcomeDiscountEnabled,
}: {
  customer: CustomerProps;
  welcomeDiscountEnabled: boolean;
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
  const [error, setError] = useState<string | null>(null);

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
    setError(null);
    try {
      const json = (await call("/api/admin/customers/purchases")) as {
        purchaseSummary?: OrderHistoryProps;
      };
      if (json.purchaseSummary) {
        setPurchases(json.purchaseSummary);
        setPurchasesUpdatedAt(new Date().toISOString());
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unbekannter Fehler");
    } finally {
      setBusy(null);
    }
  }

  async function onGenerateProfile() {
    setBusy("profile");
    setError(null);
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
      if (json.warning) setError(json.warning);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unbekannter Fehler");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section
      style={{
        background: "#fff",
        border: "1px solid #eee",
        borderRadius: 14,
        padding: 18,
        boxShadow: "0 1px 2px rgba(0,0,0,.04)",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600 }}>{customer.email}</div>
          <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>
            Zuerst gesehen: {fmtDate(customer.firstSeenAt)} · Zuletzt: {fmtDate(customer.lastSeenAt)}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "flex-start" }}>
          {isReturning ? (
            <span
              style={badge("#ede9fe", "#5b21b6")}
              title="Mehrere Sessions unter derselben E-Mail"
            >
              ↻ Wiederkehrend · {customer.sessions.length} Sessions
            </span>
          ) : (
            <span style={badge("#f3f4f6", "#6b7280")}>
              {customer.sessions.length === 1 ? "1 Session" : "Keine Session verknüpft"}
            </span>
          )}
          <span
            style={
              customer.marketingStatus === "confirmed"
                ? badge("#dcfce7", "#166534")
                : customer.marketingStatus === "unsubscribed"
                  ? badge("#fee2e2", "#991b1b")
                  : badge("#f3f4f6", "#6b7280")
            }
          >
            {MARKETING_STATUS_LABEL[customer.marketingStatus]}
          </span>
        </div>
      </div>

      {/* Session timeline */}
      <div style={{ marginTop: 14 }}>
        <div style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>
          Gesprächs-Timeline ({customer.sessions.length})
        </div>
        {customer.sessions.length === 0 && (
          <p style={{ fontSize: 13, color: "#999", margin: 0 }}>
            <em>
              Keine Konversation verknüpft — die E-Mail wurde erfasst, aber die zugehörige Session
              ist nicht (mehr) gespeichert.
            </em>
          </p>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {customer.sessions.map((s, i) => (
            <SessionRow key={s.conversationId} session={s} index={i} />
          ))}
        </div>
      </div>

      {/* Purchase history */}
      <div style={{ marginTop: 16, borderTop: "1px solid #f0f0f0", paddingTop: 14 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          <div style={{ fontSize: 12, color: "#666" }}>
            Kaufhistorie (Shopify)
            {purchasesUpdatedAt ? ` · Stand: ${fmtDate(purchasesUpdatedAt)}` : " · noch nicht geladen"}
          </div>
          <button
            onClick={onRefreshPurchases}
            disabled={busy !== null}
            style={secondaryBtn(busy !== null)}
          >
            {busy === "purchases" ? "Lade…" : "↻ Käufe aktualisieren"}
          </button>
        </div>
        {purchases ? (
          purchases.orders.length === 0 ? (
            <p style={{ fontSize: 13, color: "#999", margin: "8px 0 0" }}>
              Keine Bestellungen unter dieser E-Mail gefunden.
            </p>
          ) : (
            <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
              {purchases.orders.map((o) => (
                <div
                  key={o.name + o.createdAt}
                  style={{ fontSize: 13, background: "#fafafa", borderRadius: 8, padding: "8px 12px" }}
                >
                  <strong>{o.name}</strong> · {fmtDate(o.createdAt)}
                  {o.totalAmount ? ` · ${o.totalAmount} ${o.currencyCode ?? ""}` : ""}
                  <div style={{ color: "#555", marginTop: 2 }}>
                    {o.items.length > 0
                      ? o.items
                          .map((it) => `${it.quantity}× ${it.title ?? it.handle ?? "Artikel"}`)
                          .join(", ")
                      : "(keine Positionen)"}
                  </div>
                </div>
              ))}
              {purchases.truncated && (
                <p style={{ fontSize: 11, color: "#999", margin: "2px 0 0" }}>
                  Liste ggf. gekürzt (nur die neuesten Bestellungen).
                </p>
              )}
            </div>
          )
        ) : (
          <p style={{ fontSize: 13, color: "#999", margin: "8px 0 0" }}>
            <em>Noch keine Kaufhistorie geladen.</em>
          </p>
        )}
      </div>

      {/* Welcome discount (one-time, issued on first DOI confirmation).
          Flag-gated (WELCOME_DISCOUNT_ENABLED): when off, the historical
          issued/redeemed data stays visible but is labelled "(deaktiviert)". */}
      <div style={{ marginTop: 16, borderTop: "1px solid #f0f0f0", paddingTop: 14 }}>
        <div style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>
          Willkommensrabatt
          {!welcomeDiscountEnabled && (
            <span title="Automatische Ausstellung per WELCOME_DISCOUNT_ENABLED abgeschaltet — Codes werden manuell vergeben.">
              {" "}
              (deaktiviert)
            </span>
          )}
        </div>
        {customer.welcomeIssuedAt ? (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <span style={badge("#dbeafe", "#1e40af")}>
              🎁 Ausgestellt am {fmtDate(customer.welcomeIssuedAt)}
            </span>
            {customer.welcomeCode && (
              <span style={{ fontSize: 13 }}>
                Code: <code>{customer.welcomeCode}</code>
                {customer.welcomeCodeExpiresAt
                  ? ` (gültig bis ${fmtDate(customer.welcomeCodeExpiresAt)})`
                  : ""}
              </span>
            )}
            {customer.welcomeRedeemed === true ? (
              <span style={badge("#dcfce7", "#166534")}>✓ Eingelöst</span>
            ) : customer.welcomeRedeemed === false ? (
              <span style={badge("#fef3c7", "#92400e")}>Noch nicht eingelöst</span>
            ) : (
              <span style={badge("#f3f4f6", "#6b7280")} title="Shopify nicht erreichbar/konfiguriert">
                Einlösung unbekannt
              </span>
            )}
          </div>
        ) : (
          <p style={{ fontSize: 13, color: "#999", margin: 0 }}>
            <em>
              {welcomeDiscountEnabled
                ? "Noch kein Willkommenscode — wird automatisch bei der ersten Double-Opt-In-Bestätigung ausgestellt (einmal pro Kunde)."
                : "Kein Willkommenscode. Die automatische Ausstellung ist deaktiviert (WELCOME_DISCOUNT_ENABLED) — Rabattcodes werden manuell über das Dashboard vergeben."}
            </em>
          </p>
        )}
      </div>

      {/* Current understanding */}
      <div style={{ marginTop: 16, borderTop: "1px solid #f0f0f0", paddingTop: 14 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          <div style={{ fontSize: 12, color: "#666" }}>
            Aktuelles Kundenverständnis
            {profileUpdatedAt ? ` · Stand: ${fmtDate(profileUpdatedAt)}` : ""}
          </div>
          <button
            onClick={onGenerateProfile}
            disabled={busy !== null}
            style={primaryBtn(busy !== null)}
          >
            {busy === "profile"
              ? "Generiere…"
              : profile
                ? "✦ Neu generieren"
                : "✦ Kundenverständnis generieren"}
          </button>
        </div>
        {profile ? (
          <pre
            style={{
              whiteSpace: "pre-wrap",
              fontFamily: "inherit",
              fontSize: 13,
              lineHeight: 1.5,
              background: "#fafafa",
              padding: 12,
              borderRadius: 8,
              margin: "8px 0 0",
            }}
          >
            {profile}
          </pre>
        ) : (
          <p style={{ fontSize: 13, color: "#999", margin: "8px 0 0" }}>
            <em>Noch kein Profil generiert.</em>
          </p>
        )}
        <p style={{ fontSize: 11, color: "#999", margin: "8px 0 0" }}>
          Jede Generierung ist ein KI-Durchlauf (Anthropic Claude) über alle verknüpften Gespräche +
          Kaufhistorie und kostet Tokens.
          {lastUsage
            ? ` Letzter Lauf: ${lastUsage.inputTokens.toLocaleString("de-DE")} Input- / ` +
              `${lastUsage.outputTokens.toLocaleString("de-DE")} Output-Tokens` +
              ` (~$${lastUsage.approxCostUsd.toFixed(3)}).`
            : ""}
        </p>
      </div>

      {error && <p style={{ color: "#b91c1c", fontSize: 12, margin: "10px 0 0" }}>{error}</p>}

      {/* Personalised marketing email (full-customer context) */}
      <MarketingEmailSection customer={customer} />
    </section>
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
 * single audited pipeline. All gating is server-side.
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
  const [busy, setBusy] = useState<null | "draft" | "save" | "send">(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  if (customer.marketingStatus !== "confirmed") {
    return (
      <div style={{ marginTop: 16, borderTop: "1px solid #f0f0f0", paddingTop: 14 }}>
        <div style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>
          Personalisierte E-Mail (Mo)
        </div>
        <p style={{ fontSize: 13, color: "#999", margin: 0 }}>
          <em>{MARKETING_BLOCKED_NOTE[customer.marketingStatus]}</em>
        </p>
      </div>
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
    setError(null);
    setNote(null);
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
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unbekannter Fehler");
    } finally {
      setBusy(null);
    }
  }

  async function onSave() {
    if (!send) return;
    setBusy("save");
    setError(null);
    setNote(null);
    try {
      await call("/api/admin/marketing/update", { sendId: send.id, subject, body });
      setNote("Entwurf gespeichert.");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unbekannter Fehler");
    } finally {
      setBusy(null);
    }
  }

  async function onSend() {
    if (!send) return;
    if (needsRegenerate) {
      setError(
        "Rabatt oder Hinweise geändert — bitte zuerst neu generieren, damit Text und Eingaben übereinstimmen."
      );
      return;
    }
    if (!confirm(`E-Mail an ${customer.email} wirklich senden?`)) return;
    setBusy("send");
    setError(null);
    try {
      // Persist any unsaved edits first so the sent mail matches the textarea.
      await call("/api/admin/marketing/update", { sendId: send.id, subject, body });
      await call("/api/admin/marketing/send", { sendId: send.id });
      setSend({ ...send, status: "sent", subject, draftedText: body, sentAt: new Date().toISOString() });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unbekannter Fehler");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ marginTop: 16, borderTop: "1px solid #f0f0f0", paddingTop: 14 }}>
      <div style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>
        Personalisierte E-Mail (Mo) — aus dem GESAMTEN Kundenkontext
      </div>

      {isSent && send && (
        <div style={{ marginBottom: 12 }}>
          <span style={badge("#dcfce7", "#166534")}>✓ Gesendet am {fmtDate(send.sentAt)}</span>
          <div style={{ fontSize: 12, color: "#666", marginTop: 6 }}>
            Betreff: <strong>{send.subject || "—"}</strong>
            {send.discountPercent > 0 && (
              <>
                {" "}
                · Rabatt: {send.discountPercent} %
                {send.discountCode ? (
                  <>
                    {" "}
                    · Code: <code>{send.discountCode}</code>
                  </>
                ) : null}
              </>
            )}
          </div>
          <details style={{ marginTop: 6 }}>
            <summary style={{ fontSize: 12, color: "#2563eb", cursor: "pointer" }}>
              Gesendeten Text anzeigen
            </summary>
            <pre
              style={{
                whiteSpace: "pre-wrap",
                fontFamily: "inherit",
                fontSize: 13,
                background: "#fafafa",
                padding: 12,
                borderRadius: 8,
                marginTop: 8,
              }}
            >
              {send.draftedText}
            </pre>
          </details>
          <p style={{ fontSize: 12, color: "#666", margin: "10px 0 0" }}>
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
      <label style={{ display: "block", fontSize: 12, color: "#666", margin: "0 0 4px" }}>
        Besondere Hinweise für diese E-Mail (optional)
      </label>
      <textarea
        value={instructions}
        onChange={(e) => setInstructions(e.target.value)}
        rows={3}
        maxLength={2000}
        placeholder={
          'z. B. "Erwähne die neue Rudergeräte-Linie", "Bundle anbieten", ' +
          '"Sie hatte nach Lieferung nach Österreich gefragt"'
        }
        disabled={busy !== null}
        style={{
          width: "100%",
          boxSizing: "border-box",
          padding: "8px 10px",
          fontSize: 13,
          lineHeight: 1.5,
          border: "1px solid #ddd",
          borderRadius: 8,
          fontFamily: "inherit",
          resize: "vertical",
        }}
      />
      <p style={{ fontSize: 11, color: "#999", margin: "4px 0 10px" }}>
        Wird der KI als Team-Anweisung mitgegeben (klar getrennt von den Kundendaten) und am
        Entwurf gespeichert (Audit-Trail).
      </p>

      <div>
        <label
          htmlFor={`ms-customer-discount-${customer.id}`}
          style={{ display: "block", fontSize: 12, color: "#666", marginBottom: 6 }}
        >
          Persönlicher Rabatt (%)
        </label>
        {/* Numeric input: whole percent 0–50, DEFAULT 0. 0 = no code minted,
            no discount block in the email; >0 mints the unique MS5- code at
            send time. Bounds mirror the server (lib/discount-validation.mjs). */}
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            id={`ms-customer-discount-${customer.id}`}
            type="number"
            inputMode="numeric"
            min={DISCOUNT_PERCENT_MIN}
            max={DISCOUNT_PERCENT_MAX}
            step={1}
            value={discountPercent}
            disabled={busy !== null}
            onChange={(e) => setDiscountPercent(clampDiscountPercent(e.target.valueAsNumber))}
            style={{
              width: 96,
              boxSizing: "border-box",
              padding: "7px 10px",
              fontSize: 14,
              border: "1px solid #ddd",
              borderRadius: 8,
            }}
          />
          <span style={{ fontSize: 12, color: "#888" }}>
            {discountPercent === 0
              ? "0 = kein Rabatt, kein Code"
              : `${DISCOUNT_PERCENT_MIN}–${DISCOUNT_PERCENT_MAX} %`}
          </span>
        </div>
      </div>

      {hasDraft ? (
        <div style={{ marginTop: 12 }}>
          <span style={badge("#e0e7ff", "#3730a3")}>Entwurf — noch nicht gesendet</span>

          {needsRegenerate ? (
            <div
              style={{
                background: "#fef3c7",
                color: "#92400e",
                fontSize: 12,
                padding: "8px 10px",
                borderRadius: 8,
                margin: "8px 0",
              }}
            >
              Rabatt oder Hinweise geändert — der aktuelle Text passt nicht mehr.{" "}
              <button
                type="button"
                onClick={onGenerate}
                disabled={busy !== null}
                style={{ ...secondaryBtn(busy !== null), padding: "4px 10px", fontSize: 12, marginLeft: 4 }}
              >
                {busy === "draft" ? "Generiere…" : "↻ Neu generieren"}
              </button>
            </div>
          ) : (
            <p style={{ fontSize: 12, color: "#666", margin: "8px 0 0" }}>
              {discountPercent > 0
                ? `Vorschau mit Platzhalter-Code MO-XXXX. Den Platzhalter im Text bitte nicht ändern — er wird beim Versand durch den echten, einmaligen ${discountPercent}%-Code (7 Tage gültig) ersetzt.`
                : "Kein Rabatt gewählt — der Text nennt keinen Code, der Warenkorb-Link enthält keinen Rabatt."}
            </p>
          )}

          <label style={{ display: "block", fontSize: 12, color: "#666", margin: "12px 0 4px" }}>
            Betreff
          </label>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            style={{
              width: "100%",
              boxSizing: "border-box",
              padding: "8px 10px",
              fontSize: 14,
              border: "1px solid #ddd",
              borderRadius: 8,
            }}
          />

          <label style={{ display: "block", fontSize: 12, color: "#666", margin: "12px 0 4px" }}>
            E-Mail-Text (bearbeitbar)
          </label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={10}
            style={{
              width: "100%",
              boxSizing: "border-box",
              padding: "10px 12px",
              fontSize: 14,
              lineHeight: 1.5,
              border: "1px solid #ddd",
              borderRadius: 8,
              fontFamily: "inherit",
              resize: "vertical",
            }}
          />

          <div style={{ fontSize: 12, color: "#666", marginTop: 8 }}>
            Beim Versand werden Warenkorb-Button &amp; Abmeldelink automatisch angehängt
            {discountPercent > 0 ? " und der einmalige Rabattcode erzeugt" : ""}. Gesendet wird nur
            an bestätigte, nicht abgemeldete Adressen.
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
            <button onClick={onSave} disabled={busy !== null} style={secondaryBtn(busy !== null)}>
              {busy === "save" ? "Speichere…" : "Entwurf speichern"}
            </button>
            <button
              onClick={onSend}
              disabled={busy !== null || needsRegenerate}
              style={primaryBtn(busy !== null || needsRegenerate)}
              title={needsRegenerate ? "Bitte zuerst neu generieren" : undefined}
            >
              {busy === "send" ? "Sende…" : "✓ Freigeben & senden"}
            </button>
          </div>
        </div>
      ) : (
        <div style={{ marginTop: 12 }}>
          <p style={{ fontSize: 12, color: "#666", margin: "0 0 10px" }}>
            Der Entwurf nutzt ALLES zu diesem Kunden: alle verknüpften Gespräche, das aktuelle
            Kundenverständnis und die Kaufhistorie (bereits Gekauftes wird nicht erneut empfohlen).
            Ein KI-Durchlauf — kostet Tokens.
          </p>
          <button onClick={onGenerate} disabled={busy === "draft"} style={primaryBtn(busy === "draft")}>
            {busy === "draft"
              ? "Generiere Entwurf…"
              : isSent
                ? "✦ Neue personalisierte E-Mail generieren"
                : "✦ Personalisierte E-Mail generieren"}
          </button>
        </div>
      )}

      {note && <p style={{ color: "#16a34a", fontSize: 12, margin: "8px 0 0" }}>{note}</p>}
      {error && <p style={{ color: "#b91c1c", fontSize: 12, margin: "8px 0 0" }}>{error}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bundle offer composer + per-customer bundle list (S11). A NEW block above the
// special-additions field in the personalized-email flow. Workflow: suggest (AI)
// → edit composition (remove / add-by-search) → set price/title/expiry → create
// (S10 createBundleOffer). A created, active bundle is attached to the email and
// rendered as a special-offer block at send time.
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

function bundleStatusBadge(b: CustomerBundleProps): React.ReactNode {
  if (b.status === "failed") return <span style={badge("#fee2e2", "#991b1b")}>Fehlgeschlagen</span>;
  if (b.status === "expired") return <span style={badge("#f3f4f6", "#6b7280")}>Abgelaufen</span>;
  if (b.status === "pending") return <span style={badge("#fef3c7", "#92400e")}>Wird erstellt…</span>;
  if (b.emailSentAt) return <span style={badge("#dcfce7", "#166534")}>Versendet</span>;
  return <span style={badge("#dbeafe", "#1e40af")}>Aktiv</span>;
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
  const [busy, setBusy] = useState<null | "suggest" | "search" | "create">(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
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
    setError(null);
    setNote(null);
    try {
      const { ok, json } = await post("/api/admin/bundles/suggest", { customerId });
      if (!ok) {
        setError(json?.error?.message ?? "Vorschlag fehlgeschlagen.");
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
      setNote(`KI-Vorschlag: ${next.length} Produkte. Du kannst frei anpassen.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unbekannter Fehler");
    } finally {
      setBusy(null);
    }
  }

  async function onSearch() {
    const q = query.trim();
    if (!q) return;
    setBusy("search");
    setError(null);
    try {
      const { ok, json } = await post("/api/admin/catalog/search", { query: q });
      if (!ok) {
        setError(json?.error?.message ?? "Suche fehlgeschlagen.");
        return;
      }
      setResults(json.products ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unbekannter Fehler");
    } finally {
      setBusy(null);
    }
  }

  function addProduct(hit: CatalogSearchHit) {
    if (components.some((c) => c.productId === hit.productId)) return;
    applyComponents([...components, { ...hit }]);
  }

  function removeProduct(productId: string) {
    applyComponents(components.filter((c) => c.productId !== productId));
  }

  async function onCreate() {
    if (!countOk) {
      setError(`Ein Bundle braucht ${BUNDLE_MIN}–${BUNDLE_MAX} Produkte.`);
      return;
    }
    if (!priceValid) {
      setError("Bitte einen Bundle-Preis größer als 0 € angeben.");
      return;
    }
    setBusy("create");
    setError(null);
    setNote(null);
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
        setError(
          code === "sold_out" && offenders.length
            ? `${base} Ausverkauft: ${offenders.join(", ")}. Bitte entfernen und erneut versuchen.`
            : base
        );
        return;
      }
      const offer = json.offer;
      if (!offer) {
        setError("Bundle erstellt, aber die Antwort enthielt keine Angebotsdaten.");
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
      setNote(
        sendId != null
          ? "Bundle erstellt & an die E-Mail angehängt. Tipp: E-Mail neu generieren, damit der Text das Set erwähnt."
          : "Bundle erstellt. Es wird an die nächste generierte E-Mail angehängt."
      );
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unbekannter Fehler");
    } finally {
      setBusy(null);
    }
  }

  async function onArchive(id: number) {
    if (!confirm("Dieses Bundle wirklich archivieren? Der Angebots-Link wird ungültig.")) return;
    try {
      const { ok, json } = await post("/api/admin/bundles/archive", { id });
      if (!ok || !json.ok) {
        setError(json?.error?.message ?? "Archivieren fehlgeschlagen.");
        return;
      }
      setBundles((prev) =>
        prev.map((b) => (b.id === id ? { ...b, status: "expired" as const } : b))
      );
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unbekannter Fehler");
    }
  }

  return (
    <div style={{ margin: "0 0 16px", border: "1px solid #e5e7eb", borderRadius: 10, padding: 12 }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          fontSize: 13,
          fontWeight: 600,
          background: "none",
          border: "none",
          color: "#111",
          cursor: "pointer",
          padding: 0,
          textAlign: "left",
          width: "100%",
        }}
      >
        {open ? "▾" : "▸"} 🎁 Bundle-Angebot{" "}
        {bundles.length > 0 && (
          <span style={{ color: "#888", fontWeight: 400 }}>· {bundles.length} vorhanden</span>
        )}
      </button>

      {open && (
        <div style={{ marginTop: 10 }}>
          {/* Composer */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
            <button onClick={onSuggest} disabled={busy !== null} style={primaryBtn(busy !== null)}>
              {busy === "suggest" ? "Schlage vor…" : "✦ Bundle vorschlagen"}
            </button>
            <span style={{ fontSize: 11, color: "#999", alignSelf: "center" }}>
              KI-Durchlauf über Profil, Gespräche &amp; Käufe — kostet Tokens.
            </span>
          </div>

          {/* Editable composition */}
          {components.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
              {components.map((c) => (
                <div
                  key={c.productId}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    background: "#fafafa",
                    borderRadius: 8,
                    padding: "6px 10px",
                  }}
                >
                  {c.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={c.imageUrl}
                      alt={c.title}
                      width={36}
                      height={36}
                      style={{ width: 36, height: 36, objectFit: "cover", borderRadius: 6 }}
                    />
                  ) : (
                    <div style={{ width: 36, height: 36, background: "#eee", borderRadius: 6 }} />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{c.title}</div>
                    <div style={{ fontSize: 12, color: "#888" }}>
                      {fmtMoney(c.unitPrice, c.currency)}
                      {c.rationale ? ` · ${c.rationale}` : ""}
                    </div>
                  </div>
                  <button
                    onClick={() => removeProduct(c.productId)}
                    title="Entfernen"
                    style={{ ...secondaryBtn(false), padding: "4px 8px", fontSize: 12 }}
                  >
                    ✕
                  </button>
                </div>
              ))}
              <div style={{ fontSize: 13, color: "#444", textAlign: "right" }}>
                Komponentensumme: <strong>{fmtMoney(componentSum)}</strong>
              </div>
            </div>
          )}

          {/* Add product by name search */}
          <div style={{ marginBottom: 10 }}>
            <div style={{ display: "flex", gap: 6 }}>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    onSearch();
                  }
                }}
                placeholder="Produkt suchen (Name)…"
                style={{
                  flex: 1,
                  boxSizing: "border-box",
                  padding: "7px 10px",
                  fontSize: 13,
                  border: "1px solid #ddd",
                  borderRadius: 8,
                }}
              />
              <button onClick={onSearch} disabled={busy !== null} style={secondaryBtn(busy !== null)}>
                {busy === "search" ? "Suche…" : "Suchen"}
              </button>
            </div>
            {results.length > 0 && (
              <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
                {results.map((r) => {
                  const added = components.some((c) => c.productId === r.productId);
                  return (
                    <div
                      key={r.productId}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        fontSize: 13,
                        padding: "4px 6px",
                        borderRadius: 6,
                        background: "#fff",
                        border: "1px solid #f0f0f0",
                      }}
                    >
                      <span style={{ flex: 1, minWidth: 0 }}>
                        {r.title}{" "}
                        <span style={{ color: "#888" }}>· {fmtMoney(r.unitPrice, r.currency)}</span>
                        {!r.inStock && (
                          <span style={{ color: "#991b1b" }}> · ausverkauft</span>
                        )}
                      </span>
                      <button
                        onClick={() => addProduct(r)}
                        disabled={added || !r.inStock}
                        style={{
                          ...secondaryBtn(added || !r.inStock),
                          padding: "3px 8px",
                          fontSize: 12,
                        }}
                        title={!r.inStock ? "Ausverkauft — nicht hinzufügbar" : undefined}
                      >
                        {added ? "✓ drin" : "+ hinzufügen"}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Price / title / expiry */}
          {components.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 10 }}>
              <div>
                <label style={{ display: "block", fontSize: 12, color: "#666", marginBottom: 4 }}>
                  Bundle-Preis (€)
                </label>
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step={0.01}
                  value={price}
                  onChange={(e) => {
                    setPrice(e.target.value);
                    setPriceEdited(true);
                  }}
                  style={{
                    width: 110,
                    boxSizing: "border-box",
                    padding: "7px 10px",
                    fontSize: 14,
                    border: `1px solid ${priceValid ? "#ddd" : "#fca5a5"}`,
                    borderRadius: 8,
                  }}
                />
              </div>
              <div style={{ flex: 1, minWidth: 160 }}>
                <label style={{ display: "block", fontSize: 12, color: "#666", marginBottom: 4 }}>
                  Titel
                </label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    padding: "7px 10px",
                    fontSize: 14,
                    border: "1px solid #ddd",
                    borderRadius: 8,
                  }}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 12, color: "#666", marginBottom: 4 }}>
                  Gültig (Tage)
                </label>
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  step={1}
                  value={expiryDays}
                  onChange={(e) => setExpiryDays(Math.max(1, Math.floor(e.target.valueAsNumber || DEFAULT_EXPIRY_DAYS)))}
                  style={{
                    width: 80,
                    boxSizing: "border-box",
                    padding: "7px 10px",
                    fontSize: 14,
                    border: "1px solid #ddd",
                    borderRadius: 8,
                  }}
                />
              </div>
            </div>
          )}

          {aboveSum && (
            <p style={{ fontSize: 12, color: "#92400e", margin: "0 0 10px" }}>
              ⚠ Preis über der Komponentensumme ({fmtMoney(componentSum)}) — es wird KEINE
              „statt“-Zeile angezeigt (das Bundle ist nicht günstiger als die Einzelprodukte).
            </p>
          )}

          {components.length > 0 && (
            <button
              onClick={onCreate}
              disabled={busy !== null || !countOk || !priceValid}
              style={primaryBtn(busy !== null || !countOk || !priceValid)}
            >
              {busy === "create" ? "Erstelle…" : "Bundle erstellen"}
            </button>
          )}

          {note && <p style={{ color: "#16a34a", fontSize: 12, margin: "8px 0 0" }}>{note}</p>}
          {error && <p style={{ color: "#b91c1c", fontSize: 12, margin: "8px 0 0" }}>{error}</p>}

          {/* Per-customer bundle list */}
          {bundles.length > 0 && (
            <div style={{ marginTop: 14, borderTop: "1px solid #f0f0f0", paddingTop: 10 }}>
              <div style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>
                Bundles für {customerEmail} ({bundles.length})
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {bundles.map((b) => (
                  <div
                    key={b.id}
                    style={{ background: "#fafafa", borderRadius: 8, padding: "8px 12px", fontSize: 13 }}
                  >
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <strong>{b.title ?? "Bundle"}</strong>
                      {bundleStatusBadge(b)}
                      {b.clicked && <span style={badge("#e0e7ff", "#3730a3")}>↗ Klick erfasst</span>}
                      <span style={{ color: "#666" }}>
                        {fmtMoney(b.bundlePrice, b.currency)}
                        {Number(b.bundlePrice) < Number(b.componentsSum)
                          ? ` (statt ${fmtMoney(b.componentsSum, b.currency)})`
                          : ""}
                      </span>
                    </div>
                    <div style={{ color: "#555", marginTop: 2 }}>
                      {b.components.map((c) => c.title).join(" + ")}
                    </div>
                    <div style={{ color: "#888", marginTop: 2, fontSize: 12 }}>
                      Erstellt {fmtDate(b.createdAt)}
                      {b.expiresAt ? ` · läuft ab ${fmtDate(b.expiresAt)}` : ""}
                    </div>
                    {b.status === "failed" && b.error && (
                      <div style={{ color: "#b91c1c", marginTop: 4, fontSize: 12 }}>{b.error}</div>
                    )}
                    {b.status === "active" && (
                      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 6, flexWrap: "wrap" }}>
                        {b.redirectUrl && (
                          <a
                            href={b.redirectUrl}
                            target="_blank"
                            rel="noreferrer"
                            style={{ fontSize: 12, color: "#2563eb" }}
                          >
                            Angebots-Link
                          </a>
                        )}
                        <button
                          onClick={() => onArchive(b.id)}
                          style={{ ...secondaryBtn(false), padding: "4px 10px", fontSize: 12 }}
                        >
                          Archivieren
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SessionRow({ session, index }: { session: CustomerSessionProps; index: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ background: "#fafafa", borderRadius: 8, padding: "8px 12px" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          fontSize: 13,
          background: "none",
          border: "none",
          color: "#111",
          cursor: "pointer",
          padding: 0,
          textAlign: "left",
          width: "100%",
        }}
      >
        {open ? "▾" : "▸"} <strong>Session {index + 1}</strong> · {fmtDate(session.createdAt)}
        {session.personaDisplay ? ` · ${session.personaDisplay}` : ""}
        <span style={{ color: "#888" }}> · {session.messageCount} Nachrichten</span>
      </button>
      {open && (
        <div
          style={{
            marginTop: 8,
            maxHeight: 240,
            overflowY: "auto",
            fontSize: 13,
            lineHeight: 1.5,
          }}
        >
          {session.transcript.length === 0 && (
            <em style={{ color: "#999" }}>Kein lesbares Transkript.</em>
          )}
          {session.transcript.map((m, i) => (
            <p key={i} style={{ margin: "0 0 8px" }}>
              <strong style={{ color: m.role === "user" ? "#111" : "#2563eb" }}>
                {m.role === "user" ? "Kunde" : "Berater"}:
              </strong>{" "}
              {m.content}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function badge(bg: string, fg: string): React.CSSProperties {
  return {
    fontSize: 12,
    fontWeight: 600,
    background: bg,
    color: fg,
    borderRadius: 999,
    padding: "4px 10px",
    whiteSpace: "nowrap",
    display: "inline-block",
  };
}

function primaryBtn(disabled: boolean): React.CSSProperties {
  return {
    fontSize: 13,
    fontWeight: 600,
    padding: "7px 14px",
    background: disabled ? "#9ca3af" : "#111",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    cursor: disabled ? "default" : "pointer",
  };
}

function secondaryBtn(disabled: boolean): React.CSSProperties {
  return {
    fontSize: 13,
    fontWeight: 600,
    padding: "7px 14px",
    background: "#fff",
    color: "#111",
    border: "1px solid #ddd",
    borderRadius: 8,
    cursor: disabled ? "default" : "pointer",
  };
}
