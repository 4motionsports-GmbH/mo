// Sender identities („Absender“) — which From address a marketing mail goes
// out with. Pure and tested (sender-identities.test.mjs); the list is an
// operator setting (admin_settings key 'email_senders', Einstellungen →
// „Absender“), a campaign stores the identity it uses (campaigns.sender,
// migration 0081), and lib/email.ts applies the resolved From + Reply-To.
//
// Why a list and not a free field: Resend sends only from domains verified in
// the Resend account. Every address on the domain Mo already sends from
// (CONTACT_FROM_EMAIL, verified — otherwise no mail would go out) works, any
// other domain only when it is listed in EMAIL_SENDER_DOMAINS after its DNS
// records were added in Resend. So an identity is valid exactly when its
// domain is one of allowedSenderDomains(); the check runs on save AND again
// at send time (a domain removed from the env refuses the send instead of
// letting Resend bounce it).
//
// The default identity is not stored: it is CONTACT_FROM_EMAIL with the
// code's name „Mo von motion sports“ (email-sender.mjs formatSender) and
// replies to Mo's inbox — exactly what every mail did before 0081. A campaign
// with `sender` NULL uses it.
//
// Replies: "mo" stamps Mo's receiving address (INBOUND_EMAIL_ADDRESS) as
// Reply-To, so an answer lands in Mo's Eingang / Korrespondenz; "direct"
// sends no Reply-To, so an answer goes to the From address itself (e.g. the
// team's info@ mailbox).

import { mailboxAddress, quoteDisplayName, replyToFor } from "./email-sender.mjs";

/** The admin_settings key of the list (generic table, migration 0078). */
export const SENDER_IDENTITIES_KEY = "email_senders";

/** At most this many extra identities. */
export const MAX_SENDER_IDENTITIES = 10;

/** The id of the built-in identity (CONTACT_FROM_EMAIL), never stored. */
export const DEFAULT_SENDER_ID = "standard";

/** Where replies go. */
export const SENDER_REPLY_MODES = /** @type {const} */ (["mo", "direct"]);

/** German labels for the reply modes (Einstellungen, campaign editor). */
export const SENDER_REPLY_LABELS = Object.freeze({
  mo: "Antworten landen in Mo (Eingang)",
  direct: "Antworten gehen an diese Adresse",
});

const MAX_NAME_CHARS = 60;

/**
 * @typedef {{ id: string, address: string, name: string, replies: "mo" | "direct" }} SenderIdentity
 */

/**
 * The lower-cased domain of an address ("" when there is none).
 * @param {unknown} address
 * @returns {string}
 */
export function senderDomain(address) {
  const bare = mailboxAddress(address);
  const at = bare.lastIndexOf("@");
  return at > 0 ? bare.slice(at + 1).toLowerCase() : "";
}

/**
 * The domains an identity may use: the domain of CONTACT_FROM_EMAIL (it is
 * verified in Resend, or no mail would go out) plus every domain listed in
 * EMAIL_SENDER_DOMAINS (comma or space separated). Lower case, unique.
 * @param {unknown} defaultFrom  CONTACT_FROM_EMAIL
 * @param {unknown} [extraDomains]  EMAIL_SENDER_DOMAINS
 * @returns {string[]}
 */
export function allowedSenderDomains(defaultFrom, extraDomains) {
  const out = [];
  const add = (d) => {
    const v = String(d ?? "").trim().toLowerCase().replace(/^@/, "");
    if (/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(v) && !out.includes(v)) {
      out.push(v);
    }
  };
  add(senderDomain(defaultFrom));
  if (typeof extraDomains === "string") for (const d of extraDomains.split(/[\s,;]+/)) add(d);
  return out;
}

/**
 * May an address be used as From under the allowed domains?
 * @param {unknown} address
 * @param {ReadonlyArray<string>} allowedDomains
 * @returns {boolean}
 */
export function isSenderDomainAllowed(address, allowedDomains) {
  const domain = senderDomain(address);
  return Boolean(domain) && Array.isArray(allowedDomains) && allowedDomains.includes(domain);
}

