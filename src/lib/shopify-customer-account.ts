// Shopify Customer Account API client — OAuth 2.0 authorization-code + PKCE
// (S256) sign-in for tier-3 identity. SEPARATE from the Admin client
// (lib/shopify.ts): different client, different credentials, different host.
//
// Confirmed setup (see the task brief + docs/CUSTOMER_ACCOUNT_SPIKE.md):
//   * PUBLIC client (web app), no secret — the browser NEVER holds tokens. The
//     widget gets the `code`; this BACKEND does the PKCE exchange and holds both
//     tokens server-side (encrypted: lib/token-crypto.ts).
//   * Endpoints are resolved from discovery on the STOREFRONT domain at runtime
//     and cached; discovery is the source of truth (we never hardcode the auth
//     host). Auth happens on the Shopify-managed account.* subdomain via a
//     full-page top-level redirect — we never fetch it, only the browser is sent.
//   * Token-endpoint client auth is verified empirically by
//     scripts/verify-customer-account.mjs. Discovery advertises
//     client_secret_basic; a PUBLIC client uses PKCE with NO secret. This module
//     attempts public-PKCE first and, only if a secret is configured (the
//     confidential fallback), uses HTTP Basic — so the empirical outcome is an
//     env flip, not a code change.
//
// Everything reads `expires_in` from the live response (lifetimes are NEVER
// hardcoded) and handles refresh-token ROTATION.

import { getBaseUrl } from "./base-url";
import {
  codeChallengeS256,
  withParams,
} from "./customer-account-oauth.mjs";
import {
  buildAccountSummary,
  deriveDisplayName,
  mapCustomerAccountOrders,
  CA_ORDER_HISTORY_MAX_ORDERS,
  CA_ORDER_MAX_LINE_ITEMS,
} from "./customer-account-data.mjs";
import type { OrderHistory } from "./shopify-orders";
import { chooseLawfulAddress } from "./postal-address.mjs";
import { createPublicKey, verify as cryptoVerify, type JsonWebKey } from "node:crypto";

export const CUSTOMER_ACCOUNT_SCOPES = "openid email customer-account-api:full";
const DISCOVERY_TTL_MS = 60 * 60 * 1000; // 1h — discovery is stable
const JWKS_TTL_MS = 60 * 60 * 1000;
const CLOCK_SKEW_SEC = 60;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function envTrim(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

export function customerAccountClientId(): string | undefined {
  return envTrim("SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID");
}

/** Optional — present only when the client was switched to confidential. */
export function customerAccountClientSecret(): string | undefined {
  return envTrim("SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_SECRET");
}

/** Public storefront domain that hosts the discovery documents. */
function storefrontDomain(): string {
  return (envTrim("SHOPIFY_STOREFRONT_DOMAIN") ?? "www.motionsports.de")
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
}

/** The registered callback, always built from PUBLIC_BASE_URL (never hardcoded). */
export function customerAccountRedirectUri(req?: Request): string {
  return `${getBaseUrl(req)}/api/auth/shopify/callback`;
}

/** The registered logout-return URI (matches the Shopify admin registration). */
export function customerAccountLogoutReturnUri(req?: Request): string {
  return `${getBaseUrl(req)}/api/auth/shopify/logout/return`;
}

/** True when the Customer Account client id is configured (no secret needed). */
export function isCustomerAccountConfigured(): boolean {
  return Boolean(customerAccountClientId());
}

/**
 * Secret used to HMAC-sign the OAuth `state`. Prefer a dedicated key; fall back
 * to CHAT_SHARED_SECRET so a deployment that hasn't set the dedicated one still
 * gets signed state. Returns null when neither is set (the route fails closed).
 */
export function authStateSecret(): string | null {
  return (
    envTrim("SHOPIFY_CUSTOMER_ACCOUNT_STATE_SECRET") ??
    envTrim("CHAT_SHARED_SECRET") ??
    null
  );
}

/** Pending-auth TTL in minutes (default 10). */
export function pendingAuthTtlMinutes(): number {
  const raw = envTrim("CUSTOMER_AUTH_PENDING_TTL_MINUTES");
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 10;
}

// ---------------------------------------------------------------------------
// Discovery — the source of truth for endpoints, fetched at runtime + cached.
// ---------------------------------------------------------------------------

export interface CustomerAccountDiscovery {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  endSessionEndpoint: string | null;
  jwksUri: string;
  graphqlEndpoint: string;
  tokenEndpointAuthMethodsSupported: string[];
  fetchedAt: number;
}

let discoveryCache: CustomerAccountDiscovery | null = null;

async function fetchJson(url: string): Promise<Record<string, unknown>> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Discovery fetch ${url} → HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`Discovery ${url} returned non-JSON: ${text.slice(0, 200)}`);
  }
}

