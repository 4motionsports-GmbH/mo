"use client";

// Per-contact card for the marketing dashboard. Shows the conversation
// transcript, persona, discussed products and the "chatted but not purchased"
// flag, and drives the marketing workflow:
//
//   Generate draft  → POST /api/admin/marketing/draft  (AI text + unique code + cart)
//   Edit + save     → POST /api/admin/marketing/update (admin edits the draft)
//   Approve & send  → POST /api/admin/marketing/send    (system sends via Resend)
//
// Sent items are clearly marked and become read-only. All gating is server-side
// (the proxy + the route handlers); this component is just the operator UI.

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

type PurchaseCheck =
  | { status: "purchased"; orderCount: number; latestOrderName: string | null }
  | { status: "no_purchase" }
  | { status: "unknown" };

interface MarketingSendRow {
  id: number;
  status: "draft" | "approved" | "sent";
  subject: string | null;
  draftedText: string | null;
  discountPercent: number;
  discountCode: string | null;
  discountExpiresAt: string | null;
  cartUrl: string | null;
  sentAt: string | null;
}

export interface MarketingTargetProps {
  captureId: number;
  email: string;
  confirmedAt: string | null;
  personaDisplay: string | null;
  products: Array<{ id: string; name: string }>;
  transcript: TranscriptMessage[];
  purchase: PurchaseCheck;
  latestSend: MarketingSendRow | null;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("de-DE");
}

