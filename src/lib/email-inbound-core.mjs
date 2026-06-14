// Pure, dependency-free core for the unified mail log (S10D items 7+8): the
// RFC-5322 threading + envelope helpers, isolated so they are unit-testable
// without the Resend SDK, the database, or a live webhook. The TS route/store
// (email-messages-store.ts, /api/inbound/resend) wire these to real I/O.
//
// The decisions pinned here:
//   1. extractEmailAddress  — normalise a `From`/`To` header to the bare,
//      lower-cased address that is the customers.email lookup KEY (the
//      from→customer mapping bridge). Reused for outbound too.
//   2. normalizeSubject     — strip Re:/AW:/Fwd:… so a header-less reply still
//      threads onto its parent by subject.
//   3. parseReferences      — split a `References`/`In-Reply-To` header into the
//      ordered list of <message-id> tokens.
//   4. deriveThreadId       — the STABLE conversation key: the root of the
//      References chain, else In-Reply-To, else the message's own Message-ID.
//   5. generateMessageId    — our own Message-ID for outbound, so the replies we
//      receive carry an In-Reply-To/References we can thread back.

import { randomBytes } from "node:crypto";

/**
 * Normalise an email address for storage + lookup (trim + lower-case) — the
 * SAME rule as normalizeEmail in email-capture-store.ts, kept here so the pure
 * core has no TS/DB import. Returns "" for empty input.
 */
export function normalizeAddress(address) {
  return typeof address === "string" ? address.trim().toLowerCase() : "";
}

/**
 * Pull the bare address out of an RFC-5322 `From`/`To` header and normalise it.
 * Handles the common shapes:
 *   "Max Mustermann <Max@Example.DE>"  → "max@example.de"
 *   "<a@b.de>"                          → "a@b.de"
 *   "a@b.de"                            → "a@b.de"
 *   "  A@B.de , c@d.de"  (multi)        → "a@b.de"  (first address only)
 * Returns "" when no address can be found. This is the from→customer mapping
 * KEY: the result is matched against customers.email exactly.
 */
export function extractEmailAddress(headerValue) {
  if (typeof headerValue !== "string") return "";
  // A header can list several addresses (comma-separated). The inbound `from`
  // is a single sender; take the first token defensively.
  const first = headerValue.split(",")[0] ?? "";
  // Prefer the address inside angle brackets when a display name is present.
  const angled = first.match(/<([^>]+)>/);
  const candidate = angled ? angled[1] : first;
  const normalised = normalizeAddress(candidate);
  // Only return something that actually looks like an address.
  return normalised.includes("@") ? normalised : "";
}

// Leading reply/forward prefixes across the locales we send in (DE + EN). Each
// may repeat ("Re: Aw: Fwd:") and may carry a bracketed counter ("Re[2]:").
const SUBJECT_PREFIX_RE = /^\s*(?:(?:re|aw|fw|fwd|wg|antw|antwort)(?:\[\d+\])?\s*:\s*)+/i;

/**
 * Normalise a subject for subject-fallback threading: strip the leading
 * Re:/AW:/Fwd:/WG: chain, collapse whitespace, lower-case. Returns "" for a
 * missing/blank subject (which therefore never threads by subject).
 */
