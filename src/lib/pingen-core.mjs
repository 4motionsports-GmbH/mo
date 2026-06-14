// Pure Pingen helpers — host/endpoint resolution, the JSON:API create-letter
// body, status normalisation, token-expiry maths and webhook-event parsing.
// Kept here (no I/O) so the fiddly parts that must be EXACTLY right against the
// Pingen v2 API are unit-tested; the HTTP/token plumbing lives in lib/pingen.ts.
//
// ── VERIFIED AT BUILD TIME (2026-06-14) against the official SDKs (the vendor
//    docs 403 automated fetch, so these were confirmed against the fetchable
//    SDK sources, per docs/EMAIL_SUBSYSTEM_SPIKE.md §4 [VERIFY]):
//      * api.pingen.com (prod) / api-staging.pingen.com (staging);
//        OAuth at identity.pingen.com (identity-staging.pingen.com on staging).
//        — confirmed: pingencom/pingen2-sdk-php, pingencom/pingen2-sdk-python,
//          goneup/go-pingen-sdk.
//      * file-upload:  GET  {api}/file-upload  → signed PUT url + url_signature.
//      * create letter: POST {api}/organisations/{orgId}/letters  (JSON:API,
//        data.type = "letters").
//      * send letter:  POST {api}/organisations/{orgId}/letters/{id}/send.
//      * letter attribute names (verbatim from both the PHP and Go SDKs):
//          file_original_name, file_url, file_url_signature, address_position,
//          auto_send, delivery_product, print_mode, print_spectrum.

/** Resolve the API + identity hosts for the selected environment. */
export function pingenHosts(staging) {
  return staging
    ? { api: "https://api-staging.pingen.com", identity: "https://identity-staging.pingen.com" }
    : { api: "https://api.pingen.com", identity: "https://identity.pingen.com" };
}

/** The OAuth2 client_credentials token endpoint (Pingen v2). */
export function tokenUrl(staging) {
  return `${pingenHosts(staging).identity}/auth/access-tokens`;
}

/** GET this to request a one-shot signed PDF upload URL. */
export function fileUploadUrl(staging) {
  return `${pingenHosts(staging).api}/file-upload`;
}

/** The organisation-scoped letters collection (POST create / GET list). */
export function lettersUrl(staging, organisationId) {
  return `${pingenHosts(staging).api}/organisations/${organisationId}/letters`;
}

/** A single letter (GET status). */
export function letterUrl(staging, organisationId, letterId) {
  return `${lettersUrl(staging, organisationId)}/${letterId}`;
}

/** POST this (no auto_send) to actually dispatch a created letter. */
export function sendLetterUrl(staging, organisationId, letterId) {
  return `${letterUrl(staging, organisationId, letterId)}/send`;
}

/**
 * Build the JSON:API create-letter request body. The address is READ FROM THE
 * PDF by Pingen at `address_position` (we render the recipient block there), so
 * the body carries only the file handle + print options — NOT the address.
 *
 * @param {{ fileUrl: string, fileSignature: string, fileOriginalName: string,
 *           addressPosition?: 'left'|'right', autoSend?: boolean,
 *           deliveryProduct?: string, printMode?: 'simplex'|'duplex',
 *           printSpectrum?: 'color'|'grayscale' }} input
 */
export function buildCreateLetterBody(input) {
  return {
    data: {
      type: "letters",
      attributes: {
        file_original_name: input.fileOriginalName,
        file_url: input.fileUrl,
        file_url_signature: input.fileSignature,
        address_position: input.addressPosition ?? "left",
        auto_send: input.autoSend ?? false,
        delivery_product: input.deliveryProduct ?? "fast",
        print_mode: input.printMode ?? "simplex",
        print_spectrum: input.printSpectrum ?? "grayscale",
      },
    },
  };
}

/** The send-letter body (used only when a letter was created with auto_send=false). */
export function buildSendLetterBody(input) {
  return {
    data: {
      id: input.letterId,
      type: "letters",
      attributes: {
        delivery_product: input.deliveryProduct ?? "fast",
        print_mode: input.printMode ?? "simplex",
        print_spectrum: input.printSpectrum ?? "grayscale",
      },
    },
  };
}

