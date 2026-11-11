// Rundmail (bulk mail) — rendering its content (a block document,
// mail-template-doc.mjs) for the three moments of its life:
//
//   preview — the admin's live preview (inert links, a sample first name);
//   test    — a test mail to the operator's own address (real unsubscribe
//             link for that address, direct links, the chosen first name);
//   freeze  — the release: rendered ONCE with per-recipient placeholders
//             (mailing-core.mjs) and the tracked link table — what every
//             recipient gets, byte for byte, except the placeholders.
//
// The same renderer (mail-template-render.mjs) and the same slot rendering
// (mail-template-design.ts — fixed product rows / grid, the data of the
// „Produkt-Highlight“ cards, live countdown, in the document's colours; for
// every block of the tree, the ones inside sections too) serve all three, so
// the test mail and the preview show exactly what the freeze ships.

import { withEmailDesign, type ResolvedEmailDesign } from "./email-design-context";
import { unsubscribeFooter } from "./consent-copy";
import { EMAIL_IMPRINT_URL } from "./email-template";
import {
  preloadDocProducts,
  renderDocSlots,
  templateAssets,
  templateSectionRow,
  templateTheme,
} from "./mail-template-design";
import { applyMergeFields, normalizeMailTemplateDoc } from "./mail-template-doc.mjs";
import { renderMailTemplateHtml, renderMailTemplateText } from "./mail-template-render.mjs";
import { freezeLinks } from "./mailing-core.mjs";
import type { MailingMerges } from "./mailing-store";

type Doc = ReturnType<typeof normalizeMailTemplateDoc>;

export interface MailingRenderInput {
  doc: unknown;
  subject: string;
  preheader: string | null;
  language: "de" | "en";
}

/** The theme-only design of a document (colours, font, card rows for the classic block renderers). */
function themeDesign(doc: Doc): ResolvedEmailDesign {
  return { key: "rundmail", theme: templateTheme(doc), renderers: { sectionRow: templateSectionRow(doc) } };
}

async function renderWith(
  input: MailingRenderInput,
  opts: {
    merge: (t: string) => string;
    greeting?: (text: string, fallback: string) => string;
    unsubscribeUrl: string;
    erasureUrl: string | null;
    previewPlaceholders: boolean;
  }
): Promise<{ html: string; text: string }> {
  const doc = normalizeMailTemplateDoc(input.doc);
  const products = await preloadDocProducts(doc);
  return withEmailDesign(themeDesign(doc), () => {
    const slots = renderDocSlots(doc, products, input.language);
    const footer = unsubscribeFooter(opts.unsubscribeUrl, input.language, opts.erasureUrl);
    const ctx = {
      subject: input.subject,
      preheader: input.preheader,
      locale: input.language,
      merge: opts.merge,
      greeting: opts.greeting,
      assets: templateAssets(),
      slots,
      mo: null,
      hero: null,
      footer: { unsubscribeHtml: footer.html, unsubscribeText: footer.text },
      previewPlaceholders: opts.previewPlaceholders,
    };
    return { html: renderMailTemplateHtml(doc, ctx), text: renderMailTemplateText(doc, ctx) };
  });
}

/** The admin preview: inert links (the route passes it through adminEmailHtml), a sample name. */
export async function renderMailingPreview(
  input: MailingRenderInput,
  firstName: string | null
): Promise<{ html: string; text: string; subject: string }> {
  const merge = (t: string) => applyMergeFields(t, { firstName });
  const out = await renderWith(input, { merge, unsubscribeUrl: "#", erasureUrl: "#", previewPlaceholders: true });
  return { ...out, subject: merge(input.subject) };
}

/** A test mail: real unsubscribe / erasure links of the test address, direct (untracked) links. */
export async function renderMailingTest(
  input: MailingRenderInput,
  firstName: string | null,
  links: { unsubscribeUrl: string; erasureUrl: string | null }
): Promise<{ html: string; text: string; subject: string }> {
  const merge = (t: string) => applyMergeFields(t, { firstName });
  const out = await renderWith(input, { merge, ...links, previewPlaceholders: false });
  return { ...out, subject: merge(input.subject) };
}

export interface FrozenRender {
  html: string;
  text: string;
  subject: string;
  links: Array<{ url: string }>;
  merges: MailingMerges;
}

/**
 * The release: one render with placeholders for everything personal, the
 * links frozen into the tracked table ({{mo:link:N}} — the click targets
 * only; the web-font stylesheet in the head stays direct), the subject's
 * merge fields as their own placeholders. `campaignSlug` names the UTM
 * campaign.
 */
export async function renderMailingFrozen(input: MailingRenderInput, campaignSlug: string): Promise<FrozenRender> {
  const merges: MailingMerges = { body: [], greetings: [], subject: [] };
  const merge = (t: string) =>
    applyMergeFields(t, {}, (_i, fallback) => {
      merges.body.push({ fallback });
      return `{{mo:fn:${merges.body.length - 1}}}`;
    });
  const greeting = (text: string, fallback: string) => {
    merges.greetings.push({ text, fallback });
    return `{{mo:greet:${merges.greetings.length - 1}}}`;
  };
  const rendered = await renderWith(input, {
    merge,
    greeting,
    unsubscribeUrl: "{{mo:unsub}}",
    erasureUrl: "{{mo:erase}}",
    previewPlaceholders: false,
  });
  const frozen = freezeLinks(rendered, { campaign: campaignSlug, untracked: [EMAIL_IMPRINT_URL] });
  const subject = applyMergeFields(input.subject, {}, (_i, fallback) => {
    merges.subject.push({ fallback });
    return `{{mo:fn:${merges.subject.length - 1}}}`;
  });
  return { html: frozen.html, text: frozen.text, subject, links: frozen.links, merges };
}
