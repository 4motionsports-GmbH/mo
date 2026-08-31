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
