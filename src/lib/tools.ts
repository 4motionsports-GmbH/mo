import { tool } from "ai";
import { z } from "zod";
import { retrieve, embedQuery } from "./retrieval";
import { captureConsentCopy } from "./consent-copy";
import { toolCopy } from "./tool-descriptions.mjs";
import { createOrderStatusLookup } from "./order-status";
import { loadProductCatalog, resolveProductSelections } from "./product-catalog";
import {
  RULE_LIMITS,
  normalizeAreaM2,
  resolveProductRules,
  ruleFacts,
  ruleHint,
  validateLines,
  validateOptions,
} from "./product-rules.mjs";
import { floorAreaSchema, lineQuantitySchema } from "./configurator-tool-schemas.mjs";
import { showroomToolResult } from "./showroom-core.mjs";
import {
  OPTIONS_LIMITS,
  OPTION_STEPS,
  PLAN_MAX_ITEMS,
  PLAN_ROLES,
  REPLY_MAX_CHARS,
  REPLY_MAX_OPTIONS,
  REPLY_TOPICS,
  configuratorToolCopy,
  normalizeOfferOptions,
  normalizePlanItems,
  offerOptionsResult,
  productHeightCm,
} from "./configurator-core.mjs";
import type { Locale } from "./locale";
import type { CustomerProfile, Product } from "./types";

function buildProfilePatchSchema(c: Record<string, string>) {
  return z.object({
    segment: z
      .enum(["private", "studio", "physio", "public_sector", "unknown"])
      .optional()
      .describe(c.fieldSegment),
    experienceLevel: z
      .enum(["beginner", "intermediate", "advanced", "unknown"])
      .optional(),
    trainingFocus: z
      .enum(["strength", "cardio", "mixed", "rehab", "unknown"])
      .optional(),
    spaceM2: z
      .union([z.number(), z.literal("unknown")])
      .optional()
      .describe(c.fieldSpaceM2),
    budgetEUR: z
      .union([
        z.object({ min: z.number().nullable(), max: z.number().nullable() }),
        z.literal("unknown"),
      ])
      .optional(),
    trainingFrequency: z
      .enum(["1-2x", "3-5x", "daily", "unknown"])
      .optional(),
    housing: z
      .enum(["apartment", "house_basement_garage", "facility", "unknown"])
      .optional(),
    noiseSensitive: z
      .union([z.boolean(), z.literal("unknown")])
      .optional(),
    procurementNeeds: z
      .array(
        z.enum([
          "invoice",
          "tender",
          "warranty_docs",
          "ce_certs",
          "leasing",
          "bulk_discount",
          "maintenance_contract",
        ])
      )
      .optional(),
    confidence: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe(c.fieldConfidence),
    rationale: z
      .string()
      .optional()
      .describe(c.fieldRationale),
  });
}

// Hard cap on offer_email_summary invitations per conversation. Lives in the
// pure trigger module (email-offer-trigger.mjs) next to the deterministic
// checkout-intent trigger that shares it; re-exported here so existing
// importers (system-prompt, api/chat) keep working unchanged.
export { MAX_EMAIL_OFFERS_PER_CONVERSATION } from "./email-offer-trigger.mjs";

