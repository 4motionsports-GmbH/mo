// The voucher retention's row selection (gift-voucher-store.ts purgeGiftVoucherData)
// and the balance write it depends on (updateGiftVoucherBalance). Both are SQL in
// TypeScript, which tests cannot import — so these are source-level guardrails
// that pin the decided statements; a change to them is a retention decision
// (docs/DATA_RETENTION.md), not a refactoring.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./gift-voucher-store.ts", import.meta.url), "utf8");
const squash = (s) => s.replace(/\s+/g, " ").trim();

/** The source of one exported async function, from its signature to its closing brace. */
function fnSource(name) {
  const start = src.indexOf(`export async function ${name}(`);
  assert.ok(start >= 0, `${name} exists`);
  const end = src.indexOf("\n}\n", start);
  assert.ok(end > start, `${name} ends`);
  return src.slice(start, end);
}

test("GUARDRAIL: the voucher retention anonymises ended vouchers and old held TEST orders — never an owed voucher", () => {
  const body = squash(fnSource("purgeGiftVoucherData"));
  const start = body.indexOf("WITH ended AS (");
  const end = body.indexOf("), upd AS (", start);
  assert.ok(start >= 0 && end > start, "the ended CTE");
  assert.equal(
    body.slice(start + "WITH ended AS (".length, end).trim(),
    squash(`
      SELECT id, photo_pathname FROM gift_vouchers
       WHERE personal_data_purged_at IS NULL
         AND ((status NOT IN ('pending', 'held', 'issuing')
               AND ((expires_on IS NOT NULL
                     AND expires_on < (now() AT TIME ZONE 'Europe/Berlin')::date - \${personalDays}::int)
                    OR (status = 'deactivated' AND COALESCE(deactivated_at, updated_at) < \${cutoff}::timestamptz)
                    OR (status IN ('cancelled', 'rejected', 'failed') AND updated_at < \${cutoff}::timestamptz)
                    OR (balance_cents = 0 AND updated_at < \${cutoff}::timestamptz)))
              OR (status = 'held' AND hold_reason IN ('test_order', 'refunded') AND updated_at < \${cutoff}::timestamptz))
    `),
    "a held voucher is a paid order whose voucher is still owed — only a test order (no money) may be anonymised; " +
      "'used up' counts from the last change (updated_at), not from the last balance read"
  );
});

test("GUARDRAIL: the anonymisation clears every personal text — the team's note and deactivation reason too", () => {
  const body = squash(fnSource("purgeGiftVoucherData"));
  const start = body.indexOf("upd AS ( UPDATE gift_vouchers v SET ");
  const end = body.indexOf(" FROM ended e", start);
  assert.ok(start >= 0 && end > start, "the anonymising UPDATE");
  const set = body
    .slice(start + "upd AS ( UPDATE gift_vouchers v SET ".length, end)
    .split(",")
    .map((s) => s.trim());
  assert.deepEqual(set, [
    "recipient_name = NULL",
    "sender_name = NULL",
    "message = NULL",
    "buyer_name = NULL",
    "buyer_email = NULL",
    "recipient_email = NULL",
    "photo_pathname = NULL",
    "download_token_hash = NULL",
    // Operator free text („Absprache mit der Kundin …“) may name the person.
    "admin_note = NULL",
    "deactivation_reason = NULL",
    "personal_data_purged_at = now()",
    "updated_at = now()",
  ]);
});

test("GUARDRAIL: an unchanged balance read is no activity (updated_at stays), a changed one is", () => {
  const body = squash(fnSource("updateGiftVoucherBalance"));
  assert.ok(body.includes("balance_checked_at = now()"), "every read is stamped");
  assert.ok(
    body.includes("updated_at = CASE WHEN balance_cents IS DISTINCT FROM ${balanceCents}::int THEN now() ELSE updated_at END"),
    "updated_at moves only when the balance changed (SET reads the old balance_cents)"
  );
  assert.ok(!/updated_at = now\(\)/.test(body.replace("THEN now()", "")), "no unconditional updated_at = now()");
});
