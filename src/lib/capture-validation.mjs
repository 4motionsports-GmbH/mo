// Validation for POST /api/capture-email — kept in plain .mjs (pure, no I/O)
// so it is trivially unit-testable with node:test and shared by the TS route,
// mirroring the email-offer-trigger.mjs convention.
//
// CONSENT COPY v2 — BOTH checkboxes start UNCHECKED (client-approved product
// decision, see docs/CONSENT_FLOW.md): the transactional box is no longer
// pre-checked, so a submit without it is a real user-facing state, not just a
// malformed request. The form's only purpose is the summary email — a capture
// without transactional consent is invalid and is rejected with the dedicated,
// documented error code `transactional_consent_required` (HTTP 400), so the
// widget can show a targeted "bitte Häkchen setzen" hint instead of a generic
// error.

import { apiMessage } from "./api-messages.mjs";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Documented error code for a capture submitted without transactional
 * consent. Stable — the widget dispatches on it (see API_CONTRACT.md §7.1).
 */
export const CAPTURE_ERROR_TRANSACTIONAL_REQUIRED = "transactional_consent_required";

/**
 * @param {unknown} email
 * @returns {email is string}
 */
export function isValidEmail(email) {
  return typeof email === "string" && EMAIL_RE.test(email.trim());
}

/**
 * Validate the load-bearing fields of a capture request. Returns either
 * `{ ok: true }` or `{ ok: false, code, message }` where `code` is a stable
 * error-envelope code and `message` a user-safe, locale-appropriate string
 * (German default — byte-identical to before). The route maps a failure to
 * HTTP 400 verbatim.
 *
 * @param {{ email: unknown, transactionalConsent: unknown }} input
 * @param {"de" | "en"} [locale]
 * @returns {{ ok: true } | { ok: false, code: "bad_request" | "transactional_consent_required", message: string }}
 */
export function validateCaptureRequest({ email, transactionalConsent }, locale = "de") {
  if (!isValidEmail(email)) {
    return { ok: false, code: "bad_request", message: apiMessage("invalid_email", locale) };
  }
  // The form exists to send the summary: without the (now actively-checked)
  // transactional consent there is nothing valid to submit. Strictly `true`
  // only — any other value (false, missing, truthy string) is a rejection.
  if (transactionalConsent !== true) {
    return {
      ok: false,
      code: CAPTURE_ERROR_TRANSACTIONAL_REQUIRED,
      message: apiMessage("transactional_consent_required", locale),
    };
  }
  return { ok: true };
}
