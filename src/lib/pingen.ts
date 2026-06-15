// Pingen v2 REST client — physical letters via Pingen → Deutsche Post.
//
// There is NO official JS/TS SDK (PHP/Python/Go only), so we call the REST API
// directly — a thin OAuth2 (client_credentials) + multipart-ish flow. All the
// endpoint paths, hosts and JSON:API field names are VERIFIED + documented in
// lib/pingen-core.mjs (against the official SDKs; the vendor docs 403 automated
// fetch, per docs/EMAIL_SUBSYSTEM_SPIKE.md §4 [VERIFY]).
//
// uploadAndCreate flow (one logical "send a letter"):
//   1. GET  /file-upload                      → a signed PUT url + url_signature
//   2. PUT  <signed url> (the PDF bytes)
//   3. POST /organisations/{org}/letters      → create the letter referencing
//        the uploaded file (address_position, product/colour/duplex, auto_send),
//        with an Idempotency-Key so a retry never prints twice
//   4. (optional) POST /letters/{id}/send     → dispatch, when auto_send=false
//
// DEFENSIVE: every method returns a discriminated result and never throws past
// the client boundary — the orchestration (lib/physical-mail) decides how to
// surface a failure. The bearer token is cached + refreshed early.

import {
  pingenHosts,
  tokenUrl,
  fileUploadUrl,
  lettersUrl,
  letterUrl,
  sendLetterUrl,
  buildCreateLetterBody,
  buildSendLetterBody,
  normalizePingenStatus,
  tokenIsFresh,
  tokenExpiryMs,
} from "./pingen-core.mjs";
import { reportError } from "./observability";

// ── Config ──────────────────────────────────────────────────────────────────

function staging(): boolean {
  const raw = process.env.PINGEN_STAGING;
  if (typeof raw !== "string") return false;
  return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
}

function organisationId(): string | undefined {
  return process.env.PINGEN_ORGANISATION_ID?.trim() || undefined;
}

/** Whether the Pingen client has the credentials it needs to talk to the API. */
export function isPingenConfigured(): boolean {
  return Boolean(
    process.env.PINGEN_CLIENT_ID &&
      process.env.PINGEN_CLIENT_SECRET &&
      organisationId()
  );
}

// ── OAuth token cache ─────────────────────────────────────────────────────────

let cachedToken: { token: string | null; expiresAtMs: number } | null = null;

/**
 * A valid bearer token (client_credentials grant), cached and refreshed early.
 * Returns null when unconfigured or the grant fails (logged).
 */
async function getAccessToken(): Promise<string | null> {
  if (tokenIsFresh(cachedToken, Date.now()) && cachedToken) return cachedToken.token;

  const clientId = process.env.PINGEN_CLIENT_ID;
  const clientSecret = process.env.PINGEN_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  try {
    const res = await fetch(tokenUrl(staging()), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });
    if (!res.ok) {
      reportError(new Error(`Pingen token grant failed: ${res.status}`), {
        route: "lib/pingen",
        phase: "getAccessToken",
      });
      return null;
    }
    const json = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!json.access_token) return null;
    cachedToken = {
      token: json.access_token,
      expiresAtMs: tokenExpiryMs(json.expires_in, Date.now()),
    };
    return cachedToken.token;
  } catch (err) {
    reportError(err, { route: "lib/pingen", phase: "getAccessToken" });
    return null;
  }
}

// ── Low-level helpers ─────────────────────────────────────────────────────────

type ClientError =
  | { ok: false; reason: "unconfigured" | "auth" | "network" | "api"; message: string };

async function authedHeaders(extra?: Record<string, string>): Promise<Record<string, string> | null> {
  const token = await getAccessToken();
  if (!token) return null;
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.api+json",
    ...extra,
  };
}

// ── Flow steps ────────────────────────────────────────────────────────────────

export interface FileUpload {
  url: string;
  signature: string;
}

