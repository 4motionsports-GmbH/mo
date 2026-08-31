// Ambient email-design context — the second, more powerful layer above the
// token theme (email-theme-context.ts).
//
// A DESIGN (src/lib/email-designs/) can restyle an email in two ways:
//   1. THEME TOKENS — colors/font/button-shape consumed by the classic
//      renderers (the cheap way: same layout, different skin).
//   2. RENDERER OVERRIDES — replace whole building blocks: the section band,
//      the section row, the CTA button, the product grid/rows, or the entire
//      shell document. This is what lets an AI-authored design look completely
//      different from the classic newsletter.
//
// The public render helpers (renderBrandedEmail, renderSectionBand,
// renderEmailProductRows, …) check for an override first and fall back to the
// classic implementation, so composers (summary/marketing/campaign/DOI) never
// know which design is active — the async send/preview entry points resolve
// the selected design for the email type and run the render inside
// withEmailDesign(...).
//
// AsyncLocalStorage (not a mutable module `let`) so concurrent renders in one
// serverless instance can never bleed designs into each other, even across
// awaits. Server-only (node:async_hooks) — never import from a client
// component; the admin UI gets design METADATA serialized by the server.

import { AsyncLocalStorage } from "node:async_hooks";
import { withEmailTheme, type EmailTheme } from "./email-theme-context";
import type { BrandedEmailOptions, EmailCta } from "./email-template";
import type { EmailProductGridItem, EmailProductRowItem } from "./email-products";
import type { BundleOfferBlockInput } from "./bundle-email";

/**
 * Precomputed, PAngV-checked bundle labels handed to a bundleBlock override —
 * strike/saving values are non-null ONLY when the saving is genuine
 * (bundle-email.ts computes them once for every design).
 */
export interface BundleBlockComputed {
  /** Formatted set price (e.g. "159,90 €"). */
  priceLabel: string;
  /** Formatted genuine component sum, or null → NO strike line allowed. */
  stattLabel: string | null;
  /** Formatted genuine saving amount, or null → NO saving line allowed. */
  savingLabel: string | null;
  /** Whole-percent saving matching savingLabel, or null. */
  savingPct: number | null;
  /** Locale-correct fixed labels (kicker/price/instead/save/cta). */
  labels: { kicker: string; price: string; instead: string; save: string; cta: string };
}

/** Options of renderSectionRow — mirrored here to keep the interface local. */
export interface EmailSectionRowOptions {
  padding?: string;
  align?: "left" | "center";
  bgcolor?: string;
}

/**
 * The overridable building blocks of an email. Every function is optional —
 * whatever a design does not override renders through the classic
 * implementation (which itself honors the design's theme tokens).
 */
export interface EmailDesignRenderers {
  /** The COMPLETE HTML document. Overriding this replaces the whole shell —
   * header, heading, body slot, CTAs, footer. The override is fully
   * responsible for the legal footer slots (footer.unsubscribeHtml MUST be
   * rendered when present) and for email-client-safe markup. */
  shell?: (opts: BrandedEmailOptions) => string;
  /** The full-width section separator band (classic: black band, white text). */
  sectionBand?: (title: string) => string;
  /** A full-width content row inside the 600px card. */
  sectionRow?: (innerHtml: string, opts?: EmailSectionRowOptions) => string;
  /** The "bulletproof" CTA button table. */
  ctaButton?: (cta: EmailCta) => string;
  /** Two-column product picture grid (summary sections). */
  productGrid?: (items: EmailProductGridItem[]) => string;
  /** Personalised product rows (image 1/3 | text 2/3 — marketing/campaign). */
  productRows?: (items: EmailProductRowItem[]) => string;
  /** Inline style for normal body text (overrides emailTextStyle()). */
  textStyle?: () => string;
  /** Inline style for small print (overrides emailMutedTextStyle()). */
  mutedTextStyle?: () => string;
  /** Inline style for prose links (overrides emailLinkStyle()). */
  linkStyle?: () => string;
  /**
   * The bundle special-offer block's HTML (full-width card rows for the
   * preCtaRows slot). The TEXT part and the PAngV price computation stay with
   * bundle-email.ts for every design — the override only restyles the visuals
   * and MUST show strike/saving lines only when `computed` carries them.
   */
  bundleBlock?: (input: BundleOfferBlockInput, computed: BundleBlockComputed) => string;
  /**
   * The campaign mail's Mo-promo block (full-width card rows). The classic
   * implementation is a chat-style media row above the CTA; a design may render
   * it as its own advisor card instead. The TRACKED CTA url is handed in and
   * MUST stay clickable — the campaign funnel counts those clicks.
   */
  moPromoBlock?: (input: MoPromoBlockInput) => string;
}

