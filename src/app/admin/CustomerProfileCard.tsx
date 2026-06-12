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

// The discount depths the admin may offer — mirrors ALLOWED_DISCOUNT_PERCENTS
// server-side and the Marketing tab's selector. None (0) is the default.
const DISCOUNT_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 0, label: "Kein Rabatt" },
  { value: 5, label: "5 %" },
  { value: 10, label: "10 %" },
  { value: 15, label: "15 %" },
];

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
        <label style={{ display: "block", fontSize: 12, color: "#666", marginBottom: 6 }}>
          Persönlicher Rabatt
        </label>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {DISCOUNT_OPTIONS.map((opt) => {
            const active = discountPercent === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setDiscountPercent(opt.value)}
                disabled={busy !== null}
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  padding: "7px 14px",
                  borderRadius: 999,
                  cursor: busy !== null ? "default" : "pointer",
                  border: active ? "1px solid #111" : "1px solid #ddd",
                  background: active ? "#111" : "#fff",
                  color: active ? "#fff" : "#555",
                }}
              >
                {opt.label}
              </button>
            );
          })}
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
