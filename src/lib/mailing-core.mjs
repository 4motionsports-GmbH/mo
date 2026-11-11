// Rundmail (bulk mail) — the pure rules of the batch sender. Tested
// (mailing-core.test.mjs); the I/O is lib/mailing-send.ts, the data model
// migration 0081, the behaviour docs/CAMPAIGNS.md §9.
//
// The promise of a Rundmail: EVERY recipient gets the SAME content — the one
// a person reviewed and test-sent. So the mail is rendered once and FROZEN
// (HTML, text, subject) when it is released; per recipient only these
// placeholders are filled in, nothing else:
//
//   {{mo:unsub}}     the person's signed unsubscribe link (footer + header)
//   {{mo:erase}}     the person's signed „Daten löschen“ link
//   {{mo:link:N}}    tracked link N → /api/r/<token>?l=N (the redirect looks
//                    the target up in the frozen link table — never in the URL)
//   {{mo:fn:N}}      first-name merge field N ({{vorname|Ersatz}})
//   {{mo:greet:N}}   greeting N: its text with the name, or its fallback

import { applyMergeFields, normalizeFirstName, walkMailBlocks } from "./mail-template-doc.mjs";

/** Batch size bounds — Resend's batch endpoint takes at most 100 messages. */
export const MAILING_BATCH_MAX = 100;
export const MAILING_BATCH_DEFAULT = 50;

/** Send rates the operator can choose (mails per minute). */
export const MAILING_RATES = Object.freeze({
  behutsam: 60,
  normal: 300,
  schnell: 1000,
});
/** @typedef {keyof typeof MAILING_RATES} MailingRateKey */
export const MAILING_RATE_LABELS = Object.freeze({
  behutsam: "Behutsam — 60 pro Minute",
  normal: "Normal — 300 pro Minute",
  schnell: "Schnell — 1.000 pro Minute",
});
export const DEFAULT_MAILING_RATE = "normal";

/** At most this many tracked links per mailing (the redirect parses ≤ 3 digits). */
export const MAILING_MAX_LINKS = 200;

/** Max test addresses per test send. */
export const MAILING_MAX_TEST_ADDRESSES = 5;

/**
 * @param {unknown} v
 * @returns {MailingRateKey}
 */
export function parseMailingRate(v) {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(MAILING_RATES, v)
    ? /** @type {MailingRateKey} */ (v)
    : DEFAULT_MAILING_RATE;
}

/**
 * Milliseconds to wait between two batches so a mailing keeps its rate.
 * @param {number} batchSize
 * @param {number} perMinute
 */
export function batchSpacingMs(batchSize, perMinute) {
  const size = Math.max(1, Math.min(MAILING_BATCH_MAX, Math.floor(batchSize) || 1));
  const rate = Math.max(1, Math.floor(perMinute) || 1);
  // Never faster than one request per 600 ms (Resend's default limit is 2/s,
  // shared with every other mail Mo sends).
  return Math.max(600, Math.round((size / rate) * 60_000));
}

/**
 * How many recipients the next batch takes: the configured size, but never
 * more than the rate allows per minute (a slow mailing sends small batches
 * instead of one big burst per minute).
 * @param {number} configured
 * @param {number} perMinute
 */
export function batchSizeFor(configured, perMinute) {
  const c = Math.max(1, Math.min(MAILING_BATCH_MAX, Math.floor(configured) || MAILING_BATCH_DEFAULT));
  return Math.max(1, Math.min(c, Math.floor(perMinute / 6) || 1));
}

/**
 * The idempotency key of a batch. Stable for the batch (a retry uses the same
 * key, so Resend never delivers a batch twice) and unique across mailings.
 * Resend allows up to 256 characters.
 * @param {number} campaignId
 * @param {number} batchId
 */
export function mailingIdempotencyKey(campaignId, batchId) {
  return `mo-rundmail-${campaignId}-${batchId}`;
}

/**
 * May a batch that was NOT sent this time go back to the queue (its
 * recipients claimed again later, into a NEW batch with a NEW key)?
 * Only a batch that has certainly never reached Resend: freshly claimed in
 * this run and never attempted. A batch a dead run left open (`retry`), or
 * one with an earlier attempt of unknown outcome (`attempts > 0`), may
 * already be delivered — re-queueing it would send it a second time under
 * another key. Such a batch stays open and is retried later under its OWN
 * key, where Resend answers with the first result instead of sending again.
 * @param {{ retry: boolean, attempts: number }} batch
 */
export function mayRequeueBatch({ retry, attempts }) {
  return retry !== true && Number(attempts) === 0;
}

