// Feature flags of the Geschenkgutscheine (docs/GIFT_VOUCHERS.md).
//
// MINIMAL PLACEHOLDER written by Foundation B (the Shopify side) so the gift-card
// client and the catalog exclusion could be built in parallel. Foundation A owns this
// file: its full version (every GIFT_VOUCHER_* reader, with tests) replaces this one at
// integration — keep only that one.

/**
 * The handles of the two Shopify products behind a Geschenkgutschein: the voucher
 * itself (its variants are the amounts; a REGULAR product, never a Shopify gift-card
 * product) and the „Premium-Karte per Post“ print add-on.
 *   GIFT_VOUCHER_PRODUCT_HANDLE        default "designgutschein"
 *   GIFT_VOUCHER_PRINT_PRODUCT_HANDLE  default "gutschein-premiumkarte"
 *
 * @param {Record<string, string | undefined>} [env]
 * @returns {{ voucher: string, print: string }}
 */
export function giftVoucherProductHandles(env = process.env) {
  return {
    voucher: env.GIFT_VOUCHER_PRODUCT_HANDLE || "designgutschein",
    print: env.GIFT_VOUCHER_PRINT_PRODUCT_HANDLE || "gutschein-premiumkarte",
  };
}