/**
 * Resolve the OIDC + Customer-Account discovery documents from the storefront
 * domain. Cached for an hour; pass `force` to bypass the cache.
 */
export async function getDiscovery(force = false): Promise<CustomerAccountDiscovery> {
  if (!force && discoveryCache && Date.now() - discoveryCache.fetchedAt < DISCOVERY_TTL_MS) {
    return discoveryCache;
  }
  const domain = storefrontDomain();
  const [oidc, ca] = await Promise.all([
    fetchJson(`https://${domain}/.well-known/openid-configuration`),
    fetchJson(`https://${domain}/.well-known/customer-account-api`).catch(() => ({})),
  ]);

  const authorizationEndpoint = String(oidc.authorization_endpoint ?? "");
  const tokenEndpoint = String(oidc.token_endpoint ?? "");
  const jwksUri = String(oidc.jwks_uri ?? "");
  // The GraphQL endpoint can be advertised by either document depending on the
  // shop; prefer the customer-account-api doc, fall back to the OIDC one.
  const graphqlEndpoint = String(
    (ca as Record<string, unknown>).graphql_api ??
      (ca as Record<string, unknown>).graphql_endpoint ??
      oidc.graphql_api ??
      ""
  );

  if (!authorizationEndpoint || !tokenEndpoint || !jwksUri) {
    throw new Error(
      "Customer Account discovery is missing required endpoints (authorization/token/jwks) — is the Customer Account API enabled on the store?"
    );
  }

  discoveryCache = {
    issuer: String(oidc.issuer ?? ""),
    authorizationEndpoint,
    tokenEndpoint,
    endSessionEndpoint: oidc.end_session_endpoint ? String(oidc.end_session_endpoint) : null,
    jwksUri,
    graphqlEndpoint,
    tokenEndpointAuthMethodsSupported: Array.isArray(oidc.token_endpoint_auth_methods_supported)
      ? (oidc.token_endpoint_auth_methods_supported as string[])
      : [],
    fetchedAt: Date.now(),
  };
  return discoveryCache;
}

// ---------------------------------------------------------------------------
// Authorization request
// ---------------------------------------------------------------------------

export interface BuildAuthUrlInput {
  state: string; // signed state
  nonce: string;
  codeVerifier: string;
  redirectUri: string;
  /** Silent auth — returns a code with no UI when a storefront session exists. */
  promptNone?: boolean;
}

/** Build the top-level authorization redirect URL from discovery. */
export async function buildAuthorizationUrl(input: BuildAuthUrlInput): Promise<string> {
  const clientId = customerAccountClientId();
  if (!clientId) throw new Error("SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID is not set");
  const { authorizationEndpoint } = await getDiscovery();
  const params: Record<string, string> = {
    client_id: clientId,
    response_type: "code",
    redirect_uri: input.redirectUri,
    scope: CUSTOMER_ACCOUNT_SCOPES,
    state: input.state,
    nonce: input.nonce,
    code_challenge: codeChallengeS256(input.codeVerifier),
    code_challenge_method: "S256",
  };
  if (input.promptNone) params.prompt = "none";
  return withParams(authorizationEndpoint, params);
}

