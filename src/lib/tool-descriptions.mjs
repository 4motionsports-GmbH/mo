// Model-facing tool copy (descriptions + field hints) for buildChatTools, kept
// in plain .mjs so it is unit-testable and locale-switchable without touching
// the tool LOGIC/schemas in tools.ts. The German branch is byte-identical to the
// pre-i18n copy; English is the /en variant. These strings are read by the model
// (not shown to the user), but the task asks the model-facing instructions to be
// English on /en too, so Mo's tool use is steered in the same language it speaks.

/**
 * @param {"de" | "en"} locale
 * @returns {Record<string, string>}
 */
export function toolCopy(locale) {
  return locale === "en" ? EN : DE;
}

const DE = {
  updateProfileDesc: `Aktualisiert das Kundenprofil basierend auf neuen Signalen aus der Konversation.
Rufe dieses Tool SOFORT auf wenn du ein neues Signal erkennst — z.B. der Kunde nennt sein Budget, seinen Platz, sein Erfahrungslevel, ob er Studio/Physio/Behörde ist.

Wichtige Trigger-Wörter:
- "Studio", "Fitnessstudio", "Mengenrabatt", "Großbestellung" → segment="studio"
- "Praxis", "Reha", "Patient", "Physio", "Therapie" → segment="physio", trainingFocus="rehab"
- "Behörde", "Bundeswehr", "Polizei", "Schule", "Ausschreibung", "Auf Rechnung" → segment="public_sector" + entsprechende procurementNeeds
- "Anfänger", "noch nie", "neu" → experienceLevel="beginner"
- "Wohnung", "Mietwohnung" → housing="apartment", oft noiseSensitive=true
- "Keller", "Garage", "Haus" → housing="house_basement_garage"

Setze nur Felder die das aktuelle Signal tatsächlich klärt. Bestehende Felder werden gemerged. Aktuelles Profil ist im System-Prompt sichtbar.`,
  fieldSegment:
    "Kundensegment. studio=Fitnessstudio-Betreiber. physio=Reha/Physio. public_sector=Bundeswehr/Polizei/Schule/Behörde. private=Privatkunde.",
  fieldSpaceM2: "Verfügbare Stellfläche in m².",
  fieldConfidence: "Wie sicher du dir beim Profil bist (0-1).",
  fieldRationale:
    "Kurze Begründung welcher Satz/welches Signal das Update ausgelöst hat. Hilft beim Debuggen.",

  searchDesc: `Sucht im gesamten Produktkatalog nach passenden Produkten.

Nutze dieses Tool wenn:
- Du nicht sicher bist welches Produkt am besten passt
- Der Kunde nach einer Alternative fragt ("günstiger?", "leiser?", "kleiner?")
- Du eine Kategorie durchsuchen willst (z.B. alle Laufbänder)
- Du Kompatibilität / Zubehör suchen willst

Die Suche kombiniert semantische Ähnlichkeit mit harten Filtern. Nutze filters wenn du konkrete Constraints hast — z.B. requiresQuiet=true für Wohnungs-Cardio, requiresMedical=true für Reha. Das Kundenprofil wird automatisch berücksichtigt (Budget, Platz, Segment).

Gib das Ergebnis NICHT roh aus — nutze es um dann show_product oder compare_products zu rufen.`,
  fieldQuery:
    "Natürlichsprachliche Suchbeschreibung, z.B. 'leises Laufband klappbar' oder 'stabiles Power Rack mit Klimmzugstange'",

  showProductDesc:
    "Zeigt die Produktkarte für ein Produkt, das du dem Kunden EMPFIEHLST. Die im Chat sichtbaren Produktkarten ergeben sich AUSSCHLIESSLICH aus deinen show_product-Aufrufen — nicht aus der vorretrieveten Vorauswahl. Rufe es genau EINMAL pro Produkt auf, das du in deinem Text tatsächlich empfiehlst, in der REIHENFOLGE deiner Empfehlung. productId MUSS exakt die Katalog-ID des im Text genannten Produkts sein (nicht die eines anderen Treffers). NICHT aufrufen für Produkte, die du nur nebenbei erwähnst, gegenüberstellst oder am Ende verwirfst — und niemals einfach die vorretrieveten Kandidaten durchkarten. Empfiehl nur real existierende, VERFÜGBARE Produkte; für ein Produkt außerhalb der Vorauswahl hol dir zuerst per search_products die echte ID (niemals eine ID raten oder aus dem Gedächtnis nehmen).",
  fieldShowProductId: "Die exakte Katalog-ID des im Text empfohlenen Produkts",
  fieldShowProductReason: "Kurze Begründung warum dieses Produkt passt (1-2 Sätze)",

  compareDesc:
    "Zeigt einen Produktvergleich als Tabelle an. Nutze dieses Tool wenn der Kunde zwei oder mehr Produkte vergleichen möchte, nach Unterschieden fragt, oder du Alternativen gegenüberstellen willst.",
  fieldCompareIds: "Array mit 2-3 Produkt-IDs",
  fieldComparisonContext: "Kontext des Vergleichs z.B. 'Preis-Leistung für Einsteiger'",

  addToCartDesc:
    "Blendet einen Direkt-Checkout-Button ein. Ein Klick bringt den Privatkunden mit dem/den Produkt(en) (je Menge 1) direkt zur Kasse. Für EIN Produkt: setze productId. Wenn der Kunde klar MEHRERE Produkte zusammen kaufen will ('beides nehme ich', 'das Rack UND die Hantelbank', 'die ganze Kombi'): setze productIds mit ALLEN gewünschten IDs — das ergibt EINEN gemeinsamen Warenkorb mit allen Varianten, NICHT mehrere einzelne Buttons. Rufe das Tool dann nur EINMAL auf. Nutze ihn bei klaren Kaufsignalen ('Das nehme ich', 'Wie bestelle ich?') ODER von dir aus, wenn die Beratung rund ist und der Kunde entschieden wirkt — niedrigschwellig, ohne Druck, pro Kaufentscheidung nur einmal. Immer mit show_product für jedes enthaltene Produkt kombinieren. NUR mit Produkten die AUF LAGER sind — nimm NIEMALS ein ausverkauftes Produkt auf (der Checkout enthält ausschließlich verfügbare Artikel). NUR bei segment=private; bei studio/public_sector/physio stattdessen show_contact_form.",
  fieldAddProductId:
    "Die ID des Produkts für einen Einzel-Checkout. Nutze entweder productId (ein Produkt) ODER productIds (mehrere).",
  fieldAddProductIds:
    "Mehrere Produkt-IDs für EINEN gemeinsamen Checkout (alle Varianten in einem Warenkorb). Nutze dies, wenn der Kunde klar mehrere Produkte zusammen kaufen will.",
  fieldAddMessage:
    "Kurze, einladende Nachricht zum Direkt-Checkout — bestätigend und hilfsbereit, nie drängend. z.B. 'Wenn das für dich passt, kannst du beides hier direkt bestellen.'",

  showroomDesc:
    "Schlägt einen Besuch im Showroom in Gröbenzell bei München vor. Nutzen wenn der Kunde bei teuren Geräten (über 500€) unsicher ist oder Produkte vor dem Kauf testen möchte.",
  fieldShowroomIds: "Produkte die im Showroom getestet werden können",

  contactDesc: `Zeigt ein Kontaktformular an, das die Anfrage direkt an das motion sports Team weiterleitet (der Kunde muss nichts selbst verschicken). Für persönliche Beratung UND für Service-Anliegen, die einen Menschen beim Team brauchen.

NUTZE dieses Tool bei:
- segment="studio" sobald der Kunde konkrete Beschaffungssignale zeigt (Stückzahlen, Konzept) → reason="studio_consultation"
- segment="public_sector" sobald der Kunde formelle Prozesse anspricht (Angebot, Rechnung, Ausschreibung, Zahlungsziel) → reason="public_sector_quote"
- segment="physio" wenn der Kunde echte Medizinprodukte (CE-Klasse IIa+) oder Reha-spezifische Beratung braucht → reason="physio_consultation"
- Anfragen nach Mengenrabatt, Leasing oder Wartungsverträgen → reason="bulk_discount"/"leasing"/"maintenance"
- KUNDENSERVICE / ESKALATION → reason="order_support": jedes Anliegen, das den direkten Draht zum Team braucht — Bestellstatus/Sendungsverfolgung, eine Retoure/Rückgabe oder Erstattung anstoßen, eine Bestellung stornieren, eine Reklamation, oder wenn der Kunde ausdrücklich einen Menschen / das Team erreichen möchte. Nenne in diesen Fällen NICHT nur eine E-Mail-Adresse — rufe dieses Tool auf. (Allgemeine Fragen zu den Rückgabe-/Versand-/Zahlungskonditionen beantwortest du weiterhin direkt aus deinem Wissen; das Formular ist für das konkrete, persönliche Anliegen.)
- Wenn ein Anliegen die Möglichkeiten eines Chatbots übersteigt → reason="general"

Nutze die treffendste reason. Die Nachricht sollte einladend erklären, dass sich das Team kümmert bzw. meldet; info@motionsports.de darf höchstens ergänzend als Alternative vorkommen.`,
  fieldContactMessage:
    "Kurze, einladende Erklärung warum persönlicher Kontakt der richtige nächste Schritt ist (1-2 Sätze).",
  fieldContactProductIds:
    "Produkte die im Gespräch relevant sind, werden im Formular vorausgefüllt.",

  offerDesc: `Bietet dem Kunden an, eine Zusammenfassung dieses Gesprächs samt vorausgefülltem Warenkorb per E-Mail zu erhalten. Der Aufruf blendet im Widget ein DSGVO-konformes Erfassungsformular ein (E-Mail-Feld + zwei GETRENNTE Einwilligungs-Checkboxen: Zusammenfassung jetzt vs. optionales Marketing).

WANN aufrufen (wertgetriggert):
- Erst NACHDEM du nachweislich Wert geliefert hast — der Kunde reagiert positiv auf eine konkrete Empfehlung, du hast einen hilfreichen Vergleich geliefert, der Kunde will in Ruhe überlegen, oder es gibt ein klares Kaufsignal. Setze den passenden trigger.
- NIE als erste Nachricht, nie bevor du etwas empfohlen hast, nie nach festem Raster — und nie als Bedingung für weitere Beratung.
- Maximal ZWEI Mal pro Gespräch: Lehnt der Kunde ab oder reagiert nicht, höchstens EIN weiteres Angebot an einem späteren, klar wertvolleren Moment (typisch checkout_intent) — danach nie wieder.

NICHT aufrufen bei segment=studio/public_sector/physio mit Beschaffungssignalen — dort ist show_contact_form der richtige Weg.

Das eigentliche Versenden + die Einwilligungen passieren über das Formular und /api/capture-email. Die Zusammenfassung gibt es IMMER auch ohne Marketing-Einwilligung (nie bündeln); du sammelst hier KEINE E-Mail-Adresse im Chat ein.`,
  fieldOfferMessage:
    "Kurze, freundliche Einladung um den konkreten Nutzen JETZT. z.B. 'Soll ich dir deine persönliche Empfehlung und den fertigen Warenkorb per Mail schicken?'",
  fieldOfferTrigger:
    "Der Wert-Moment, der dieses Angebot auslöst. recommendation_accepted=Kunde reagiert positiv auf eine Empfehlung; comparison_delivered=nach hilfreichem Vergleich; consideration_pause=Kunde will in Ruhe überlegen; buying_intent=klares Kaufsignal; checkout_intent=Moment rund um den Direkt-Checkout.",
  fieldOfferProductIds:
    "Die im Gespräch besprochenen Produkt-IDs (für die Warenkorb-Vorschau im Formular). Optional/advisory — die tatsächlichen Produkte ermittelt das Backend serverseitig.",
};

