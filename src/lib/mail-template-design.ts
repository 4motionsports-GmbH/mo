// E-mail templates („Vorlagen“) as DESIGNS of Mo's mails — the bridge between
// a stored block document (mail-template-store.ts) and the design system
// (email-design-context.ts, docs/EMAIL_DESIGNS.md). docs/EMAIL_TEMPLATES.md.
//
// A template with the block „Mos persönlicher Text“ can be selected for the
// Kampagne and Marketing mails (Einstellungen per type, or per campaign) under
// the design key 'vorlage-<id>'. It resolves to a ResolvedEmailDesign whose
// theme tokens come from the template's style and whose `shell` renders the
// template's blocks (mail-template-render.mjs) — the composers stay untouched:
// they still write Mo's text, pick products, mint the code and hand over the
// pieces (BrandedEmailOptions, incl. `blocks` from the campaign composer);
// the shell only decides WHERE each piece sits. Nothing is ever dropped (the
// renderer places an unplaced piece after Mo's text), the legal footer is
// always rendered.
//
// What needs data is resolved here and handed to the renderer as DATA, which
// it draws in the template's own look: the fixed product blocks (catalog,
// loaded before rendering, so the synchronous shell can lay them out — the
// classic rows / grid in the template's fonts and colours), the
// „Produkt-Highlight“ blocks (they may stand inside the columns of a
// section) and the live countdown (signed token, its picture in the block's
// colours — countdownLook). Everything is fail-soft: an unreadable template
// resolves to null (the caller falls back to the selected / classic design).

import type { EmailSectionRowOptions, OfferCountdownInput, ResolvedEmailDesign } from "./email-design-context";
import { activeEmailRenderData } from "./email-design-context";
import type { EmailTheme } from "./email-theme-context";
import type { BrandedEmailOptions } from "./email-template";
import {
  EMAIL_IMPRINT_URL,
  EMAIL_SOCIAL_LINKS,
  classicSectionRowHtml,
  emailLogoUrl,
  emailMoIconUrl,
  offerCountdownInput,
  renderCtaButton,
  renderSectionRow,
} from "./email-template";
import { productGridItem, productRowItems } from "./email-products";
import { COUNTDOWN_HEIGHT } from "./email-countdown-image.mjs";
import { resolveProductSelections } from "./product-catalog";
import { getBaseUrl } from "./base-url";
import { reportError } from "./observability";
import { getCachedMailTemplate, type MailTemplateDoc } from "./mail-template-store";
import {
  applyMergeFields,
  classicFontFor,
  countdownLook,
  docHasHero,
  docProductRefs,
  docSupportsPersonal,
  normalizeMailTemplateDoc,
  parseTemplateDesignKey,
  templateDesignKey,
  walkMailBlocks,
} from "./mail-template-doc.mjs";
import {
  isDarkCard,
  mailWhitePanel,
  renderMailTemplateHtml,
  type MailRenderContext,
  type MailSlotCountdown,
  type MailSlotProducts,
} from "./mail-template-render.mjs";
import { emptyProductBlocks, mailProductImageUrl, productHighlightSlot, productListText } from "./mail-template-slots.mjs";
import { MAILING_HTML_HARD_LIMIT } from "./mailing-checks.mjs";
import { countdownDeadlineText, countdownText } from "./offer-countdown.mjs";
import type { Product } from "./types";

/**
 * A slot of the template renderer (MailRenderContext.slots): its line(s) of
 * the text part and the DATA the renderer lays out in the template's look —
 * `product` (a „Produkt-Highlight“ card), `products` (the rows / grid of a
 * products block), `countdown` (the signed live image in the block's colours
 * and the line under it). `html` stays "": pre-rendered rows are only what a
 * version-1 document of the fixtures hands in.
 */
export type MailSlot = {
  html: string;
  text: string;
  product?: ReturnType<typeof productHighlightSlot>["product"];
  products?: MailSlotProducts;
  countdown?: MailSlotCountdown;
};

/** The kinds a template may be the design of (marketing mails only — DOI and summary keep the code designs). */
export const TEMPLATE_DESIGN_KINDS = ["marketing", "campaign"] as const;

export function isTemplateDesignKind(kind: string): boolean {
  return (TEMPLATE_DESIGN_KINDS as readonly string[]).includes(kind);
}

/** Readable text on a band colour: dark text on a light band. */
function textOn(hex: string): string {
  const v = /^#([0-9a-f]{6})$/i.exec(hex)?.[1];
  if (!v) return "#ffffff";
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255);
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.6 ? "#111111" : "#ffffff";
}

