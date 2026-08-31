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

import {
  withEmailDesign,
  withEmailRenderData,
  type ResolvedEmailDesign,
} from "./email-design-context";
import { buildSummaryEmailContent } from "./summary-email";
import { doiEmailBody, unsubscribeFooter } from "./consent-copy";
import { renderMarketingEmail } from "./marketing-email";
import { renderCampaignEmail } from "./campaign-email";
import { renderBundleOfferBlock } from "./bundle-email";
import { loadProductCatalog } from "./catalog-store";
import { reportError } from "./observability";
import type { EmailDesignKind } from "./email-designs/registry";
import type { Product } from "./types";

// Inert links: the unsubscribe/confirm pages show their "invalid link" screens
// if clicked — nothing can be (un)subscribed from a preview.
const FAKE_UNSUBSCRIBE_URL = "https://motionsports.de/api/unsubscribe?token=PREVIEW";
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

const firstImage = (p: Product): string | null =>
  p.images?.find((u) => typeof u === "string" && u.startsWith("https://")) ?? null;

function renderSampleForKind(kind: EmailDesignKind, products: Product[]): string {
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
      const bundleComponents = products.slice(4, 6);
      const bundle = bundleComponents.length
        ? renderBundleOfferBlock({
            title: "Dein persönliches Home-Gym Set",
            components: bundleComponents.map((p) => ({
              name: p.name,
              imageUrl: firstImage(p),
            })),
            bundlePrice: 899,
            componentsSum: 998,
            offerUrl: SHOP_URL,
          })
        : null;
      const { html } = renderMarketingEmail({
        subject: "Deine persönliche Empfehlung von motion sports",
        body:
          "Hallo,\n\nvielen Dank für dein Gespräch mit Mo! Basierend auf deiner " +
          "Beratung haben wir eine persönliche Auswahl für dich zusammengestellt — " +
          "inklusive einem kleinen Dankeschön: 10 % auf deinen vorbereiteten Warenkorb.",
        linkUrl: SHOP_URL,
        products: products.slice(0, 4),
        discountCode: "MS5-BEISPIEL",
        discountExpiresLabel: "31.12.2026",
        unsubscribe: unsubscribeFooter(FAKE_UNSUBSCRIBE_URL),
        bundle,
      });
      return html;
    }
    case "campaign": {
      const { html } = renderCampaignEmail({
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
        unsubscribe: unsubscribeFooter(FAKE_UNSUBSCRIBE_URL),
        bundle: null,
      });
      return html;
    }
  }
}

/**
 * Render the sample email of `kind` inside `design` (null → classic built-ins).
 * Returns the full HTML document for the preview iframe.
 */
export async function renderEmailDesignPreview(
  kind: EmailDesignKind,
  design: ResolvedEmailDesign | null
): Promise<string> {
  const products = await sampleProducts();
  // Sample render data so hero-driven designs preview their personalisation
  // (a real send passes the recipient's actual first name).
  return withEmailDesign(design, () =>
    withEmailRenderData({ recipientFirstName: "Anna-Sophie" }, () =>
      renderSampleForKind(kind, products)
    )
  );
}
