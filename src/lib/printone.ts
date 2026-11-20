// STUB — replaced by P4 Print (spec §10, printone.ts).
//
// The print.one client (v2 REST: orders, status, cancel). Until P4 lands only
// the configuration check exists; it is already the real rule.

import { isPrintOneConfiguredEnv } from "./gift-voucher-flags.mjs";

/** print.one can print: PRINTONE_API_KEY and PRINTONE_TEMPLATE_ID are set. */
export function isPrintOneConfigured(): boolean {
  return isPrintOneConfiguredEnv(process.env);
}