export interface BuildEndSessionUrlInput {
  /**
   * Where Shopify sends the browser AFTER logging out — our registered Logout
   * URI (customerAccountLogoutReturnUri), typically carrying ?session=&return_url=
   * so that route can drop the server-side tokens and bounce to the storefront.
   */
  postLogoutRedirectUri: string;
  /** Optional id_token_hint, when available, to skip Shopify's logout prompt. */
  idTokenHint?: string | null;
}

/**
 * Build the top-level end-session (logout) redirect URL from discovery. The
 * widget can't construct this itself — it never sees discovery or tokens — so
 * logout is server-initiated, mirroring login. Returns null when the store does
 * not advertise an end_session_endpoint (the caller then falls back to a local
 * sign-out via the logout-return route directly).
 */
export async function buildEndSessionUrl(
  input: BuildEndSessionUrlInput
): Promise<string | null> {
  const { endSessionEndpoint } = await getDiscovery();
  if (!endSessionEndpoint) return null;
  const params: Record<string, string> = {
    post_logout_redirect_uri: input.postLogoutRedirectUri,
  };
  const clientId = customerAccountClientId();
  if (clientId) params.client_id = clientId;
  if (input.idTokenHint) params.id_token_hint = input.idTokenHint;
  return withParams(endSessionEndpoint, params);
}

// ---------------------------------------------------------------------------
// Token exchange + refresh
// ---------------------------------------------------------------------------

export interface TokenSet {
  accessToken: string;
  refreshToken: string | null;
  idToken: string | null;
  /** Seconds until the access token expires (read from the live response). */
  expiresIn: number;
  /** Seconds until the refresh token expires, when advertised. */
  refreshExpiresIn: number | null;
  scope: string;
  tokenType: string;
}

interface RawTokenResponse {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
  refresh_token_expires_in?: number;
  refresh_expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
}

function mapTokenResponse(j: RawTokenResponse): TokenSet {
  if (!j.access_token) {
    throw new Error("Token response missing access_token");
  }
  // Lifetimes ALWAYS read from the response — never hardcoded.
  const expiresIn = typeof j.expires_in === "number" ? j.expires_in : 0;
  const refreshExpiresIn =
    typeof j.refresh_token_expires_in === "number"
      ? j.refresh_token_expires_in
      : typeof j.refresh_expires_in === "number"
        ? j.refresh_expires_in
        : null;
  return {
    accessToken: j.access_token,
    refreshToken: j.refresh_token ?? null,
    idToken: j.id_token ?? null,
    expiresIn,
    refreshExpiresIn,
    scope: j.scope ?? CUSTOMER_ACCOUNT_SCOPES,
    tokenType: j.token_type ?? "Bearer",
  };
}

/** A token-endpoint rejection that distinguishes "client auth" failures. */
export class TokenEndpointError extends Error {
  oauthError: string | null;
  needsClientAuth: boolean;
  status: number;
  constructor(message: string, oauthError: string | null, status: number) {
    super(message);
    this.name = "TokenEndpointError";
    this.oauthError = oauthError;
    this.status = status;
    // invalid_client (and some servers' invalid_request "client authentication")
    // means our public attempt was rejected → switch the client to confidential.
    this.needsClientAuth =
      oauthError === "invalid_client" ||
      /client authentication|client_secret/i.test(message);
  }
}

async function postToken(
  body: Record<string, string>,
  opts: { useBasic: boolean }
): Promise<TokenSet> {
  const { tokenEndpoint } = await getDiscovery();
  const clientId = customerAccountClientId();
  if (!clientId) throw new Error("SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID is not set");

  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
    // Shopify's Customer Account token endpoint expects a browser-like Origin /
    // User-Agent; send a stable backend identifier.
    "User-Agent": "motionsports-chat-backend",
  };
  const params = new URLSearchParams({ ...body, client_id: clientId });

  if (opts.useBasic) {
    const secret = customerAccountClientSecret();
    if (!secret) throw new Error("client_secret_basic requested but no secret configured");
    headers.Authorization =
      "Basic " + Buffer.from(`${clientId}:${secret}`).toString("base64");
  }

  const res = await fetch(tokenEndpoint, {
    method: "POST",
    headers,
    body: params.toString(),
  });
  const text = await res.text();
  let json: RawTokenResponse = {};
  try {
    json = JSON.parse(text) as RawTokenResponse;
  } catch {
    /* non-JSON error body */
  }

  if (!res.ok || json.error) {
    const oauthError = json.error ?? null;
    const desc = json.error_description ?? text.slice(0, 300);
    throw new TokenEndpointError(
      `Token endpoint ${res.status}: ${oauthError ?? "error"} — ${desc}`,
      oauthError,
      res.status
    );
  }
  return mapTokenResponse(json);
}

