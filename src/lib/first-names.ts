// Which words are first names — for the first-name fallbacks of a mail
// (first-name-fallback.mjs, docs/EMAIL_TEMPLATES.md §2). A word is a name when
// a customer is called that way (knownFirstNames) or it is a first name of the
// shop's own people in the imprint (MAIL_COMPANY_LINES — „Geschäftsführer:
// Sabine Brunner, Lucas Brunner“), known even when no customer carries it.
// Used by the Rundmail release check and runner (mailing-send.ts) and the
// KI-Gestalter's draft check (mail-template-assist.ts). Fail-soft: the
// customer lookup returns [] on an error, the imprint names stay.

import { knownFirstNames } from "./customer-store";
import { MAIL_COMPANY_LINES } from "./mail-template-render.mjs";
import { peopleFirstNames } from "./first-name-fallback.mjs";

/** The shop's own people's first names (lower case). */
const PEOPLE_FIRST_NAMES = peopleFirstNames(MAIL_COMPANY_LINES);

/** The words (lower case) that are first names: a customer's or the imprint's. Never throws. */
export async function firstNamesAmong(words: ReadonlyArray<string>): Promise<string[]> {
  const list = [...new Set(words.map((w) => String(w).toLowerCase()))];
  if (list.length === 0) return [];
  const known = await knownFirstNames(list);
  return [...new Set([...known, ...list.filter((w) => PEOPLE_FIRST_NAMES.includes(w))])];
}
