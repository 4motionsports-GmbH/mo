// GET /api/auth/storefront/whoami — the same shop-native sign-in detection as
// /api/auth/storefront (docs/frontend/ACCOUNT_CONTRACT.md §3a). Shopify's App Proxy
// appends the storefront sub-path to the proxy URL, so with the documented
// proxy URL `…/api/auth/storefront` the theme's `/apps/chat/whoami` arrives
// here. Both paths answer identically; the signature covers only the query.

export { GET } from "../route";

export const runtime = "nodejs";
export const maxDuration = 15;
