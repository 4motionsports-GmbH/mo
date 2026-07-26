// POST /api/admin/qa/answer  { id, answer, question?, productId?, productTitle? }
//
// The operator saves (or edits) the answer — and may correct the question
// wording and the product attribution. A non-empty answer moves an open entry
// to 'answered'; clearing the answer moves it back to 'open'. A published
// entry stays 'published' (use publish again to push the edit to Shopify).

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { recordAdminAccess } from "@/lib/admin-access-log";
import { saveQaAnswer } from "@/lib/qa-store";
import { loadProductCatalog } from "@/lib/catalog-store";
import { isDbConfigured } from "@/lib/db";

export const maxDuration = 15;

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;
  if (!isDbConfigured()) {
    return adminJsonError("unavailable", "No database configured", 503);
  }

  let id: number;
  let answer: string;
  let question: string | undefined;
  let productId: string | null;
  let questionEn: string | undefined;
  let answerEn: string | undefined;
  try {
    const body = (await req.json()) as {
      id?: unknown;
      answer?: unknown;
      question?: unknown;
      productId?: unknown;
      questionEn?: unknown;
      answerEn?: unknown;
    };
    id = Number(body.id);
    if (!Number.isInteger(id) || id <= 0) {
      return adminJsonError("bad_request", "id required", 400);
    }
    answer = typeof body.answer === "string" ? body.answer.trim().slice(0, 4000) : "";
    question =
      typeof body.question === "string" && body.question.trim()
        ? body.question.trim().slice(0, 500)
        : undefined;
    productId =
      typeof body.productId === "string" && body.productId.trim()
        ? body.productId.trim()
        : null;
    // English override (i18n): a string always applies — "" clears the cached
    // translation (→ fresh auto-translation on next publish); absent = keep.
    questionEn =
      typeof body.questionEn === "string" ? body.questionEn.trim().slice(0, 500) : undefined;
    answerEn =
      typeof body.answerEn === "string" ? body.answerEn.trim().slice(0, 4000) : undefined;
  } catch {
    return adminJsonError("bad_request", "Invalid JSON body", 400);
  }

  // Product attribution must point at a real catalog product; the title is
  // resolved server-side (never trusted from the client).
  let productTitle: string | null = null;
  if (productId) {
    const catalog = await loadProductCatalog().catch(() => []);
    const product = catalog.find((p) => p.id === productId);
    if (!product) {
      return adminJsonError(
        "unknown_product",
        `Kein Katalog-Produkt mit Handle "${productId}" — Handle prüfen oder Feld leeren (allgemeine Frage).`,
        400
      );
    }
    productTitle = product.name;
  }

  await recordAdminAccess({ action: "qa.answer", detail: { id } }, req);

  const entry = await saveQaAnswer({
    id,
    answer,
    question,
    productId,
    productTitle,
    questionEn,
    answerEn,
  });
  if (!entry) return adminJsonError("not_found", "Eintrag nicht gefunden.", 404);
  return adminJson({ entry });
}
