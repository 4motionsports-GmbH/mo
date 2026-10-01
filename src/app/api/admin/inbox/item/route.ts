// GET /api/admin/inbox/item?id= → { item, customer }
//
// One Eingang item with the customer mini-card (identity, the one consent,
// figures, profile excerpt) for the right pane. Read-only.

import { guardAdminGet, adminJson, adminJsonError } from "@/lib/admin-api";
import { getInboxItem } from "@/lib/inbox-store";
import { getCustomerById } from "@/lib/customer-store";
import { getCustomerFigures } from "@/lib/customer-list-store";
import { consentLabel } from "@/lib/consent-core.mjs";
import { ARCHETYPE_META } from "@/lib/persona";
import type { PersonaArchetype } from "@/lib/types";

export async function GET(req: Request) {
  const blocked = await guardAdminGet();
  if (blocked) return blocked;
  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) return adminJsonError("bad_request", "id required", 400);
  const item = await getInboxItem(id);
  if (!item) return adminJsonError("not_found", "Eintrag nicht gefunden.", 404);
  if (item.customerId == null) return adminJson({ item, customer: null });
  const [c, figures] = await Promise.all([getCustomerById(item.customerId), getCustomerFigures(item.customerId)]);
  if (!c) return adminJson({ item, customer: null });
  const name = [c.firstName, c.lastName].filter(Boolean).join(" ") || c.shopifyAccountSummary?.displayName || null;
  return adminJson({
    item,
    customer: {
      id: c.id,
      email: c.email,
      name,
      isShopifyCustomer: c.shopifyCustomerId != null,
      consentLabel: consentLabel(c.emailConsentState, c.emailConsentLevel),
      sendable: c.emailConsentState === "subscribed" && !figures?.blocked,
      letterPossible: !c.postalObjectionAt && c.postalAddress != null,
      persona: c.personaLabel ? (ARCHETYPE_META[c.personaLabel as PersonaArchetype]?.label ?? null) : null,
      profileDepth: c.profileDepth,
      profileExcerpt: c.profileObjectionAt ? null : (c.profileSummary?.slice(0, 600) ?? null),
      figures,
    },
  });
}