/**
 * Exchange an authorization code (+ PKCE verifier) for tokens, SERVER-SIDE.
 * Attempts the PUBLIC (no-secret) PKCE form first; if a secret is configured it
 * uses client_secret_basic; and if the public attempt is rejected for missing
 * client authentication while a secret IS available, it retries with Basic.
 */
export async function exchangeAuthorizationCode(input: {
  code: string;
  codeVerifier: string;
  redirectUri: string;
}): Promise<TokenSet> {
  const body = {
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.redirectUri,
    code_verifier: input.codeVerifier,
  };
  const hasSecret = Boolean(customerAccountClientSecret());
  // Configured posture: secret present → confidential (client_secret_basic);
  // else PUBLIC (PKCE, no secret — the confirmed setup).
  try {
    return await postToken(body, { useBasic: hasSecret });
  } catch (err) {
    // Public exchange rejected for missing client authentication and we have no
    // secret to fall back to — surface a clear, actionable error (the client
    // must be switched to Confidential in Shopify admin).
    if (err instanceof TokenEndpointError && err.needsClientAuth && !hasSecret) {
      throw new Error(
        "Customer Account token endpoint rejected the PUBLIC (PKCE, no-secret) exchange for missing client authentication. " +
          "Switch the client to Confidential in Shopify admin (Headless → Customer Account API → Client type) to obtain a client_secret, " +
          "then set SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_SECRET. Original: " +
          err.message
      );
    }
    throw err;
  }
}

/**
 * Refresh the access token using the refresh token. Expect ROTATION — the
 * response carries a NEW refresh_token that MUST be persisted atomically (the
 * old one is invalidated; reusing it fails invalid_grant).
 */
export async function refreshTokens(refreshToken: string): Promise<TokenSet> {
  const body = {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  };
  const hasSecret = Boolean(customerAccountClientSecret());
  return postToken(body, { useBasic: hasSecret });
}

// ---------------------------------------------------------------------------
// id_token verification (JWKS) — verify signature + iss/aud/nonce/exp.
// ---------------------------------------------------------------------------

interface Jwk {
  kid?: string;
  kty: string;
  n?: string;
  e?: string;
  alg?: string;
  use?: string;
}

let jwksCache: { keys: Jwk[]; fetchedAt: number } | null = null;

async function getJwks(force = false): Promise<Jwk[]> {
  if (!force && jwksCache && Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS) {
    return jwksCache.keys;
  }
  const { jwksUri } = await getDiscovery();
  const doc = await fetchJson(jwksUri);
  const keys = Array.isArray(doc.keys) ? (doc.keys as Jwk[]) : [];
  jwksCache = { keys, fetchedAt: Date.now() };
  return keys;
}

const RS_ALG: Record<string, string> = {
  RS256: "RSA-SHA256",
  RS384: "RSA-SHA384",
  RS512: "RSA-SHA512",
};

