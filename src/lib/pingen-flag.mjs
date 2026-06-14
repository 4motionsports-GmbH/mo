// PHYSICAL-MAIL send gate — the lawyer/processor sign-off flag for Pingen.
//
// Kept in plain .mjs (pure, no I/O) so the part with legal consequences is
// unit-tested in isolation, mirroring the BESTANDSKUNDE_SENDS_APPROVED gate in
// lib/bestandskunden.mjs.
//
// ⚠️ Pingen is a NEW DATA PROCESSOR — recipient postal address → Pingen (CH) →
// Deutsche Post — so it needs its OWN AV-Vertrag (DPA) and a CH third-country
// transfer note (docs/EMAIL_SUBSYSTEM_SPIKE.md §4). The whole physical-send path
// (REST client, table, PDF render, webhook) is BUILT regardless, but NO real
// letter is handed to Pingen until (a) that DPA + address-acquisition decision
// land and (b) this flag is flipped on. SEPARATE from BESTANDSKUNDE_SENDS_APPROVED
// (which gates §7(3) email) and from CONSENT_COPY_LAWYER_APPROVED (DOI email).

const TRUTHY = new Set(["1", "true", "yes", "on"]);

/**
 * Whether REAL physical letters may be handed to Pingen. Reads
 * PHYSICAL_MAIL_SENDS_APPROVED; defaults to FALSE (fail-closed) for any absent,
 * empty, or unrecognised value.
 *
 * @param {Record<string, string | undefined>} [env]
 * @returns {boolean}
 */
export function isPhysicalMailSendsApproved(env = process.env) {
  const raw = env.PHYSICAL_MAIL_SENDS_APPROVED;
  if (typeof raw !== "string") return false;
  return TRUTHY.has(raw.trim().toLowerCase());
}
