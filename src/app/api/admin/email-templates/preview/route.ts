// POST /api/admin/email-templates/preview — render a REPRESENTATIVE sample
// email with the posted design tokens and return raw text/html for the
// EmailPreviewButton iframe dialog. The tokens come straight from the form
// (unsaved edits preview correctly); nothing is stored and nothing is sent.
//
// The sample composes every themeable element through the REAL shell helpers
// (heading band, prose with a link, product rows, section band, CTA pill,
// footnote, unsubscribe footer, social row) so the preview shows exactly what
// the tokens will do to real sends — same fetch→blob→iframe pattern as the
// marketing/campaign email previews.

import { guardAdminPost, adminJsonError } from "@/lib/admin-api";
import { withEmailTheme, type EmailTheme } from "@/lib/email-theme-context";
import { parseEmailThemeInput } from "@/lib/email-theme.mjs";
import {
  renderBrandedEmail,
  renderSectionBand,
  renderSectionRow,
  emailTextStyle,
  emailMutedTextStyle,
  emailLinkStyle,
} from "@/lib/email-template";
import { renderEmailProductRows, productRowItems } from "@/lib/email-products";
import { renderEmailProseHtml } from "@/lib/email-prose.mjs";
import { loadProductCatalog } from "@/lib/catalog-store";
import { reportError } from "@/lib/observability";
import type { Product } from "@/lib/types";

export const maxDuration = 15;

// Two catalog products with images make the preview realistic; a catalog
// failure degrades to an imageless placeholder row, never a 500.
async function sampleProducts(): Promise<Product[]> {
  try {
    const catalog = await loadProductCatalog();
    return catalog
      .filter((p) =>
        p.images?.some((u) => typeof u === "string" && u.startsWith("https://"))
      )
      .slice(0, 2);
  } catch (err) {
    reportError(err, { route: "api/admin/email-templates/preview", phase: "catalog" });
    return [];
  }
}

function renderSample(products: Product[]): string {
  const prose =
    "Hallo Alex,\n\nschön, dass du wieder reinschaust! Ich habe dir ein paar " +
    "Dinge herausgesucht, die perfekt zu deinem Training passen — schau sie " +
    "dir hier an: https://www.motionsports.de";
  const rowItems = productRowItems(products, { locale: "de" });
  const productRows = rowItems.length
    ? renderSectionBand("Für dich ausgesucht") +
      renderSectionRow(renderEmailProductRows(rowItems), {
        padding: "10px 60px 20px",
        align: "center",
      })
    : renderSectionBand("Für dich ausgesucht");
  return renderBrandedEmail({
    subject: "Vorschau — E-Mail-Vorlage",
    preheader: "So sehen E-Mails mit dieser Vorlage aus.",
    heading: "Deine persönliche Empfehlung",
    moAvatar: true,
    bodyHtml: `
                    <p style="${emailTextStyle()} white-space: pre-wrap;" align="left">${renderEmailProseHtml(
                      prose,
                      { linkStyle: emailLinkStyle() }
                    )}</p>`,
    preCtaRowsHtml: productRows,
    ctas: [{ label: "Warenkorb öffnen", url: "https://www.motionsports.de" }],
    footnoteHtml: `<p style="${emailMutedTextStyle()} padding-top: 5px; padding-bottom: 10px;" align="center">Dein pers&#246;nlicher Code <strong>MO-BEISPIEL</strong> ist im Warenkorb bereits hinterlegt.</p>`,
    footer: {
      unsubscribeHtml: `<p style="${emailMutedTextStyle()}" align="center">Keine E-Mails mehr erhalten? <a href="#" style="color: #000000; text-decoration: underline;">Hier abmelden</a>.</p>`,
    },
  });
}

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;

  let theme: EmailTheme;
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const parsed = parseEmailThemeInput(body);
    if (parsed.errors.length > 0) {
      return adminJsonError(
        "bad_request",
        `Ungültige Design-Werte: ${parsed.errors.join(", ")}`,
        400
      );
    }
    theme = parsed.theme as EmailTheme;
  } catch {
    return adminJsonError("bad_request", "Invalid JSON body", 400);
  }

  try {
    const products = await sampleProducts();
    const html = withEmailTheme(theme, () => renderSample(products));
    return new Response(html, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
  } catch (err) {
    reportError(err, { route: "api/admin/email-templates/preview" });
    return adminJsonError("internal_error", "Vorschau fehlgeschlagen.", 500);
  }
}
