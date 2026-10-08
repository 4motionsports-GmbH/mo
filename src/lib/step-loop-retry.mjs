// How the admin step loop (src/app/admin/lib/use-step-loop.ts) treats a
// failed /step request — pure, so it is tested (step-loop-retry.test.mjs).
//
//   network — no answer at all (dropped connection, `adminFetch` status 0):
//             the server may still be working → wait and try again;
//   gateway — the platform answered instead of the route: 502/503/504 or a
//             5xx without the route's JSON envelope (Vercel's error page, e.g.
//             FUNCTION_INVOCATION_TIMEOUT when a step ran into maxDuration),
//             or 429 → the stored state is untouched and resumable → retry a
//             few times;
//   fatal   — the route itself refused (4xx, or a 5xx carrying its JSON
//             error) → stop and show its message.

/**
 * @param {{ status?: unknown, code?: unknown, details?: unknown } | null | undefined} err
 * @returns {"network" | "gateway" | "fatal"}
 */
export function classifyStepFailure(err) {
  const status = Number(err?.status);
  if (err?.code === "network" || status === 0) return "network";
  if (!Number.isFinite(status)) return "fatal";
  if (status === 429 || status === 504) return "gateway";
  const routeAnswered = err?.details !== null && err?.details !== undefined && typeof err.details === "object";
  if (status >= 500 && !routeAnswered) return "gateway";
  return "fatal";
}

/** Consecutive platform errors (without progress in between) before the loop gives up. */
export const GATEWAY_RETRY_MAX = 3;
/** Wait before re-trying after a platform error — a killed step's claim needs a moment. */
export const GATEWAY_RETRY_DELAY_MS = 15_000;

/** The message when the loop gives up after repeated platform errors. */
export const GATEWAY_GIVE_UP_MESSAGE =
  "Der Server hat mehrmals nicht rechtzeitig geantwortet — der Stand ist gespeichert, „Erneut versuchen“ setzt an derselben Stelle fort.";
