// Per-email-type design previews for the admin "Einstellungen" tab: render ONE
// representative sample email of the requested kind through the EXACT
// production composers (buildSummaryEmailContent, doiEmailBody,
// renderMarketingEmail, renderCampaignEmail — the same functions the send
// paths use), inside the requested design. Only the data is sample data;
// links are inert and nothing is claimed, minted, sent or recorded.
//
// This is the design system's review loop: what the operator previews per
// design × email type is byte-for-byte what a real send with that design
// would produce, so a new AI-authored design can be inspected for every type
// before it is selected. Sample-data shapes mirror scripts/send-test-emails.mjs.
//
// A marketing / campaign mail is EITHER an item mail OR a set mail
// (offer-mode.mjs), so those two types have two samples: "items" (product
// rows + discount coupon) and "set" (only the set block — no rows, no code).

import {
  withEmailDesign,
  withEmailRenderData,
  type ResolvedEmailDesign,
} from "./email-design-context";
import { buildSummaryEmailContent } from "./summary-email";
import { doiEmailBody, unsubscribeFooter } from "./consent-copy";
import { renderMarketingEmail } from "./marketing-email";
import { renderCampaignEmail } from "./campaign-email";
import { bundleEmailComponents, renderBundleOfferBlock } from "./bundle-email";
import { loadProductCatalog } from "./catalog-store";
import { reportError } from "./observability";
import type { EmailDesignKind } from "./email-designs/registry";
import type { Product } from "./types";

/** Which offer a marketing / campaign sample shows (other types ignore it). */
export type EmailDesignPreviewSample = "items" | "set";

/** Parse the preview route's `sample` field: "set" or the default "items". */
export function parseEmailDesignPreviewSample(value: unknown): EmailDesignPreviewSample {
  return value === "set" ? "set" : "items";
}

// Inert links: the unsubscribe/confirm pages show their "invalid link" screens
// if clicked — nothing can be (un)subscribed from a preview.
const FAKE_UNSUBSCRIBE_URL = "https://motionsports.de/api/unsubscribe?token=PREVIEW";
const FAKE_ERASURE_URL = "https://motionsports.de/api/erase-data?token=PREVIEW";
const FAKE_CONFIRM_URL = "https://motionsports.de/api/confirm-marketing?token=PREVIEW";
const SHOP_URL = "https://motionsports.de";

/** Catalog products with https images for realistic previews; a catalog
 * failure degrades to an empty list (sections without products), never a 500. */
async function sampleProducts(): Promise<Product[]> {
  try {
    const catalog = await loadProductCatalog();
    return catalog
      .filter((p) =>
        p.images?.some((u) => typeof u === "string" && u.startsWith("https://"))
      )
      .slice(0, 6);
  } catch (err) {
    reportError(err, { route: "lib/email-design-preview", phase: "catalog" });
    return [];
  }
}

/** A sample deadline a few days out (the countdown renders from it). */
const sampleDeadline = () => new Date(Date.now() + (3 * 24 + 14) * 3_600_000).toISOString();

/**
 * The sample SET: three catalog products (the first twice) with their
 * current price as the snapshot unit price, the set about 12 % below the
 * component sum — a genuine saving, so the saving eyecatcher shows. Inert
 * shop link instead of a tracked one.
 */
function sampleSetBlock(
  products: Product[],
  language: "de" | "en"
): { text: string; html: string; expiresAt: string } | null {
  const parts = products.slice(3, 6);
  if (parts.length === 0) return null;
  const unitPrice = (p: Product) =>
    typeof p.salePrice === "number" && p.salePrice > 0 && p.salePrice < p.price ? p.salePrice : p.price;
  const records = parts.map((p, i) => ({
    productId: p.id,
    title: p.name,
    quantity: i === 0 ? 2 : 1,
    unitPrice: unitPrice(p).toFixed(2),
  }));
  const sumCents = records.reduce((n, r) => n + Math.round(Number(r.unitPrice) * 100) * r.quantity, 0);
  // ~12 % off, ending in ,90 — always below the sum (a genuine saving).
  const priceCents = Math.max(90, Math.floor((sumCents * 0.88) / 100) * 100 - 10);
  const block = renderBundleOfferBlock({
    title: language === "en" ? "Your home gym set" : "Dein Home-Gym-Set",
    components: bundleEmailComponents(records, new Map(parts.map((p) => [p.id, p])), null),
    bundlePrice: (Math.min(priceCents, sumCents - 1) / 100).toFixed(2),
    componentsSum: (sumCents / 100).toFixed(2),
    offerUrl: SHOP_URL,
    language,
  });
  return { ...block, expiresAt: sampleDeadline() };
}

