// Pure, dependency-free core for the "Wissen" (Q&A / knowledge enhancement)
// feature. No I/O, no DB, no model — imported by the draft pass (qa-draft.ts),
// the store (qa-store.ts), the Shopify publisher (shopify-qa.ts), the catalog
// mapper (catalog-mapping.ts) AND the node:test suite, so it stays a plain
// .mjs like conversation-analysis-core.mjs.
//
// It owns: the status vocabulary, the eligibility rule (which conversations
// the knowledge-gap scan looks at), the draft prompt + defensive JSON parser,
// the question fingerprint (de-dup), and the `custom.qa` metafield format
// (parse / merge) shared by the publisher and the catalog mapper.

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
//   { "q": "<Frage>", "a": "<Antwort>" }
// objects, oldest first. Kept deliberately terse ("q"/"a") — it lives in a
// Shopify metafield and is parsed by Liquid/JS in the theme.

export const QA_METAFIELD_NAMESPACE = "custom";
export const QA_METAFIELD_KEY = "qa";
/** Cap per product — the PDP tab and Mo's context both stay bounded. */
export const QA_MAX_PER_PRODUCT = 20;

/**
 * Parse a `custom.qa` metafield value into a clean list. Tolerates junk:
 * non-JSON, non-arrays and malformed items yield [] / are skipped.
 * @param {unknown} value
 * @returns {Array<{ question: string, answer: string }>}
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
    out.push({ question: q, answer: a });
    if (out.length >= QA_MAX_PER_PRODUCT) break;
  }
  return out;
}

/**
 * Merge a new Q&A pair into an existing list (as parsed by parseQaMetafield).
 * Same-fingerprint questions are REPLACED (answer updates win); the list is
 * capped at QA_MAX_PER_PRODUCT by dropping the OLDEST entries.
 * @param {Array<{ question: string, answer: string }>} existing
 * @param {{ question: string, answer: string }} next
 * @returns {Array<{ question: string, answer: string }>}
 */
export function mergeQaList(existing, next) {
  const q = String(next?.question ?? "").trim();
  const a = String(next?.answer ?? "").trim();
  const base = Array.isArray(existing) ? existing : [];
  if (!q || !a) return base.slice(0, QA_MAX_PER_PRODUCT);
  const fp = questionFingerprint(q);
  const kept = base.filter(
    (e) => e && questionFingerprint(e.question) !== fp
  );
  kept.push({ question: q, answer: a });
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
 * Serialize a Q&A list to the metafield's canonical JSON ({q,a} objects).
 * @param {Array<{ question: string, answer: string }>} list
 * @returns {string}
 */
export function serializeQaMetafield(list) {
  const arr = (Array.isArray(list) ? list : [])
    .filter((e) => e && e.question && e.answer)
    .slice(-QA_MAX_PER_PRODUCT)
    .map((e) => ({ q: String(e.question).trim(), a: String(e.answer).trim() }));
  return JSON.stringify(arr);
}
