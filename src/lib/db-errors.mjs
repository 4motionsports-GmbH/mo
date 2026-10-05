// Postgres error classification (pure, tested). Neon surfaces the server's
// SQLSTATE as `err.code`; a transaction wraps it, sometimes one level down
// (`err.cause`).

const UNDEFINED_COLUMN = "42703";

/** @param {unknown} err @returns {string | null} */
function sqlState(err) {
  if (!err || typeof err !== "object") return null;
  const e = /** @type {{ code?: unknown, cause?: unknown }} */ (err);
  if (typeof e.code === "string") return e.code;
  if (e.cause && typeof e.cause === "object") {
    const c = /** @type {{ code?: unknown }} */ (e.cause);
    if (typeof c.code === "string") return c.code;
  }
  return null;
}

/**
 * True when a query failed because a column does not exist (SQLSTATE 42703) —
 * the code shipped before its additive migration ran. Callers that write a new
 * nullable column use it to retry without that column, so the deploy order of
 * code and migration does not lose data.
 * @param {unknown} err
 */
export function isUndefinedColumnError(err) {
  return sqlState(err) === UNDEFINED_COLUMN;
}