function renderSampleForKind(
  kind: EmailDesignKind,
  products: Product[],
  sample: EmailDesignPreviewSample
): string {
  switch (kind) {
    case "summary": {
      const { html } = buildSummaryEmailContent({
        summary:
          "Du suchst eine kompakte Ausstattung für dein Heimstudio mit Fokus " +
          "auf Krafttraining auf begrenzter Fläche. Wir haben passende " +
          "Hantelscheiben und ergänzendes Zubehör besprochen, die leise und " +
          "platzsparend sind.",
        chosenProducts: products.slice(0, 2),
        alternatives: products.slice(2, 5),
        cartUrl: SHOP_URL,
      });
      return html;
    }
    case "doi": {
      return doiEmailBody(FAKE_CONFIRM_URL, "de").html;
    }
    case "marketing": {
      // Set mail: only the set (no rows, no cart, no code); item mail: the
      // product rows, the cart button and the code note.
      const bundle = sample === "set" ? sampleSetBlock(products, "de") : null;
      const { html } = renderMarketingEmail(
        bundle
          ? {
              subject: "Dein persönliches Set von motion sports",
              body:
                "Hallo,\n\nvielen Dank für dein Gespräch mit Mo! Passend zu deiner Beratung " +
                "haben wir dir ein Set zusammengestellt — zusammen günstiger als einzeln.",
              linkUrl: null,
              products: [],
              discountCode: null,
              discountExpiresLabel: null,
              unsubscribe: unsubscribeFooter(FAKE_UNSUBSCRIBE_URL, "de", FAKE_ERASURE_URL),
              bundle,
            }
          : {
              subject: "Deine persönliche Empfehlung von motion sports",
              body:
                "Hallo,\n\nvielen Dank für dein Gespräch mit Mo! Basierend auf deiner " +
                "Beratung haben wir eine persönliche Auswahl für dich zusammengestellt — " +
                "inklusive einem kleinen Dankeschön: 10 % auf deinen vorbereiteten Warenkorb.",
              linkUrl: SHOP_URL,
              products: products.slice(0, 4),
              discountCode: "MS5-BEISPIEL",
              discountExpiresLabel: "31.12.2026",
              discountExpiresAt: sampleDeadline(),
              unsubscribe: unsubscribeFooter(FAKE_UNSUBSCRIBE_URL, "de", FAKE_ERASURE_URL),
              bundle: null,
            }
      );
      return html;
    }
    case "campaign": {
      // Set mail: only the set; item mail: product rows + coupon.
      const bundle = sample === "set" ? sampleSetBlock(products, "de") : null;
      const { html } = renderCampaignEmail(
        bundle
          ? {
              subject: "Dein persönliches Set von motion sports",
              body:
                "Hallo,\n\nschön, dass du wieder da bist! Passend zu deinem letzten Einkauf " +
                "haben wir dir ein Set zusammengestellt — zusammen günstiger als einzeln.",
              language: "de",
              discountCode: null,
              discountExpiresLabel: null,
              unsubscribe: unsubscribeFooter(FAKE_UNSUBSCRIBE_URL, "de", FAKE_ERASURE_URL),
              bundle,
            }
          : {
              subject: "Deine persönliche Empfehlung von motion sports",
              body:
                "Hallo,\n\nschön, dass du wieder da bist! Seit deinem letzten Einkauf " +
                "gibt es einige Neuheiten, die zu deinem Training passen könnten. Mo, " +
                "unser digitaler Berater, stellt dir in wenigen Minuten eine " +
                "persönliche Empfehlung zusammen.",
              language: "de",
              products: products.slice(2, 5),
              discountCode: "MK-BEISPIEL",
              discountExpiresLabel: "31.12.2026",
              discountExpiresAt: sampleDeadline(),
              discountPercent: 5,
              unsubscribe: unsubscribeFooter(FAKE_UNSUBSCRIBE_URL, "de", FAKE_ERASURE_URL),
              bundle: null,
            }
      );
      return html;
    }
  }
}

/**
 * Render the sample email of `kind` inside `design` (null → classic built-ins).
 * `sample` picks the item mail or the set mail for marketing / campaign.
 * Returns the full HTML document for the preview iframe.
 */
export async function renderEmailDesignPreview(
  kind: EmailDesignKind,
  design: ResolvedEmailDesign | null,
  sample: EmailDesignPreviewSample = "items"
): Promise<string> {
  const products = await sampleProducts();
  // Sample render data so hero-driven designs preview their personalisation
  // (a real send passes the recipient's actual first name).
  return withEmailDesign(design, () =>
    withEmailRenderData({ recipientFirstName: "Anna-Sophie" }, () =>
      renderSampleForKind(kind, products, sample)
    )
  );
}