const EN = {
  updateProfileDesc: `Updates the customer profile based on new signals from the conversation.
Call this tool IMMEDIATELY when you detect a new signal — e.g. the customer states their budget, their space, their experience level, whether they are a studio/physio/authority.

Important trigger words:
- "studio", "gym", "bulk discount", "large order" → segment="studio"
- "practice", "rehab", "patient", "physio", "therapy" → segment="physio", trainingFocus="rehab"
- "authority", "armed forces", "police", "school", "tender", "on account" → segment="public_sector" + matching procurementNeeds
- "beginner", "never before", "new" → experienceLevel="beginner"
- "apartment", "rented flat" → housing="apartment", often noiseSensitive=true
- "basement", "garage", "house" → housing="house_basement_garage"

Only set fields the current signal actually clarifies. Existing fields are merged. The current profile is visible in the system prompt.`,
  fieldSegment:
    "Customer segment. studio=gym operator. physio=rehab/physio. public_sector=armed forces/police/school/authority. private=private customer.",
  fieldSpaceM2: "Available footprint in m².",
  fieldConfidence: "How sure you are about the profile (0-1).",
  fieldRationale:
    "Short rationale for which sentence/signal triggered the update. Helps with debugging.",

  searchDesc: `Searches the entire product catalog for matching products.

Use this tool when:
- You are not sure which product fits best
- The customer asks for an alternative ("cheaper?", "quieter?", "smaller?")
- You want to search a category (e.g. all treadmills)
- You want to find compatibility / accessories

The search combines semantic similarity with hard filters. Use filters when you have concrete constraints — e.g. requiresQuiet=true for apartment cardio, requiresMedical=true for rehab. The customer profile is taken into account automatically (budget, space, segment).

Do NOT output the result raw — use it to then call show_product or compare_products.`,
  fieldQuery:
    "Natural-language search description, e.g. 'quiet foldable treadmill' or 'stable power rack with pull-up bar'",

  showProductDesc:
    "Shows the product card for a product you RECOMMEND to the customer. The product cards visible in the chat result SOLELY from your show_product calls — not from the pre-retrieved pre-selection. Call it exactly ONCE per product you actually recommend in your text, in the ORDER of your recommendation. productId MUST be exactly the catalog id of the product named in the text (not that of another hit). Do NOT call it for products you only mention in passing, contrast or reject in the end — and never just card the pre-retrieved candidates one by one. Only recommend products that really exist and are AVAILABLE; for a product outside the pre-selection, first get the real id via search_products (never guess an id or take one from memory).",
  fieldShowProductId: "The exact catalog id of the product recommended in the text",
  fieldShowProductReason: "Short rationale why this product fits (1-2 sentences)",

  compareDesc:
    "Shows a product comparison as a table. Use this tool when the customer wants to compare two or more products, asks about differences, or you want to contrast alternatives.",
  fieldCompareIds: "Array with 2-3 product ids",
  fieldComparisonContext: "Context of the comparison, e.g. 'value for money for beginners'",

  addToCartDesc:
    "Shows a direct-checkout button. One click takes the private customer straight to checkout with the product(s) (quantity 1 each). For ONE product: set productId. When the customer clearly wants to buy SEVERAL products together ('I'll take both', 'the rack AND the weight bench', 'the whole combo'): set productIds with ALL the desired ids — this creates ONE shared cart with all variants, NOT several individual buttons. Then call the tool only ONCE. Use it on clear buying signals ('I'll take it', 'How do I order?') OR on your own initiative, when the consultation is rounded off and the customer seems decided — low-threshold, no pressure, only once per buying decision. Always combine with show_product for each included product. ONLY with products that are IN STOCK — NEVER include a sold-out product (the checkout contains only available items). ONLY for segment=private; for studio/public_sector/physio use show_contact_form instead.",
  fieldAddProductId:
    "The id of the product for a single checkout. Use either productId (one product) OR productIds (several).",
  fieldAddProductIds:
    "Several product ids for ONE shared checkout (all variants in one cart). Use this when the customer clearly wants to buy several products together.",
  fieldAddMessage:
    "Short, inviting message for the direct checkout — affirming and helpful, never pushy. e.g. 'If that works for you, you can order both directly here.'",

  showroomDesc:
    "Suggests a visit to the showroom in Gröbenzell near Munich. Use when the customer is unsure about expensive equipment (over €500) or wants to test products before buying.",
  fieldShowroomIds: "Products that can be tested in the showroom",

  contactDesc: `Shows a contact form that forwards the request straight to the motion sports team (the customer doesn't have to send anything themselves). For personal advice AND for service matters that need a human on the team.

USE this tool for:
- segment="studio" as soon as the customer shows concrete procurement signals (quantities, concept) → reason="studio_consultation"
- segment="public_sector" as soon as the customer raises formal processes (quote, invoice, tender, payment terms) → reason="public_sector_quote"
- segment="physio" when the customer needs genuine medical devices (CE class IIa+) or rehab-specific advice → reason="physio_consultation"
- requests for bulk discount, leasing or maintenance contracts → reason="bulk_discount"/"leasing"/"maintenance"
- CUSTOMER SERVICE / ESCALATION → reason="order_support": any matter that needs the direct line to the team — order status/tracking, starting a return/refund, cancelling an order, a complaint, or when the customer explicitly wants to reach a human / the team. In these cases do NOT just name an email address — call this tool. (General questions about the return/shipping/payment conditions you still answer directly from your knowledge; the form is for the concrete, personal matter.)
- When a matter exceeds the capabilities of a chatbot → reason="general"

Use the most fitting reason. The message should invitingly explain that the team will take care of it / get back to them; info@motionsports.de may appear at most additionally as an alternative.`,
  fieldContactMessage:
    "Short, inviting explanation why personal contact is the right next step (1-2 sentences).",
  fieldContactProductIds:
    "Products relevant in the conversation are prefilled in the form.",

  offerDesc: `Offers the customer a summary of this conversation along with a prefilled cart by email. The call shows a GDPR-compliant capture form in the widget (email field + two SEPARATE consent checkboxes: summary now vs optional marketing).

WHEN to call (value-triggered):
- Only AFTER you have demonstrably delivered value — the customer reacts positively to a concrete recommendation, you delivered a helpful comparison, the customer wants to think it over, or there is a clear buying signal. Set the matching trigger.
- NEVER as the first message, never before you have recommended anything, never on a fixed cadence — and never as a condition for further advice.
- At most TWICE per conversation: if the customer declines or doesn't respond, at most ONE further offer at a later, clearly more valuable moment (typically checkout_intent) — after that never again.

Do NOT call for segment=studio/public_sector/physio with procurement signals — there show_contact_form is the right path.

The actual sending + the consents happen via the form and /api/capture-email. The summary is ALWAYS available without marketing consent (never bundle); you do NOT collect an email address in the chat here.`,
  fieldOfferMessage:
    "Short, friendly invitation around the concrete benefit NOW. e.g. 'Shall I send you your personal recommendation and the ready-made cart by email?'",
  fieldOfferTrigger:
    "The value moment that triggers this offer. recommendation_accepted=customer reacts positively to a recommendation; comparison_delivered=after a helpful comparison; consideration_pause=customer wants to think it over; buying_intent=clear buying signal; checkout_intent=moment around the direct checkout.",
  fieldOfferProductIds:
    "The product ids discussed in the conversation (for the cart preview in the form). Optional/advisory — the backend determines the actual products server-side.",
};
