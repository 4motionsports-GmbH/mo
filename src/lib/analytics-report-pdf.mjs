// "Komplettanalyse" → single downloadable PDF. Renders the full assembled report
// as ONE flowed, paginated A4 document for the team to print / circulate. A
// decision report (sections v2) leads with the strategist's part — at a glance,
// decisions, revenue through Mo, bottlenecks, changes since the previous
// report, customers, campaigns, recommendations, experiments, risks and data
// caveats — followed by every business-snapshot figure; older reports (v1)
// keep their KPI / Kundenbasis / Kampagnen chapters. Both end with the analysis
// chapters (distributions, insights, personas, customer knowledge, appendix).
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
import { adminLinkFor, formatMetricDelta, formatMetricValue, flattenSnapshot, HEADLINE_METRICS } from "./business-snapshot-core.mjs";
import { EFFORT_LABELS, OWNER_LABELS, isDecisionReport } from "./analytics-report-synthesis-core.mjs";

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
    // Rule between heading and body: below the heading's descenders, above the
    // cap height of the first body line (y is that line's baseline).
    content += ruleOp(MARGIN_X, CONTENT_RIGHT_X, y + 13, 0.6, "0.8 0.8 0.8");
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

const SEGMENT_PDF_LABELS = {
  frisch: "Frisch gekauft",
  ausbauen_frueh: "Ausbauen — früh",
  ausbauen: "Ausbauen",
  weiterentwickeln: "Weiterentwickeln",
  zurueckholen: "Zurückholen",
  ruhen: "Ruhen lassen",
  keine_bestellung: "Ohne Bestellung",
  unbekannt: "Unbekannt",
};

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

  if (isDecisionReport(s)) renderDecisionReport(flow, s);
  else renderLegacyKpis(flow, s);
  renderFoundations(flow, s);

  return flow.finish();
}

// ── The decision report (sections v2) ─────────────────────────────────────────

const PDF_REPLACEMENTS = [
  [/→/g, "->"],
  [/←/g, "<-"],
  [/≥/g, ">="],
  [/≤/g, "<="],
  [/≈/g, "~"],
  [/−/g, "-"],
  [/ /g, " "],
];

/** Typographic symbols the base-14 fonts lack → ASCII stand-ins. */
function pdfText(v) {
  let out = String(v ?? "");
  for (const [re, to] of PDF_REPLACEMENTS) out = out.replace(re, to);
  return out;
}

const LEVEL = { hoch: "hoch", mittel: "mittel", niedrig: "niedrig" };
const DIRECTION = { besser: "besser", schlechter: "schlechter", gleich: "unverändert", unklar: "unklar" };

function metricLine(m, previousWord = "Vorperiode") {
  const value = formatMetricValue(m.unit, m.value);
  if (m.previous === null || m.previous === undefined) return `${m.label}: ${value} (Stand heute)`;
  const d = formatMetricDelta(m);
  return `${m.label}: ${value}  (${previousWord} ${formatMetricValue(m.unit, m.previous)}${d ? `, ${d}` : ""})`;
}

function linkText(target, range) {
  const link = adminLinkFor(target, range);
  return link ? `Im Admin: ${link.label}` : null;
}

function renderTableLines(flow, t) {
  if (!t || !Array.isArray(t.rows) || t.rows.length === 0) return;
  flow.line(pdfText(t.title), { font: "F2", size: 10, leading: 14 });
  const single = t.columns.length === 1;
  for (const row of t.rows) {
    const cells = t.columns.map((c) => {
      const v = formatMetricValue(c.unit, row.values?.[c.key]);
      const p = row.previous ? row.previous[c.key] : undefined;
      const head = single ? v : `${c.label} ${v}`;
      return p !== undefined && p !== null ? `${head} (VP ${formatMetricValue(c.unit, p)})` : head;
    });
    flow.bullet(pdfText(`${row.label}: ${cells.join(" · ")}`), { size: 9, leading: 12.5 });
  }
  flow.gap(0.3);
}

