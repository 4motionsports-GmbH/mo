// "Komplettanalyse" → single downloadable PDF. Renders the full assembled report
// (KPIs, spend, category/quality distributions, the aggregate insights narrative,
// the persona breakdown with top-questions, the aggregate + per-customer customer
// knowledge, and the per-conversation appendix) as ONE flowed, paginated A4
// document for the team to print / circulate.
//
// Dependency-free (shared lib/pdf-core, same stack as the physical-letter and the
// signed-in summary PDFs): no headless browser / PDF dependency on Vercel. Pure +
// INJECTED inputs (the stored `sections` payload) → deterministic + unit-testable.

import {
  PAGE_W,
  PAGE_H,
  MARGIN_X,
  ACCENT_RGB,
  MUTED_RGB,
  wrapText,
  textOp,
  ruleOp,
  brandHeaderOps,
  footerOp,
  assemblePdf,
} from "./pdf-core.mjs";

const CONTENT_TOP_Y = PAGE_H - 120; // below the letterhead
const CONTENT_BOTTOM_Y = 56; // above the footer
const CONTENT_RIGHT_X = PAGE_W - MARGIN_X;
const BODY_FONT = 10.5;
const BODY_LEADING = 14;
// Helvetica 10.5pt over the ~481pt frame ⇒ ~92 chars.
const BODY_MAX_CHARS = 92;

// ── Inline markdown → plain text ──────────────────────────────────────────────
// The AI narratives are markdown. The base-14 PDF fonts can't do inline bold, so
// we flatten emphasis/code/link markup to readable plain text before wrapping.

