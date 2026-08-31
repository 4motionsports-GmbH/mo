// The email-design REGISTRY — the single list of every design the app can
// render. Designs are CODE MODULES in this directory, authored with Claude
// Code (recipe: docs/EMAIL_DESIGNS.md); the database only stores which design
// each email type currently uses (email-design-store.ts), so the registry is
// the "version history": every design ever shipped stays here and stays
// selectable in the admin "Einstellungen" tab.
//
// A design definition is layered ("general template + tailored versions"):
//   classic built-ins  ←  design.theme / design.renderers (the GENERAL look)
//                      ←  design.variants[kind]           (per-type tailoring)
// Whatever a layer does not define falls through to the layer below, so a
// design only writes what actually differs.
//
// Adding a design = one new file here + one entry in EMAIL_DESIGNS below.
// Nothing else: the settings page lists this registry, the preview route
// renders it, and the send paths pick it up through the stored selection.

import type {
  EmailDesignRenderers,
  ResolvedEmailDesign,
} from "../email-design-context";
import type { EmailTheme } from "../email-theme-context";
import { DEFAULT_EMAIL_THEME, EMAIL_THEME_KINDS } from "../email-theme.mjs";
import { studioDesign } from "./studio";

/** The email kinds a design can be tailored for ('summary' | 'doi' | …). */
export type EmailDesignKind = (typeof EMAIL_THEME_KINDS)[number];

/** One tailoring layer: token overrides and/or renderer overrides. */
export interface EmailDesignLayer {
  /** Theme-token overrides consumed by the classic renderers. */
  theme?: Partial<EmailTheme>;
  /** Renderer overrides — replace whole building blocks (up to the shell). */
  renderers?: EmailDesignRenderers;
}

export interface EmailDesignDefinition extends EmailDesignLayer {
  /** Stable identifier stored in email_design_selections. NEVER change it —
   * treat a visual rework as a NEW design (new key), that's the versioning. */
  key: string;
  /** Display name in the admin UI. */
  name: string;
  /** One short German sentence: what this design looks like / is for. */
  description: string;
  /** When the design was added (informational, shown in the UI). */
  addedAt: string;
  /** Kinds this design is offered for (default: all four). */
  supportedKinds?: EmailDesignKind[];
  /** Per-email-type tailored adjustments layered over the general look. */
  variants?: Partial<Record<EmailDesignKind, EmailDesignLayer>>;
}

/** The built-in default: the classic Shopify-newsletter look implemented in
 * email-template.ts/email-products.ts. It has no overrides by definition. */
export const CLASSIC_EMAIL_DESIGN_KEY = "classic";

const CLASSIC_META = {
  key: CLASSIC_EMAIL_DESIGN_KEY,
  name: "Klassisch (Standard)",
  description:
    "Das bisherige Newsletter-Design: weiße Karte, schwarze Trennbänder, blauer Pill-Button, Montserrat.",
  addedAt: "2025-01-01",
  supportedKinds: [...EMAIL_THEME_KINDS] as EmailDesignKind[],
};

/**
 * All NON-classic designs, oldest first. Add new designs at the END so the
 * settings page reads like a changelog.
 */
const EMAIL_DESIGNS: EmailDesignDefinition[] = [studioDesign];

/** Serializable metadata for the admin UI (classic first, then the registry). */
export interface EmailDesignMeta {
  key: string;
  name: string;
  description: string;
  addedAt: string;
  supportedKinds: EmailDesignKind[];
  isDefault: boolean;
}

export function listEmailDesignMeta(): EmailDesignMeta[] {
  return [
    { ...CLASSIC_META, isDefault: true },
    ...EMAIL_DESIGNS.map((d) => ({
      key: d.key,
      name: d.name,
      description: d.description,
      addedAt: d.addedAt,
      supportedKinds: d.supportedKinds ?? ([...EMAIL_THEME_KINDS] as EmailDesignKind[]),
      isDefault: false,
    })),
  ];
}

export function isKnownEmailDesign(key: string): boolean {
  return key === CLASSIC_EMAIL_DESIGN_KEY || EMAIL_DESIGNS.some((d) => d.key === key);
}

export function designSupportsKind(key: string, kind: EmailDesignKind): boolean {
  if (key === CLASSIC_EMAIL_DESIGN_KEY) return true;
  const d = EMAIL_DESIGNS.find((x) => x.key === key);
  if (!d) return false;
  return (d.supportedKinds ?? EMAIL_THEME_KINDS).includes(kind);
}

/**
 * Resolve a design for one email kind: merge default tokens ← general theme ←
 * variant theme, and general renderers ← variant renderers. Returns null for
 * the classic design and for unknown keys (→ render the built-ins), so a
 * selection pointing at a design an older/newer deploy doesn't know degrades
 * safely to the default look.
 */
export function resolveEmailDesignForKind(
  key: string,
  kind: EmailDesignKind
): ResolvedEmailDesign | null {
  if (key === CLASSIC_EMAIL_DESIGN_KEY) return null;
  const d = EMAIL_DESIGNS.find((x) => x.key === key);
  if (!d) return null;
  const variant = d.variants?.[kind];
  const hasTheme = d.theme || variant?.theme;
  const theme: EmailTheme | null = hasTheme
    ? {
        ...(DEFAULT_EMAIL_THEME as EmailTheme),
        ...(d.theme ?? {}),
        ...(variant?.theme ?? {}),
      }
    : null;
  return {
    key: d.key,
    theme,
    renderers: { ...(d.renderers ?? {}), ...(variant?.renderers ?? {}) },
  };
}
