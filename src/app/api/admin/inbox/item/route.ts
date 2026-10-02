// GET /api/admin/inbox/item?id= → { item, customer, mail }
//
// One Eingang item with the customer mini-card (identity, the one consent,
// figures, profile excerpt) for the right pane; for „E-Mail beantworten“ also
// the conversation (`mail.messages`, oldest first, the item's mails flagged
// `isNew`) and the message a reply answers (`mail.replyToMessageId`). Read-only.

import { guardAdminGet, adminJson, adminJsonError } from "@/lib/admin-api";
import { getInboxItem } from "@/lib/inbox-store";
import { getCustomerById } from "@/lib/customer-store";
import { getCustomerFigures } from "@/lib/customer-list-store";
import { consentLabel } from "@/lib/consent-core.mjs";
import { ARCHETYPE_META } from "@/lib/persona";
import type { PersonaArchetype } from "@/lib/types";
import { plainExcerpt } from "@/lib/text-excerpt.mjs";
import { MAIL_ITEM_KIND } from "@/lib/inbox-mail-core.mjs";
import { itemMessageIds, loadMailThread } from "@/lib/inbox-mail";

export async function GET(req: Request) {
  const blocked = await guardAdminGet();
  if (blocked) return blocked;
  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) return adminJsonError("bad_request", "id required", 400);
  const item = await getInboxItem(id);
  if (!item) return adminJsonError("not_found", "Eintrag nicht gefunden.", 404);
  if (item.customerId == null) return adminJson({ item, customer: null, mail: null });
  const isMail = item.kind === MAIL_ITEM_KIND;
  const [c, figures, thread] = await Promise.all([
    getCustomerById(item.customerId),
    getCustomerFigures(item.customerId),
    isMail ? loadMailThread(item.customerId, itemMessageIds(item)) : Promise.resolve(null),
  ]);
  const mail = thread
    ? {
        messages: thread,
        replyToMessageId: [...thread].reverse().find((m) => m.direction === "received")?.id ?? null,
      }
    : null;
  if (!c) return adminJson({ item, customer: null, mail });
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
      profileExcerpt: c.profileObjectionAt ? null : plainExcerpt(c.profileSummary, 320),
      figures,
    },
    mail,
  });
}