/**
 * The template's style as theme tokens for the classic renderers (product
 * rows, coupon, countdown …). Those know the theme fonts only: a template web
 * font (Oswald, Poppins …) maps to the closest of them.
 */
export function templateTheme(doc: MailTemplateDoc): EmailTheme {
  const s = doc.style;
  return {
    accentColor: s.accentColor,
    bandBackground: s.headingColor,
    bandTextColor: textOn(s.headingColor),
    outerBackground: s.outerBackground,
    fontFamily: classicFontFor(s.fontFamily),
    buttonShape: s.buttonShape,
    logoUrl: s.logoUrl,
    showSocial: true,
  } as EmailTheme;
}

/** Swap the classic 60px side padding of a CSS padding shorthand for the template's. */
function withSidePadding(padding: string, side: number): string {
  if (side === 60) return padding;
  const parts = padding.trim().split(/\s+/);
  const swap = (v: string) => (v === "60px" ? `${side}px` : v);
  if (parts.length === 2) return `${parts[0]} ${swap(parts[1])}`;
  if (parts.length === 3) return `${parts[0]} ${swap(parts[1])} ${parts[2]}`;
  if (parts.length === 4) return `${parts[0]} ${swap(parts[1])} ${parts[2]} ${swap(parts[3])}`;
  return padding;
}

/**
 * The classic content rows inside a template (Mo's buttons and footnote, the
 * composer's offer rows — the template's own products and countdown are drawn
 * by the renderer): the template's card colour and side padding instead of
 * white and 60px. The
 * classic renderers write dark text, so on a dark card (black below 4.5:1)
 * the piece sits on a white panel instead of turning unreadable — the same
 * panel the renderer gives Mo's text (mail-template-render.mjs
 * mailWhitePanel). With the default style the row is byte-identical to the
 * classic one.
 */
export function templateSectionRow(doc: MailTemplateDoc) {
  const s = doc.style;
  const darkCard = isDarkCard(s.cardBackground);
  return (innerHtml: string, opts: EmailSectionRowOptions = {}): string => {
    const panel = darkCard && !opts.bgcolor;
    // The panel's own 16 px come out of the row's side padding, so the classic
    // pieces keep the width they are built for (the countdown picture and the
    // product grid are 480 px wide; Outlook sizes them by that attribute).
    const side = panel ? Math.max(0, s.contentPadding - MAIL_PANEL_PADDING) : s.contentPadding;
    return classicSectionRowHtml(panel ? mailWhitePanel(innerHtml) : innerHtml, {
      ...opts,
      padding: withSidePadding(opts.padding ?? "20px 60px", side),
      bgcolor: opts.bgcolor ?? s.cardBackground,
    });
  };
}

/** The inner padding of mailWhitePanel (mail-template-render.mjs). */
const MAIL_PANEL_PADDING = 16;

/** The static assets every template render needs. */
export function templateAssets(): MailRenderContext["assets"] {
  const custom = (process.env.EMAIL_AI_LABEL_ICON_URL ?? "").trim();
  return {
    logoUrl: emailLogoUrl(),
    shopUrl: "https://www.motionsports.de",
    imprintUrl: EMAIL_IMPRINT_URL,
    socialLinks: EMAIL_SOCIAL_LINKS,
    aiLabelIconUrl: /^https?:\/\//.test(custom) ? custom : `${getBaseUrl()}/eu-ai-icon-email.png`,
  };
}

/**
 * The display products of every product block — `products` and
 * „Produkt-Highlight“, the ones inside sections too (catalog refs → live
 * products; sold-out and vanished ones are left out — a mail never
 * advertises what cannot be bought). Never throws: a catalog failure leaves
 * the blocks empty.
 */
export async function preloadDocProducts(doc: MailTemplateDoc): Promise<Map<string, Product>> {
  const refs = docProductRefs(doc);
  const out = new Map<string, Product>();
  if (refs.length === 0) return out;
  try {
    for (const s of await resolveProductSelections(refs, { allVariants: true })) {
      if (s.available && s.display) out.set(s.ref, s.display);
    }
  } catch (err) {
    reportError(err, { route: "lib/mail-template-design", phase: "preloadDocProducts" });
  }
  return out;
}

/**
 * What the product blocks would show right now — for the Rundmail checks:
 * names of products that are sold out (prepared ahead, left out of the mail
 * while sold out), refs no longer in the catalog, and the blocks with nothing
 * to show (left out entirely): `products` blocks none of whose products can
 * be shown and „Produkt-Highlight“ blocks whose product cannot — the ones
 * inside sections included. Never throws: a catalog failure reports nothing
 * (the checks are hints).
 */
