// Publish an answered Q&A pair to the product's `custom.qa` metafield in
// Shopify — the single source of truth the storefront PDP Q&A tab renders and
// the catalog sync feeds back into Mo's context (docs/QA_KNOWLEDGE.md).
//
// Flow per publish:
//   1. Resolve the catalog handle → product GID + the CURRENT custom.qa value
//      (one query; read-merge-write keeps concurrent publishes append-safe
//      enough for a single-operator admin queue).
//   2. metafieldsSet with the merged JSON list (type "json"). Requires the
//      app to have the write_products scope.
//   3. Best-effort: refresh the ONE product in the catalog blob via the same
//      targeted path the stock webhook uses, so Mo knows the new Q&A
//      immediately instead of after the nightly sync.
//
// The metafield shape ({q,a} JSON array) lives in qa-core.mjs — shared with
// the catalog mapper and documented for the theme.

import { adminGraphql } from "./shopify";
import {
  QA_METAFIELD_KEY,
  QA_METAFIELD_NAMESPACE,
  mergeQaList,
  parseQaMetafield,
  removeQaFromList,
  serializeQaMetafield,
} from "./qa-core.mjs";
import { refreshProductInCatalog } from "./catalog-mutate";
import { reportError } from "./observability";

export type PublishQaResult =
  | { ok: true; productGid: string; qaCount: number; catalogRefreshed: boolean }
  | { ok: false; reason: "product_not_found" | "shopify_error"; message: string };

interface ProductForQa {
  productByIdentifier: {
    id: string;
    title: string;
    metafield: { value: string | null } | null;
  } | null;
}

const PRODUCT_FOR_QA_QUERY = /* GraphQL */ `
  query ProductForQa($handle: String!) {
    productByIdentifier(identifier: { handle: $handle }) {
      id
      title
      metafield(namespace: "${QA_METAFIELD_NAMESPACE}", key: "${QA_METAFIELD_KEY}") {
        value
      }
    }
  }
`;