/** A display name without control characters (no header injection), trimmed. */
function cleanName(value) {
  if (typeof value !== "string") return "";
  if (/[\u0000-\u001f\u007f]/.test(value)) return "";
  return value.replace(/\s+/g, " ").trim();
}

/** A stable id from the address's local part: "info@…" → "info". */
export function senderIdFor(address, takenIds = []) {
  const local = mailboxAddress(address).split("@")[0]?.toLowerCase() ?? "";
  const base = local.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30) || "absender";
  const taken = new Set([DEFAULT_SENDER_ID, ...takenIds]);
  if (!taken.has(base)) return base;
  for (let i = 2; i < 100; i++) {
    const candidate = `${base}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}-${Date.now() % 100000}`;
}

/**
 * One identity from an untrusted value, or null when it is not usable: a
 * plausible address on an allowed domain, a name of 1–60 characters without
 * control characters, a known reply mode. The address is stored in lower case.
 * @param {unknown} raw
 * @param {{ allowedDomains: ReadonlyArray<string> }} opts
 * @returns {SenderIdentity | null}
 */
export function normalizeSenderIdentity(raw, opts) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = /** @type {Record<string, unknown>} */ (raw);
  const address = mailboxAddress(typeof r.address === "string" ? r.address.trim() : "").toLowerCase();
  if (!address || address.length > 120 || !isSenderDomainAllowed(address, opts.allowedDomains)) return null;
  const name = cleanName(r.name);
  if (!name || name.length > MAX_NAME_CHARS) return null;
  const replies = r.replies === "direct" ? "direct" : r.replies === "mo" ? "mo" : null;
  if (!replies) return null;
  const id = typeof r.id === "string" && /^[a-z0-9-]{1,40}$/.test(r.id) && r.id !== DEFAULT_SENDER_ID ? r.id : senderIdFor(address);
  return { id, address, name, replies };
}

/**
 * The stored list (JSONB value or its JSON text) → identities. Lenient:
 * entries that no longer validate (e.g. a domain dropped from the env) are
 * left out, duplicates by address keep the first.
 * @param {unknown} value
 * @param {{ allowedDomains: ReadonlyArray<string> }} opts
 * @returns {SenderIdentity[]}
 */
export function parseSenderIdentities(value, opts) {
  let v = value;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return [];
    }
  }
  const list = v && typeof v === "object" && Array.isArray(/** @type {any} */ (v).senders) ? /** @type {any} */ (v).senders : [];
  /** @type {SenderIdentity[]} */
  const out = [];
  for (const entry of list.slice(0, MAX_SENDER_IDENTITIES)) {
    const s = normalizeSenderIdentity(entry, opts);
    if (!s || out.some((o) => o.address === s.address)) continue;
    if (out.some((o) => o.id === s.id)) s.id = senderIdFor(s.address, out.map((o) => o.id));
    out.push(s);
  }
  return out;
}

/**
 * Strict check of the list the operator saves (Einstellungen). Every entry
 * must validate; the German message names the first problem.
 * @param {unknown} raw  the route body's `senders`
 * @param {{ allowedDomains: ReadonlyArray<string>, defaultAddress?: string }} opts
 * @returns {{ ok: true, senders: SenderIdentity[] } | { ok: false, message: string }}
 */
