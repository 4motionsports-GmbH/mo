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
// The renderers that need data run here, inside the design context: the
// fixed product blocks (catalog, loaded before rendering, so the synchronous
// shell can lay them out through the classic product renderers) and the live
// countdown (signed token). Everything is fail-soft: an unreadable template
// resolves to null (the caller falls back to the selected / classic design).

import type { ResolvedEmailDesign } from "./email-design-context";
import { activeEmailRenderData } from "./email-design-context";
import type { EmailTheme } from "./email-theme-context";
import type { BrandedEmailOptions } from "./email-template";
import {
  EMAIL_IMPRINT_URL,
  EMAIL_SOCIAL_LINKS,
  emailLogoUrl,
  emailMoIconUrl,
  renderCtaButton,
  renderOfferCountdown,
  renderSectionRow,
} from "./email-template";
import {
  productGridItem,
  productRowItems,
  renderEmailProductGrid,
  renderEmailProductRows,
} from "./email-products";
import { resolveProductSelections } from "./product-catalog";
import { getBaseUrl } from "./base-url";
import { reportError } from "./observability";
import { getCachedMailTemplate, type MailTemplateDoc } from "./mail-template-store";
import {
  applyMergeFields,
  docHasHero,
  docProductRefs,
  docSupportsPersonal,
  normalizeMailTemplateDoc,
  parseTemplateDesignKey,
  templateDesignKey,
} from "./mail-template-doc.mjs";
import { renderMailTemplateHtml, type MailRenderContext } from "./mail-template-render.mjs";
import { countdownText } from "./offer-countdown.mjs";
import type { Product } from "./types";

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

/** The template's style as theme tokens for the classic renderers (product rows, coupon, countdown …). */
export function templateTheme(doc: MailTemplateDoc): EmailTheme {
  const s = doc.style;
  return {
    accentColor: s.accentColor,
    bandBackground: s.headingColor,
    bandTextColor: textOn(s.headingColor),
    outerBackground: s.outerBackground,
    fontFamily: s.fontFamily,
    buttonShape: s.buttonShape,
    logoUrl: s.logoUrl,
    showSocial: true,
  } as EmailTheme;
}

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
 * The display products of every fixed product block (catalog refs → live
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
 * What the products blocks would show right now — for the Rundmail checks:
 * names of products that are sold out (prepared ahead, left out of the mail
 * while sold out), refs no longer in the catalog, and products blocks with
 * nothing to show (left out entirely). Never throws: a catalog failure
 * reports nothing (the checks are hints).
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
    for (const b of doc.blocks) {
      if (b.type !== "products" || !Array.isArray(b.refs) || b.refs.length === 0) continue;
      const showable = (b.refs as string[]).some((ref) => {
        const s = byRef.get(ref);
        return Boolean(s && !s.missingVariant && s.available && s.display);
      });
      if (!showable) out.emptyBlocks++;
    }
  } catch (err) {
    reportError(err, { route: "lib/mail-template-design", phase: "docProductAvailability" });
  }
  return out;
}

const priceFmt = {
  de: new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }),
  en: new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR" }),
};

/**
 * The pre-rendered slots of the fixed product and countdown blocks. MUST run
 * inside withEmailDesign(...) of the template, so the classic renderers use
 * its colours and font.
 */
export function renderDocSlots(
  doc: MailTemplateDoc,
  products: Map<string, Product>,
  language: "de" | "en"
): Record<string, { html: string; text: string }> {
  const slots: Record<string, { html: string; text: string }> = {};
  for (const b of doc.blocks) {
    try {
      if (b.type === "products") {
        const list = (b.refs as string[]).map((r) => products.get(r)).filter((p): p is Product => Boolean(p));
        if (list.length === 0) continue;
        const inner =
          b.layout === "grid"
            ? renderEmailProductGrid(list.map((p) => productGridItem(p, language)))
            : renderEmailProductRows(productRowItems(list, { locale: language }));
        const text = list
          .map((p) => {
            const price = typeof p.price === "number" ? priceFmt[language].format(p.salePrice ?? p.price) : "";
            return `- ${p.name}${price ? ` — ${price}` : ""}${p.shopifyUrl ? `\n  ${p.shopifyUrl}` : ""}`;
          })
          .join("\n");
        slots[b.id] = { html: renderSectionRow(inner, { padding: "10px 60px 20px", align: "center" }), text };
      } else if (b.type === "countdown" && b.until) {
        const html = renderOfferCountdown({ expiresAt: b.until, language });
        if (html) slots[b.id] = { html, text: countdownText(b.until, language) };
      }
    } catch (err) {
      reportError(err, { route: "lib/mail-template-design", phase: "renderDocSlots" });
    }
  }
  return slots;
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
      shell: (opts: BrandedEmailOptions) => {
        const rd = activeEmailRenderData();
        const language = opts.locale === "en" ? "en" : "de";
        const firstName = rd.recipientFirstName ?? null;
        return renderMailTemplateHtml(doc, {
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
