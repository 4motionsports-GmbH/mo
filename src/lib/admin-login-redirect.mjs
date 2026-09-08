// Sanitise the `next` parameter of /admin/login (pure, unit-tested). The login
// page sends the operator back to the admin screen they were on when their
// session expired — but only ever to a path inside /admin on this origin, so
// the parameter can never become an open redirect.

export const ADMIN_HOME = "/admin";
const MAX_LENGTH = 512;
// Backslashes, whitespace and control characters have no place in a path.
const FORBIDDEN = /[\\\s\x00-\x1f\x7f]/;

/**
 * @param {unknown} value raw query-string value
 * @returns {string} a safe same-origin path under /admin (defaults to /admin)
 */
export function safeAdminNext(value) {
  if (typeof value !== "string") return ADMIN_HOME;
  const next = value.trim();
  if (!next || next.length > MAX_LENGTH) return ADMIN_HOME;
  // Exactly one leading slash (no protocol-relative "//host") and the path must
  // stay inside the admin subtree.
  if (!next.startsWith("/") || next.startsWith("//")) return ADMIN_HOME;
  if (FORBIDDEN.test(next)) return ADMIN_HOME;
  if (!(next === "/admin" || next.startsWith("/admin/") || next.startsWith("/admin?"))) {
    return ADMIN_HOME;
  }
  // Never bounce back onto the login page itself.
  if (next === "/admin/login" || /^\/admin\/login[/?]/.test(next)) return ADMIN_HOME;
  return next;
}
