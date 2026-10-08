// Which discount codes count as the welcome code („Willkommensgutscheine
// eingelöst“ on the KPI tab, OPTIN_REWARD T6). WELCOME_CODE_MATCH is a comma
// list: an exact code (`WELCOME5`) or a prefix ending in `*` (`WELCOME-*`),
// compared case-insensitively. Empty or unset disables the count — the
// dashboard then shows „n/a“, never an estimate. A lone `*` or a `*` inside an
// entry is ignored (it would count every code). Pure, tested.

const MAX_ENTRIES = 20;
const MAX_LENGTH = 64;

/**
 * @typedef {{ enabled: boolean, exact: string[], prefixes: string[] }} WelcomeCodeMatch
 */

/**
 * @param {unknown} raw WELCOME_CODE_MATCH
 * @returns {WelcomeCodeMatch}
 */
export function parseWelcomeCodeMatch(raw) {
  /** @type {Set<string>} */
  const exact = new Set();
  /** @type {Set<string>} */
  const prefixes = new Set();
  const entries = typeof raw === "string" ? raw.split(",") : [];
  for (const e of entries.slice(0, MAX_ENTRIES)) {
    const s = e.trim().toUpperCase();
    if (!s || s.length > MAX_LENGTH) continue;
    if (s.endsWith("*")) {
      const p = s.slice(0, -1);
      if (p && !p.includes("*")) prefixes.add(p);
    } else if (!s.includes("*")) {
      exact.add(s);
    }
  }
  return { enabled: exact.size + prefixes.size > 0, exact: [...exact], prefixes: [...prefixes] };
}

/**
 * @param {unknown} code a discount code from an order
 * @param {WelcomeCodeMatch} match
 */
export function isWelcomeCode(code, match) {
  if (!match?.enabled || typeof code !== "string") return false;
  const c = code.trim().toUpperCase();
  if (!c) return false;
  return match.exact.includes(c) || match.prefixes.some((p) => c.startsWith(p));
}

/**
 * The prefixes as SQL LIKE patterns (`%`, `_` and `\` escaped, default escape
 * character) for `upper(code) LIKE ANY(...)` — the SQL in
 * kpi-consent-experiment-store.ts mirrors isWelcomeCode.
 * @param {WelcomeCodeMatch} match
 */
export function welcomeCodeLikePatterns(match) {
  return (match?.prefixes ?? []).map((p) => `${p.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`);
}
