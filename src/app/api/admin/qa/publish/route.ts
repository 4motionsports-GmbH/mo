// POST /api/admin/qa/publish  { id }
//
// Publish an ANSWERED entry:
//   - product-linked → write the {q,a} pair into the product's custom.qa
//     metafield in Shopify (metafieldsSet, requires write_products) and
//     refresh that one product in the catalog blob so Mo knows immediately.
//     The storefront PDP Q&A tab reads the same metafield.
//   - general (no product) → mark published; it enters Mo's system prompt
//     knowledge block (qa-store.getCachedGeneralQa) within ~5 minutes.
//
// Re-publishing an edited, already-published entry is allowed — the metafield
// merge replaces the same question instead of duplicating it.

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { recordAdminAccess } from "@/lib/admin-access-log";
import {
  getQaEntry,
  markQaPublished,
  saveQaTranslation,
  invalidateGeneralQaCache,
} from "@/lib/qa-store";
import { generateQaTranslation } from "@/lib/qa-translate";
import { publishQaToProduct } from "@/lib/shopify-qa";
import { reportError } from "@/lib/observability";
import { isShopifyConfigured } from "@/lib/shopify";
import { isDbConfigured } from "@/lib/db";

export const maxDuration = 60;

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;
  if (!isDbConfigured()) {
    return adminJsonError("unavailable", "No database configured", 503);
  }

  let id: number;
  try {
    const body = (await req.json()) as { id?: unknown };
    id = Number(body.id);
    if (!Number.isInteger(id) || id <= 0) {
      return adminJsonError("bad_request", "id required", 400);
    }
  } catch {
    return adminJsonError("bad_request", "Invalid JSON body", 400);
  }

  const entry = await getQaEntry(id);
  if (!entry) return adminJsonError("not_found", "Eintrag nicht gefunden.", 404);
  if (!entry.answer || !["answered", "published"].includes(entry.status)) {
    return adminJsonError(
      "not_answered",
      "Erst beantworten, dann veröffentlichen.",
      409
    );
  }

  await recordAdminAccess(
    { action: "qa.publish", detail: { id, productId: entry.productId } },
    req
  );

  // i18n: the team writes German only — fill the English pair automatically
  // (one cheap Haiku pass) unless the operator already provided/edited it.
  // A failed translation NEVER blocks the publish: the pair goes out
  // German-only and the storefront/prompt fall back to German; re-publishing
  // retries the translation.
  let questionEn = entry.questionEn;
  let answerEn = entry.answerEn;
  let translated = false;
  if (!questionEn || !answerEn) {
    const t = await generateQaTranslation({
      question: entry.question,
      answer: entry.answer,
    });
    if (t.ok) {
      questionEn = t.questionEn;
      answerEn = t.answerEn;
      translated = true;
      await saveQaTranslation({ id, questionEn, answerEn });
    } else {
      reportError(new Error(t.message), {
        route: "api/admin/qa/publish",
        phase: "translate",
      });
    }
  }

  let catalogRefreshed = false;
  if (entry.productId) {
    if (!isShopifyConfigured()) {
      return adminJsonError(
        "shopify_unconfigured",
        "Shopify ist nicht konfiguriert — Produkt-Q&A kann nicht veröffentlicht werden.",
        503
      );
    }
    const res = await publishQaToProduct({
      handle: entry.productId,
      question: entry.question,
      answer: entry.answer,
      questionEn,
      answerEn,
    });
    if (!res.ok) {
      const status = res.reason === "product_not_found" ? 404 : 502;
      return adminJsonError(`publish_${res.reason}`, res.message, status);
    }
    catalogRefreshed = res.catalogRefreshed;
  }

  const updated = await markQaPublished(id);
  invalidateGeneralQaCache();
  return adminJson({
    entry: updated ?? entry,
    catalogRefreshed,
    translated,
    hasEnglish: Boolean(questionEn && answerEn),
  });
}