// NOTE on withholding offer_email_summary: the full tool set is always built
// here so the return type is stable (api/chat's deterministic email-offer
// trigger force-selects the tool in a prepareStep, which needs the tool's key
// in the type). The actual withholding — ask cap reached, email already
// captured or the session is signed in (tier 3, CA §6.0), making "never a third ask" a guarantee rather than a prompt
// instruction — happens in api/chat via streamText's `activeTools`: an
// inactive tool is filtered out before the provider call and is invisible to
// the model, exactly like omitting it from this object.
//
// LOCALE: `locale` only switches the language of the model-facing descriptions
// (toolCopy) and the consent copy attached to the offer_email_summary result.
// The schemas, enums and execute LOGIC are identical across locales.
//
// get_order_status follows the same pattern: always built, withheld in
// api/chat via `activeTools` while CHAT_ORDER_STATUS_ENABLED is off — so the
// tools the model sees (and their bytes) are exactly today's with the switch
// off. With it on, `orderStatusEnabled` also switches the contact-form copy
// so order-STATUS questions go to get_order_status first.
export interface ChatToolOptions {
  /** The widget session (`x-ms-session`) — get_order_status resolves the signed-in customer from it. */
  sessionId?: string | null;
  /** CHAT_ORDER_STATUS_ENABLED (lib/platform-flags.mjs). */
  orderStatusEnabled?: boolean;
  /**
   * The products on display in the showroom and whether that list is known
   * (showroom-store getCachedShowroom, 2026-10-27) — suggest_showroom and the
   * configurator tools report them. Absent = unknown.
   */
  showroom?: { known: boolean; ids: ReadonlySet<string> } | null;
  /**
   * The configurator widget applies the product rules itself (configurator
   * feature "rules", 2026-10-27). False = an older widget that caps every
   * line at 20 and shows Mo's input: show_gym_plan / offer_plan_options then
   * cap floor lines at 20 too (RULE_LIMITS.lineMax), so a reported `adjusted`
   * never exceeds what that page can hold. Absent = the default caps.
   */
  widgetRules?: boolean;
}

// PRODUCT RULES (2026-10-27, product-rules.mjs): show_gym_plan,
// offer_plan_options and add_to_cart validate their lines against the rules
// (pairs, minimum / maximum, the coverage of floor tiles for a given room area)
// and tell the model what they `adjusted`, the `coverage` and which products
// are `inShowroom` — so it corrects its text in the same turn. The widget
// renders the INPUT and normalises the quantities itself with the same rules
// (GET /api/products `rules`). A result without anything to report keeps its
// exact previous shape.
async function catalogById(): Promise<Map<string, Product>> {
  return new Map((await loadProductCatalog()).map((p) => [p.id, p]));
}

