// I/O side of the page context on typed product-page messages (A3): the
// holdout share from the environment. Rules: page-context.mjs (tested).

import { parseHoldoutPct } from "./page-context.mjs";

/** CHAT_PAGE_CONTEXT_HOLDOUT_PCT → 0–50 % of sessions as the control group (default 0). */
export function pageContextHoldoutPct(): number {
  return parseHoldoutPct(process.env.CHAT_PAGE_CONTEXT_HOLDOUT_PCT);
}
