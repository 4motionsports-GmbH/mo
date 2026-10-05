// Who is signed in to a chat session, and with which proof (P0.3, D-AP1).
// The one resolver behind /api/auth/me, every /api/account/* route and the
// chat memory, so the UI, the account features and Mo's greeting agree.
//
//   token — a Customer Account sign-in in the chat: needs a live access token
//           (refreshed if needed), exactly as before.
//   shop  — an App Proxy link whose shop proof is fresh
//           (APP_PROXY_SIGNIN_MAX_AGE_HOURS while APP_PROXY_SIGNIN_ENABLED).
//           No token and no refresh; the name comes from the cached account
//           summary or the Admin API.
// With the max age at 0 (default) an App Proxy link needs a token, as before.
// Order status stays token-only (order-status.ts). Null-safe, never throws.

import { getSql, type Sql } from "./db";
import { reportError } from "./observability";
import { resolveSignedInLinkWithProof } from "./customer-session-link.mjs";
import { signedInProofFor } from "./signed-in-proof.mjs";
import { appProxyShopProofHours } from "./platform-flags.mjs";
import { getValidAccessToken } from "./customer-oauth-store";

export type SignedInProof = "token" | "shop";

export type LiveSignedInCustomer =
  | {
      customerId: number;
      shopifyCustomerId: string;
      linkKind: "customer_account" | "app_proxy";
      proof: SignedInProof;
      /** Only for the token proof. */
      accessToken: string | null;
    }
  | { fail: "unlinked" | "expired" };

export async function resolveLiveSignedInCustomer(
  sessionId: string | null,
  sql: Sql | null = getSql()
): Promise<LiveSignedInCustomer> {
  const sid = sessionId?.trim() || null;
  if (!sql || !sid) return { fail: "unlinked" };
  try {
    const link = await resolveSignedInLinkWithProof(sql, sid);
    if (!link) return { fail: "unlinked" };
    const proof = signedInProofFor({
      linkKind: link.linkKind,
      authenticatedAt: link.authenticatedAt,
      nowMs: Date.now(),
      shopProofHours: appProxyShopProofHours(),
    });
    if (!proof) return { fail: "unlinked" };
    if (proof === "shop") {
      return {
        customerId: link.customerId,
        shopifyCustomerId: link.shopifyCustomerId,
        linkKind: link.linkKind,
        proof,
        accessToken: null,
      };
    }
    const accessToken = await getValidAccessToken(link.customerId, sql);
    if (!accessToken) return { fail: "expired" };
    return {
      customerId: link.customerId,
      shopifyCustomerId: link.shopifyCustomerId,
      linkKind: link.linkKind,
      proof,
      accessToken,
    };
  } catch (err) {
    reportError(err, { route: "lib/signed-in-session", phase: "resolve" });
    return { fail: "unlinked" };
  }
}
