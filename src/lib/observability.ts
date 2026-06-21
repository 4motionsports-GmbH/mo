// Server-side error logging + optional Sentry integration.
//
// Sentry is initialized on first use only when NEXT_PUBLIC_SENTRY_DSN is set —
// the single DSN injected by the Vercel Sentry integration (a DSN is not a
// secret; it ships in client bundles by design). When it's absent we skip the
// import entirely and log a one-time warning, so a missing DSN is visible (not
// silent) yet observability config never crashes the route. Every route funnels
// unhandled errors through `reportError` — the single Sentry init path — and
// returns a stable JSON envelope via `errorResponse`.
//
// ERRORS ONLY: tracesSampleRate is pinned to 0 — no performance/transaction
// events — so we never burn the free-tier event quota on traces. Error capture
// stays on.

import type * as SentryNS from "@sentry/nextjs";

type SentryModule = typeof SentryNS;

let sentryPromise: Promise<SentryModule | null> | null = null;

// ---------------------------------------------------------------------------
// PII scrubbing (GDPR — LEGAL_READINESS_REPORT §8 OQ-04)
// ---------------------------------------------------------------------------
//
// Error messages / stack values can incidentally carry personal data — a chat
// snippet echoed in an AI-provider error, an address in a Pingen error, or a
// GraphQL `email:"foo@bar.com"` phrase from a Shopify query. The `reportError`
// context object is already kept PII-free by contract, but the exception OBJECT
// is not under our control. So we scrub every outgoing event: redact email
// addresses and the quoted `email:"…"` order-search phrase from the message,
// the exception values, and breadcrumb messages, before anything leaves the
// process. `sendDefaultPii` is also set false so the SDK never auto-attaches
// IPs / headers / cookies / request bodies.

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// Shopify order-search phrase, e.g. email:"foo@bar.com" — redact the whole thing.
const EMAIL_QUERY_RE = /email:"[^"]*"/gi;

/** Redact email-shaped PII from a free-text string. */
export function scrubPiiString(input: unknown): string {
  if (typeof input !== "string" || !input) return typeof input === "string" ? input : "";
  return input.replace(EMAIL_QUERY_RE, 'email:"[redacted]"').replace(EMAIL_RE, "[redacted-email]");
}

/** The free-text-bearing slice of a Sentry event the scrubber touches. */
type ScrubbableEvent = {
  message?: unknown;
  exception?: { values?: Array<{ value?: unknown }> } | null;
  breadcrumbs?: Array<{ message?: unknown }> | null;
};

/**
 * Sentry `beforeSend` hook: scrub PII from the parts of an event that can carry
 * free text (mutates in place, returns the same event). Defensive and total —
 * any failure leaves the event unchanged rather than dropping observability.
 * Generic so it returns the caller's concrete event type unchanged.
 */
export function scrubSentryEvent<T extends ScrubbableEvent>(event: T): T {
  const e: ScrubbableEvent = event;
  try {
    if (typeof e.message === "string") e.message = scrubPiiString(e.message);
    for (const v of e.exception?.values ?? []) {
      if (typeof v.value === "string") v.value = scrubPiiString(v.value);
    }
    for (const b of e.breadcrumbs ?? []) {
      if (typeof b.message === "string") b.message = scrubPiiString(b.message);
    }
  } catch {
    // never let scrubbing break error reporting
  }
  return event;
}

function getSentry(): Promise<SentryModule | null> {
  if (sentryPromise) return sentryPromise;
  // Single source of truth: the DSN injected by the Vercel Sentry integration.
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) {
    // Skip cleanly, but make the missing DSN visible rather than silent. This
    // branch runs at most once per process — sentryPromise is memoized on the
    // next line and short-circuits every later call — so the warning is logged
    // exactly once.
    console.warn(
      "[observability] NEXT_PUBLIC_SENTRY_DSN is not set — Sentry is disabled; " +
        "errors are logged to stdout only."
    );
    sentryPromise = Promise.resolve(null);
    return sentryPromise;
  }
  sentryPromise = import("@sentry/nextjs")
    .then((mod) => {
      try {
        mod.init({
          dsn,
          // ERRORS ONLY — 0 disables performance tracing so transaction events
          // never consume the free-tier event quota. Error capture is unaffected.
          tracesSampleRate: 0,
          environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
          // Never auto-attach IPs / headers / cookies / request bodies.
          sendDefaultPii: false,
          // Redact email-shaped PII from message / exception / breadcrumbs before
          // the event leaves the process (GDPR — OQ-04).
          beforeSend: (event) => scrubSentryEvent(event),
        });
        return mod;
      } catch (err) {
        console.warn("[observability] Sentry init failed", err);
        return null;
      }
    })
    .catch((err) => {
      console.warn("[observability] Sentry import failed", err);
      return null;
    });
  return sentryPromise;
}

export interface ErrorContext {
  route: string;
  messageCount?: number;
  archetype?: string;
  // Free-form tags — keep values primitive and small. NEVER pass secrets,
  // auth headers, or request bodies here.
  [key: string]: unknown;
}

function errorClass(err: unknown): string {
  if (err instanceof Error) return err.name || "Error";
  return typeof err;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  try {
    return String(err);
  } catch {
    return "<unstringifiable error>";
  }
}

export function reportError(err: unknown, ctx: ErrorContext): void {
  const safeCtx = { ...ctx, errorClass: errorClass(err) };
  console.error(`[${ctx.route}] unhandled error`, {
    ...safeCtx,
    // Scrub email-shaped PII before the message hits stdout — application logs
    // are a processor-visible sink, the same reason beforeSend scrubs Sentry
    // events below. The Sentry captureException(err) still receives the raw
    // error (and is scrubbed by scrubSentryEvent), so diagnostics are unchanged.
    message: scrubPiiString(errorMessage(err)),
  });
  getSentry()
    .then((sentry) => {
      if (!sentry) return;
      sentry.withScope((scope) => {
        scope.setTag("route", ctx.route);
        if (ctx.archetype) scope.setTag("archetype", ctx.archetype);
        if (typeof ctx.messageCount === "number") {
          scope.setExtra("messageCount", ctx.messageCount);
        }
        sentry.captureException(err);
      });
    })
    .catch(() => {
      // swallow — observability must never break the request path
    });
}

export type ErrorCode =
  | "bad_request"
  | "unauthorized"
  | "forbidden"
  | "rate_limited"
  | "payload_too_large"
  | "upstream_unavailable"
  | "internal_error"
  // Capture form submitted without the (no-longer-pre-checked) transactional
  // consent — see capture-validation.mjs + API_CONTRACT.md §7.1.
  | "transactional_consent_required"
  // At-sign-in opt-in POSTed without the explicit affirmative marketing tick —
  // a Shopify account never implies consent. See /api/account/marketing-opt-in.
  | "marketing_consent_required"
  // At-sign-in opt-in for an account with no verified email (synthetic
  // shopify:<id> placeholder) — can't run the DOI without a real address.
  | "no_verified_email"
  // Requested resource (e.g. the signed-in customer row) was not found.
  | "not_found";

export interface ErrorEnvelope {
  error: { code: ErrorCode; message: string };
}

export function errorEnvelope(code: ErrorCode, message: string): ErrorEnvelope {
  return { error: { code, message } };
}

export function errorResponse(
  code: ErrorCode,
  message: string,
  status: number,
  headers: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(errorEnvelope(code, message)), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}
