// Data access for the per-send HERO images (migration 0050): the operator-
// generated hero image + its prompt, stored on the marketing_sends row
// (kind 'marketing', keyed by send id) resp. the campaign_drafts row
// (kind 'campaign', keyed by contact id — drafts are 1:1 per contact).
//
// Kept as its own tiny store (instead of widening marketing-store /
// campaign-store row mappings): the hero is design-layer data that only the
// hero routes and the send/preview entry points touch. Fail-soft like every
// store: no DB / read failure → null (→ the design's default hero), a write
// failure surfaces as ok:false to the admin route.

import { getSql, type Sql } from "./db";
import { reportError } from "./observability";

export type EmailHeroKind = "marketing" | "campaign";

export interface EmailHeroState {
  url: string | null;
  prompt: string | null;
}

export function parseEmailHeroKind(value: unknown): EmailHeroKind | null {
  return value === "marketing" || value === "campaign" ? value : null;
}

/** The stored hero for one draft, or null when the row doesn't exist. */
export async function getEmailHero(
  kind: EmailHeroKind,
  id: number,
  sql: Sql | null = getSql()
): Promise<EmailHeroState | null> {
  if (!sql) return null;
  try {
    const rows = (kind === "marketing"
      ? await sql`
          SELECT hero_image_url, hero_image_prompt
            FROM marketing_sends WHERE id = ${id}
        `
      : await sql`
          SELECT hero_image_url, hero_image_prompt
            FROM campaign_drafts WHERE contact_id = ${id}
        `) as Array<{ hero_image_url: string | null; hero_image_prompt: string | null }>;
    if (rows.length === 0) return null;
    return {
      url: rows[0].hero_image_url ?? null,
      prompt: rows[0].hero_image_prompt ?? null,
    };
  } catch (err) {
    reportError(err, { route: "lib/email-hero-store", phase: "get" });
    return null;
  }
}

/** The custom hero URL for the SEND PATH — never throws, null → default hero. */
export async function getEmailHeroUrl(kind: EmailHeroKind, id: number): Promise<string | null> {
  const state = await getEmailHero(kind, id);
  return state?.url ?? null;
}

/** Store (or with nulls: clear) the hero image + prompt on the draft row. */
export async function setEmailHero(
  kind: EmailHeroKind,
  id: number,
  url: string | null,
  prompt: string | null,
  sql: Sql | null = getSql()
): Promise<{ ok: boolean; notFound?: boolean }> {
  if (!sql) return { ok: false };
  try {
    const rows = (kind === "marketing"
      ? await sql`
          UPDATE marketing_sends
             SET hero_image_url = ${url}, hero_image_prompt = ${prompt}
           WHERE id = ${id}
          RETURNING id
        `
      : await sql`
          UPDATE campaign_drafts
             SET hero_image_url = ${url}, hero_image_prompt = ${prompt},
                 updated_at = now()
           WHERE contact_id = ${id}
          RETURNING id
        `) as Array<{ id: number }>;
    if (rows.length === 0) return { ok: false, notFound: true };
    return { ok: true };
  } catch (err) {
    reportError(err, { route: "lib/email-hero-store", phase: "set" });
    return { ok: false };
  }
}