/** (1) Request a one-shot signed URL to PUT the PDF to. */
async function requestFileUpload(): Promise<{ ok: true; upload: FileUpload } | ClientError> {
  const headers = await authedHeaders();
  if (!headers) return { ok: false, reason: "auth", message: "Pingen auth failed" };
  try {
    const res = await fetch(fileUploadUrl(staging()), { method: "GET", headers });
    if (!res.ok) {
      return { ok: false, reason: "api", message: `file-upload ${res.status}` };
    }
    const json = (await res.json()) as {
      data?: { attributes?: { url?: string; url_signature?: string } };
    };
    const url = json.data?.attributes?.url;
    const signature = json.data?.attributes?.url_signature;
    if (!url || !signature) {
      return { ok: false, reason: "api", message: "file-upload: missing url/signature" };
    }
    return { ok: true, upload: { url, signature } };
  } catch (err) {
    reportError(err, { route: "lib/pingen", phase: "requestFileUpload" });
    return { ok: false, reason: "network", message: "file-upload request failed" };
  }
}

/** (2) PUT the PDF bytes to the signed URL (no auth header — the URL is signed). */
async function putFile(url: string, pdf: Uint8Array): Promise<{ ok: true } | ClientError> {
  try {
    const res = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/pdf" },
      // Uint8Array is a valid BodyInit; copy into a fresh view to satisfy types.
      body: new Uint8Array(pdf),
    });
    if (!res.ok) return { ok: false, reason: "api", message: `file PUT ${res.status}` };
    return { ok: true };
  } catch (err) {
    reportError(err, { route: "lib/pingen", phase: "putFile" });
    return { ok: false, reason: "network", message: "file PUT failed" };
  }
}

export interface LetterResult {
  id: string;
  status: ReturnType<typeof normalizePingenStatus>;
  costCents: number | null;
}

export interface CreateLetterOptions {
  addressPosition?: "left" | "right";
  autoSend?: boolean;
  deliveryProduct?: string;
  printMode?: "simplex" | "duplex";
  printSpectrum?: "color" | "grayscale";
}

function parseLetter(json: unknown): LetterResult | null {
  const data = (json as { data?: { id?: string; attributes?: Record<string, unknown> } })?.data;
  if (!data?.id) return null;
  const attrs = data.attributes ?? {};
  const price = attrs.price;
  const costCents =
    price == null ? null : Number.isFinite(Number(price)) ? Math.round(Number(price) * 100) : null;
  return {
    id: data.id,
    status: normalizePingenStatus(attrs.status),
    costCents,
  };
}

/** (3) Create the letter referencing the uploaded file. Idempotency-Key guards
 *  against a retry creating (and printing) a second letter. */
