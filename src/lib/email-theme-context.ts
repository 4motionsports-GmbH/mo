// Ambient email-theme context for the shared branded shell.
//
// The shell's design tokens (email-template.ts) are read from DEEP inside the
// composition tree — section bands, CTA buttons, product rows, bundle blocks —
// far away from the async send/preview entry points that know WHICH email type
// is being rendered. Threading a `theme` parameter through every helper would
// touch dozens of signatures, so the entry points instead run the (sync or
// async) render inside `withEmailTheme(theme, …)` and every token getter reads
// the active theme via AsyncLocalStorage. Outside any wrapper — legacy callers,
// scripts, unit renders — `activeEmailTheme()` returns the built-in default,
// which is exactly today's hard-coded design.
//
// AsyncLocalStorage (not a mutable module `let`) so concurrent renders in one
// serverless instance can never bleed themes into each other, even across
// awaits.
//
// Server-only (node:async_hooks) — never import this from a client component.

import { AsyncLocalStorage } from "node:async_hooks";
import { DEFAULT_EMAIL_THEME } from "./email-theme.mjs";

/** The shell design tokens — mirror of email-theme.mjs' EmailThemeTokens. */
export interface EmailTheme {
  /** CTA buttons, prose links, savings line ('#rrggbb'). */
  accentColor: string;
  /** The signature full-width separator bands ('#rrggbb'). */
  bandBackground: string;
  /** Text on the separator bands ('#rrggbb'). */
  bandTextColor: string;
  /** Page background around the white card ('#rrggbb'). */
  outerBackground: string;
  /** Font stack key (email-theme.mjs EMAIL_FONT_CHOICES). */
  fontFamily: string;
  /** CTA button corner shape ('pill' | 'rounded' | 'square'). */
  buttonShape: string;
  /** Absolute https logo override, or null → env/default. */
  logoUrl: string | null;
  /** Social-icons row in the footer. */
  showSocial: boolean;
}

const themeStorage = new AsyncLocalStorage<EmailTheme>();

/**
 * Run `fn` with `theme` as the active email theme (null → run unwrapped, i.e.
 * the default design). Works for sync and async callbacks — the context
 * propagates across awaits inside `fn`.
 */
export function withEmailTheme<T>(theme: EmailTheme | null, fn: () => T): T {
  if (!theme) return fn();
  return themeStorage.run(theme, fn);
}

/** The active theme, or the built-in default outside any withEmailTheme. */
export function activeEmailTheme(): EmailTheme {
  return themeStorage.getStore() ?? (DEFAULT_EMAIL_THEME as EmailTheme);
}
