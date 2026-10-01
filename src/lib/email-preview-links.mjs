// Admin previews of an e-mail must never act on the recipient.
//
// A rendered campaign/marketing mail carries links that DO something when
// opened: /api/unsubscribe (one-click opt-out), /api/erase-data (deletion),
// /api/confirm-marketing (DOI) and /api/r/<token> (records a click). The admin
// shows those mails in an iframe; a click there is a real GET with the real
// recipient's token — an operator once unsubscribed a customer that way. Every
// admin HTML preview therefore goes through neutralizeRecipientLinks(), which
// points those hrefs at "#" (the label stays, so the footer still reads right).

const ACTION_PATHS = ["/api/unsubscribe", "/api/erase-data", "/api/confirm-marketing", "/api/r/"];

/** True when an href would act on the recipient if opened. */
export function isRecipientActionLink(href) {
  if (typeof href !== "string") return false;
  let path;
  try {
    path = new URL(href, "https://preview.invalid").pathname;
  } catch {
    return false;
  }
  return ACTION_PATHS.some((p) => (p.endsWith("/") ? path.startsWith(p) : path === p));
}

/**
 * Replace every recipient-action href (single or double quoted, any case) with
 * "#". Everything else — shop links, product links, images — is untouched.
 * Non-string input → "".
 */
export function neutralizeRecipientLinks(html) {
  if (typeof html !== "string") return "";
  return html.replace(/(\bhref\s*=\s*)(["'])([^"']*)\2/gi, (match, attr, quote, href) => {
    const decoded = href.replace(/&amp;/g, "&");
    return isRecipientActionLink(decoded) ? `${attr}${quote}#${quote}` : match;
  });
}
