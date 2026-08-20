// POST /api/admin/campaign/prepare  { count, discountPercent, textMode? }
//
// Batch pre-generation (Task C): draft the next `count` PENDING campaign
// contacts so the review queue is instant. Sequential with modest concurrency;
// resilient per contact (a failure marks 'draft_failed' and continues). The
// dashboard calls this in small chunks so it can show live progress and stay
// well inside the function-duration limit.
//
// Generation costs API money — this is only ever triggered by the admin
// (deliberately no cron).
//
// Auth + CSRF via guardAdminPost (the proxy already gates /api/admin/*).

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { prepareNextDrafts } from "@/lib/campaign-prepare";
import {
  parseDiscountPercent,
  DISCOUNT_PERCENT_MAX,
} from "@/lib/discount-validation.mjs";
import {
  DEFAULT_EMAIL_TEXT_MODE,
  EMAIL_TEXT_MODES,
  parseEmailTextMode,
} from "@/lib/email-text-mode.mjs";
import type { EmailTextMode } from "@/lib/marketing-draft";
import { reportError } from "@/lib/observability";

export const maxDuration = 300;

// Per-request ceiling — the dashboard chunks larger batches.
const MAX_COUNT_PER_REQUEST = 50;

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;

  let count: number;
  let discountPercent: number;
  let textMode: EmailTextMode;
  try {
    const body = (await req.json()) as {
      count?: unknown;
      discountPercent?: unknown;
      textMode?: unknown;
    };
    count = Number(body.count);
    if (!Number.isInteger(count) || count <= 0 || count > MAX_COUNT_PER_REQUEST) {
      return adminJsonError(
        "bad_request",
        `count must be an integer between 1 and ${MAX_COUNT_PER_REQUEST}.`,
        400
      );
    }
    const parsedPercent = parseDiscountPercent(body.discountPercent ?? 0);
    if (parsedPercent === null) {
      return adminJsonError(
        "bad_request",
        `discountPercent must be a whole number between 0 and ${DISCOUNT_PERCENT_MAX}.`,
        400
      );
    }
    discountPercent = parsedPercent;
    // Optional prose length for the whole batch (default: the modern compact).
    const parsedMode = body.textMode == null ? DEFAULT_EMAIL_TEXT_MODE : parseEmailTextMode(body.textMode);
    if (parsedMode === null) {
      return adminJsonError(
        "bad_request",
        `textMode must be one of: ${EMAIL_TEXT_MODES.join(", ")}.`,
        400
      );
    }
    textMode = parsedMode;
  } catch {
    return adminJsonError("bad_request", "Invalid JSON body", 400);
  }

  try {
    const result = await prepareNextDrafts(count, discountPercent, textMode);
    return adminJson(result);
  } catch (err) {
    reportError(err, { route: "api/admin/campaign/prepare" });
    return adminJsonError("internal_error", "Draft preparation failed.", 500);
  }
}
