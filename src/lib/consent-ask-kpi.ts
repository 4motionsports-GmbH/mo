// The two server-only measurements of the welcome-voucher test (OPTIN_REWARD
// T6): which variant the server ASSIGNED a session, independent of what the
// widget later showed. Pseudonymous (session-keyed; ids and booleans only),
// at most once per session per 24 h, best-effort — a database problem never
// reaches the caller. Read by kpi-consent-experiment-store.ts and kpi-store.ts.

import type { Locale } from "./locale";
import { signInMarketingConsentCopy } from "./consent-copy";
import { servedCopyFacts } from "./consent-experiment.mjs";
import {
  KPI_CONSENT_ASK_ELIGIBLE,
  KPI_CONSENT_COPY_SERVED,
  recordKpiEventOncePerWindow,
} from "./kpi-events";
import { reportError } from "./observability";

const ONCE_PER_HOURS = 24;
const MAX_SESSION_CHARS = 128;

function boundedSession(sessionId: string | null | undefined): string | null {
  return sessionId?.trim().slice(0, MAX_SESSION_CHARS) || null;
}

/**
 * GET /api/auth/me answered `optInActionable: true`: record the session as
 * eligible for the consent ask, with the variant and mode its sign-in copy
 * assigns (the same pick as /api/consent-copy for this session id and
 * locale). The intention-to-treat population of the test.
 */
export async function recordConsentAskEligible(opts: {
  sessionId: string | null | undefined;
  locale: Locale;
  optInActionable: boolean;
}): Promise<void> {
  const sessionId = boundedSession(opts.sessionId);
  if (!opts.optInActionable || !sessionId) return;
  try {
    // The pick hashes the whole (trimmed) id, exactly as /api/consent-copy does.
    const facts = servedCopyFacts(signInMarketingConsentCopy(opts.locale, opts.sessionId?.trim() ?? null));
    if (!facts.variant) return;
    await recordKpiEventOncePerWindow({
      sessionId,
      event: KPI_CONSENT_ASK_ELIGIBLE,
      data: { variant: facts.variant, mode: facts.mode, locale: opts.locale },
      hours: ONCE_PER_HOURS,
    });
  } catch (err) {
    reportError(err, { route: "lib/consent-ask-kpi", phase: "eligible" });
  }
}

/**
 * GET /api/consent-copy?surface=signin served a per-session copy (several
 * variants active, `private, no-store`) to a request carrying `x-ms-session`:
 * record the variant and what renders. A single-variant copy is CDN-cached
 * and the same for everyone, so the caller skips it.
 */
export async function recordConsentCopyServed(opts: {
  sessionId: string | null | undefined;
  locale: Locale;
  copy: unknown;
}): Promise<void> {
  const sessionId = boundedSession(opts.sessionId);
  if (!sessionId) return;
  try {
    const facts = servedCopyFacts(opts.copy);
    if (!facts.variant) return;
    await recordKpiEventOncePerWindow({
      sessionId,
      event: KPI_CONSENT_COPY_SERVED,
      data: { variant: facts.variant, locale: opts.locale, reward: facts.reward, valueMoment: facts.valueMoment },
      hours: ONCE_PER_HOURS,
    });
  } catch (err) {
    reportError(err, { route: "lib/consent-ask-kpi", phase: "copyServed" });
  }
}
