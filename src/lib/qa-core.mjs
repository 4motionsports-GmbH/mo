// Pure core for the "Wissen" (Q&A / knowledge enhancement) feature. No I/O,
// no DB, no model — imported by the draft pass (qa-draft.ts), the store
// (qa-store.ts), the Shopify publisher (shopify-qa.ts), the catalog mapper
// (catalog-mapping.ts) AND the node:test suite, so it stays a plain .mjs like
// conversation-analysis-core.mjs. Only pure-module imports (qa-links.mjs).
//
// It owns: the status vocabulary, the eligibility rule (which conversations
// the knowledge-gap scan looks at), the draft prompt + defensive JSON parser,
// the question fingerprint (de-dup), and the `custom.qa` metafield format
// (parse / merge) shared by the publisher and the catalog mapper.

import { qaAnswerHasLink, qaAnswerHtml } from "./qa-links.mjs";

// ── Statuses ─────────────────────────────────────────────────────────────────

export const QA_STATUSES = ["open", "answered", "published", "dismissed"];

export const QA_STATUS_LABELS = {
  open: "Offen",
  answered: "Beantwortet",
  published: "Veröffentlicht",
  dismissed: "Verworfen",
};

// ── Eligibility ──────────────────────────────────────────────────────────────
// A conversation is worth scanning for a knowledge gap when the cached analysis
// flagged an unmet need or a drop-off, OR when Mo handed over to a human (the
// show_contact_form tool fired) — the operator's "Mo konnte nicht helfen"
// signals. (There was no separate category for this before; these existing
// signals ARE the flag.)

export const QA_ELIGIBLE_QUALITIES = ["unmet_need", "dropped_off"];

/**
 * @param {{ quality?: string | null, contactFormShown?: boolean }} c
 * @returns {boolean}
 */
export function isEligibleForQaScan({ quality, contactFormShown }) {
  if (contactFormShown === true) return true;
  return typeof quality === "string" && QA_ELIGIBLE_QUALITIES.includes(quality);
}

// ── Draft prompt ─────────────────────────────────────────────────────────────

export const QA_DRAFT_SYSTEM_PROMPT =
  "Du bist Wissens-Redakteur bei motion sports (Fitness- und Kraftsportgeräte). " +
  "Du bekommst EIN Beratungsgespräch zwischen einem Kunden und dem Chatbot 'Mo', " +
  "in dem Mo vermutlich eine Wissenslücke hatte (Frage nicht beantwortet, Kunde " +
  "an das Team verwiesen, Bedarf blieb offen).\n\n" +
  "Deine Aufgabe: Prüfe, ob dem Gespräch eine KONKRETE, wiederverwendbare " +
  "Wissensfrage zugrunde liegt, die das Team einmal beantworten kann, damit Mo " +
  "sie künftig selbst beantworten kann und sie als Q&A auf der Produktseite " +
  "erscheinen kann.\n\n" +
  "Antworte AUSSCHLIESSLICH mit EINEM JSON-Objekt — keine Code-Fences, kein Text " +
  "davor oder danach. Felder:\n" +
  '- "found": true, wenn eine echte Wissenslücke mit klarer Frage vorliegt; ' +
  "false, wenn nicht (z. B. reiner Beschwerdefall, Off-Topic, individuelle " +
  "Bestellfrage, oder Mo hat eigentlich alles beantwortet).\n" +
  '- "gap_summary": 1–3 deutsche Sätze: Was konnte NICHT gelöst werden und ' +
  "warum (faktenbasiert, nichts erfinden). Leerer String wenn found=false.\n" +
  '- "question": EINE klare, präzise, kundengerechte deutsche Frage, so ' +
  "formuliert, dass sie mit Antwort direkt als öffentliches Q&A taugt. Keine " +
  "personenbezogenen Details (keine Namen, Bestellnummern, Orte). Leerer " +
  "String wenn found=false.\n" +
  '- "product_handle": Der Produkt-Handle aus der Liste unten, wenn sich die ' +
  "Frage KLAR auf genau ein Produkt bezieht — sonst null (allgemeine Frage, " +
  "z. B. zu Versand, Garantie, Finanzierung).";

/**
 * Build the user prompt for the draft pass.
 * @param {{ transcript: string, productHandles?: string[] }} input
 *   transcript — the readable, chronological transcript (already rendered).
 *   productHandles — handles of products that appeared in the conversation
 *   (candidates for product attribution; may be empty).
 * @returns {string}
 */