export function normalizeSubject(subject) {
  if (typeof subject !== "string") return "";
  let prev;
  let s = subject;
  // Strip repeated/stacked prefixes ("Re: Fwd: …") until stable.
  do {
    prev = s;
    s = s.replace(SUBJECT_PREFIX_RE, "");
  } while (s !== prev);
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Split a `References` or `In-Reply-To` header into its ordered <id> tokens.
 * The wire form is whitespace-separated angle-bracketed ids; we keep the
 * brackets stripped and drop empties. Accepts the already-parsed array too
 * (Resend may surface either).
 */
export function parseReferences(header) {
  if (Array.isArray(header)) {
    return header.map((t) => stripAngle(t)).filter(Boolean);
  }
  if (typeof header !== "string" || !header.trim()) return [];
  return header
    .split(/\s+/)
    .map((t) => stripAngle(t))
    .filter(Boolean);
}

function stripAngle(token) {
  if (typeof token !== "string") return "";
  return token.trim().replace(/^</, "").replace(/>$/, "").trim();
}

/**
 * The STABLE conversation key. Header-first: the root of the References chain
 * (the first/oldest id) identifies the whole thread; failing that the
 * In-Reply-To parent; failing both, the message's own Message-ID (a brand-new
 * thread). All ids are returned bracket-stripped for a consistent key.
 */
export function deriveThreadId({ messageId, inReplyTo, references } = {}) {
  const refs = parseReferences(references);
  if (refs.length > 0) return refs[0];
  const parent = stripAngle(inReplyTo);
  if (parent) return parent;
  return stripAngle(messageId) || null;
}

/**
 * Generate an RFC-5322 Message-ID for an OUTBOUND mail: `<hex@domain>`. We set
 * this on every send so the reply that comes back carries it in In-Reply-To /
 * References and threads onto the originating row. `domain` is derived from our
 * sender address; falls back to "motionsports.de".
 */
export function generateMessageId(domain) {
  const host = sanitizeDomain(domain) || "motionsports.de";
  const token = randomBytes(16).toString("hex");
  return `<${token}@${host}>`;
}

/** Domain part of an address/host string, lightly sanitised for Message-ID use. */
export function sanitizeDomain(value) {
  if (typeof value !== "string") return "";
  const at = value.lastIndexOf("@");
  const raw = (at >= 0 ? value.slice(at + 1) : value).trim().toLowerCase();
  // Keep only a plausible hostname (letters/digits/dot/hyphen).
  const cleaned = raw.replace(/[^a-z0-9.-]/g, "");
  return cleaned;
}

/** First ~`max` chars of the body for list rendering (text preferred). */
export function buildSnippet(bodyText, bodyHtml, max = 200) {
  const source =
    (typeof bodyText === "string" && bodyText.trim()) ||
    stripHtml(bodyHtml) ||
    "";
  const collapsed = source.replace(/\s+/g, " ").trim();
  return collapsed.length > max ? collapsed.slice(0, max) : collapsed;
}

function stripHtml(html) {
  if (typeof html !== "string") return "";
  return html.replace(/<[^>]+>/g, " ");
}

/**
 * Normalise a Resend inbound message (the receiving.get response, with the
 * webhook event data as fallback) into the flat row shape email_messages
 * stores. PURE: no I/O — the route resolves customer_id and calls the store.
 *
 * `full` is GetReceivingEmailResponseSuccess; `eventData` is the
 * email.received `data` (used only to backfill fields the fetch lacks).
 */
export function normalizeInboundMessage(full, eventData = {}) {
  const f = full ?? {};
  const headers = (f.headers && typeof f.headers === "object") ? f.headers : {};
  const headerMessageId = stripAngle(pickHeader(headers, "message-id"));
  const messageId =
    headerMessageId || stripAngle(f.message_id) || stripAngle(eventData.message_id) || null;
  const inReplyTo = stripAngle(pickHeader(headers, "in-reply-to")) || null;
  const references = parseReferences(pickHeader(headers, "references"));

  const fromRaw = f.from ?? eventData.from ?? "";
  const toRaw = firstString(f.to) || firstString(eventData.to) || "";
  const subject = f.subject ?? eventData.subject ?? null;
  const bodyText = typeof f.text === "string" ? f.text : null;
  const bodyHtml = typeof f.html === "string" ? f.html : null;

  return {
    messageId,
    inReplyTo,
    references,
    threadId: deriveThreadId({ messageId, inReplyTo, references }),
    fromAddress: extractEmailAddress(fromRaw) || normalizeAddress(fromRaw),
    toAddress: extractEmailAddress(toRaw) || normalizeAddress(toRaw),
    subject,
    normalizedSubject: normalizeSubject(subject ?? ""),
    bodyText,
    bodyHtml,
    snippet: buildSnippet(bodyText, bodyHtml),
    attachments: normalizeAttachments(f.attachments ?? eventData.attachments),
    providerEmailId: f.id ?? eventData.email_id ?? null,
    occurredAt: f.created_at ?? eventData.created_at ?? null,
  };
}

/**
 * Interpret the rows an inbound INSERT … ON CONFLICT (message_id) DO NOTHING
 * RETURNING id gives back, the SAME way the TS store does. A row back ⇒ the
 * message landed; ZERO rows back (with a Message-ID present) ⇒ the unique index
 * rejected a re-delivery ⇒ `duplicate`. Shared so the dedup decision is unit-
 * testable without a database.
 */
export function interpretReceivedInsert(rows) {
  const id = Array.isArray(rows) && rows[0] ? rows[0].id : undefined;
  if (id != null) return { inserted: true, id: Number(id) };
  return { inserted: false, reason: "duplicate" };
}

function pickHeader(headers, name) {
  if (!headers || typeof headers !== "object") return "";
  // Headers may arrive with any casing; do a case-insensitive lookup.
  const target = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === target) return headers[key];
  }
  return "";
}

function firstString(value) {
  if (Array.isArray(value)) return typeof value[0] === "string" ? value[0] : "";
  return typeof value === "string" ? value : "";
}

/** Keep attachment METADATA only — never the blob. */
function normalizeAttachments(list) {
  if (!Array.isArray(list)) return [];
  return list.map((a) => ({
    id: a?.id ?? null,
    filename: a?.filename ?? null,
    content_type: a?.content_type ?? null,
    size: typeof a?.size === "number" ? a.size : null,
    content_id: a?.content_id ?? null,
    content_disposition: a?.content_disposition ?? null,
  }));
}