function stripInline(s) {
  return String(s)
    .replace(/`([^`]+)`/g, "$1") // inline code
    .replace(/\*\*([^*]+)\*\*/g, "$1") // bold **x**
    .replace(/__([^_]+)__/g, "$1") // bold __x__
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1$2") // italic *x*
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, "$1 ($2)") // [text](url) → text (url)
    .trim();
}

// ── Block markdown → typed blocks ─────────────────────────────────────────────

/** Parse a small markdown subset into typed blocks for the flow renderer. */
function mdToBlocks(md) {
  const blocks = [];
  const lines = String(md ?? "").replace(/\r\n/g, "\n").split("\n");
  let para = [];
  const flushPara = () => {
    if (para.length) {
      blocks.push({ type: "para", text: stripInline(para.join(" ")) });
      para = [];
    }
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flushPara();
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) {
      flushPara();
      blocks.push({ type: "rule" });
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      flushPara();
      blocks.push({ type: "heading", level: h[1].length, text: stripInline(h[2]) });
      continue;
    }
    const b = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (b) {
      flushPara();
      blocks.push({ type: "bullet", text: stripInline(b[1]) });
      continue;
    }
    const o = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (o) {
      flushPara();
      blocks.push({ type: "bullet", text: stripInline(o[1]) });
      continue;
    }
    para.push(line);
  }
  flushPara();
  return blocks;
}

// ── Flow layout (top-to-bottom, paginated) ────────────────────────────────────

function makeFlow() {
  const pages = [];
  let content = brandHeaderOps();
  let y = CONTENT_TOP_Y;

  const newPage = () => {
    pages.push(content);
    content = "";
    y = PAGE_H - 70; // continuation pages: full height, no letterhead
  };

  const ensure = (need) => {
    if (y - need < CONTENT_BOTTOM_Y) newPage();
  };

  /** One already-short line at the current y. */
  const line = (text, { font = "F1", size = BODY_FONT, leading = BODY_LEADING, color, indent = 0 } = {}) => {
    ensure(leading);
    if (text !== "") content += textOp(font, MARGIN_X + indent, y, size, text, color);
    y -= leading;
  };

  /** Wrapped paragraph text. */
  const paragraph = (text, opts = {}) => {
    const max = opts.maxChars ?? BODY_MAX_CHARS;
    for (const l of wrapText(text, max)) line(l, opts);
  };

  /** A wrapped bullet: hanging indent so continuation lines align under the text. */
  const bullet = (text, opts = {}) => {
    const max = (opts.maxChars ?? BODY_MAX_CHARS) - 3;
    const wrapped = wrapText(text, max);
    wrapped.forEach((l, i) => {
      line((i === 0 ? "•  " : "   ") + l, { ...opts, indent: 0 });
    });
  };

  const gap = (n = 1) => {
    y -= BODY_LEADING * n;
  };

  /** Section heading: keep it with at least a couple of following lines. */
  const sectionHeading = (text) => {
    ensure(BODY_LEADING * 3);
    y -= 4;
    content += textOp("F2", MARGIN_X, y, 14, text, ACCENT_RGB);
    y -= 20;
    content += ruleOp(MARGIN_X, CONTENT_RIGHT_X, y + 6, 0.6, "0.8 0.8 0.8");
  };

  const subHeading = (text) => {
    ensure(BODY_LEADING * 2);
    gap(0.3);
    line(text, { font: "F2", size: 11.5, leading: 16 });
  };

  /** Render a markdown string as flowed blocks. */
  const markdown = (md) => {
    for (const blk of mdToBlocks(md)) {
      if (blk.type === "rule") {
        ensure(10);
        y -= 4;
        content += ruleOp(MARGIN_X, CONTENT_RIGHT_X, y, 0.5, "0.85 0.85 0.85");
        y -= 8;
      } else if (blk.type === "heading") {
        if (blk.level <= 2) subHeading(blk.text);
        else line(blk.text, { font: "F2", size: 10.5, leading: 15 });
      } else if (blk.type === "bullet") {
        bullet(blk.text);
      } else {
        paragraph(blk.text);
      }
    }
  };

  const finish = () => {
    pages.push(content);
    return assemblePdf(pages.map((p) => p + footerOp()));
  };

  return { line, paragraph, bullet, gap, sectionHeading, subHeading, markdown, finish };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString("de-DE", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function fmtTs(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" });
}

function eur(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return `${v.toFixed(v < 1 ? 4 : 2)} €`;
}

const TIER_LABELS = { anonymous: "Anonym", emailOnly: "E-Mail", signedIn: "Angemeldet" };

// ── Builder ───────────────────────────────────────────────────────────────────

/**
 * Build the full report PDF.
 * @param {{
 *   title: string,
 *   label?: string,
 *   from: string,
 *   to: string,
 *   generatedAt?: string,
 *   costEur?: number,
 *   sections: object,
 * }} input
 * @returns {Buffer}
 */
export function buildAnalyticsReportPdf(input) {
  const flow = makeFlow();
  const s = input.sections || {};

  // ── Title block ──
  flow.line("Komplettanalyse", { font: "F2", size: 19, leading: 24, color: ACCENT_RGB });
  flow.line(input.label || `${fmtDate(input.from)} – ${fmtDate(input.to)}`, {
    font: "F2",
    size: 12,
    leading: 17,
  });
  const metaBits = [
    `Erstellt: ${fmtTs(input.generatedAt)}`,
    input.costEur != null ? `KI-Kosten: ~${eur(input.costEur)}` : null,
  ].filter(Boolean);
  flow.line(metaBits.join("   ·   "), { color: MUTED_RGB, size: 9, leading: 14 });

  if (Array.isArray(s.notes) && s.notes.length) {
    flow.gap(0.3);
    for (const note of s.notes) flow.line(`Hinweis: ${note}`, { color: MUTED_RGB, size: 8.5, leading: 12 });
  }
  flow.gap();

  // ── Kennzahlen ──
  const k = s.kpis || {};
  const tiers = k.tiers || {};
  flow.sectionHeading("Kennzahlen");
  const kpiRows = [
    ["Gespräche im Zeitraum", String(k.conversations ?? 0)],
    ["davon analysiert", String(k.analyzed ?? 0)],
    [`Tier · ${TIER_LABELS.anonymous}`, String(tiers.anonymous ?? 0)],
    [`Tier · ${TIER_LABELS.emailOnly}`, String(tiers.emailOnly ?? 0)],
    [`Tier · ${TIER_LABELS.signedIn}`, String(tiers.signedIn ?? 0)],
    ["Ohne Bot-Antwort (Fehler-Proxy)", String(k.withError ?? 0)],
    ["E-Mail erfasst", String(k.emailCaptured ?? 0)],
    ["Warenkorb/Checkout genutzt", String(k.cartUsed ?? 0)],
    ["Produkt(e) empfohlen", String(k.checkoutOffered ?? 0)],
  ];
  for (const [label, value] of kpiRows) {
    flow.line(`${label}:  ${value}`);
  }
  const spend = s.spend || {};
  flow.gap(0.4);
  flow.line(`KI-Ausgaben im Zeitraum (alle Aufrufe): ~${eur(spend.totalEur ?? 0)}`, {
    font: "F2",
    size: 10.5,
    leading: 15,
  });
  flow.gap();

  // ── Verteilung ──
  flow.sectionHeading("Verteilung der Gespräche");
  flow.subHeading("Kategorien");
  renderDistribution(flow, s.categories);
  flow.gap(0.4);
  flow.subHeading("Qualitätssignale");
  renderDistribution(flow, s.qualities);
  flow.gap();

  // ── Insights ──
  flow.sectionHeading("Aggregierte Insights");
  if (s.insightsMd) flow.markdown(s.insightsMd);
  else flow.paragraph("Keine Insights verfügbar.", { color: MUTED_RGB });
  flow.gap();

  // ── Personas ──
  flow.sectionHeading("Personas");
  const personas = Array.isArray(s.personas) ? s.personas : [];
  if (personas.length === 0) {
    flow.paragraph("Keine Persona-Daten im Zeitraum.", { color: MUTED_RGB });
  } else {
    for (const p of personas) {
      flow.subHeading(`${p.personaDisplay} — ${p.chatCount} Gespräch(e)`);
      const favs = Array.isArray(p.favoriteProducts) ? p.favoriteProducts : [];
      if (favs.length) {
        flow.line("Häufig empfohlen:", { color: MUTED_RGB, size: 9, leading: 13 });
        for (const f of favs) flow.bullet(`${f.name} (${f.count}×)`, { size: 9.5, leading: 13 });
      }
      if (p.topQuestionsMd) {
        flow.line("Top-Fragen & Themen:", { color: MUTED_RGB, size: 9, leading: 13 });
        flow.markdown(p.topQuestionsMd);
      }
      flow.gap(0.4);
    }
  }
  flow.gap(0.3);

  // ── Kundenwissen ──
  flow.sectionHeading("Kundenwissen");
  if (s.customerKnowledgeMd) flow.markdown(s.customerKnowledgeMd);
  else flow.paragraph("Keine aggregierte Kundensynthese verfügbar.", { color: MUTED_RGB });

  const profiles = Array.isArray(s.profiles) ? s.profiles : [];
  if (profiles.length) {
    flow.gap(0.5);
    flow.subHeading(`Einzelne Kundenprofile (${profiles.length})`);
    flow.line(
      "Identitätsbezogen — nur intern für die Team-Entscheidung.",
      { color: MUTED_RGB, size: 8.5, leading: 12 }
    );
    flow.gap(0.3);
    for (const pr of profiles) {
      const meta = [
        pr.sessionCount != null ? `${pr.sessionCount} Session(s)` : null,
        pr.lastSeenAt ? `zuletzt ${fmtDate(pr.lastSeenAt)}` : null,
      ]
        .filter(Boolean)
        .join(" · ");
      flow.line(pr.name || "Unbekannter Kunde", { font: "F2", size: 10.5, leading: 14 });
      if (meta) flow.line(meta, { color: MUTED_RGB, size: 8.5, leading: 12 });
      if (pr.profileSummary) flow.markdown(pr.profileSummary);
      flow.gap(0.4);
    }
  }
  flow.gap(0.3);

  // ── Appendix ──
  const appendix = Array.isArray(s.appendix) ? s.appendix : [];
  if (appendix.length) {
    flow.sectionHeading(`Anhang · Gespräche (${appendix.length})`);
    flow.line(
      "Pro Gespräch: Datum · Tier · Persona · Kategorie · Qualität — Zusammenfassung.",
      { color: MUTED_RGB, size: 8.5, leading: 12 }
    );
    flow.gap(0.3);
    appendix.forEach((a, i) => {
      const head = [
        fmtDate(a.createdAt),
        a.tier ? (TIER_LABELS[a.tier] ?? a.tier) : null,
        a.personaDisplay || null,
        a.category || null,
        a.quality || null,
      ]
        .filter(Boolean)
        .join(" · ");
      flow.line(`${i + 1}. ${head}`, { font: "F2", size: 9, leading: 13 });
      if (a.summary) flow.paragraph(a.summary, { size: 9.5, leading: 13 });
      flow.gap(0.2);
    });
  }

  return flow.finish();
}

function renderDistribution(flow, rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (list.length === 0) {
    flow.line("— keine Daten", { color: MUTED_RGB, size: 9.5, leading: 13 });
    return;
  }
  const total = list.reduce((sum, r) => sum + (Number(r.count) || 0), 0) || 1;
  for (const r of list) {
    const count = Number(r.count) || 0;
    const pct = Math.round((count / total) * 100);
    flow.line(`${r.label}:  ${count}  (${pct}%)`, { size: 9.5, leading: 13, indent: 6 });
  }
}

export { mdToBlocks, stripInline };
