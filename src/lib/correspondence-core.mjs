// Pure, dependency-free core for folding email correspondence into the
// per-customer knowledge base (S10D item 7, docs/EMAIL_SUBSYSTEM_SPIKE.md §3).
//
// Renders a customer's email thread into ONE readable block the KB passes
// (generateCustomerProfile, generateCustomerMarketingDraft) drop in beside the
// chat-session blocks — exactly paralleling readableTranscript/draftSessionBlock,
// but for mail. Isolated here so the rendering + the two minimisation bounds (a
// max-messages cap + a per-message char clip) are unit-testable without the DB.
//
// DATA-MINIMISATION (required, §3): the renderer is fed body TEXT ONLY — never
// raw headers/address lines (no From/To/Subject/Message-ID). The store loader
// (email-messages-store.loadCustomerCorrespondence) also caps recency (last N
// messages / last 12 months) before this ever sees a row.

// Bound the prompt like the session blocks (MAX_SESSIONS_IN_*_PROMPT): a long
// thread must not turn into an unbounded mega-prompt. Newest messages carry the
// freshest signal, so when trimming, the OLDEST are dropped first.
export const MAX_CORRESPONDENCE_IN_PROMPT = 20;
// Per-message clip — a single long mail can't blow the prompt on its own.
export const MAX_BODY_CHARS_PER_MESSAGE = 2000;

/**
 * Format an ISO timestamp as German DD.MM.YYYY. Done by hand (not
 * toLocaleDateString) so the output is zero-padded and locale/ICU-independent —
 * stable for tests and for the "Kunde schrieb (12.06.2026): …" form. Returns
 * "" for a missing/unparseable date (then no date is shown).
 */
export function formatGermanDate(iso) {
  if (typeof iso !== "string" || !iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  return `${dd}.${mm}.${yyyy}`;
}

/**
 * Render ONE message: a direction label + date + the clipped body TEXT. The
 * label parallels readableTranscript's "Kunde:"/"Berater:" — here
 * "Kunde schrieb" (received) / "motion sports schrieb" (sent). Body text only.
 */
export function renderCorrespondenceMessage(msg, { maxChars = MAX_BODY_CHARS_PER_MESSAGE } = {}) {
  const who = msg && msg.direction === "received" ? "Kunde schrieb" : "motion sports schrieb";
  const date = formatGermanDate(msg ? msg.occurredAt : null);
  const dateLabel = date ? ` (${date})` : "";
  const raw = msg && typeof msg.bodyText === "string" ? msg.bodyText.trim() : "";
  const clipped = raw.length > maxChars ? raw.slice(0, maxChars) + "\n[… gekürzt]" : raw;
  return `${who}${dateLabel}:\n${clipped || "(kein Textinhalt)"}`;
}

/**
 * Render a customer's correspondence (oldest-first) into one block string for
 * the KB prompt. Applies the max-messages cap (keeps the most recent N, still
 * oldest-first) and the per-message char clip. Returns "" for no messages, so
 * the caller can show a "(keine Korrespondenz)" placeholder.
 */
export function renderCorrespondence(messages, opts = {}) {
  if (!Array.isArray(messages) || messages.length === 0) return "";
  const maxMessages = opts.maxMessages ?? MAX_CORRESPONDENCE_IN_PROMPT;
  const maxChars = opts.maxChars ?? MAX_BODY_CHARS_PER_MESSAGE;
  // Newest carry the most signal; keep the most recent N, preserving order.
  const kept = messages.slice(-maxMessages);
  return kept.map((m) => renderCorrespondenceMessage(m, { maxChars })).join("\n\n");
}