function renderDecisionReport(flow, s) {
  const d = s.decision ?? {};
  const snap = s.snapshot ?? null;
  const range = snap?.period ? { from: snap.period.from, to: snap.period.to } : null;
  const flat = snap ? flattenSnapshot(snap) : {};
  const muted = { color: MUTED_RGB, size: 9, leading: 13, maxChars: 104 };
  const small = { size: 9.5, leading: 13, maxChars: 100 };
  const bold = { font: "F2", size: 10.5, leading: 14, maxChars: 86 };

  // ── Auf einen Blick ──
  flow.sectionHeading("Auf einen Blick");
  if (snap?.period) {
    flow.line(pdfText(`Zeitraum ${snap.period.label} · verglichen mit ${snap.previous?.label ?? "—"}`), muted);
  }
  if (d.headline) {
    flow.gap(0.2);
    flow.paragraph(pdfText(d.headline), { font: "F2", size: 11.5, leading: 15.5, maxChars: 84 });
  }
  if (d.summary) {
    flow.gap(0.2);
    flow.paragraph(pdfText(d.summary));
  }
  if (!d.headline && !d.summary) {
    flow.paragraph("Keine Synthese verfügbar — die Kennzahlen unten sind vollständig.", { color: MUTED_RGB });
  }
  for (const n of Array.isArray(d.notes) ? d.notes : []) {
    flow.paragraph(pdfText(`Hinweis: ${n}`), { color: MUTED_RGB, size: 8.5, leading: 12, maxChars: 110 });
  }
  const headline = HEADLINE_METRICS.map((k) => flat[k]).filter(Boolean);
  if (headline.length) {
    flow.gap(0.4);
    for (const m of headline) flow.bullet(pdfText(metricLine(m)), small);
  }
  flow.gap();

  // ── Jetzt entscheiden ──
  flow.sectionHeading("Jetzt entscheiden");
  const decisions = Array.isArray(d.decisions) ? d.decisions : [];
  if (decisions.length === 0) flow.paragraph("Keine Entscheidungen in diesem Bericht.", { color: MUTED_RGB });
  decisions.forEach((x, i) => {
    flow.paragraph(pdfText(`${i + 1}. ${x.title}`), bold);
    if (x.rationale) flow.paragraph(pdfText(x.rationale), small);
    const meta = [
      `Verantwortlich: ${OWNER_LABELS[x.owner] ?? x.owner}`,
      `Wirkung ${LEVEL[x.impact] ?? x.impact}`,
      `Konfidenz ${LEVEL[x.confidence] ?? x.confidence}`,
      linkText(x.link, range),
    ].filter(Boolean);
    flow.paragraph(pdfText(meta.join(" · ")), muted);
    if (x.metric) flow.paragraph(pdfText(`Erfolg: ${x.metric}`), muted);
    flow.gap(0.4);
  });
  flow.gap(0.4);

  // ── Umsatz über Mo ──
  flow.sectionHeading("Umsatz über Mo");
  if (d.revenue?.summary) flow.paragraph(pdfText(d.revenue.summary));
  for (const dr of d.revenue?.drivers ?? []) flow.bullet(pdfText(`${dr.title}: ${dr.detail}`), small);
  const revenue = (snap?.sections ?? []).find((x) => x.key === "revenue");
  if (revenue) {
    flow.gap(0.3);
    for (const t of revenue.tables ?? []) renderTableLines(flow, t);
  }
  flow.gap();

  // ── Engpässe ──
  flow.sectionHeading("Engpässe im Funnel");
  for (const b of d.bottlenecks ?? []) {
    flow.paragraph(pdfText(b.stage), bold);
    if (b.finding) flow.paragraph(pdfText(b.finding), small);
    flow.paragraph(pdfText([b.evidence, `Wirkung ${LEVEL[b.impact] ?? b.impact}`, linkText(b.link, range)].filter(Boolean).join(" · ")), muted);
    flow.gap(0.3);
  }
  for (const f of snap?.funnels ?? []) {
    const steps = f.steps
      .map((st) => `${st.label} ${formatMetricValue("count", st.value)} (VP ${formatMetricValue("count", st.previous)})`)
      .join(" -> ");
    flow.bullet(pdfText(`${f.title}: ${steps}`), { size: 9, leading: 12.5 });
  }
  flow.gap();

  // ── Seit dem letzten Bericht ──
  flow.sectionHeading("Seit dem letzten Bericht");
  const c = s.comparison ?? null;
  if (c) {
    flow.paragraph(
      pdfText(`Verglichen mit „${c.title || `Bericht #${c.previousReportId}`}“ (${fmtDate(c.from)} – ${fmtDate(c.to)})${c.perDay ? " · Mengen je Tag" : ""}`),
      muted
    );
  }
  if (d.changes?.summary) flow.paragraph(pdfText(d.changes.summary));
  for (const it of d.changes?.items ?? []) {
    flow.bullet(pdfText(`${it.title} (${DIRECTION[it.direction] ?? it.direction}): ${it.detail}`), small);
  }
  if (c && c.metrics.length) {
    flow.gap(0.3);
    for (const m of c.metrics) {
      flow.bullet(pdfText(metricLine({ label: m.label, unit: m.unit, value: m.now, previous: m.then, good: m.good }, "damals")), {
        size: 9,
        leading: 12.5,
      });
    }
  }
  if (!c && !d.changes?.summary) flow.paragraph("Kein früherer Bericht gespeichert.", { color: MUTED_RGB });
  flow.gap();

  // ── Kunden & Segmente ──
  flow.sectionHeading("Kunden & Segmente");
  for (const seg of d.segments ?? []) {
    flow.paragraph(pdfText(seg.segment), bold);
    if (seg.insight) flow.paragraph(pdfText(seg.insight), small);
    if (seg.action) flow.paragraph(pdfText(`Folgerung: ${seg.action}`), muted);
    flow.gap(0.3);
  }
  const customers = (snap?.sections ?? []).find((x) => x.key === "customers");
  const segTable = customers?.tables?.find((t) => t.key === "customers.segments");
  if (segTable) renderTableLines(flow, segTable);
  flow.gap();

  // ── Kampagnen ──
  flow.sectionHeading("Kampagnen");
  if (d.campaigns?.summary) flow.paragraph(pdfText(d.campaigns.summary));
  for (const it of d.campaigns?.items ?? []) flow.bullet(pdfText(`${it.campaign}: ${it.insight} Folgerung: ${it.action}`), small);
  const campaigns = (snap?.sections ?? []).find((x) => x.key === "campaigns");
  const campTable = campaigns?.tables?.find((t) => t.key === "campaigns.byCampaign");
  if (campTable) {
    flow.gap(0.3);
    renderTableLines(flow, campTable);
  }
  flow.gap();

  // ── Maßnahmen ──
  flow.sectionHeading("Maßnahmen nach Priorität");
  const recs = Array.isArray(d.recommendations) ? d.recommendations : [];
  if (recs.length === 0) flow.paragraph("Keine Maßnahmen in diesem Bericht.", { color: MUTED_RGB });
  recs.forEach((r, i) => {
    flow.paragraph(pdfText(`#${i + 1} ${r.title}`), bold);
    flow.line(
      pdfText(
        [
          `Wirkung ${LEVEL[r.impact] ?? r.impact}`,
          `Aufwand ${EFFORT_LABELS[r.effort] ?? r.effort}`,
          `Konfidenz ${LEVEL[r.confidence] ?? r.confidence}`,
          `Verantwortlich: ${OWNER_LABELS[r.owner] ?? r.owner}`,
        ].join(" · ")
      ),
      muted
    );
    if (r.why) flow.paragraph(pdfText(`Warum: ${r.why}`), small);
    if (r.action) flow.paragraph(pdfText(`Erste Schritte: ${r.action}`), small);
    if (r.expectedImpact) flow.paragraph(pdfText(`Erwartete Wirkung: ${r.expectedImpact}`), small);
    if (r.successMetric) flow.paragraph(pdfText(`Erfolgsmessung: ${r.successMetric}`), small);
    const l = linkText(r.link, range);
    if (l) flow.line(pdfText(l), muted);
    flow.gap(0.4);
  });
  flow.gap(0.4);

  // ── Experimente ──
  flow.sectionHeading("Experimente");
  const experiments = Array.isArray(d.experiments) ? d.experiments : [];
  if (experiments.length === 0) flow.paragraph("Keine Experimente vorgeschlagen.", { color: MUTED_RGB });
  for (const e of experiments) {
    flow.paragraph(pdfText(e.title), bold);
    for (const [label, v] of [
      ["Hypothese", e.hypothesis],
      ["Aufbau", e.design],
      ["Kennzahl", e.metric],
      ["Laufzeit", e.duration],
      ["Erfolg, wenn", e.successCriterion],
    ]) {
      if (v) flow.paragraph(pdfText(`${label}: ${v}`), small);
    }
    flow.line(pdfText(`Verantwortlich: ${OWNER_LABELS[e.owner] ?? e.owner}`), muted);
    flow.gap(0.4);
  }
  flow.gap(0.4);

  // ── Risiken & Datenqualität ──
  flow.sectionHeading("Risiken & Datenqualität");
  for (const r of d.risks ?? []) {
    flow.paragraph(pdfText(`${r.title} (Schwere ${LEVEL[r.severity] ?? r.severity})`), bold);
    if (r.detail) flow.paragraph(pdfText(r.detail), small);
    if (r.mitigation) flow.paragraph(pdfText(`Gegenmaßnahme: ${r.mitigation}`), muted);
    flow.gap(0.3);
  }
  const caveats = [...(snap?.caveats ?? []), ...(d.dataQuality ?? [])];
  if (caveats.length) {
    flow.subHeading("Messhinweise");
    for (const cv of caveats) flow.bullet(pdfText(`${cv.title}: ${cv.detail}`), { size: 9, leading: 12.5 });
  }
  if ((snap?.switches ?? []).length) {
    flow.gap(0.3);
    flow.line("Schalter (Stand heute):", { font: "F2", size: 9.5, leading: 13 });
    flow.paragraph(
      pdfText(snap.switches.map((x) => `${x.label}: ${typeof x.value === "number" ? x.value : x.value ? "an" : "aus"}`).join(" · ")),
      { size: 9, leading: 12.5 }
    );
  }
  flow.gap();

  // ── Alle Kennzahlen ──
  if (snap) {
    flow.sectionHeading("Alle Kennzahlen");
    flow.line("Jede Kennzahl mit Vorperiode und Veränderung; VP = Vorperiode.", muted);
    for (const sec of snap.sections ?? []) {
      flow.subHeading(pdfText(sec.title));
      for (const m of sec.metrics ?? []) {
        if (m.value === null && m.previous === null) continue;
        flow.bullet(pdfText(metricLine(m)), { size: 9, leading: 12.5 });
      }
      for (const t of sec.tables ?? []) {
        if (t.key === "revenue.tiers") continue;
        renderTableLines(flow, t);
      }
    }
    flow.gap();
  }
}

function renderLegacyKpis(flow, s) {
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

  // ── Kundenbasis (since the customer platform; older reports have none) ──
  const cb = s.customerBase;
  if (cb) {
    flow.sectionHeading("Kundenbasis");
    for (const [label, value] of [
      ["Kunden gesamt", cb.total],
      ["davon Shopify-Kunden", cb.shopifyCustomers],
      ["Mit Mo gesprochen", cb.withMo],
      ["Mit Einwilligung in E-Mail-Werbung", cb.subscribed],
      ["Neu angemeldet im Zeitraum", cb.newSubscribers],
    ]) {
      flow.line(`${label}:  ${value ?? 0}`);
    }
    if (Array.isArray(cb.bySegment) && cb.bySegment.length) {
      flow.gap(0.4);
      flow.subHeading("Lebenszyklus");
      renderDistribution(flow, cb.bySegment.map((r) => ({ label: SEGMENT_PDF_LABELS[r.key] ?? r.key, count: r.n })));
    }
    flow.gap();
  }

  // ── Kampagnen ──
  const campaigns = Array.isArray(s.campaigns) ? s.campaigns : [];
  if (campaigns.length) {
    flow.sectionHeading("Kampagnen");
    for (const c of campaigns) {
      flow.line(c.name, { font: "F2", size: 10.5, leading: 14 });
      flow.line(
        `Gesendet ${c.sent} · geklickt ${c.clicked} · Chat gestartet ${c.chatStarted} · abgemeldet ${c.unsubscribed}`,
        { color: MUTED_RGB, size: 9, leading: 13 }
      );
    }
    flow.gap();
  }

}

function renderFoundations(flow, s) {
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