export async function docProductAvailability(
  doc: MailTemplateDoc
): Promise<{ soldOut: string[]; unknown: string[]; emptyBlocks: number }> {
  const out = { soldOut: [] as string[], unknown: [] as string[], emptyBlocks: 0 };
  const refs = docProductRefs(doc);
  if (refs.length === 0) return out;
  try {
    const selections = await resolveProductSelections(refs, { allVariants: true });
    const byRef = new Map(selections.map((s) => [s.ref, s]));
    for (const ref of refs) {
      const s = byRef.get(ref);
      if (!s || s.missingVariant) out.unknown.push(ref);
      else if (!s.available) out.soldOut.push(s.display?.name ?? s.product.name ?? ref);
    }
    // The same rule as preloadDocProducts: only an available product with a display is shown.
    out.emptyBlocks = emptyProductBlocks(doc, (ref) => {
      const s = byRef.get(ref);
      return Boolean(s && !s.missingVariant && s.available && s.display);
    });
  } catch (err) {
    reportError(err, { route: "lib/mail-template-design", phase: "docProductAvailability" });
  }
  return out;
}

/**
 * The slots of the blocks that need live data, by block id — every block of
 * the tree, the ones inside sections included — as DATA the template
 * renderer lays out in the template's own look (fonts, colours, buttons):
 *   * `products` — the products of the rows / grid (the shared price
 *     projection, a mail-safe picture; the rows' description and button
 *     label) + the text;
 *   * `countdown` — the live image URLs, signed and in the block's colours
 *     (countdownLook) with its text in the picture (`label` / `showLabel`),
 *     and the deadline for the line under it (until it has expired);
 *   * `product` („Produkt-Highlight“) — the card DATA (the grid's price
 *     line, a mail-safe picture, the short description) + the text.
 * A block whose products are not available gets no slot (it is left out of a
 * send). Runs inside withEmailDesign(...) of the template (the price
 * projection and the signing are design-independent).
 */
export function renderDocSlots(
  doc: MailTemplateDoc,
  products: Map<string, Product>,
  language: "de" | "en"
): Record<string, MailSlot> {
  const slots: Record<string, MailSlot> = {};
  for (const { block: b } of walkMailBlocks(doc)) {
    try {
      if (b.type === "products") {
        const list = (b.refs as string[]).map((r) => products.get(r)).filter((p): p is Product => Boolean(p));
        if (list.length === 0) continue;
        const items = list.map((p) => productGridItem(p, language));
        const grid = b.layout === "grid";
        // the rows' description and button label (no highlights: the catalog's short description)
        const rows = grid ? [] : productRowItems(list, { locale: language });
        slots[b.id] = {
          html: "",
          text: productListText(items),
          products: {
            layout: grid ? "grid" : "rows",
            items: items.map((it, i) => ({
              name: it.name,
              imageUrl: mailProductImageUrl(it.imageUrl, list[i]?.images),
              url: it.url ?? null,
              priceLabel: it.priceLabel ?? null,
              compareAtLabel: it.compareAtLabel ?? null,
              description: rows[i]?.description ?? null,
              ctaLabel: rows[i]?.ctaLabel ?? null,
            })),
          },
        };
      } else if (b.type === "product" && b.ref) {
        const display = products.get(b.ref as string);
        if (display) {
          slots[b.id] = productHighlightSlot(productGridItem(display, language), display, { showPrice: b.showPrice !== false });
        }
      } else if (b.type === "countdown" && b.until) {
        const look = countdownLook(b, doc.style);
        // the text in the picture: the block's own, none, or (unset) the default words
        const label = b.showLabel === false ? { hidden: true } : typeof b.label === "string" && b.label ? { text: b.label } : null;
        const data = offerCountdownInput({ expiresAt: b.until as string, language, colors: look, label });
        if (data) slots[b.id] = { html: "", text: countdownText(b.until, language), countdown: templateCountdownSlot(data) };
      }
    } catch (err) {
      reportError(err, { route: "lib/mail-template-design", phase: "renderDocSlots" });
    }
  }
  return slots;
}

/**
 * The countdown slot of a template block: the signed image URLs (in the
 * block's colours, with its text), their sizes, the alt text and the
 * deadline („Sa., 15.11.2026, 23:59 Uhr“) for the line under the image (the
 * block's `caption`, by default „Gültig bis {datum}“). Neither the alt text
 * nor the line carries a remaining time: a Rundmail is rendered once and
 * opened days later — the live picture shows the real one.
 */