/** @typedef {"rate_limited" | "quota" | "config" | "invalid" | "conflict" | "transient"} ResendErrorClass */

/**
 * What to do with an error Resend returned for a request.
 *   rate_limited — wait (Retry-After) and try the SAME batch again
 *   quota        — daily/monthly quota used up: pause the mailing
 *   config       — key, sender domain or permission: pause the mailing
 *   invalid      — the request itself was refused (nothing sent): pause
 *   conflict     — same idempotency key with another payload: the batch is
 *                  marked „unklar“, never resent automatically
 *   transient    — network / 5xx / unknown: retry with the SAME key
 * @param {{ name?: string | null, statusCode?: number | null } | null | undefined} err
 * @returns {ResendErrorClass}
 */
export function classifyResendError(err) {
  const name = String(err?.name ?? "");
  const status = Number(err?.statusCode);
  if (name === "rate_limit_exceeded" || status === 429) {
    if (name === "daily_quota_exceeded" || name === "monthly_quota_exceeded") return "quota";
    return "rate_limited";
  }
  if (name === "daily_quota_exceeded" || name === "monthly_quota_exceeded") return "quota";
  if (name === "invalid_idempotent_request" || name === "invalid_idempotency_key") return "conflict";
  if (name === "concurrent_idempotent_requests") return "transient";
  if (
    [
      "missing_api_key",
      "invalid_api_key",
      "restricted_api_key",
      "invalid_from_address",
      "invalid_access",
      "security_error",
      "invalid_region",
      "method_not_allowed",
      "not_found",
    ].includes(name) ||
    status === 401 ||
    status === 403
  ) {
    return "config";
  }
  if (["validation_error", "invalid_parameter", "missing_required_field", "invalid_attachment"].includes(name)) return "invalid";
  if (Number.isFinite(status) && status >= 400 && status < 500) return "invalid";
  return "transient";
}

/** German operator message per error class. */
export function resendErrorMessage(errorClass, detail) {
  const d = detail ? ` (${String(detail).slice(0, 200)})` : "";
  switch (errorClass) {
    case "rate_limited":
      return `Resend bremst gerade (Rate-Limit) — der Versand läuft automatisch weiter.${d}`;
    case "quota":
      return `Das Resend-Kontingent ist aufgebraucht — Versand pausiert. Im Resend-Tarif mehr Mails freischalten, dann fortsetzen.${d}`;
    case "config":
      return `Resend lehnt den Versand ab (API-Schlüssel, Absender-Domain oder Berechtigung) — Versand pausiert.${d}`;
    case "invalid":
      return `Resend hat die Anfrage abgelehnt — Versand pausiert.${d}`;
    case "conflict":
      return `Ein Paket konnte nicht eindeutig zugeordnet werden — es wird nicht erneut gesendet.${d}`;
    case "not_configured":
      return "E-Mail-Versand ist nicht eingerichtet (RESEND_API_KEY).";
    default:
      return `Vorübergehender Fehler bei Resend — wird automatisch wiederholt.${d}`;
  }
}

// ── link tracking ────────────────────────────────────────────────────────────

/** The hosts whose links get UTM parameters (the shop). */
export const SHOP_LINK_HOSTS = Object.freeze(["motionsports.de", "www.motionsports.de"]);

/** Decode the entities escapeAttr writes, so the table holds the real URL. */
function unescapeAttr(s) {
  return s.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'").replace(/&amp;/g, "&");
}
const escapeAttr = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const escapeHtml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * The link target with UTM parameters for shop links (no change when the
 * link already carries utm_* or points elsewhere).
 * @param {string} url
 * @param {{ campaign: string, hosts?: ReadonlyArray<string> }} opts
 */
export function withUtm(url, opts) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  const hosts = opts.hosts ?? SHOP_LINK_HOSTS;
  if (!hosts.includes(u.hostname.toLowerCase())) return url;
  for (const k of u.searchParams.keys()) if (k.toLowerCase().startsWith("utm_")) return url;
  u.searchParams.set("utm_source", "mo");
  u.searchParams.set("utm_medium", "email");
  u.searchParams.set("utm_campaign", opts.campaign);
  return u.toString();
}

/**
 * Should a link be tracked? Every http(s) link except the legal ones (the
 * imprint) — unsubscribe/erasure links are placeholders, never http.
 * @param {string} url
 * @param {{ untracked?: ReadonlyArray<string> }} [opts]
 */