async function createLetter(
  upload: FileUpload,
  fileOriginalName: string,
  idempotencyKey: string,
  opts: CreateLetterOptions
): Promise<{ ok: true; letter: LetterResult } | ClientError> {
  const org = organisationId();
  if (!org) return { ok: false, reason: "unconfigured", message: "PINGEN_ORGANISATION_ID not set" };
  const headers = await authedHeaders({
    "Content-Type": "application/vnd.api+json",
    "Idempotency-Key": idempotencyKey,
  });
  if (!headers) return { ok: false, reason: "auth", message: "Pingen auth failed" };

  const bodyJson = buildCreateLetterBody({
    fileUrl: upload.url,
    fileSignature: upload.signature,
    fileOriginalName,
    addressPosition: opts.addressPosition,
    autoSend: opts.autoSend,
    deliveryProduct: opts.deliveryProduct,
    printMode: opts.printMode,
    printSpectrum: opts.printSpectrum,
  });

  try {
    const res = await fetch(lettersUrl(staging(), org), {
      method: "POST",
      headers,
      body: JSON.stringify(bodyJson),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return { ok: false, reason: "api", message: `create letter ${res.status} ${detail.slice(0, 300)}` };
    }
    const letter = parseLetter(await res.json());
    if (!letter) return { ok: false, reason: "api", message: "create letter: no id in response" };
    return { ok: true, letter };
  } catch (err) {
    reportError(err, { route: "lib/pingen", phase: "createLetter" });
    return { ok: false, reason: "network", message: "create letter failed" };
  }
}

/** (4) Dispatch a letter created with auto_send=false. */
export async function sendLetter(
  letterId: string,
  opts: CreateLetterOptions = {}
): Promise<{ ok: true; letter: LetterResult } | ClientError> {
  const org = organisationId();
  if (!org) return { ok: false, reason: "unconfigured", message: "PINGEN_ORGANISATION_ID not set" };
  const headers = await authedHeaders({ "Content-Type": "application/vnd.api+json" });
  if (!headers) return { ok: false, reason: "auth", message: "Pingen auth failed" };
  try {
    const res = await fetch(sendLetterUrl(staging(), org, letterId), {
      method: "POST",
      headers,
      body: JSON.stringify(
        buildSendLetterBody({
          letterId,
          deliveryProduct: opts.deliveryProduct,
          printMode: opts.printMode,
          printSpectrum: opts.printSpectrum,
        })
      ),
    });
    if (!res.ok) return { ok: false, reason: "api", message: `send letter ${res.status}` };
    // Some send responses echo the letter; fall back to a status fetch.
    const letter = parseLetter(await res.json().catch(() => ({})));
    if (letter) return { ok: true, letter };
    return { ok: true, letter: { id: letterId, status: "queued", costCents: null } };
  } catch (err) {
    reportError(err, { route: "lib/pingen", phase: "sendLetter" });
    return { ok: false, reason: "network", message: "send letter failed" };
  }
}

/** Fetch one letter's current status (status webhooks are primary; this is the
 *  poll fallback for reconciliation). */
export async function getLetter(
  letterId: string
): Promise<{ ok: true; letter: LetterResult } | ClientError> {
  const org = organisationId();
  if (!org) return { ok: false, reason: "unconfigured", message: "PINGEN_ORGANISATION_ID not set" };
  const headers = await authedHeaders();
  if (!headers) return { ok: false, reason: "auth", message: "Pingen auth failed" };
  try {
    const res = await fetch(letterUrl(staging(), org, letterId), { method: "GET", headers });
    if (!res.ok) return { ok: false, reason: "api", message: `get letter ${res.status}` };
    const letter = parseLetter(await res.json());
    if (!letter) return { ok: false, reason: "api", message: "get letter: no id" };
    return { ok: true, letter };
  } catch (err) {
    reportError(err, { route: "lib/pingen", phase: "getLetter" });
    return { ok: false, reason: "network", message: "get letter failed" };
  }
}

export interface UploadAndCreateInput {
  pdf: Uint8Array;
  fileOriginalName: string;
  /** A stable key (e.g. derived from the physical_letters row) so a retry is safe. */
  idempotencyKey: string;
  options?: CreateLetterOptions;
  /** When true (default), the letter is created with auto_send and dispatched
   *  in one step; false leaves it as a draft at Pingen for a manual send. */
  autoSend?: boolean;
}

/**
 * The whole flow: request upload URL → PUT the PDF → create the letter (with
 * Idempotency-Key + auto_send). Returns the provider letter id + normalised
 * status, or a typed error at the step that failed.
 */
export async function uploadAndCreate(
  input: UploadAndCreateInput
): Promise<{ ok: true; letter: LetterResult } | ClientError> {
  if (!isPingenConfigured()) {
    return { ok: false, reason: "unconfigured", message: "Pingen is not configured" };
  }
  const autoSend = input.autoSend ?? true;

  const up = await requestFileUpload();
  if (!up.ok) return up;

  const put = await putFile(up.upload.url, input.pdf);
  if (!put.ok) return put;

  return createLetter(up.upload, input.fileOriginalName, input.idempotencyKey, {
    ...input.options,
    autoSend,
  });
}

/** Re-export so callers don't reach into the core for the one mapping they need. */
export { normalizePingenStatus, pingenHosts };
