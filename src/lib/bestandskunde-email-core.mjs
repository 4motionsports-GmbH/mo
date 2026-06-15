// Pure assembly for the plain-text body of a §7 Abs. 3 UWG "Bestandskunden"
// (existing-customer) email. Kept in .mjs (no I/O, no template deps) so the
// LEGAL INVARIANT — every §7(3) message MUST carry the free, anytime objection
// notice (§7 Abs. 3 Nr. 4 UWG) — is unit-tested in isolation. The branded HTML
// shell and the German notice copy live on the .ts side (bestandskunde-email.ts,
// consent-copy.ts); this module only orders the text blocks and guarantees the
// objection notice is always present and last.

export const TEST_SUBJECT_PREFIX = "[TEST] ";

const BASE_SUBJECT = "Für dich als bestehende:r Kund:in bei motion sports";

/**
 * Subject for a Bestandskunden email. In test mode it is clearly prefixed so an
 * internal test send is unmistakable in the inbox.
 * @param {{ isTest?: boolean }} [opts]
 * @returns {string}
 */
export function bestandskundeEmailSubject(opts = {}) {
  return opts.isTest ? `${TEST_SUBJECT_PREFIX}${BASE_SUBJECT}` : BASE_SUBJECT;
}

/**
 * Assemble the plain-text body. The objection notice (which carries the opt-out
 * URL) is ALWAYS appended as the final block — a §7(3) email without it is
 * unlawful, so this refuses to build one rather than silently omit it.
 * @param {{ intro: string, marketingLines?: string[], optOutNoticeText: string }} parts
 * @returns {string}
 */
export function bestandskundeEmailText({ intro, marketingLines = [], optOutNoticeText }) {
  if (typeof optOutNoticeText !== "string" || !optOutNoticeText.trim()) {
    throw new Error(
      "bestandskundeEmailText: optOutNoticeText is mandatory (§7 Abs. 3 Nr. 4 UWG)"
    );
  }
  const blocks = [intro, ...marketingLines, optOutNoticeText].filter(
    (b) => typeof b === "string" && b.trim()
  );
  return blocks.join("\n\n");
}
