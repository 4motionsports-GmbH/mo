// The pure half of the Art. 15 / Art. 20 account export (lib/account-export.ts):
// how a row the export reads becomes an entry of the JSON document. No I/O, so
// node:test covers it (account-export-core.test.mjs).

import { formatGiftVoucherNumber } from "./gift-voucher-core.mjs";

/**
 * gift_vouchers columns that never leave the system, not even in the person's
 * own export: the encrypted code, its lookup hash and the hash of the e-mailed
 * download link (bearer secrets — whoever holds the card need not be the
 * person asking; the export shows code_last4 instead), and the operators'
 * internal note.
 */
export const GIFT_VOUCHER_EXPORT_HIDDEN_COLUMNS = Object.freeze([
  "code_enc",
  "code_hash",
  "download_token_hash",
  "admin_note",
]);

/**
 * One Geschenkgutschein of the export: the number people see („G-2026-00042“,
 * from the id and the creation date; null when either is missing) first, then
 * the row as read. The export query never selects a hidden column; they are
 * dropped here too, so a wider SELECT cannot leak them.
 * @param {Record<string, unknown>} row
 * @returns {Record<string, unknown>}
 */
export function giftVoucherExportEntry(row) {
  /** @type {Record<string, unknown>} */
  const entry = {
    number: formatGiftVoucherNumber(row.id, /** @type {Date | string | number} */ (row.created_at)),
    ...row,
  };
  for (const column of GIFT_VOUCHER_EXPORT_HIDDEN_COLUMNS) delete entry[column];
  return entry;
}