function decodeSegment(seg: string): Buffer {
  return Buffer.from(seg.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

export interface IdTokenClaims {
  sub: string;
  iss?: string;
  aud?: string | string[];
  nonce?: string;
  email?: string;
  exp?: number;
  [k: string]: unknown;
}

/**
 * Verify a Shopify id_token against the JWKS and check iss / aud / nonce / exp.
 * Returns the decoded claims on success; throws on any failure (fail-closed).
 */
export async function verifyIdToken(
  idToken: string,
  expected: { nonce: string }
): Promise<IdTokenClaims> {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new Error("id_token is not a well-formed JWT");
  const [headerB64, payloadB64, sigB64] = parts;

  const header = JSON.parse(decodeSegment(headerB64).toString("utf8")) as {
    alg?: string;
    kid?: string;
  };
  const alg = header.alg ?? "";
  const cryptoAlg = RS_ALG[alg];
  if (!cryptoAlg) {
    // Reject 'none' and any non-RSA alg outright (alg-confusion guard).
    throw new Error(`Unsupported id_token alg: ${alg || "(none)"}`);
  }

  // Find the signing key by kid, refreshing the JWKS once on a miss (rotation).
  let keys = await getJwks();
  let jwk = keys.find((k) => k.kid === header.kid) ?? (header.kid ? undefined : keys[0]);
  if (!jwk) {
    keys = await getJwks(true);
    jwk = keys.find((k) => k.kid === header.kid);
  }
  if (!jwk) throw new Error(`No JWKS key matches id_token kid ${header.kid}`);

  const pubKey = createPublicKey({ key: jwk as unknown as JsonWebKey, format: "jwk" });
  const signingInput = Buffer.from(`${headerB64}.${payloadB64}`);
  const signature = decodeSegment(sigB64);
  const ok = cryptoVerify(cryptoAlg, signingInput, pubKey, signature);
  if (!ok) throw new Error("id_token signature verification failed");

  const claims = JSON.parse(decodeSegment(payloadB64).toString("utf8")) as IdTokenClaims;

  // iss must match discovery.
  const { issuer } = await getDiscovery();
  if (issuer && claims.iss && claims.iss !== issuer) {
    throw new Error(`id_token iss mismatch: ${claims.iss} != ${issuer}`);
  }
  // aud must contain our client id.
  const clientId = customerAccountClientId();
  const aud = claims.aud;
  const audOk = Array.isArray(aud) ? aud.includes(clientId ?? "") : aud === clientId;
  if (clientId && !audOk) {
    throw new Error("id_token aud does not match our client id");
  }
  // nonce must match the one we minted.
  if (claims.nonce !== expected.nonce) {
    throw new Error("id_token nonce mismatch");
  }
  // exp (with small skew).
  if (typeof claims.exp === "number" && claims.exp + CLOCK_SKEW_SEC < Date.now() / 1000) {
    throw new Error("id_token is expired");
  }
  if (!claims.sub) throw new Error("id_token has no sub");
  return claims;
}

// ---------------------------------------------------------------------------
// Customer GraphQL query (customer-scoped access token).
// ---------------------------------------------------------------------------

export interface CustomerIdentity {
  /** Full GID: gid://shopify/Customer/<numeric>. */
  gid: string;
  firstName: string | null;
  lastName: string | null;
  displayName: string | null;
  email: string | null;
}

const CUSTOMER_QUERY = /* GraphQL */ `
  query SignedInCustomer {
    customer {
      id
      firstName
      lastName
      displayName
      emailAddress { emailAddress }
    }
  }
`;

interface CustomerQueryData {
  customer: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    displayName: string | null;
    emailAddress: { emailAddress: string | null } | null;
  } | null;
}

/**
 * Run a Customer Account API GraphQL query with the customer-scoped access
 * token. The endpoint takes the access token DIRECTLY in the Authorization
 * header (no "Bearer " prefix), per Shopify. Throws on HTTP / GraphQL errors so
 * callers can fail closed.
 */
async function customerAccountGraphql<T>(
  accessToken: string,
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const { graphqlEndpoint } = await getDiscovery();
  if (!graphqlEndpoint) throw new Error("Customer Account GraphQL endpoint not in discovery");
  const res = await fetch(graphqlEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // NOTE: raw access token, NOT "Bearer <token>".
      Authorization: accessToken,
    },
    body: JSON.stringify({ query, variables }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Customer Account GraphQL ${res.status}: ${text.slice(0, 300)}`);
  }
  let json: { data?: T; errors?: unknown[] };
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Customer Account GraphQL non-JSON: ${text.slice(0, 200)}`);
  }
  if (json.errors?.length) {
    throw new Error(`Customer Account GraphQL errors: ${JSON.stringify(json.errors)}`);
  }
  return json.data as T;
}

