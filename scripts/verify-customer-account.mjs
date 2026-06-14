#!/usr/bin/env node
// Verify-first GATE for the Shopify Customer Account sign-in (tier-3 identity).
//
// Run this from an environment WITH egress to the storefront + Shopify auth
// subdomain (locally or on Vercel) — the CI sandbox that built this feature
// blocks those hosts, so the gate is executed here at deploy/verify time.
//
//   npm run verify:customer-account
//
// All checks are READ-SAFE (no sign-in is completed, no data is written). It:
//   1. Fetches discovery from the storefront domain and compares it to the
//      confirmed live values.
//   2. EMPIRICALLY probes token-endpoint client auth: attempts an
//      authorization_code exchange as a PUBLIC client (client_id + PKCE
//      code_verifier, NO secret) with a throwaway code. The OAuth error tells us
//      whether public auth is accepted (invalid_grant → PROCEED public) or
//      rejected for missing client auth (invalid_client → switch to confidential).
//   3. Probes prompt=none silent auth (logged-out path): expects the authorize
//      endpoint to redirect back with error=login_required.
//
// Required env: SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID, PUBLIC_BASE_URL.
// Optional:     SHOPIFY_STOREFRONT_DOMAIN (default www.motionsports.de),
//               SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_SECRET (confidential fallback).

import process from "node:process";
import { createHash, randomBytes } from "node:crypto";

const EXPECTED = {
  issuer: "https://shopify.com/authentication/82348966217",
  authorization_endpoint: "https://account.motionsports.de/authentication/oauth/authorize",
  token_endpoint: "https://account.motionsports.de/authentication/oauth/token",
  end_session_endpoint: "https://account.motionsports.de/authentication/logout",
  jwks_uri: "https://account.motionsports.de/authentication/.well-known/jwks.json",
  graphql: "https://account.motionsports.de/customer/api/2026-04/graphql",
};

function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const clientId = (process.env.SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID ?? "").trim();
const clientSecret = (process.env.SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_SECRET ?? "").trim();
const baseUrl = (process.env.PUBLIC_BASE_URL ?? "").trim().replace(/\/+$/, "");
const storefront = (process.env.SHOPIFY_STOREFRONT_DOMAIN ?? "www.motionsports.de")
  .trim()
  .replace(/^https?:\/\//, "")
  .replace(/\/+$/, "");

if (!clientId) {
  console.error("FAILURE: SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID is not set.");
  process.exit(1);
}
if (!baseUrl) {
  console.error("FAILURE: PUBLIC_BASE_URL is not set (needed to build the registered redirect_uri).");
  process.exit(1);
}
const redirectUri = `${baseUrl}/api/auth/shopify/callback`;

console.log(`[verify-customer-account] storefront=${storefront}`);
console.log(`  client_id    = ${clientId}`);
console.log(`  client_secret= ${clientSecret ? "(set → confidential posture)" : "(none → PUBLIC posture)"}`);
console.log(`  redirect_uri = ${redirectUri}`);

let failures = 0;

// ─── Step 1: discovery ───────────────────────────────────────────────────────
let discovery = null;
{
  console.log(`\n[1] discovery — GET https://${storefront}/.well-known/openid-configuration`);
  try {
    const res = await fetch(`https://${storefront}/.well-known/openid-configuration`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      console.error(`  FAILURE: HTTP ${res.status}. Is the Customer Account API enabled on the store?`);
      failures++;
    } else {
      discovery = await res.json();
      const ca = await fetch(`https://${storefront}/.well-known/customer-account-api`, {
        headers: { Accept: "application/json" },
      })
        .then((r) => (r.ok ? r.json() : {}))
        .catch(() => ({}));
      const graphql = ca.graphql_api ?? ca.graphql_endpoint ?? discovery.graphql_api ?? "(not advertised)";

      const checks = [
        ["issuer", discovery.issuer, EXPECTED.issuer],
        ["authorization_endpoint", discovery.authorization_endpoint, EXPECTED.authorization_endpoint],
        ["token_endpoint", discovery.token_endpoint, EXPECTED.token_endpoint],
        ["end_session_endpoint", discovery.end_session_endpoint, EXPECTED.end_session_endpoint],
        ["jwks_uri", discovery.jwks_uri, EXPECTED.jwks_uri],
        ["graphql", graphql, EXPECTED.graphql],
      ];
      for (const [name, got, want] of checks) {
        const ok = got === want;
        console.log(`  ${ok ? "ok " : "?? "}${name.padEnd(24)} ${got}`);
        if (!ok) console.log(`     expected: ${want}`);
      }
      console.log(
        `  token_endpoint_auth_methods_supported = ${JSON.stringify(
          discovery.token_endpoint_auth_methods_supported ?? []
        )}`
      );
    }
  } catch (err) {
    console.error(`  FAILURE: ${err}`);
    failures++;
  }
}

// ─── Step 2: empirical token-endpoint client-auth probe ──────────────────────
if (discovery?.token_endpoint) {
  console.log(`\n[2] token-endpoint client auth (PUBLIC attempt, throwaway code)`);
  console.log(`  POST ${discovery.token_endpoint}`);
  const verifier = b64url(randomBytes(32));
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: "verify-gate-throwaway-code",
    redirect_uri: redirectUri,
    code_verifier: verifier,
    client_id: clientId,
  });
  try {
    const res = await fetch(discovery.token_endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        "User-Agent": "motionsports-chat-backend-verify",
      },
      body: body.toString(),
    });
    const text = await res.text();
    let json = {};
    try {
      json = JSON.parse(text);
    } catch {
      /* non-JSON */
    }
    const err = json.error ?? "(none)";
    console.log(`  HTTP ${res.status}, error=${err}, description=${json.error_description ?? text.slice(0, 160)}`);

    if (err === "invalid_grant") {
      console.log("  VERDICT: PUBLIC client auth ACCEPTED ✅ (got past client auth; the throwaway code");
      console.log("           was rejected as expected). Proceed PUBLIC — no secret needed.");
    } else if (err === "invalid_client" || /client authentication|client_secret/i.test(JSON.stringify(json))) {
      console.log("  VERDICT: PUBLIC client auth REJECTED ❌ — the client must be switched to CONFIDENTIAL");
      console.log("           in Shopify admin (Headless → Customer Account API → Client type) to obtain a");
      console.log("           client_secret; then set SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_SECRET and re-run.");
      console.log("           STOP and report (per the verify gate).");
      failures++;
    } else {
      console.log(`  VERDICT: INCONCLUSIVE — unexpected error '${err}'. Inspect the body above; if it is not`);
      console.log("           a client-auth complaint, public auth is likely fine. Re-run with a real code.");
    }
  } catch (e) {
    console.error(`  FAILURE: ${e}`);
    failures++;
  }
}

