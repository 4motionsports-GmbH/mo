"use client";

// Client island for the on-demand "Top-Fragen pro Persona" insight. The cached
// summary (if any) is rendered immediately from the server; the button runs the
// token-costing Anthropic pass via POST /api/admin/kpi/top-questions and swaps in
// the fresh result. The token cost is stated up front so it's never a surprise.

import { useState } from "react";

interface Summary {
  personaLabel: string;
  summaryMd: string;
  sampleSize: number;
  model: string | null;
  generatedAt: string;
  cached: boolean;
}

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString("de-DE", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

// Minimal markdown-ish renderer: '- ' lines become bullets, '_…_' become italic.
function renderSummary(md: string): React.ReactNode {
  const lines = md.split("\n").map((l) => l.trim()).filter(Boolean);
  const bullets = lines.filter((l) => l.startsWith("- ") || l.startsWith("* "));
  if (bullets.length > 0) {
    return (
      <ul style={{ margin: "8px 0 0", paddingLeft: 20 }}>
        {bullets.map((l, i) => (
          <li key={i} style={{ fontSize: 13, lineHeight: 1.5, marginBottom: 4 }}>
            {l.replace(/^[-*]\s+/, "")}
          </li>
        ))}
      </ul>
    );
  }
  return lines.map((l, i) => (
    <p key={i} style={{ fontSize: 13, color: "#555", margin: "8px 0 0", fontStyle: l.startsWith("_") ? "italic" : "normal" }}>
      {l.replace(/^_|_$/g, "")}
    </p>
  ));
}

export function KpiTopQuestions({
  personaLabel,
  initial,
}: {
  personaLabel: string;
  initial: Summary | null;
}) {
  const [summary, setSummary] = useState<Summary | null>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(force: boolean) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/kpi/top-questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personaLabel, force }),
      });
      const data = (await res.json()) as { summary?: Summary; error?: { message?: string } };
      if (!res.ok || !data.summary) {
        setError(data.error?.message ?? "Fehler beim Erstellen der Zusammenfassung.");
        return;
      }
      setSummary(data.summary);
    } catch {
      setError("Netzwerkfehler — bitte erneut versuchen.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ marginTop: 12, borderTop: "1px dashed #e5e5e5", paddingTop: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <strong style={{ fontSize: 13 }}>Top-Fragen dieser Gruppe</strong>
        <button
          type="button"
          onClick={() => run(summary != null)}
          disabled={loading}
          style={{
            fontSize: 12,
            padding: "5px 10px",
            border: "1px solid #ddd",
            background: loading ? "#f3f3f3" : "#fff",
            borderRadius: 8,
            cursor: loading ? "default" : "pointer",
          }}
        >
          {loading
            ? "Wird erstellt…"
            : summary
              ? "Neu generieren"
              : "Top-Fragen generieren"}
        </button>
      </div>

      <p style={{ fontSize: 11, color: "#999", margin: "6px 0 0" }}>
        ⚠️ On-Demand-KI-Analyse von bis zu 80 echten Nutzernachrichten — kostet
        Anthropic-Tokens (wenige Cent pro Lauf). Ergebnis wird zwischengespeichert.
      </p>

      {error && (
        <p style={{ fontSize: 12, color: "#b91c1c", margin: "8px 0 0" }}>{error}</p>
      )}

      {summary && (
        <div>
          {renderSummary(summary.summaryMd)}
          <p style={{ fontSize: 11, color: "#aaa", margin: "8px 0 0" }}>
            Stichprobe: {summary.sampleSize} Nachrichten ·{" "}
            {summary.cached ? "zwischengespeichert" : "frisch generiert"} ·{" "}
            {formatTimestamp(summary.generatedAt)}
            {summary.model ? ` · ${summary.model}` : ""}
          </p>
        </div>
      )}
    </div>
  );
}
