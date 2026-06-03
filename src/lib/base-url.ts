// Resolve the public base URL of this backend, used to build the absolute
// links that go into emails (DOI confirmation, unsubscribe). These links are
// clicked as top-level navigations from the user's mail client, so they must be
// absolute and point at THIS deployment.
//
// Prefer the explicit PUBLIC_BASE_URL (e.g. https://chat.motionsports.de). Fall
// back to Vercel's injected host, then to the request's own origin.

function stripTrailingSlash(s: string): string {
  return s.replace(/\/+$/, "");
}

export function getBaseUrl(req?: Request): string {
  const explicit = process.env.PUBLIC_BASE_URL;
  if (explicit) return stripTrailingSlash(explicit);

  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  if (vercel) return `https://${stripTrailingSlash(vercel)}`;

  if (req) {
    try {
      return stripTrailingSlash(new URL(req.url).origin);
    } catch {
      // fall through
    }
  }
  return "https://chat.motionsports.de";
}