export function buildChatTools(
  profile: CustomerProfile,
  locale: Locale = "de",
  options: ChatToolOptions = {}
) {
  const c = toolCopy(locale);
  const k = configuratorToolCopy(locale);
  const showroom = options.showroom?.known ? options.showroom : null;
  const showroomIds = showroom?.ids ?? null;
  // An older configurator widget (no "rules") holds at most 20 per line, floor lines included.
  const floorLineMax = options.widgetRules === false ? RULE_LIMITS.lineMax : undefined;
  // One lookup per request: the access gate (link + live token) is resolved
  // once even when the model calls the tool several times in parallel.
  const lookupOrderStatus = createOrderStatusLookup(options.sessionId ?? null);
  return {
    update_customer_profile: tool({
      description: c.updateProfileDesc,
      inputSchema: buildProfilePatchSchema(c),
      execute: async () => ({ ok: true }),
    }),

    search_products: tool({
      description: c.searchDesc,
      inputSchema: z.object({
        query: z.string().describe(c.fieldQuery),
        filters: z
          .object({
            category: z.string().optional(),
            maxPriceEUR: z.number().optional(),
            minPriceEUR: z.number().optional(),
            maxFootprintM2: z.number().optional(),
            requiresMedical: z.boolean().optional(),
            requiresQuiet: z.boolean().optional(),
          })
          .optional(),
        limit: z.number().min(1).max(15).optional(),
      }),
      execute: async ({ query, filters, limit }) => {
        const queryVector = await embedQuery(query);
        const hits = await retrieve({
          query,
          profile,
          filters,
          limit: limit ?? 8,
          queryVector,
        });
        return {
          totalMatched: hits.length,
          products: hits.map((h) => {
            // The product rules as on a product line („nur paarweise“, „deckt ca. 1 m² je Stück“,
            // „im Showroom ausgestellt“ …) and the height (2026-10-27) — omitted when there are none.
            const rules = ruleHint(resolveProductRules(h.product, { showroomIds }), locale);
            const heightCm = productHeightCm(h.product);
            return {
              id: h.product.id,
              name: h.product.name,
              category: h.product.category,
              price: h.product.salePrice ?? h.product.price,
              // Effective price range + count for multi-variant products (the
              // flat price is only the default variant's; details + per-variant
              // refs are in the retrieved-products prompt block).
              ...(h.product.priceMin != null &&
              h.product.priceMax != null &&
              h.product.priceMax > h.product.priceMin
                ? {
                    priceFrom: h.product.priceMin,
                    priceTo: h.product.priceMax,
                    variantCount: h.product.variants?.length,
                  }
                : {}),
              shortDescription: h.product.shortDescription,
              ...(heightCm != null ? { heightCm } : {}),
              ...(rules ? { rules } : {}),
              score: Number(h.score.toFixed(3)),
            };
          }),
        };
      },
    }),

    show_product: tool({
      description: c.showProductDesc,
      inputSchema: z.object({
        productId: z.string().describe(c.fieldShowProductId),
        reason: z.string().optional().describe(c.fieldShowProductReason),
      }),
      execute: async () => ({ ok: true }),
    }),

    compare_products: tool({
      description: c.compareDesc,
      inputSchema: z.object({
        productIds: z
          .array(z.string())
          .min(2)
          .max(3)
          .describe(c.fieldCompareIds),
        comparisonContext: z
          .string()
          .optional()
          .describe(c.fieldComparisonContext),
      }),
      execute: async () => ({ ok: true }),
    }),

    add_to_cart: tool({
      description: c.addToCartDesc,
      inputSchema: z
        .object({
          productId: z.string().optional().describe(c.fieldAddProductId),
          productIds: z
            .array(z.string())
            .min(1)
            .optional()
            .describe(c.fieldAddProductIds),
          message: z.string().describe(c.fieldAddMessage),
        })
        // Backward compatible: at least one of productId / productIds must be
        // present. The frontend normalises both to a single id list.
        .refine((d) => Boolean(d.productId) || (d.productIds?.length ?? 0) > 0, {
          message: "Either productId or productIds must be provided.",
        }),
      // The checkout link (GET /api/products cartUrl) carries each product's
      // minimum quantity (pairs → 2); the result tells the model so.
      execute: async ({ productId, productIds }) => {
        const ids = [...new Set([...(productId ? [productId] : []), ...(productIds ?? [])])];
        const v = validateLines(ids.map((id) => ({ productId: id, quantity: 1 })), await catalogById(), { locale });
        return { ok: true, ...ruleFacts({ adjusted: v.adjusted }) };
      },
    }),

    // Only for products on display (showroom-core showroomToolResult): none on
    // display → ok: false (the widget renders no card either); an unknown list
    // → ok with the note not to promise a product.
    suggest_showroom: tool({
      description: c.showroomDesc,
      inputSchema: z.object({
        productIds: z.array(z.string()).describe(c.fieldShowroomIds),
      }),
      execute: async ({ productIds }) => {
        const byId = await catalogById();
        return showroomToolResult(productIds, showroom ?? { known: false, ids: new Set<string>() }, (id) => byId.has(id), locale);
      },
    }),

    // Order status for a customer signed in with the Customer Account in THIS
    // session (lib/order-status.ts; gates and privacy whitelist in
    // order-status-core.mjs). Placed BEFORE show_contact_form so the cache
    // marker below stays on the last always-active tool: this one is present
    // or withheld per deployment (CHAT_ORDER_STATUS_ENABLED), never per turn,
    // so the cached tools prefix stays byte-stable either way. The widget
    // renders nothing for it (docs/frontend/API_CONTRACT.md §2).
    get_order_status: tool({
      description: c.orderStatusDesc,
      inputSchema: z.object({
        orderRef: z.string().max(40).optional().describe(c.fieldOrderRef),
        topic: z
          .enum(["status", "shipping", "return", "cancellation", "refund"])
          .describe(c.fieldOrderTopic),
      }),
      execute: async ({ orderRef, topic }) => lookupOrderStatus({ orderRef, topic }),
    }),

    show_contact_form: tool({
      description: options.orderStatusEnabled ? c.contactDescOrderStatus : c.contactDesc,
      // PROMPT-CACHE BREAKPOINT (tools tier): Anthropic renders tools → system
      // → messages; a cache_control marker on a tool caches the tool prefix up
      // to and including it. This sits on the LAST always-active tool —
      // offer_email_summary (below) is sometimes withheld via activeTools, and
      // a marker there would vanish with it. The tool definitions are byte-
      // stable per locale (and per CHAT_ORDER_STATUS_ENABLED, a deployment
      // switch), so this prefix hits across turns, sessions and users. See
      // docs/PROMPT_CACHING.md.
      providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
      inputSchema: z.object({
        reason: z.enum([
          "studio_consultation",
          "public_sector_quote",
          "physio_consultation",
          "bulk_discount",
          "leasing",
          "maintenance",
          "order_support",
          "general",
        ]),
        message: z.string().describe(c.fieldContactMessage),
        productIds: z
          .array(z.string())
          .optional()
          .describe(c.fieldContactProductIds),
      }),
      execute: async () => ({ ok: true }),
    }),

    offer_email_summary: tool({
      description: c.offerDesc,
      inputSchema: z.object({
        message: z.string().describe(c.fieldOfferMessage),
        trigger: z
          .enum([
            "recommendation_accepted",
            "comparison_delivered",
            "consideration_pause",
            "buying_intent",
            "checkout_intent",
          ])
          .describe(c.fieldOfferTrigger),
        productIds: z
          .array(z.string())
          .optional()
          .describe(c.fieldOfferProductIds),
      }),
      // The tool result carries the canonical capture-form consent copy (it
      // streams to the widget as the tool part's `output`). The widget renders
      // these strings verbatim and echoes `consentTextShown` back unchanged on
      // /api/capture-email — the Art. 7 audit record can never drift from what
      // was displayed, and lawyer copy changes need no widget release. The
      // locale picks the consent language so an /en chat captures /en consent.
      // See src/lib/consent-copy.ts and docs/frontend/API_CONTRACT.md §7.4.
      execute: async () => ({ ok: true, consentCopy: captureConsentCopy(locale) }),
    }),

    // ── Home-Gym-Konfigurator only (configurator-core.mjs) ──────────────────
    // Always built (stable type, like get_order_status), withheld via
    // `activeTools` in api/chat unless the request carries a configurator
    // context — so every other conversation sends exactly today's tool list.
    // Both sit AFTER the tools-tier cache marker (show_contact_form) and after
    // offer_email_summary, so they never change the cached tools prefix.
    // Older widgets render nothing for them (API_CONTRACT §2, unknown tools).
    suggest_replies: tool({
      description: k.suggestRepliesDesc,
      inputSchema: z.object({
        options: z
          .array(z.string().min(1).max(REPLY_MAX_CHARS))
          .min(2)
          .max(REPLY_MAX_OPTIONS)
          .describe(k.fieldReplyOptions),
        multiSelect: z.boolean().optional().describe(k.fieldReplyMulti),
        topic: z.enum(REPLY_TOPICS).optional().describe(k.fieldReplyTopic),
      }),
      execute: async () => ({ ok: true }),
    }),

    show_gym_plan: tool({
      description: k.showGymPlanDesc,
      inputSchema: z.object({
        title: z.string().max(80).describe(k.fieldPlanTitle),
        summary: z.string().max(400).optional().describe(k.fieldPlanSummary),
        items: z
          .array(
            z.object({
              productId: z.string(),
              // Up to 200 (a floor line); validateLines caps any other line at 20 and reports it.
              quantity: lineQuantitySchema,
              role: z.enum(PLAN_ROLES),
              note: z.string().max(120).optional(),
            })
          )
          .min(1)
          .max(PLAN_MAX_ITEMS)
          .describe(k.fieldPlanItems),
        tips: z.array(z.string().max(200)).max(3).optional().describe(k.fieldPlanTips),
        // A number, null or absent (configurator-tool-schemas.mjs): a null area never invalidates
        // the plan — normalizeAreaM2 drops a missing, zero, negative or implausible one.
        floorAreaM2: floorAreaSchema.describe(k.fieldPlanFloorArea),
      }),
      // The widget renders the plan from the INPUT (hydrating the ids itself);
      // the result tells the model which lines will not show and what the
      // product rules corrected (`adjusted`, `coverage`, `inShowroom`), so it
      // can correct itself in the same turn.
      execute: async (input) => {
        const lines = normalizePlanItems(input);
        const resolved = await resolveProductSelections(lines.map((l) => l.productId));
        const known = new Map(resolved.map((r) => [r.ref, r]));
        const unknownIds = lines.filter((l) => !known.has(l.productId)).map((l) => l.productId);
        const soldOutIds = resolved.filter((r) => !r.available).map((r) => r.ref);
        const base =
          unknownIds.length || soldOutIds.length
            ? { ok: true, shownItems: lines.length - unknownIds.length, unknownIds, soldOutIds }
            : { ok: true, shownItems: lines.length };
        const v = validateLines(lines, await catalogById(), {
          showroomIds,
          areaM2: normalizeAreaM2(input.floorAreaM2),
          locale,
          floorLineMax,
        });
        return { ...base, ...ruleFacts(v, { showroomKnown: Boolean(showroom) }) };
      },
    }),

    // The step-by-step choice (2026-10-23): offered only when the widget
    // renders it (configurator.features "options"); withheld via activeTools
    // otherwise. Same id check as show_gym_plan; an option counts as shown
    // only when every item is known and available (the widget's rule).
    // The texts accept twice the documented length (the description keeps the
    // documented limits): a slightly long pro must not invalidate the whole
    // call — normalizeOfferOptions and the widget clip to OPTIONS_LIMITS.
    offer_plan_options: tool({
      description: k.offerOptionsDesc,
      inputSchema: z.object({
        step: z.enum(OPTION_STEPS).describe(k.fieldOptionsStep),
        title: z.string().max(OPTIONS_LIMITS.titleChars * 2).describe(k.fieldOptionsTitle),
        intro: z.string().max(OPTIONS_LIMITS.introChars * 2).optional().describe(k.fieldOptionsIntro),
        multiSelect: z.boolean().optional().describe(k.fieldOptionsMulti),
        options: z
          .array(
            z.object({
              items: z
                .array(
                  z.object({
                    productId: z.string(),
                    quantity: lineQuantitySchema,
                  })
                )
                .min(1)
                .max(OPTIONS_LIMITS.items),
              label: z.string().max(OPTIONS_LIMITS.labelChars * 2).optional(),
              badge: z.string().max(OPTIONS_LIMITS.badgeChars * 2).optional(),
              pros: z.array(z.string().max(OPTIONS_LIMITS.pointChars * 2)).max(OPTIONS_LIMITS.pros).optional(),
              cons: z.array(z.string().max(OPTIONS_LIMITS.pointChars * 2)).max(OPTIONS_LIMITS.cons).optional(),
            })
          )
          .min(1)
          .max(OPTIONS_LIMITS.options)
          .describe(k.fieldOptionsList),
        // A number, null or absent: a null area never invalidates the options (normalizeAreaM2 is the gate).
        areaM2: floorAreaSchema.describe(k.fieldOptionsArea),
      }),
      execute: async (input) => {
        const { options } = normalizeOfferOptions(input);
        const refs = [...new Set(options.flatMap((o) => o.items.map((it) => it.productId)))];
        const resolved = await resolveProductSelections(refs);
        const base = offerOptionsResult(options, resolved);
        // The rules of the options the widget shows (every item known and
        // available), numbered by their position in Mo's own list (`rank` —
        // an option normalizeOfferOptions dropped never shifts the later ones).
        const available = new Map(resolved.map((r) => [r.ref, r.available]));
        const shown = options
          .map((o) => ({ ...o, option: o.rank }))
          .filter((o) => o.items.every((it) => available.get(it.productId) === true));
        const v = validateOptions(shown, await catalogById(), {
          showroomIds,
          areaM2: normalizeAreaM2(input.areaM2),
          locale,
          floorLineMax,
        });
        return { ...base, ...ruleFacts(v, { showroomKnown: Boolean(showroom) }) };
      },
    }),
  };
}
