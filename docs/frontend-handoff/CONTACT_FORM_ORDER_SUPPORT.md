# Contact form — new `order_support` reason (customer-service escalation)

**Status:** backend shipped. Widget change is an **enhancement, not a
blocker** — the form already renders for this reason via the existing
"unknown reason → `general` label" fallback (`BEHAVIOR_REFERENCE.md`
§2.5). This note describes the recommended widget polish.

## What changed (backend)

`show_contact_form` gained one new `reason` enum value: **`order_support`**.
The tool shape is otherwise unchanged
(`{ reason, message, productIds? }`), and so is the submit path
(`POST /api/contact` → Resend → motion sports inbox, customer's address
as `replyTo`). The contract enums are updated in `API_CONTRACT.md` §2.5 /
§4 and the label table in `BEHAVIOR_REFERENCE.md` §2.5.

The backend already maps the new reason to an email subject label
(`"Bestellung & Service"`), so submissions route and read correctly with
**no widget change at all**.

## Why

Previously the assistant answered order-status / return / cancellation /
complaint requests by **naming an email address** (`info@motionsports.de`)
in plain text — a dead end the customer had to act on themselves. The
assistant now triggers the **same contact-form widget** already used for
Mengenrabatt / B2B, so these requests land in the team's inbox as a
structured submission the customer never has to copy-paste.

## When the assistant calls it (trigger conditions)

`show_contact_form` with `reason="order_support"` fires for any
**"I need a human at motion sports"** case:

- order status / shipment tracking ("Wo ist meine Bestellung?")
- starting a **return / refund** ("Ich möchte zurückschicken/erstatten")
- **cancelling** an order ("Bestellung stornieren")
- **complaints** / Reklamation
- a general request to reach the team / a person

General policy questions ("Wie lange habe ich Rückgaberecht?") are still
answered inline from the assistant's knowledge — the form is for the
**concrete, personal** action on a specific order.

## Recommended widget rendering

- **Label row** (added to `BEHAVIOR_REFERENCE.md` §2.5):
  - Title: **Kontakt zum motion sports Team**
  - Subline: *Bestellstatus, Retoure/Rückgabe, Stornierung oder
    Reklamation — das Team kümmert sich.*
- **Organisation** field stays **optional** for this reason (these are
  usually private customers — same as `general`, unlike
  `studio_consultation` / `public_sector_quote` which require it).
- **Order number helps a lot.** No backend field change is needed — surface
  it through the **Nachricht** placeholder for this reason, e.g.
  `"Bestellnummer + kurz dein Anliegen…"`. It travels inside the existing
  `message` field.
- **Email as fallback, not primary.** The primary action is submitting the
  form. The assistant may mention `info@motionsports.de` as an alternative
  in its accompanying `message`; the widget doesn't need to render the
  email as a competing CTA.

## No-op if you ship later

If the widget ships before this row is added, `order_support` falls through
to the `general` label ("Persönliche Beratung" / "Wir helfen dir gerne
weiter.") and the form still renders and submits correctly. Nothing breaks;
you just get a generic heading until the row above is added.
