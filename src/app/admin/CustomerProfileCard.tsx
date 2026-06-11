"use client";

// Per-CUSTOMER card for the admin dashboard's Kunden tab — grouped by person
// (email), not by session. Shows the session timeline (each transcript
// viewable), the cached Shopify purchase history, the persona(s), and the
// regenerated "current understanding" summary. Returning customers (more than
// one session) are clearly marked.
//
// Two on-demand actions (all gating server-side; this is just the operator UI):
//   Käufe aktualisieren            → POST /api/admin/customers/purchases
//   Kundenverständnis generieren   → POST /api/admin/customers/profile
//                                    (an Anthropic pass — costs tokens; the
//                                    response usage is shown after each run)

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

export interface CustomerProps {
  id: number;
  email: string;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  transactionalConsent: boolean;
  marketingStatus: "none" | "pending" | "confirmed" | "unsubscribed";
  profileSummary: string | null;
  profileSummaryUpdatedAt: string | null;
  purchaseSummary: OrderHistoryProps | null;
  purchaseSummaryUpdatedAt: string | null;
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

export function CustomerProfileCard({ customer }: { customer: CustomerProps }) {
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
    </section>
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