const METAFIELDS_SET_MUTATION = /* GraphQL */ `
  mutation QaMetafieldsSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

/**
 * Publish (or re-publish, on an edit) one Q&A pair to a product. Merging is
 * fingerprint-based: an edited answer to the same question REPLACES the old
 * pair instead of duplicating it.
 */
export async function publishQaToProduct(input: {
  handle: string;
  question: string;
  answer: string;
  // Optional English pair (auto-translated or operator-provided) — stored as
  // q_en/a_en in the metafield; absent → the storefront falls back to German.
  questionEn?: string | null;
  answerEn?: string | null;
}): Promise<PublishQaResult> {
  let product: ProductForQa["productByIdentifier"];
  try {
    const data = await adminGraphql<ProductForQa>(PRODUCT_FOR_QA_QUERY, {
      handle: input.handle,
    });
    product = data.productByIdentifier;
  } catch (err) {
    return {
      ok: false,
      reason: "shopify_error",
      message: `Produkt-Lookup fehlgeschlagen: ${(err as Error).message}`,
    };
  }
  if (!product?.id) {
    return {
      ok: false,
      reason: "product_not_found",
      message: `Kein Shopify-Produkt mit Handle "${input.handle}" gefunden.`,
    };
  }

  const merged = mergeQaList(parseQaMetafield(product.metafield?.value), {
    question: input.question,
    answer: input.answer,
    ...(input.questionEn && input.answerEn
      ? { questionEn: input.questionEn, answerEn: input.answerEn }
      : {}),
  });

  try {
    const res = await adminGraphql<{
      metafieldsSet: {
        metafields: Array<{ id: string }> | null;
        userErrors: Array<{ field?: string[] | null; message: string }>;
      };
    }>(METAFIELDS_SET_MUTATION, {
      metafields: [
        {
          ownerId: product.id,
          namespace: QA_METAFIELD_NAMESPACE,
          key: QA_METAFIELD_KEY,
          type: "json",
          value: serializeQaMetafield(merged),
        },
      ],
    });
    const errors = res.metafieldsSet?.userErrors ?? [];
    if (errors.length > 0) {
      return {
        ok: false,
        reason: "shopify_error",
        message: `metafieldsSet: ${errors.map((e) => e.message).join("; ")}`,
      };
    }
  } catch (err) {
    return {
      ok: false,
      reason: "shopify_error",
      message: `metafieldsSet fehlgeschlagen: ${(err as Error).message}`,
    };
  }

  // Best-effort immediate catalog refresh (same targeted path as the stock
  // webhook). A failure here is NOT a publish failure — the nightly sync is
  // the backstop — but it is logged.
  let catalogRefreshed = false;
  try {
    const r = await refreshProductInCatalog(product.id);
    catalogRefreshed = r.ok;
  } catch (err) {
    reportError(err, { route: "lib/shopify-qa", phase: "catalog-refresh" });
  }

  return { ok: true, productGid: product.id, qaCount: merged.length, catalogRefreshed };
}

export type UnpublishQaResult =
  | { ok: true; removed: boolean; qaCount: number; catalogRefreshed: boolean }
  | { ok: false; reason: "shopify_error"; message: string };

/**
 * Remove one Q&A pair (matched by question fingerprint) from a product's
 * custom.qa metafield — the "Zurückziehen" inverse of publishQaToProduct.
 * Idempotent: a question that is already gone (or a product that no longer
 * exists) reports ok with removed:false instead of failing, so the queue
 * entry can always be pulled back to 'answered'.
 */
export async function unpublishQaFromProduct(input: {
  handle: string;
  question: string;
}): Promise<UnpublishQaResult> {
  let product: ProductForQa["productByIdentifier"];
  try {
    const data = await adminGraphql<ProductForQa>(PRODUCT_FOR_QA_QUERY, {
      handle: input.handle,
    });
    product = data.productByIdentifier;
  } catch (err) {
    return {
      ok: false,
      reason: "shopify_error",
      message: `Produkt-Lookup fehlgeschlagen: ${(err as Error).message}`,
    };
  }
  // Product deleted since publishing → nothing carries the pair anymore.
  if (!product?.id) {
    return { ok: true, removed: false, qaCount: 0, catalogRefreshed: false };
  }

  const existing = parseQaMetafield(product.metafield?.value);
  const reduced = removeQaFromList(existing, input.question);
  const removed = reduced.length !== existing.length;

  if (removed) {
    try {
      const res = await adminGraphql<{
        metafieldsSet: {
          metafields: Array<{ id: string }> | null;
          userErrors: Array<{ field?: string[] | null; message: string }>;
        };
      }>(METAFIELDS_SET_MUTATION, {
        metafields: [
          {
            ownerId: product.id,
            namespace: QA_METAFIELD_NAMESPACE,
            key: QA_METAFIELD_KEY,
            type: "json",
            // An empty list is written as "[]" (not deleted) — keeps the
            // definition attached and the theme simply hides the tab.
            value: serializeQaMetafield(reduced),
          },
        ],
      });
      const errors = res.metafieldsSet?.userErrors ?? [];
      if (errors.length > 0) {
        return {
          ok: false,
          reason: "shopify_error",
          message: `metafieldsSet: ${errors.map((e) => e.message).join("; ")}`,
        };
      }
    } catch (err) {
      return {
        ok: false,
        reason: "shopify_error",
        message: `metafieldsSet fehlgeschlagen: ${(err as Error).message}`,
      };
    }
  }

  // Best-effort immediate catalog refresh so Mo forgets the pair right away
  // (nightly sync as backstop). Refresh even when removed=false — a stale
  // catalog copy might still carry the pair.
  let catalogRefreshed = false;
  try {
    const r = await refreshProductInCatalog(product.id);
    catalogRefreshed = r.ok;
  } catch (err) {
    reportError(err, { route: "lib/shopify-qa", phase: "catalog-refresh-unpublish" });
  }

  return { ok: true, removed, qaCount: reduced.length, catalogRefreshed };
}