/** Everything a moPromoBlock override needs (campaign-email.ts builds it). */
export interface MoPromoBlockInput {
  /** Mo's chat hint, already locale-resolved (plain text — escape it). */
  introText: string;
  /** Label of the promo CTA. */
  ctaLabel: string;
  /** The TRACKED /api/r/<token> deep link (preview: the plain deep link). */
  ctaUrl: string;
  language: "de" | "en";
}

/** A design resolved for ONE email kind: merged tokens + merged renderers. */
export interface ResolvedEmailDesign {
  key: string;
  /** Merged theme tokens, or null → default tokens. */
  theme: EmailTheme | null;
  /** Merged renderer overrides (base + kind variant). May be empty. */
  renderers: EmailDesignRenderers;
}

const designStorage = new AsyncLocalStorage<EmailDesignRenderers>();

/**
 * Run `fn` with `design` active (null → run unwrapped, i.e. the classic
 * design with default tokens). Sets BOTH layers: the token theme and the
 * renderer overrides. Works for sync and async callbacks.
 */
export function withEmailDesign<T>(design: ResolvedEmailDesign | null, fn: () => T): T {
  if (!design) return fn();
  return withEmailTheme(design.theme, () => designStorage.run(design.renderers, fn));
}

/** The active renderer overrides, or null outside any withEmailDesign. */
export function activeEmailDesignRenderers(): EmailDesignRenderers | null {
  return designStorage.getStore() ?? null;
}

// ── Per-send render data ──────────────────────────────────────────────────────
// Data that belongs to ONE email being rendered (not to the design): today the
// operator-generated hero image of hero-driven designs. Carried in its own ALS
// so the send/preview entry points can pass it without widening every composer
// signature; designs read it via activeEmailRenderData() and fall back to
// their defaults when a field is absent.

export interface EmailRenderData {
  /** Absolute https URL of the per-send custom hero image, or null → the
   * design's default hero asset. */
  heroImageUrl?: string | null;
  /**
   * Per-send hero claim (two short lines, "\n"-separated) — the AI-drafted,
   * operator-edited headline. Null/absent → the design's per-type default.
   */
  heroHeadline?: string | null;
  /**
   * The recipient's first name, when known — image-first designs open with a
   * personal greeting ("Hey Anna-Sophie,"). Null/absent → the design falls
   * back to whatever greeting the AI prose already carries.
   */
  recipientFirstName?: string | null;
}

const renderDataStorage = new AsyncLocalStorage<EmailRenderData>();

/**
 * Run `fn` with per-send render data active (null/empty → run unwrapped).
 *
 * Nested calls MERGE onto the data already active instead of replacing it, so
 * an inner wrapper that only knows one field (e.g. a preview adding a sample
 * recipient name) can never silently drop the fields an outer wrapper set.
 */
export function withEmailRenderData<T>(data: EmailRenderData | null, fn: () => T): T {
  if (!data) return fn();
  const merged = { ...activeEmailRenderData(), ...data };
  return renderDataStorage.run(merged, fn);
}

/** The active per-send render data ({} outside any withEmailRenderData). */
export function activeEmailRenderData(): EmailRenderData {
  return renderDataStorage.getStore() ?? {};
}