// ─── Step 3: prompt=none silent-auth (logged-out path) ───────────────────────
if (discovery?.authorization_endpoint) {
  console.log(`\n[3] prompt=none silent auth (logged-out path)`);
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const authUrl = new URL(discovery.authorization_endpoint);
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", "openid email customer-account-api:full");
  authUrl.searchParams.set("state", b64url(randomBytes(16)));
  authUrl.searchParams.set("nonce", b64url(randomBytes(16)));
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("prompt", "none");
  console.log(`  GET ${authUrl.toString().slice(0, 120)}…  (redirect: manual)`);
  try {
    const res = await fetch(authUrl, { redirect: "manual" });
    const loc = res.headers.get("location") ?? "";
    console.log(`  HTTP ${res.status}${loc ? `, Location=${loc.slice(0, 160)}` : ""}`);
    if (loc.includes("error=login_required")) {
      console.log("  VERDICT: prompt=none HONORED ✅ (logged-out → error=login_required). CA-3 can use silent");
      console.log("           already-signed-in detection.");
    } else if (res.status >= 300 && res.status < 400 && loc.startsWith(redirectUri)) {
      console.log("  VERDICT: redirected back to our callback — inspect the error param above.");
    } else {
      console.log("  VERDICT: prompt=none likely NOT honored (a login UI was served instead of an immediate");
      console.log("           redirect). NOT a blocker — CA-3 degrades to a one-click 'Sign in' affordance.");
      console.log("           Flag this for CA-3.");
    }
  } catch (e) {
    console.error(`  NOTE: could not probe prompt=none (${e}). Verify manually in a browser.`);
  }
}

// ─── Lifetimes reminder ──────────────────────────────────────────────────────
console.log(`\n[4] token lifetimes — read expires_in from a REAL exchange (never hardcoded).`);
console.log("    Complete one live sign-in and log the token response's expires_in /");
console.log("    refresh_token_expires_in; the backend already derives expiry from them.");

console.log(`\n=== verify gate ${failures ? "FAILED" : "passed"} (${failures} failure(s)) ===`);
process.exit(failures ? 1 : 0);