/**
 * Read the signed-in customer's identity with their access token. Returns null
 * if the query yields no customer.
 */
export async function fetchCustomerIdentity(accessToken: string): Promise<CustomerIdentity | null> {
  const data = await customerAccountGraphql<CustomerQueryData>(accessToken, CUSTOMER_QUERY);
  const c = data?.customer;
  if (!c?.id) return null;
  return {
    gid: c.id,
    firstName: c.firstName ?? null,
    lastName: c.lastName ?? null,
    displayName: c.displayName ?? null,
    email: c.emailAddress?.emailAddress ?? null,
  };
}

// ---------------------------------------------------------------------------
// Richer signed-in data (tier-3 CA-2/CA-3) — name + addresses + order history.
// ---------------------------------------------------------------------------
//
// ⚠️ Customer Account API field shapes DIFFER from the Admin Customer object and
// MUST be re-verified against the rendered schema (see the verify gate in
// docs/CUSTOMER_ACCOUNT.md). Known differences baked in below:
//   * email is wrapped: emailAddress { emailAddress }
//   * the order date is `processedAt` (Admin uses `createdAt`)
//   * the order total is a flat MoneyV2 `totalPrice { amount currencyCode }`
//     (Admin wraps it in currentTotalPriceSet { shopMoney { … } })
//   * the status field is `financialStatus` (Admin: `displayFinancialStatus`)
//   * the default address exposes `territoryCode` (ISO country)
// To stay robust against any residual shape drift we split the addresses+orders
// read into its OWN query, isolated from the identity read: if it fails (e.g. a
// renamed field), the name still resolves (greeting works) and only the
// history-personalisation degrades. Normalisation lives in the pure, unit-tested
// customer-account-data.mjs.

const CUSTOMER_DATA_QUERY = /* GraphQL */ `
  query SignedInCustomerData($ordersFirst: Int!, $lineItemsFirst: Int!, $addressesFirst: Int!) {
    customer {
      id
      firstName
      lastName
      displayName
      emailAddress { emailAddress }
      defaultAddress {
        city
        territoryCode
      }
      addresses(first: $addressesFirst) {
        nodes { id }
      }
      orders(first: $ordersFirst, sortKey: PROCESSED_AT, reverse: true) {
        nodes {
          id
          name
          processedAt
          financialStatus
          totalPrice { amount currencyCode }
          lineItems(first: $lineItemsFirst) {
            nodes { title quantity }
          }
        }
      }
    }
  }
`;

// FULL address read for physical mail — kept in its OWN query, run fault-isolated
// (lib §4 address acquisition). This must NEVER affect the order-history /
// account-summary read above: if a field here is unavailable on the Customer
// Account API schema (or the token can't read addresses), the address read fails
// soft to "no address" while order history keeps working. defaultAddress is the
// customer's saved account address → basis 'consented_capture'.
const CUSTOMER_ADDRESS_QUERY = /* GraphQL */ `
  query SignedInCustomerAddress {
    customer {
      defaultAddress {
        city
        territoryCode
        address1
        address2
        zip
        firstName
        lastName
        company
        name
      }
    }
  }
`;

export interface SignedInAddressContext {
  city: string | null;
  countryCode: string | null;
}

export interface SignedInAccountSummary {
  displayName: string | null;
  firstName: string | null;
  addressContext: SignedInAddressContext | null;
  addressCount: number;
  fetchedAt: string;
}

export interface SignedInCustomerData {
  identity: CustomerIdentity | null;
  /** Name + DATA-MINIMISED address context (city/country only). */
  accountSummary: SignedInAccountSummary | null;
  /** Normalised order history (same shape as customers.purchase_summary). */
  orderHistory: OrderHistory | null;
  /**
   * The FULL lawful postal address for physical mail (migration 0022), derived
   * from a completed order's shipping address (basis 'purchase') or the saved
   * profile address (basis 'consented_capture'). Kept SEPARATE from the
   * minimised accountSummary and NEVER fed to the profile model. Null when no
   * complete address is on file. See lib/postal-address.
   */
  lawfulAddress: { address: Record<string, unknown>; source: string } | null;
}

