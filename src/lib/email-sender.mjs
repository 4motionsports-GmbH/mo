// Who Mo's mail comes from — the display name and the Reply-To rule. Pure and
// tested (email-sender.test.mjs); src/lib/email.ts and email-inbound.ts apply
// it to the env values.
//
// The display name belongs to the code, not to the env value: the brand is
// written in lower case („motion sports“) and an env value typed by hand
// („Mo von Motion Sports <…>“) put the wrong spelling into every inbox (owner,
// 13.10.2026). CONTACT_FROM_EMAIL therefore only supplies the ADDRESS — a
// display name in it is ignored; EMAIL_SENDER_NAME overrides the name.

/** The From display name of every mail Mo sends. */
export const MO_SENDER_NAME = "Mo von motion sports";

/**
 * The bare address of a mailbox value: "Name <a@b.de>", "<a@b.de>" or
 * "a@b.de" → "a@b.de" (case kept). "" when there is no plausible address.
 * @param {unknown} value
 * @returns {string}
 */
export function mailboxAddress(value) {
  if (typeof value !== "string") return "";
  const angled = /<([^<>]+)>/.exec(value);
  const candidate = (angled ? angled[1] : value).trim();
  return /^[^\s@<>",]+@[^\s@<>",]+\.[^\s@<>",]+$/.test(candidate) ? candidate : "";
}

/**
 * A display name as RFC 5322 wants it: plain words stay as they are, anything
 * with specials (comma, quotes, brackets, @ …) is quoted with \ and " escaped.
 * @param {string} name
 * @returns {string}
 */
export function quoteDisplayName(name) {
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (/^[\p{L}\p{N} !#$%&'*+\-/=?^_`{|}~.]+$/u.test(trimmed)) return trimmed;
  return `"${trimmed.replace(/["\\]/g, (c) => `\\${c}`)}"`;
}

/**
 * The From header Mo sends with: the code's display name (or the override)
 * in front of the address taken from the env value. undefined when the env
 * value holds no address (mail is then "not configured").
 * @param {unknown} envValue  CONTACT_FROM_EMAIL
 * @param {unknown} [nameOverride]  EMAIL_SENDER_NAME
 * @returns {string | undefined}
 */
export function formatSender(envValue, nameOverride) {
  const address = mailboxAddress(envValue);
  if (!address) return undefined;
  const name = typeof nameOverride === "string" && nameOverride.trim() ? nameOverride : MO_SENDER_NAME;
  return `${quoteDisplayName(name)} <${address}>`;
}

/**
 * The Reply-To for an outbound mail: the inbound address, but none when it is
 * the From address itself (mo@… sends and receives) — a Reply-To equal to From
 * says nothing and only adds a header.
 * @param {unknown} inboundAddress  INBOUND_EMAIL_ADDRESS
 * @param {unknown} fromValue  the From header
 * @returns {string | undefined}
 */
export function replyToFor(inboundAddress, fromValue) {
  const inbound = mailboxAddress(inboundAddress);
  if (!inbound) return undefined;
  const from = mailboxAddress(fromValue);
  if (from && from.toLowerCase() === inbound.toLowerCase()) return undefined;
  return inbound;
}
