// Shopify RICH-TEXT metafield → plain text.
//
// A Shopify `rich_text_field` metafield (e.g. custom.kurzinfo) is returned by
// the Admin API as a JSON DOCUMENT string, not as text:
//
//   {"type":"root","children":[{"type":"list","listType":"unordered","children":[
//     {"type":"list-item","children":[{"type":"text","value":"…"}]}]}]}
//
// getMetafield() hands that value through verbatim, so without this converter
// the raw JSON ends up wherever the product's short description is used — the
// email product cards, Mo's system prompt, the search embeddings, the bundle
// suggestions and the public /api/products response.
//
// Deliberately forgiving: anything that is not a parseable rich-text document
// is returned UNCHANGED, so plain-text metafields (and the committed catalog
// fallback, which is plain text) pass through untouched.
//
// Plain .mjs like the other pure cores so it is unit-testable under node --test
// and importable from both the TS server code and .mjs helpers.

/** Text of one node, recursively. Lists become " · "-separated items. */
function nodeText(node) {
  if (!node || typeof node !== "object") return "";
  if (node.type === "text") return typeof node.value === "string" ? node.value : "";
  const children = Array.isArray(node.children) ? node.children : [];
  if (node.type === "list") {
    return children
      .map(nodeText)
      .map((s) => s.trim())
      .filter(Boolean)
      .join(" · ");
  }
  // paragraph / heading / list-item / link / root / unknown → concatenate.
  const joiner = node.type === "root" ? " " : "";
  return children.map(nodeText).join(joiner);
}

/**
 * Convert a Shopify rich-text metafield value to plain text. Non-rich-text
 * input (plain strings, empty, non-strings) is returned as-is.
 *
 * @param {unknown} value
 * @returns {string} plain text, or the original string when not rich text
 */
export function richTextToPlainText(value) {
  if (typeof value !== "string") return typeof value === "string" ? value : "";
  const trimmed = value.trim();
  // Cheap pre-check: only a JSON object can be a rich-text document.
  if (!trimmed.startsWith("{") || !trimmed.includes('"type"')) return value;
  let doc;
  try {
    doc = JSON.parse(trimmed);
  } catch {
    return value;
  }
  if (!doc || typeof doc !== "object" || doc.type !== "root") return value;
  const text = nodeText(doc).replace(/\s+/g, " ").trim();
  // An empty conversion means we misread the document — keep the original
  // rather than silently dropping the product's description.
  return text || value;
}

/**
 * Product copy fields that may carry rich-text JSON, normalised in place-safe
 * fashion (returns a new object only when something actually changed, so the
 * common all-plain-text catalog keeps its identity and allocations).
 *
 * @template {{ shortDescription?: unknown }} T
 * @param {T} product
 * @returns {T}
 */
export function normalizeProductText(product) {
  if (!product || typeof product !== "object") return product;
  const short = product.shortDescription;
  if (typeof short !== "string") return product;
  const clean = richTextToPlainText(short);
  return clean === short ? product : { ...product, shortDescription: clean };
}