export function validateSenderIdentitiesInput(raw, opts) {
  if (!Array.isArray(raw)) return { ok: false, message: "Ungültige Absender-Liste." };
  if (raw.length > MAX_SENDER_IDENTITIES) {
    return { ok: false, message: `Höchstens ${MAX_SENDER_IDENTITIES} zusätzliche Absender.` };
  }
  const domains = opts.allowedDomains.join(", ") || "—";
  /** @type {SenderIdentity[]} */
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    const entry = raw[i] && typeof raw[i] === "object" ? /** @type {Record<string, unknown>} */ (raw[i]) : {};
    const label = `Absender ${i + 1}`;
    const address = mailboxAddress(typeof entry.address === "string" ? entry.address.trim() : "").toLowerCase();
    if (!address) return { ok: false, message: `${label}: keine gültige E-Mail-Adresse.` };
    if (!isSenderDomainAllowed(address, opts.allowedDomains)) {
      return {
        ok: false,
        message: `${label}: ${address} liegt nicht auf einer in Resend bestätigten Domain (erlaubt: ${domains}).`,
      };
    }
    if (opts.defaultAddress && mailboxAddress(opts.defaultAddress).toLowerCase() === address) {
      return { ok: false, message: `${label}: ${address} ist schon der Standard-Absender.` };
    }
    const name = cleanName(entry.name);
    if (!name || name.length > MAX_NAME_CHARS) {
      return { ok: false, message: `${label}: Anzeigename mit 1–${MAX_NAME_CHARS} Zeichen angeben.` };
    }
    if (entry.replies !== "mo" && entry.replies !== "direct") {
      return { ok: false, message: `${label}: wählen, wohin Antworten gehen.` };
    }
    if (out.some((o) => o.address === address)) return { ok: false, message: `${label}: ${address} steht doppelt in der Liste.` };
    const wanted = typeof entry.id === "string" && /^[a-z0-9-]{1,40}$/.test(entry.id) && entry.id !== DEFAULT_SENDER_ID ? entry.id : null;
    const id = wanted && !out.some((o) => o.id === wanted) ? wanted : senderIdFor(address, out.map((o) => o.id));
    out.push({ id, address, name, replies: entry.replies });
  }
  return { ok: true, senders: out };
}

/**
 * The From header of an identity: "motion sports <info@motionsports.de>".
 * @param {Pick<SenderIdentity, "address" | "name">} identity
 * @returns {string}
 */
export function senderFromHeader(identity) {
  return `${quoteDisplayName(identity.name)} <${identity.address}>`;
}

/**
 * Resolve what a mail is sent with. `identity` null → the default (the env
 * sender, replies to Mo — today's behaviour). A stored identity whose domain
 * is no longer allowed is REFUSED (ok: false) — never silently swapped for
 * the default: the operator chose that sender for this campaign.
 * @param {{
 *   identity: SenderIdentity | null,
 *   defaultFrom: string | undefined,   // senderAddress() — the formatted env sender
 *   inboundAddress: string | undefined, // INBOUND_EMAIL_ADDRESS
 *   allowedDomains: ReadonlyArray<string>,
 * }} input
 * @returns {{ ok: true, from: string, replyTo: string | undefined, address: string, isDefault: boolean }
 *   | { ok: false, message: string }}
 */
export function resolveSender(input) {
  if (!input.identity) {
    if (!input.defaultFrom) return { ok: false, message: "Kein Absender konfiguriert (CONTACT_FROM_EMAIL)." };
    return {
      ok: true,
      from: input.defaultFrom,
      replyTo: replyToFor(input.inboundAddress, input.defaultFrom),
      address: mailboxAddress(input.defaultFrom) || input.defaultFrom,
      isDefault: true,
    };
  }
  const identity = normalizeSenderIdentity(input.identity, { allowedDomains: input.allowedDomains });
  if (!identity) {
    return {
      ok: false,
      message:
        `Der Absender ${mailboxAddress(input.identity.address) || "?"} ist nicht mehr erlaubt ` +
        "(Domain nicht in Resend bestätigt oder aus EMAIL_SENDER_DOMAINS entfernt) — in der Kampagne einen anderen wählen.",
    };
  }
  const from = senderFromHeader(identity);
  return {
    ok: true,
    from,
    replyTo: identity.replies === "mo" ? replyToFor(input.inboundAddress, from) : undefined,
    address: identity.address,
    isDefault: false,
  };
}

/**
 * A campaign's stored sender (campaigns.sender JSONB, or its JSON text) →
 * identity, or null (the default sender). Read WITHOUT the domain rule — what
 * was stored stays visible in the editor; the send-time resolveSender refuses
 * an identity whose domain is no longer allowed.
 * @param {unknown} value
 * @returns {SenderIdentity | null}
 */
export function parseStoredSender(value) {
  let v = value;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const domain = senderDomain(/** @type {Record<string, unknown>} */ (v).address);
  return domain ? normalizeSenderIdentity(v, { allowedDomains: [domain] }) : null;
}
