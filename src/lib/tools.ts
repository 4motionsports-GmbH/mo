import { tool } from "ai";
import { z } from "zod";
import { retrieve, embedQuery } from "./retrieval";
import { captureConsentCopy } from "./consent-copy";
import { toolCopy } from "./tool-descriptions.mjs";
import type { Locale } from "./locale";
import type { CustomerProfile } from "./types";

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
// in the type). The actual withholding — ask cap reached or email already
// captured, making "never a third ask" a guarantee rather than a prompt
// instruction — happens in api/chat via streamText's `activeTools`: an
// inactive tool is filtered out before the provider call and is invisible to
// the model, exactly like omitting it from this object.
//
// LOCALE: `locale` only switches the language of the model-facing descriptions
// (toolCopy) and the consent copy attached to the offer_email_summary result.
// The schemas, enums and execute LOGIC are identical across locales.
export function buildChatTools(profile: CustomerProfile, locale: Locale = "de") {
  const c = toolCopy(locale);
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
          products: hits.map((h) => ({
            id: h.product.id,
            name: h.product.name,
            category: h.product.category,
            price: h.product.salePrice ?? h.product.price,
            shortDescription: h.product.shortDescription,
            score: Number(h.score.toFixed(3)),
          })),
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
      execute: async () => ({ ok: true }),
    }),

    suggest_showroom: tool({
      description: c.showroomDesc,
      inputSchema: z.object({
        productIds: z.array(z.string()).describe(c.fieldShowroomIds),
      }),
      execute: async () => ({ ok: true }),
    }),

    show_contact_form: tool({
      description: c.contactDesc,
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
      // See src/lib/consent-copy.ts and API_CONTRACT.md §7.4.
      execute: async () => ({ ok: true, consentCopy: captureConsentCopy(locale) }),
    }),
  };
}