export function isTrackableUrl(url, opts = {}) {
  if (!/^https?:\/\//i.test(url)) return false;
  const bare = url.replace(/[?#].*$/, "").replace(/\/+$/, "").toLowerCase();
  return !(opts.untracked ?? []).some((u) => u.replace(/[?#].*$/, "").replace(/\/+$/, "").toLowerCase() === bare);
}

/**
 * The opening tag of a click target: a link, an image-map area or Outlook's
 * VML button (<v:roundrect href>). Quoted attribute values may hold ">"; a
 * "<" outside quotes ends the attempt (an unclosed tag never makes the scan
 * run to the end of the mail for every later "<a"). Never <link> (the
 * web-font stylesheet — a client that loads it is no click), <base> or any
 * other tag.
 */
const CLICK_TAG_RE = /<(?:a|area|v:roundrect)(?=[\s/>])(?:[^<>"']|"[^"]*"|'[^']*')*>/gi;
/** One attribute of a tag: its name and, optionally, `=` and a quoted or bare value. */
const TAG_ATTR_RE = /(\s+)([^\s"'<>/=]+)(?:(\s*=\s*)("[^"]*"|'[^']*'|[^\s"'=<>`]+))?/g;

/**
 * Is this a web-font stylesheet (Google Fonts)? Rundmails released before
 * 2026-11-11 froze the font <link> of the head as link 0 — a mail client that
 * loads it is no click (recordCampaignClick skips it, the statistics leave it
 * out).
 * @param {unknown} url
 */
export function isWebFontStylesheetUrl(url) {
  try {
    const host = new URL(String(url ?? "")).hostname.toLowerCase();
    return host === "fonts.googleapis.com" || host === "fonts.gstatic.com";
  } catch {
    return false;
  }
}

/**
 * Rewrite the href of every click target of an HTML document (<a>, <area>,
 * <v:roundrect> — inside conditional comments too, where Outlook's twin of a
 * button lives). Only double-quoted values, the way the renderer writes every
 * link (it rewrites custom HTML to double quotes as well); stylesheets
 * (<link>), <base> and every other tag stay as they are.
 * @param {string} html
 * @param {(value: string) => string | null} rewrite  the raw (still escaped)
 *   attribute value → the new, already escaped value, or null to keep it
 * @returns {string}
 */
export function rewriteLinkHrefs(html, rewrite) {
  return String(html ?? "").replace(CLICK_TAG_RE, (tag) =>
    tag.replace(TAG_ATTR_RE, (all, space, name, eq, value) => {
      if (!eq || name.toLowerCase() !== "href" || !value?.startsWith('"')) return all;
      const next = rewrite(value.slice(1, -1));
      return next === null ? all : `${space}${name}${eq}"${next}"`;
    })
  );
}

/**
 * Freeze the links of a rendered mail: the href of every click target in the
 * HTML (rewriteLinkHrefs) and every trackable URL in the text part becomes
 * {{mo:link:N}}; the table holds the real target (with UTM for shop links).
 * One index per distinct URL — the Outlook twin of a button links to the same
 * index as the original. The web-font stylesheet in the head stays direct.
 * @param {{ html: string, text: string }} rendered
 * @param {{ campaign: string, untracked?: ReadonlyArray<string> }} opts
 * @returns {{ html: string, text: string, links: Array<{ url: string }> }}
 */
export function freezeLinks(rendered, opts) {
  /** @type {Array<{ url: string }>} */
  const links = [];
  const index = new Map();
  const indexOf = (raw) => {
    if (index.has(raw)) return index.get(raw);
    if (links.length >= MAILING_MAX_LINKS) return null;
    const n = links.length;
    links.push({ url: withUtm(raw, { campaign: opts.campaign }) });
    index.set(raw, n);
    return n;
  };
  const html = rewriteLinkHrefs(rendered.html, (value) => {
    const url = unescapeAttr(value).trim();
    if (!isTrackableUrl(url, opts)) return null;
    const n = indexOf(url);
    return n === null ? null : `{{mo:link:${n}}}`;
  });
  const text = rendered.text.replace(/https?:\/\/[^\s<>()"']+/g, (raw) => {
    const url = raw.replace(/[.,;:!?…]+$/, "");
    const tail = raw.slice(url.length);
    if (!isTrackableUrl(url, opts)) return raw;
    const n = indexOf(url);
    return n === null ? raw : `{{mo:link:${n}}}${tail}`;
  });
  return { html, text, links };
}

/**
 * Fill the frozen placeholders for ONE recipient. In HTML every value is
 * escaped (links as attributes, names as text); in the text part and the
 * subject they stay raw.
 * @param {string} template
 * @param {{
 *   unsubscribeUrl: string,
 *   erasureUrl: string | null,
 *   trackUrl: (n: number) => string,
 *   firstName: string | null,
 *   merges: ReadonlyArray<{ fallback: string }>,
 *   greetings: ReadonlyArray<{ text: string, fallback: string }>,
 * }} values
 * @param {"html" | "text"} mode
 * @returns {string}
 */
export function personalizeFrozen(template, values, mode) {
  const html = mode === "html";
  const first = normalizeFirstName(values.firstName);
  const asUrl = (u) => (html ? escapeAttr(u) : u);
  const asText = (t) => (html ? escapeHtml(t) : t);
  return String(template).replace(/\{\{mo:(unsub|erase|link|fn|greet)(?::(\d{1,4}))?\}\}/g, (all, kind, num) => {
    const n = num === undefined ? -1 : Number(num);
    switch (kind) {
      case "unsub":
        return asUrl(values.unsubscribeUrl);
      case "erase":
        return asUrl(values.erasureUrl ?? values.unsubscribeUrl);
      case "link":
        return n >= 0 ? asUrl(values.trackUrl(n)) : all;
      case "fn": {
        const m = values.merges[n];
        if (!m) return "";
        return asText(first ?? m.fallback);
      }
      case "greet": {
        const g = values.greetings[n];
        if (!g) return "";
        return asText(first ? applyMergeFields(g.text, { firstName: first }) : g.fallback);
      }
      default:
        return all;
    }
  });
}

/** Placeholders left after personalisation — a send must never ship one. */
export function leftoverPlaceholders(s) {
  return Array.from(new Set(String(s).match(/\{\{\s*mo:[^}]*\}\}|\{\{\s*vorname[^}]*\}\}/gi) ?? []));
}

/**
 * Does a Rundmail address people by their first name — {{vorname}} in the
 * subject, a greeting block, or {{vorname}} in any field of any block, the
 * blocks inside the columns of a section included? (The checks then say what
 * stands where no first name is known.)
 * @param {unknown} subject
 * @param {{ blocks?: unknown } | null | undefined} doc  a normalised document
 */
export function mailingUsesFirstName(subject, doc) {
  const field = /\{\{\s*vorname/i;
  if (field.test(String(subject ?? ""))) return true;
  // A section holds no text of its own; its blocks are visited one by one.
  return walkMailBlocks(doc).some(({ block }) => block.type === "greeting" || (block.type !== "section" && field.test(JSON.stringify(block))));
}

/**
 * A plausible single recipient address (no display name, no list).
 * @param {unknown} v
 */
export function isSendableAddress(v) {
  return typeof v === "string" && v.length <= 254 && /^[^\s@<>(),;:"[\]\\]+@[^\s@<>(),;:"[\]\\]+\.[^\s@<>(),;:"[\]\\]{2,}$/.test(v);
}

/**
 * Test-send addresses from the form: comma/space/line separated, at most
 * MAILING_MAX_TEST_ADDRESSES, each plausible. German message on failure.
 * @param {unknown} raw  string or string[]
 * @returns {{ ok: true, addresses: string[] } | { ok: false, message: string }}
 */
export function parseTestAddresses(raw) {
  const list = (Array.isArray(raw) ? raw : String(raw ?? "").split(/[\s,;]+/))
    .map((s) => String(s).trim().toLowerCase())
    .filter(Boolean);
  const unique = Array.from(new Set(list));
  if (unique.length === 0) return { ok: false, message: "Mindestens eine Adresse für die Testmail angeben." };
  if (unique.length > MAILING_MAX_TEST_ADDRESSES) {
    return { ok: false, message: `Höchstens ${MAILING_MAX_TEST_ADDRESSES} Testadressen auf einmal.` };
  }
  const bad = unique.find((a) => !isSendableAddress(a));
  if (bad) return { ok: false, message: `${bad} ist keine gültige E-Mail-Adresse.` };
  return { ok: true, addresses: unique };
}

/**
 * Progress figures of a mailing from its recipient counts.
 * @param {{ total: number, pending: number, sending: number, sent: number, skipped: number, suppressed: number, failed: number }} c
 */
export function mailingProgress(c) {
  const done = c.sent + c.skipped + c.suppressed + c.failed;
  const total = Math.max(c.total, done + c.pending + c.sending);
  return {
    total,
    done,
    open: c.pending + c.sending,
    percent: total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0,
  };
}

/**
 * Minutes left at a rate (rounded up), or 0.
 * @param {number} open
 * @param {number} perMinute
 */
export function minutesLeft(open, perMinute) {
  if (open <= 0) return 0;
  return Math.max(1, Math.ceil(open / Math.max(1, perMinute)));
}