export function CustomerCard({ target }: { target: MarketingTargetProps }) {
  const router = useRouter();
  const send = target.latestSend;
  const isSent = send?.status === "sent";
  const hasDraft = Boolean(send) && !isSent;

  const [showTranscript, setShowTranscript] = useState(false);
  const [subject, setSubject] = useState(send?.subject ?? "");
  const [body, setBody] = useState(send?.draftedText ?? "");
  // The selected discount depth. Defaults to the draft's stored depth, or "None"
  // (0) for a fresh card — applying a discount is always a deliberate choice.
  const [discountPercent, setDiscountPercent] = useState<number>(send?.discountPercent ?? 0);
  const [busy, setBusy] = useState<null | "draft" | "save" | "send">(null);
  const [error, setError] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);

  // When a draft exists but the admin changed the depth, the prose and the
  // (eventual) real code would disagree — force a re-generate before sending.
  const needsRegenerate = hasDraft && send != null && discountPercent !== send.discountPercent;

  async function call(path: string, payload: unknown): Promise<unknown> {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error((json as { error?: { message?: string } })?.error?.message ?? `Fehler (${res.status})`);
    }
    return json;
  }

  async function onGenerate() {
    setBusy("draft");
    setError(null);
    setSavedNote(null);
    try {
      const json = (await call("/api/admin/marketing/draft", {
        captureId: target.captureId,
        discountPercent,
        // Re-generate (overwrite) when a draft already exists — e.g. the depth
        // changed. A fresh card inserts a new draft.
        regenerate: hasDraft,
      })) as { send?: MarketingSendRow };
      if (json.send) {
        setSubject(json.send.subject ?? "");
        setBody(json.send.draftedText ?? "");
        setDiscountPercent(json.send.discountPercent ?? 0);
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
    setSavedNote(null);
    try {
      await call("/api/admin/marketing/update", { sendId: send.id, subject, body });
      setSavedNote("Entwurf gespeichert.");
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
      setError("Rabatt geändert — bitte zuerst neu generieren, damit Text und Code übereinstimmen.");
      return;
    }
    if (!confirm(`E-Mail an ${target.email} wirklich senden?`)) return;
    setBusy("send");
    setError(null);
    try {
      // Persist any unsaved edits first so the sent mail matches the textarea.
      await call("/api/admin/marketing/update", { sendId: send.id, subject, body });
      await call("/api/admin/marketing/send", { sendId: send.id });
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
          <div style={{ fontSize: 15, fontWeight: 600 }}>{target.email}</div>
          <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>
            DOI bestätigt: {fmtDate(target.confirmedAt)}
            {target.personaDisplay ? ` · Persona: ${target.personaDisplay}` : ""}
          </div>
        </div>
        <PurchaseBadge purchase={target.purchase} />
      </div>

      {/* Products */}
      {target.products.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>Besprochene Produkte</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {target.products.map((p) => (
              <span
                key={p.id}
                style={{
                  fontSize: 12,
                  background: "#f3f4f6",
                  borderRadius: 999,
                  padding: "3px 10px",
                }}
              >
                {p.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Transcript */}
      <div style={{ marginTop: 12 }}>
        <button
          onClick={() => setShowTranscript((v) => !v)}
          style={{
            fontSize: 12,
            background: "none",
            border: "none",
            color: "#2563eb",
            cursor: "pointer",
            padding: 0,
          }}
        >
          {showTranscript ? "▾ Transkript ausblenden" : `▸ Transkript anzeigen (${target.transcript.length})`}
        </button>
        {showTranscript && (
          <div
            style={{
              marginTop: 8,
              maxHeight: 240,
              overflowY: "auto",
              background: "#fafafa",
              borderRadius: 8,
              padding: 12,
              fontSize: 13,
              lineHeight: 1.5,
            }}
          >
            {target.transcript.length === 0 && (
              <em style={{ color: "#999" }}>Kein Transkript verknüpft (Session nicht gefunden).</em>
            )}
            {target.transcript.map((m, i) => (
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

      {/* Marketing workflow */}
      <div style={{ marginTop: 16, borderTop: "1px solid #f0f0f0", paddingTop: 14 }}>
        {isSent ? (
          <SentPanel send={send!} email={target.email} />
        ) : hasDraft ? (
          <DraftPanel
            subject={subject}
            body={body}
            setSubject={setSubject}
            setBody={setBody}
            busy={busy}
            discountPercent={discountPercent}
            setDiscountPercent={setDiscountPercent}
            needsRegenerate={needsRegenerate}
            onSave={onSave}
            onSend={onSend}
            onGenerate={onGenerate}
          />
        ) : (
          <div>
            <DiscountSelector
              value={discountPercent}
              onChange={setDiscountPercent}
              disabled={busy === "draft"}
            />
            <p style={{ fontSize: 12, color: "#666", margin: "8px 0 12px" }}>
              Rabatt vor dem Generieren wählen — der Text wird darum herum
              geschrieben. Bei einem Rabatt zeigt der Entwurf einen Platzhalter-Code
              (<code>MO-XXXX</code>); der echte, einmalige Code wird erst beim
              Versand erzeugt.
            </p>
            <button
              onClick={onGenerate}
              disabled={busy === "draft"}
              style={primaryBtn(busy === "draft")}
            >
              {busy === "draft" ? "Generiere Entwurf…" : "✦ Entwurf generieren"}
            </button>
          </div>
        )}

        {savedNote && <p style={{ color: "#16a34a", fontSize: 12, margin: "8px 0 0" }}>{savedNote}</p>}
        {error && <p style={{ color: "#b91c1c", fontSize: 12, margin: "8px 0 0" }}>{error}</p>}
      </div>
    </section>
  );
}

function PurchaseBadge({ purchase }: { purchase: PurchaseCheck }) {
  if (purchase.status === "no_purchase") {
    return (
      <span style={badge("#fef3c7", "#92400e")} title="Hat beraten, aber keinen Kauf im Zeitfenster">
        ★ Beraten, nicht gekauft
      </span>
    );
  }
  if (purchase.status === "purchased") {
    return (
      <span style={badge("#dcfce7", "#166534")} title={purchase.latestOrderName ?? undefined}>
        ✓ Hat gekauft
      </span>
    );
  }
  return <span style={badge("#f3f4f6", "#6b7280")}>Kaufstatus unbekannt</span>;
}

function SentPanel({ send, email }: { send: MarketingSendRow; email: string }) {
  return (
    <div>
      <span style={badge("#dcfce7", "#166534")}>✓ Gesendet am {fmtDate(send.sentAt)}</span>
      <div style={{ fontSize: 13, marginTop: 10 }}>
        <div style={{ color: "#666", fontSize: 12 }}>Betreff</div>
        <div style={{ fontWeight: 600 }}>{send.subject || "—"}</div>
        {send.discountPercent > 0 && (
          <div style={{ marginTop: 8, fontSize: 12, color: "#666" }}>
            Rabatt: {send.discountPercent} %
            {send.discountCode ? (
              <>
                {" "}
                · Code: <code>{send.discountCode}</code>
              </>
            ) : null}
            {send.discountExpiresAt ? ` (gültig bis ${fmtDate(send.discountExpiresAt)})` : ""}
          </div>
        )}
        <details style={{ marginTop: 8 }}>
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
        <p style={{ fontSize: 11, color: "#999", marginTop: 8 }}>
          Versendet über das System an {email} — Abmeldelink automatisch angehängt.
        </p>
      </div>
    </div>
  );
}

// Numeric discount input: a whole percent in [0, 50], DEFAULT 0. 0 = no code is
// minted and no discount block appears in the email; >0 mints the unique MS5-
// code at send time with this percentage. Bounds mirror the server
// (lib/discount-validation.mjs) and are clamped on change.
function DiscountSelector({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  disabled: boolean;
}) {
  return (
    <div>
      <label
        htmlFor="ms-discount-percent"
        style={{ display: "block", fontSize: 12, color: "#666", marginBottom: 6 }}
      >
        Persönlicher Rabatt (%)
      </label>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input
          id="ms-discount-percent"
          type="number"
          inputMode="numeric"
          min={DISCOUNT_PERCENT_MIN}
          max={DISCOUNT_PERCENT_MAX}
          step={1}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(clampDiscountPercent(e.target.valueAsNumber))}
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
          {value === 0
            ? "0 = kein Rabatt, kein Code"
            : `${DISCOUNT_PERCENT_MIN}–${DISCOUNT_PERCENT_MAX} %`}
        </span>
      </div>
    </div>
  );
}

function DraftPanel({
  subject,
  body,
  setSubject,
  setBody,
  busy,
  discountPercent,
  setDiscountPercent,
  needsRegenerate,
  onSave,
  onSend,
  onGenerate,
}: {
  subject: string;
  body: string;
  setSubject: (v: string) => void;
  setBody: (v: string) => void;
  busy: null | "draft" | "save" | "send";
  discountPercent: number;
  setDiscountPercent: (v: number) => void;
  needsRegenerate: boolean;
  onSave: () => void;
  onSend: () => void;
  onGenerate: () => void;
}) {
  return (
    <div>
      <span style={badge("#e0e7ff", "#3730a3")}>Entwurf — noch nicht gesendet</span>

      <div style={{ margin: "12px 0 4px" }}>
        <DiscountSelector
          value={discountPercent}
          onChange={setDiscountPercent}
          disabled={busy !== null}
        />
      </div>

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
          Rabatt geändert auf {discountPercent === 0 ? "Kein Rabatt" : `${discountPercent} %`} —
          der aktuelle Text passt nicht mehr.{" "}
          <button
            type="button"
            onClick={onGenerate}
            disabled={busy !== null}
            style={{
              ...secondaryBtn(busy !== null),
              padding: "4px 10px",
              fontSize: 12,
              marginLeft: 4,
            }}
          >
            {busy === "draft" ? "Generiere…" : "↻ Neu generieren"}
          </button>
        </div>
      ) : (
        <p style={{ fontSize: 12, color: "#666", margin: "8px 0 0" }}>
          {discountPercent > 0
            ? `Vorschau mit Platzhalter-Code MO-XXXX. Den Platzhalter im Text bitte nicht ändern — er wird beim Versand durch den echten, einmaligen ${discountPercent}%-Code ersetzt.`
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
        {discountPercent > 0
          ? `Beim Versand: einmaliger ${discountPercent}%-Code wird erzeugt`
          : "Beim Versand werden"}{" "}
        {discountPercent > 0
          ? "und automatisch als vorausgefüllter Warenkorb-Button & Abmeldelink angehängt."
          : "Warenkorb-Button & Abmeldelink automatisch angehängt."}
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
    padding: "9px 16px",
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
    padding: "9px 16px",
    background: "#fff",
    color: "#111",
    border: "1px solid #ddd",
    borderRadius: 8,
    cursor: disabled ? "default" : "pointer",
  };
}
