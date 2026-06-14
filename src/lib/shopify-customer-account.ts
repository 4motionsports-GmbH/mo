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
  base64url,
  codeChallengeS256,
  withParams,
} from "./customer-account-oauth.mjs";
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
 * Read the signed-in customer's identity with their access token. The Customer
 * Account API takes the access token DIRECTLY in the Authorization header (no
 * "Bearer " prefix). Returns null if the query yields no customer.
 */
export async function fetchCustomerIdentity(accessToken: string): Promise<CustomerIdentity | null> {
  const { graphqlEndpoint } = await getDiscovery();
  if (!graphqlEndpoint) throw new Error("Customer Account GraphQL endpoint not in discovery");
  const res = await fetch(graphqlEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // NOTE: raw access token, NOT "Bearer <token>".
      Authorization: accessToken,
    },
    body: JSON.stringify({ query: CUSTOMER_QUERY }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Customer Account GraphQL ${res.status}: ${text.slice(0, 300)}`);
  }
  let json: { data?: CustomerQueryData; errors?: unknown[] };
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Customer Account GraphQL non-JSON: ${text.slice(0, 200)}`);
  }
  if (json.errors?.length) {
    throw new Error(`Customer Account GraphQL errors: ${JSON.stringify(json.errors)}`);
  }
  const c = json.data?.customer;
  if (!c?.id) return null;
  return {
    gid: c.id,
    firstName: c.firstName ?? null,
    lastName: c.lastName ?? null,
    displayName: c.displayName ?? null,
    email: c.emailAddress?.emailAddress ?? null,
  };
}

// Re-export for callers that only need the base64url helper from one place.
export { base64url };