// Pingen exposes many granular letter statuses; we NORMALISE them into the small
// lifecycle the physical_letters CHECK constraint allows (queued → printed →
// posted, plus terminal error states). Unknown/unset → 'submitted' (we DID hand
// it over) so a status we don't recognise never throws away the row.
const STATUS_MAP = new Map([
  // pre-dispatch
  ["created", "submitted"],
  ["validating", "submitted"],
  ["valid", "submitted"],
  ["processing", "submitted"],
  ["submitted", "submitted"],
  // accepted / in the print queue
  ["queued", "queued"],
  ["accepted", "queued"],
  ["sending", "queued"],
  // physically printed
  ["printing", "printing"],
  ["printed", "printed"],
  // handed to the postal service
  ["sent", "posted"],
  ["posted", "posted"],
  ["completed", "posted"],
  ["delivered", "posted"],
  // terminal failures
  ["invalid", "failed"],
  ["failed", "failed"],
  ["error", "failed"],
  ["cancelled", "cancelled"],
  ["canceled", "cancelled"],
  ["undeliverable", "undeliverable"],
  ["returned", "undeliverable"],
]);

/**
 * Map a raw Pingen status string to our internal lifecycle status. Defensive:
 * non-strings and unknown values fall back to 'submitted'.
 * @param {unknown} raw
 * @returns {'submitted'|'queued'|'printing'|'printed'|'posted'|'failed'|'cancelled'|'undeliverable'}
 */
export function normalizePingenStatus(raw) {
  if (typeof raw !== "string") return "submitted";
  return STATUS_MAP.get(raw.trim().toLowerCase()) ?? "submitted";
}

/**
 * Decide whether a cached OAuth token is still usable. Refresh EARLY (default
 * 60s skew) so a token never expires mid-request.
 * @param {{ token: string | null, expiresAtMs: number } | null} cached
 * @param {number} nowMs
 * @param {number} [skewMs]
 */
export function tokenIsFresh(cached, nowMs, skewMs = 60_000) {
  return Boolean(cached && cached.token && cached.expiresAtMs - skewMs > nowMs);
}

/** Absolute expiry (ms epoch) from an OAuth `expires_in` (seconds). */
export function tokenExpiryMs(expiresInSeconds, nowMs) {
  const secs = Number(expiresInSeconds);
  // Default to a conservative 1h if the provider omits/garbles expires_in.
  const safe = Number.isFinite(secs) && secs > 0 ? secs : 3600;
  return nowMs + safe * 1000;
}

/**
 * Pull the letter id, normalised status and (optional) cost from a Pingen
 * status webhook event, defensively across the shapes the payload may take
 * (JSON:API `data.id` + `data.attributes.status`, or a flatter event object).
 *
 * @param {unknown} event
 * @returns {{ providerLetterId: string | null,
 *             status: ReturnType<typeof normalizePingenStatus> | null,
 *             costCents: number | null }}
 */
export function interpretWebhookEvent(event) {
  const e = event && typeof event === "object" ? /** @type {any} */ (event) : {};
  const data = e.data && typeof e.data === "object" ? e.data : {};
  const attrs = data.attributes && typeof data.attributes === "object" ? data.attributes : {};

  // The letter id: prefer an explicit letter reference, else the data object id.
  const providerLetterId =
    firstString([
      attrs.letter_id,
      e.letter_id,
      data.letter_id,
      // A webhook whose primary resource IS the letter.
      data.type === "letters" ? data.id : null,
      attrs.id,
    ]) ?? null;

  const rawStatus = firstString([attrs.status, e.status, data.status]);
  const status = rawStatus != null ? normalizePingenStatus(rawStatus) : null;

  const costCents = parseCostCents(attrs.price ?? attrs.cost ?? e.price);

  return { providerLetterId, status, costCents };
}

function firstString(candidates) {
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return null;
}

/** Pingen prices are decimal currency units (e.g. "0.86" or 0.86); store cents. */
function parseCostCents(value) {
  if (value == null) return null;
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  return Math.round(n * 100);
}