function templateCountdownSlot(data: OfferCountdownInput): MailSlotCountdown {
  return {
    imageUrl: data.imageUrl,
    imageUrlMobile: data.imageUrlMobile,
    imageAlt: countdownDeadlineText(data.expiresAt, data.language),
    imageWidth: data.imageWidth,
    imageHeight: COUNTDOWN_HEIGHT,
    imageWidthMobile: data.imageWidthMobile,
    deadline: data.deadlineLabel,
  };
}

/** The Mo pieces of a composer's options (everything it produced, rendered as card rows). */
function moContext(opts: BrandedEmailOptions): NonNullable<MailRenderContext["mo"]> {
  const ctaRowsHtml = (opts.ctas ?? [])
    .filter((c) => c.url && c.label)
    .map((c) => renderSectionRow(renderCtaButton(c), { padding: "10px 60px", align: "center" }))
    .join("");
  return {
    heading: opts.heading,
    bodyHtml: opts.bodyHtml,
    moAvatarUrl: opts.moAvatar ? emailMoIconUrl() : null,
    offerRowsHtml: opts.blocks ? opts.blocks.offerRowsHtml : null,
    promoRowsHtml: opts.blocks ? opts.blocks.promoRowsHtml : null,
    ctaRowsHtml,
    footnoteRowHtml: opts.footnoteHtml ? renderSectionRow(opts.footnoteHtml, { padding: "10px 60px", align: "center" }) : "",
    postCtaRowsHtml: opts.postCtaRowsHtml ?? "",
    preCtaRowsHtml: opts.preCtaRowsHtml ?? "",
  };
}

/**
 * A template document as a design: its theme tokens + a shell that renders
 * the blocks around the composer's pieces. `products` are the preloaded
 * display products of its fixed product blocks.
 */
export function templateDesignFromDoc(
  key: string,
  rawDoc: unknown,
  products: Map<string, Product>
): ResolvedEmailDesign {
  const doc = normalizeMailTemplateDoc(rawDoc);
  return {
    key,
    hasHero: docHasHero(doc),
    theme: templateTheme(doc),
    renderers: {
      sectionRow: templateSectionRow(doc),
      shell: (opts: BrandedEmailOptions) => {
        const rd = activeEmailRenderData();
        const language = opts.locale === "en" ? "en" : "de";
        const firstName = rd.recipientFirstName ?? null;
        const html = renderMailTemplateHtml(doc, {
          subject: opts.subject,
          preheader: opts.preheader ?? null,
          locale: language,
          merge: (t: string) => applyMergeFields(t, { firstName }),
          assets: templateAssets(),
          slots: renderDocSlots(doc, products, language),
          mo: moContext(opts),
          hero: rd.heroImageUrl
            ? {
                imageUrl: rd.heroImageUrl,
                mobileUrl: rd.heroImageMobileUrl ?? null,
                headline: rd.heroHeadline ?? null,
                isAi: rd.heroIsAiGenerated !== false,
              }
            : null,
          footer: { unsubscribeHtml: opts.footer?.unsubscribeHtml ?? null },
        });
        // Gmail clips a mail above 102 KB and hides the footer behind „Nachricht
        // gekürzt“: report it (the mail still goes out — fail-soft), so the
        // operator learns that the template is too heavy for personal mails.
        const bytes = Buffer.byteLength(html, "utf8");
        if (bytes > MAILING_HTML_HARD_LIMIT) {
          reportError(new Error(`template design ${key}: ${Math.round(bytes / 1024)} KB`), {
            route: "lib/mail-template-design",
            phase: "shell-size",
          });
        }
        return html;
      },
    },
  };
}

/**
 * Resolve a template design key for a mail kind: the template must exist and
 * carry „Mos persönlicher Text“, the kind must be a marketing kind. Archived
 * templates still resolve — a campaign that uses one keeps rendering until
 * someone picks another. Null otherwise (the caller falls back). Never throws.
 */
export async function resolveTemplateDesign(key: string, kind: string): Promise<ResolvedEmailDesign | null> {
  const id = parseTemplateDesignKey(key);
  if (id == null || !isTemplateDesignKind(kind)) return null;
  try {
    const template = await getCachedMailTemplate(id);
    if (!template || !docSupportsPersonal(template.doc)) return null;
    const products = await preloadDocProducts(template.doc);
    return templateDesignFromDoc(templateDesignKey(id), template.doc, products);
  } catch (err) {
    reportError(err, { route: "lib/mail-template-design", phase: "resolveTemplateDesign" });
    return null;
  }
}

/** The template version behind a design key (release fingerprint), or null for a code design. */
export async function templateDesignVersion(key: string | null | undefined): Promise<number | null> {
  const id = parseTemplateDesignKey(key);
  if (id == null) return null;
  const template = await getCachedMailTemplate(id);
  return template ? template.version : null;
}
