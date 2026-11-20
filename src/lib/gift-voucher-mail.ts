// STUB — replaced by P3 Issuing (spec §9, gift-voucher-mail.ts).
//
// The voucher mail: shop vouchers to the buyer, admin vouchers with delivery
// 'email' to the recipient, with the PDF attached and a download link.
// Placeholder: sends nothing and reports "skipped"; never throws.

export type GiftVoucherMailOutcome = "sent" | "skipped" | "failed";

/**
 * Send (or resend) the mail of a voucher. `downloadToken` is the plain token
 * of the download link when the caller just created it (only its hash is
 * stored); without it a new link is created.
 */
export async function sendGiftVoucherMail(id: number, opts: { downloadToken?: string | null } = {}): Promise<GiftVoucherMailOutcome> {
  void id;
  void opts;
  return "skipped";
}
