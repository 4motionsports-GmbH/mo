/** Shared env-var integer parser. */

/**
 * Read process.env[name], parse a base-10 integer, and return it when finite
 * and >= min; otherwise return fallback.
 *
 * @param name     Environment variable name.
 * @param fallback Returned when the var is absent, empty, non-numeric, or
 *                 below min.
 * @param min      Minimum accepted value (default 1, use 0 for >= 0 sites).
 */
export function parseIntEnv(name: string, fallback: number, min = 1): number {
  const raw = process.env[name];
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n >= min ? n : fallback;
}