/**
 * Pull the interesting signed-in data for tier 3: identity (name), a compact
 * address context, and the full order history. Fault-isolated and fail-soft:
 * the identity is read first (it backs the greeting); the addresses+orders read
 * is best-effort, so a schema drift there degrades to "name only" rather than
 * losing the whole result. Never throws.
 */
export async function fetchSignedInCustomerData(
  accessToken: string
): Promise<SignedInCustomerData> {
  let dataCustomer: Record<string, unknown> | null = null;
  try {
    const data = await customerAccountGraphql<{ customer: Record<string, unknown> | null }>(
      accessToken,
      CUSTOMER_DATA_QUERY,
      {
        ordersFirst: CA_ORDER_HISTORY_MAX_ORDERS,
        lineItemsFirst: CA_ORDER_MAX_LINE_ITEMS,
        addressesFirst: 10,
      }
    );
    dataCustomer = data?.customer ?? null;
  } catch {
    // Richer read failed (likely a CA-schema field drift) — fall back to the
    // minimal identity query so the greeting still works.
    dataCustomer = null;
  }

  if (dataCustomer && dataCustomer.id) {
    const c = dataCustomer as {
      id: string;
      firstName?: string | null;
      lastName?: string | null;
      displayName?: string | null;
      emailAddress?: { emailAddress?: string | null } | null;
    };
    const identity: CustomerIdentity = {
      gid: c.id,
      firstName: c.firstName ?? null,
      lastName: c.lastName ?? null,
      displayName: c.displayName ?? null,
      email: c.emailAddress?.emailAddress ?? null,
    };
    // Derive the FULL lawful address in a SEPARATE, fault-isolated read so it can
    // NEVER break the order-history / account-summary result above (a missing
    // address field or an address-read permission gap → "no address", not a 502).
    const lawfulAddress = await fetchSignedInLawfulAddress(accessToken);

    return {
      identity,
      accountSummary: buildAccountSummary(dataCustomer) as SignedInAccountSummary,
      orderHistory: mapCustomerAccountOrders(dataCustomer) as OrderHistory,
      lawfulAddress,
    };
  }

  // Degraded path: identity only.
  try {
    const identity = await fetchCustomerIdentity(accessToken);
    return {
      identity,
      accountSummary: identity
        ? {
            displayName: identity.displayName ?? deriveDisplayName(identity),
            firstName: identity.firstName,
            addressContext: null,
            addressCount: 0,
            fetchedAt: new Date().toISOString(),
          }
        : null,
      orderHistory: null,
      lawfulAddress: null,
    };
  } catch {
    return { identity: null, accountSummary: null, orderHistory: null, lawfulAddress: null };
  }
}

/**
 * Read the signed-in customer's saved account address for physical mail, FAULT-
 * ISOLATED: its own Customer Account API query in its own try/catch, so a schema
 * gap or an address-read permission issue degrades to null WITHOUT affecting the
 * order-history / account-summary read. The saved default address is the
 * customer's own account address → lawful basis 'consented_capture'. (The
 * 'purchase' basis from order shipping addresses is captured on the Admin-API
 * path, lib/shopify-orders.) Returns null on anything unexpected.
 */
async function fetchSignedInLawfulAddress(
  accessToken: string
): Promise<{ address: Record<string, unknown>; source: string } | null> {
  try {
    const data = await customerAccountGraphql<{
      customer: { defaultAddress: Record<string, unknown> | null } | null;
    }>(accessToken, CUSTOMER_ADDRESS_QUERY, {});
    const defaultAddress = data?.customer?.defaultAddress ?? null;
    return chooseLawfulAddress({ defaultAddress });
  } catch {
    return null;
  }
}