export function buildQaDraftPrompt({ transcript, productHandles }) {
  const handles = Array.isArray(productHandles)
    ? productHandles.filter((h) => typeof h === "string" && h.trim()).slice(0, 12)
    : [];
  const handleBlock = handles.length
    ? `## Produkte im Gespräch (Handles für "product_handle")\n\n${handles.join("\n")}\n\n`
    : "## Produkte im Gespräch\n\n(keine erkannt — product_handle dann null)\n\n";
  return (
    `## Gespräch (chronologisch)\n\n${transcript}\n\n` +
    handleBlock +
    "Prüfe das Gespräch jetzt und gib NUR das JSON-Objekt zurück."
  );
}

/**
 * Defensively parse the draft model's JSON. Tolerates ```json fences and
 * surrounding prose (same tactic as parseAnalysisResponse). Returns
 * { found:false } when the model saw no real gap, the parsed draft when it
 * did, or null when no JSON object can be recovered (model error — the caller
 * must NOT cache/misread garbage).
 *
 * @param {string} text
 * @returns {{ found: false } | { found: true, gapSummary: string, question: string, productHandle: string | null } | null}
 */
export function parseQaDraftResponse(text) {
  if (typeof text !== "string") return null;
  let body = text.trim();
  body = body.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  let obj;
  try {
    obj = JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;

  const gapSummary =
    typeof obj.gap_summary === "string" ? obj.gap_summary.trim().slice(0, 1200) : "";
  const question =
    typeof obj.question === "string" ? obj.question.trim().slice(0, 500) : "";
  if (obj.found !== true || !gapSummary || !question) return { found: false };

  const rawHandle =
    typeof obj.product_handle === "string" ? obj.product_handle.trim() : "";
  return {
    found: true,
    gapSummary,
    question,
    productHandle: rawHandle || null,
  };
}

// ── Fingerprint (de-dup) ─────────────────────────────────────────────────────

/**
 * Normalized fingerprint of a question for de-duplication: German-folded,
 * lowercased, punctuation stripped, whitespace collapsed. Two phrasings that
 * differ only in case/umlauts/punctuation collide (on purpose).
 * @param {string} q
 * @returns {string}
 */
export function questionFingerprint(q) {
  return String(q ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

// ── custom.qa metafield format ───────────────────────────────────────────────
// ONE canonical shape, shared by the publisher (shopify-qa.ts), the catalog
// mapper (catalog-mapping.ts) and the storefront theme: a JSON array of
//   { "q": "<Frage>", "a": "<Antwort>", "q_en": "<Question>", "a_en": "<Answer>" }
// objects, oldest first. Kept deliberately terse — it lives in a Shopify
// metafield and is parsed by Liquid/JS in the theme. German (q/a) is the
// REQUIRED source of truth (the team writes German only); q_en/a_en are the
// OPTIONAL English pair, auto-translated at publish time — consumers fall
// back to German when they are absent, so pre-i18n values keep working.
//
// Product links: answers may contain markdown links `[Text](https://…)`
// (entered in the Wissen tab). For answers that contain a link the serializer
// ALSO writes `a_html` / `a_en_html` — the pre-rendered, escaped HTML with
// plain clickable anchors (qa-links.mjs) — so the theme shows "Text" as a
// clickable link without parsing markdown in Liquid: render `a_html` when
// present, else `a`. `a` keeps the raw markdown as the source of truth (and
// Mo's chat context, which renders markdown natively, uses exactly that).

export const QA_METAFIELD_NAMESPACE = "custom";
export const QA_METAFIELD_KEY = "qa";
/** Cap per product — the PDP tab and Mo's context both stay bounded. */
export const QA_MAX_PER_PRODUCT = 20;

/**
 * Parse a `custom.qa` metafield value into a clean list. Tolerates junk:
 * non-JSON, non-arrays and malformed items yield [] / are skipped. The
 * pre-rendered link HTML (a_html/a_en_html) rides along when present so the
 * widget mirror (/api/products → Product.qa) can render clickable links; it
 * is IGNORED by the write path (serialize recomputes it from the text).
 * @param {unknown} value
 * @returns {Array<{ question: string, answer: string, answerHtml?: string, questionEn?: string, answerEn?: string, answerEnHtml?: string }>}
 */
export function parseQaMetafield(value) {
  if (typeof value !== "string" || !value.trim().startsWith("[")) return [];
  let arr;
  try {
    arr = JSON.parse(value);
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const q = typeof item.q === "string" ? item.q.trim() : "";
    const a = typeof item.a === "string" ? item.a.trim() : "";
    if (!q || !a) continue;
    const qEn = typeof item.q_en === "string" ? item.q_en.trim() : "";
    const aEn = typeof item.a_en === "string" ? item.a_en.trim() : "";
    const aHtml = typeof item.a_html === "string" ? item.a_html.trim() : "";
    const aEnHtml = typeof item.a_en_html === "string" ? item.a_en_html.trim() : "";
    out.push({
      question: q,
      answer: a,
      ...(aHtml ? { answerHtml: aHtml } : {}),
      // The English pair only travels complete — a lone question or answer
      // would render half-translated on the storefront.
      ...(qEn && aEn
        ? { questionEn: qEn, answerEn: aEn, ...(aEnHtml ? { answerEnHtml: aEnHtml } : {}) }
        : {}),
    });
    if (out.length >= QA_MAX_PER_PRODUCT) break;
  }
  return out;
}

/**
 * Merge a new Q&A pair into an existing list (as parsed by parseQaMetafield).
 * Same-fingerprint questions are REPLACED (answer updates win); the list is
 * capped at QA_MAX_PER_PRODUCT by dropping the OLDEST entries. The optional
 * English pair (questionEn/answerEn) rides along only when complete.
 * @param {Array<{ question: string, answer: string, questionEn?: string, answerEn?: string }>} existing
 * @param {{ question: string, answer: string, questionEn?: string, answerEn?: string }} next
 * @returns {Array<{ question: string, answer: string, questionEn?: string, answerEn?: string }>}
 */
export function mergeQaList(existing, next) {
  const q = String(next?.question ?? "").trim();
  const a = String(next?.answer ?? "").trim();
  const base = Array.isArray(existing) ? existing : [];
  if (!q || !a) return base.slice(0, QA_MAX_PER_PRODUCT);
  const qEn = String(next?.questionEn ?? "").trim();
  const aEn = String(next?.answerEn ?? "").trim();
  const fp = questionFingerprint(q);
  const kept = base.filter(
    (e) => e && questionFingerprint(e.question) !== fp
  );
  kept.push({
    question: q,
    answer: a,
    ...(qEn && aEn ? { questionEn: qEn, answerEn: aEn } : {}),
  });
  return kept.slice(-QA_MAX_PER_PRODUCT);
}

/**
 * Remove a question (matched by fingerprint, like mergeQaList's replace) from
 * a Q&A list — the inverse of a publish. Removing a question that is not in
 * the list is a no-op, so unpublish stays idempotent.
 * @param {Array<{ question: string, answer: string }>} existing
 * @param {string} question
 * @returns {Array<{ question: string, answer: string }>}
 */
export function removeQaFromList(existing, question) {
  const fp = questionFingerprint(question);
  const base = Array.isArray(existing) ? existing : [];
  if (!fp) return base.slice(0, QA_MAX_PER_PRODUCT);
  return base
    .filter((e) => e && questionFingerprint(e.question) !== fp)
    .slice(0, QA_MAX_PER_PRODUCT);
}

/**
 * Serialize a Q&A list to the metafield's canonical JSON ({q,a[,q_en,a_en]}
 * objects). Answers containing a link additionally carry the pre-rendered
 * `a_html`/`a_en_html` for the theme (recomputed from the raw text on EVERY
 * serialize, so text and HTML can never drift apart).
 * @param {Array<{ question: string, answer: string, questionEn?: string, answerEn?: string }>} list
 * @returns {string}
 */
export function serializeQaMetafield(list) {
  const arr = (Array.isArray(list) ? list : [])
    .filter((e) => e && e.question && e.answer)
    .slice(-QA_MAX_PER_PRODUCT)
    .map((e) => {
      const qEn = String(e.questionEn ?? "").trim();
      const aEn = String(e.answerEn ?? "").trim();
      const a = String(e.answer).trim();
      return {
        q: String(e.question).trim(),
        a,
        ...(qaAnswerHasLink(a) ? { a_html: qaAnswerHtml(a) } : {}),
        ...(qEn && aEn
          ? {
              q_en: qEn,
              a_en: aEn,
              ...(qaAnswerHasLink(aEn) ? { a_en_html: qaAnswerHtml(aEn) } : {}),
            }
          : {}),
      };
    });
  return JSON.stringify(arr);
}
