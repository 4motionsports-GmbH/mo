// Typed wrapper around the pure prompt assembly (system-prompt-core.mjs). The
// copy + assembly live in the .mjs core so the whole prompt is node:test-able
// (German-byte-identical snapshot + English-path assertion); this file keeps the
// typed public API the chat route imports and forwards a `locale` through.

import type { Product, CustomerProfile, PersonaArchetype } from "./types";
import type { BrowsingContext } from "./browsing-context";
import type { CustomerMemoryContext } from "./customer-memory";
import type { Locale } from "./locale";
import {
  buildSystemPrompt as buildSystemPromptCore,
  productPivotNote as productPivotNoteCore,
  browsingPivotNote as browsingPivotNoteCore,
  greetingTriggerText as greetingTriggerTextCore,
} from "./system-prompt-core.mjs";

// How far the email-summary ask has progressed in THIS conversation. Derived
// server-side from the message history (api/chat counts prior
// offer_email_summary tool calls) so the two-ask cap doesn't rely on the
// model's memory alone — once exhausted the tool is also withheld entirely.
export interface EmailOfferState {
  /** Prior offer_email_summary calls in this conversation's history. */
  offersMade: number;
  /** True once the user submitted their email via the capture form here. */
  emailCaptured: boolean;
}

export interface ProductContext {
  id: string;
  name: string;
}

interface BuildPromptOpts {
  profile: CustomerProfile;
  archetype: PersonaArchetype;
  retrievedProducts: Product[];
  emailOffer?: EmailOfferState;
  // Set when the chat was opened "about" a specific product from the
  // storefront AND the conversation is fresh (no prior messages). It seeds a
  // system-level instruction so the assistant opens with a warm, product-aware
  // greeting. For an EXISTING conversation we do NOT use this — see
  // `productPivotNote` for the lightweight in-conversation variant.
  productContext?: ProductContext;
  // Set when the user opened a FRESH chat bringing a small recently-viewed
  // trail along (validated in lib/browsing-context.ts). Seeds either the
  // context-aware greeting (no productContext present) or background info for
  // the first answer (productContext present — the product greeting wins).
  // For an EXISTING conversation we do NOT use this — see `browsingPivotNote`.
  browsingContext?: BrowsingContext;
  // Set ONLY after the user re-identified themselves IN THIS session (email
  // captured here and verified against this session id) AND that email matched
  // an existing customer with history. Never derived from the session id alone
  // — see lib/customer-memory.ts for the gate. Absent → no memory, the chat
  // behaves exactly as for an anonymous/new visitor.
  customerMemory?: CustomerMemoryContext;
  // Storefront-selected language. Default German — every legacy caller and the
  // German output stay byte-identical; "en" switches Mo to English.
  locale?: Locale;
}

// Lightweight in-conversation note used when the user opens the product
// context on top of an EXISTING conversation. Injected into the message flow
// (not the system prompt) so the assistant can pivot toward the product
// without wiping the history that came before it.
export function productPivotNote(ctx: ProductContext, locale: Locale = "de"): string {
  return productPivotNoteCore(ctx, locale);
}

// Lightweight in-conversation note used when browsing context arrives on top
// of an EXISTING conversation. Like productPivotNote: injected into the
// message flow, never wiping the history that came before it.
export function browsingPivotNote(ctx: BrowsingContext, locale: Locale = "de"): string {
  return browsingPivotNoteCore(ctx, locale);
}

// Server-only trigger turn pushed onto a fresh product/browsing open so the
// model actually emits the opener (never streamed back nor stored).
export function greetingTriggerText(
  locale: Locale,
  ctx: { productName?: string | null }
): string {
  return greetingTriggerTextCore(locale, ctx);
}

export function buildSystemPrompt(opts: BuildPromptOpts): string {
  return buildSystemPromptCore({ locale: "de", ...opts });
}
