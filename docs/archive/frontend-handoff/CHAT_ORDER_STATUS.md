# Chat — new background tool `get_order_status` (order status for signed-in customers)

**Status:** backend shipped behind `CHAT_ORDER_STATUS_ENABLED` (default **off**).
Widget change: **render nothing** for the new tool — most widgets already do
(unknown tool → nothing). Please confirm before the switch is turned on, and
add the logout clean-up below.

## What changed (backend)

A customer who signed in with **„Anmelden“ (Customer Account) in the same chat
session** can ask Mo about their own orders — „Wo ist meine Bestellung?“,
„Wann kommt mein Paket?“, „Ist meine Erstattung durch?“. Mo looks the order up
with a new tool, `get_order_status`, and answers **in its text**. Returns,
cancellations and complaints still open the contact form
(`show_contact_form`, `reason: "order_support"`,
[`CONTACT_FORM_ORDER_SUPPORT.md`](./CONTACT_FORM_ORDER_SUPPORT.md)) — Mo only
states facts, it never changes an order.

The tool streams like `search_products` (`API_CONTRACT.md` §2, „Tools the
widget MUST NOT render“):

```json
{ "type": "tool-input-available", "toolCallId": "call_x", "toolName": "get_order_status",
  "input": { "topic": "shipping" } }
{ "type": "tool-output-available", "toolCallId": "call_x",
  "output": { "status": "ok", "orders": [ { "ref": "A", "placedOn": "2026-09-28",
    "items": ["1× ATX Power Rack 620 (Schwarz)"], "state": "in_transit", "payment": "paid",
    "carrier": "DHL", "estimatedDelivery": "2026-10-01" } ],
    "ordersPageUrl": "https://www.motionsports.de/account" } }
```

## What the widget must do

1. **Render nothing** for `toolName: "get_order_status"` — no card, no
   placeholder, no „tool used“ hint, no error. Consume its chunks silently. The
   customer reads Mo's text answer. (General rule, now explicit in
   `API_CONTRACT.md` §2: a tool part whose `toolName` the widget does not know
   renders nothing.)
2. **Never show, log or send the output elsewhere** (KPI payloads, analytics,
   error reports). It may stay in the conversation history the widget already
   keeps and resends — the backend replaces a replayed output with
   `{ replayed: true }` before the model sees it, so nothing needs filtering.
3. **Clear the stored chat history on logout** (recommended — shared devices).
   The history in `localStorage` can now contain the customer's order status
   (order date, items, delivery state) in the tool output and in Mo's text.
   When the customer signs out (`CUSTOMER_ACCOUNT.md` §5) or erases their data
   (§7.5), remove the stored messages of that session as well, so the next
   person on the same browser does not see them. Starting a new session id on
   logout is the simplest way.

## When it is on

- Only for sessions signed in via **„Anmelden“** (the Customer Account sign-in,
  completed with the one-time code — `CUSTOMER_ACCOUNT.md` §2a). An anonymous
  visitor, a session linked by a typed e-mail or one recognised only through
  the shop (`/apps/chat/whoami`) gets `status: "sign_in_required"`; Mo then
  explains „Anmelden“ and offers the contact form. **Keep „Anmelden“ reachable
  for shop-recognised sessions** (e.g. in the account menu), even though task 5
  of the frontend prompt skips the sign-in popup for them — the order status
  needs the chat sign-in once.
- No marketing consent is needed (customer service).
- `ordersPageUrl` may appear as a normal Markdown link in Mo's text („Meine
  Bestellungen“); the existing link rendering covers it.

## No-op if you ship later

While `CHAT_ORDER_STATUS_ENABLED` is off the tool never appears in the stream.
When it is on and a widget still renders an unknown tool as a card or an error,
that is visible to customers — so the switch is turned on only after this was
checked on the live widget (`docs/ROLLOUT_TODO.md`).
