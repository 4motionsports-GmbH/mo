import { tool } from "ai";
import { z } from "zod";
import { retrieve, embedQuery } from "./retrieval";
import { captureConsentCopy } from "./consent-copy";
import type { CustomerProfile } from "./types";

const profilePatchSchema = z.object({
  segment: z
    .enum(["private", "studio", "physio", "public_sector", "unknown"])
    .optional()
    .describe(
      "Kundensegment. studio=Fitnessstudio-Betreiber. physio=Reha/Physio. public_sector=Bundeswehr/Polizei/Schule/Behörde. private=Privatkunde."
    ),
  experienceLevel: z
    .enum(["beginner", "intermediate", "advanced", "unknown"])
    .optional(),
  trainingFocus: z
    .enum(["strength", "cardio", "mixed", "rehab", "unknown"])
    .optional(),
  spaceM2: z
    .union([z.number(), z.literal("unknown")])
    .optional()
    .describe("Verfügbare Stellfläche in m²."),
  budgetEUR: z
    .union([
      z.object({ min: z.number().nullable(), max: z.number().nullable() }),
      z.literal("unknown"),
    ])
    .optional(),
  trainingFrequency: z
    .enum(["1-2x", "3-5x", "daily", "unknown"])
    .optional(),
  housing: z
    .enum(["apartment", "house_basement_garage", "facility", "unknown"])
    .optional(),
  noiseSensitive: z
    .union([z.boolean(), z.literal("unknown")])
    .optional(),
  procurementNeeds: z
    .array(
      z.enum([
        "invoice",
        "tender",
        "warranty_docs",
        "ce_certs",
        "leasing",
        "bulk_discount",
        "maintenance_contract",
      ])
    )
    .optional(),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe("Wie sicher du dir beim Profil bist (0-1)."),
  rationale: z
    .string()
    .optional()
    .describe(
      "Kurze Begründung welcher Satz/welches Signal das Update ausgelöst hat. Hilft beim Debuggen."
    ),
});

// Hard cap on offer_email_summary invitations per conversation. Lives in the
// pure trigger module (email-offer-trigger.mjs) next to the deterministic
// checkout-intent trigger that shares it; re-exported here so existing
// importers (system-prompt, api/chat) keep working unchanged.
export { MAX_EMAIL_OFFERS_PER_CONVERSATION } from "./email-offer-trigger.mjs";

// NOTE on withholding offer_email_summary: the full tool set is always built
// here so the return type is stable (api/chat's deterministic email-offer
// trigger force-selects the tool in a prepareStep, which needs the tool's key
// in the type). The actual withholding — ask cap reached or email already
// captured, making "never a third ask" a guarantee rather than a prompt
// instruction — happens in api/chat via streamText's `activeTools`: an
// inactive tool is filtered out before the provider call and is invisible to
// the model, exactly like omitting it from this object.
export function buildChatTools(profile: CustomerProfile) {
  return {
    update_customer_profile: tool({
      description: `Aktualisiert das Kundenprofil basierend auf neuen Signalen aus der Konversation.
Rufe dieses Tool SOFORT auf wenn du ein neues Signal erkennst — z.B. der Kunde nennt sein Budget, seinen Platz, sein Erfahrungslevel, ob er Studio/Physio/Behörde ist.

Wichtige Trigger-Wörter:
- "Studio", "Fitnessstudio", "Mengenrabatt", "Großbestellung" → segment="studio"
- "Praxis", "Reha", "Patient", "Physio", "Therapie" → segment="physio", trainingFocus="rehab"
- "Behörde", "Bundeswehr", "Polizei", "Schule", "Ausschreibung", "Auf Rechnung" → segment="public_sector" + entsprechende procurementNeeds
- "Anfänger", "noch nie", "neu" → experienceLevel="beginner"
- "Wohnung", "Mietwohnung" → housing="apartment", oft noiseSensitive=true
- "Keller", "Garage", "Haus" → housing="house_basement_garage"

Setze nur Felder die das aktuelle Signal tatsächlich klärt. Bestehende Felder werden gemerged. Aktuelles Profil ist im System-Prompt sichtbar.`,
      inputSchema: profilePatchSchema,
      execute: async () => ({ ok: true }),
    }),

    search_products: tool({
      description: `Sucht im gesamten Produktkatalog nach passenden Produkten.

Nutze dieses Tool wenn:
- Du nicht sicher bist welches Produkt am besten passt
- Der Kunde nach einer Alternative fragt ("günstiger?", "leiser?", "kleiner?")
- Du eine Kategorie durchsuchen willst (z.B. alle Laufbänder)
- Du Kompatibilität / Zubehör suchen willst

Die Suche kombiniert semantische Ähnlichkeit mit harten Filtern. Nutze filters wenn du konkrete Constraints hast — z.B. requiresQuiet=true für Wohnungs-Cardio, requiresMedical=true für Reha. Das Kundenprofil wird automatisch berücksichtigt (Budget, Platz, Segment).

Gib das Ergebnis NICHT roh aus — nutze es um dann show_product oder compare_products zu rufen.`,
      inputSchema: z.object({
        query: z
          .string()
          .describe(
            "Natürlichsprachliche Suchbeschreibung, z.B. 'leises Laufband klappbar' oder 'stabiles Power Rack mit Klimmzugstange'"
          ),
        filters: z
          .object({
            category: z.string().optional(),
            maxPriceEUR: z.number().optional(),
            minPriceEUR: z.number().optional(),
            maxFootprintM2: z.number().optional(),
            requiresMedical: z.boolean().optional(),
            requiresQuiet: z.boolean().optional(),
          })
          .optional(),
        limit: z.number().min(1).max(15).optional(),
      }),
      execute: async ({ query, filters, limit }) => {
        const queryVector = await embedQuery(query);
        const hits = await retrieve({
          query,
          profile,
          filters,
          limit: limit ?? 8,
          queryVector,
        });
        return {
          totalMatched: hits.length,
          products: hits.map((h) => ({
            id: h.product.id,
            name: h.product.name,
            category: h.product.category,
            price: h.product.salePrice ?? h.product.price,
            shortDescription: h.product.shortDescription,
            score: Number(h.score.toFixed(3)),
          })),
        };
      },
    }),

    show_product: tool({
      description:
        "Zeigt eine Produktkarte im Chat an. Nutze dieses Tool wenn du ein Produkt empfiehlst oder der Kunde nach einem bestimmten Produkt fragt. Nutze es für jedes Produkt das du erwähnst.",
      inputSchema: z.object({
        productId: z.string().describe("Die ID des Produkts aus dem Katalog"),
        reason: z
          .string()
          .optional()
          .describe("Kurze Begründung warum dieses Produkt passt (1-2 Sätze)"),
      }),
      execute: async () => ({ ok: true }),
    }),

    compare_products: tool({
      description:
        "Zeigt einen Produktvergleich als Tabelle an. Nutze dieses Tool wenn der Kunde zwei oder mehr Produkte vergleichen möchte, nach Unterschieden fragt, oder du Alternativen gegenüberstellen willst.",
      inputSchema: z.object({
        productIds: z
          .array(z.string())
          .min(2)
          .max(3)
          .describe("Array mit 2-3 Produkt-IDs"),
        comparisonContext: z
          .string()
          .optional()
          .describe(
            "Kontext des Vergleichs z.B. 'Preis-Leistung für Einsteiger'"
          ),
      }),
      execute: async () => ({ ok: true }),
    }),

    add_to_cart: tool({
      description:
        "Blendet einen Direkt-Checkout-Button ein. Ein Klick bringt den Privatkunden mit dem/den Produkt(en) (je Menge 1) direkt zur Kasse. Für EIN Produkt: setze productId. Wenn der Kunde klar MEHRERE Produkte zusammen kaufen will ('beides nehme ich', 'das Rack UND die Hantelbank', 'die ganze Kombi'): setze productIds mit ALLEN gewünschten IDs — das ergibt EINEN gemeinsamen Warenkorb mit allen Varianten, NICHT mehrere einzelne Buttons. Rufe das Tool dann nur EINMAL auf. Nutze ihn bei klaren Kaufsignalen ('Das nehme ich', 'Wie bestelle ich?') ODER von dir aus, wenn die Beratung rund ist und der Kunde entschieden wirkt — niedrigschwellig, ohne Druck, pro Kaufentscheidung nur einmal. Immer mit show_product für jedes enthaltene Produkt kombinieren. NUR mit Produkten die AUF LAGER sind — nimm NIEMALS ein ausverkauftes Produkt auf (der Checkout enthält ausschließlich verfügbare Artikel). NUR bei segment=private; bei studio/public_sector/physio stattdessen show_contact_form.",
      inputSchema: z
        .object({
          productId: z
            .string()
            .optional()
            .describe(
              "Die ID des Produkts für einen Einzel-Checkout. Nutze entweder productId (ein Produkt) ODER productIds (mehrere)."
            ),
          productIds: z
            .array(z.string())
            .min(1)
            .optional()
            .describe(
              "Mehrere Produkt-IDs für EINEN gemeinsamen Checkout (alle Varianten in einem Warenkorb). Nutze dies, wenn der Kunde klar mehrere Produkte zusammen kaufen will."
            ),
          message: z
            .string()
            .describe(
              "Kurze, einladende Nachricht zum Direkt-Checkout — bestätigend und hilfsbereit, nie drängend. z.B. 'Wenn das für dich passt, kannst du beides hier direkt bestellen.'"
            ),
        })
        // Backward compatible: at least one of productId / productIds must be
        // present. The frontend normalises both to a single id list.
        .refine((d) => Boolean(d.productId) || (d.productIds?.length ?? 0) > 0, {
          message: "Either productId or productIds must be provided.",
        }),
      execute: async () => ({ ok: true }),
    }),

    suggest_showroom: tool({
      description:
        "Schlägt einen Besuch im Showroom in Gröbenzell bei München vor. Nutzen wenn der Kunde bei teuren Geräten (über 500€) unsicher ist oder Produkte vor dem Kauf testen möchte.",
      inputSchema: z.object({
        productIds: z
          .array(z.string())
          .describe("Produkte die im Showroom getestet werden können"),
      }),
      execute: async () => ({ ok: true }),
    }),

    show_contact_form: tool({
      description: `Zeigt ein Kontaktformular für persönliche Beratung an.

NUTZE dieses Tool bei:
- segment="studio" sobald der Kunde konkrete Beschaffungssignale zeigt (Stückzahlen, Konzept, Wartung, Mengenrabatt)
- segment="public_sector" sobald der Kunde formelle Prozesse anspricht (Angebot, Rechnung, Ausschreibung, Zahlungsziel)
- segment="physio" wenn der Kunde echte Medizinprodukte (CE-Klasse IIa+) oder Reha-spezifische Beratung braucht
- Anfragen nach Leasing, Wartungsverträgen, Großbestellungen
- Wenn ein Anliegen die Möglichkeiten eines Chatbots übersteigt

Nutze die treffendste reason. Die Nachricht sollte erklären WARUM persönliche Beratung sinnvoll ist und einladend formuliert sein.`,
      inputSchema: z.object({
        reason: z.enum([
          "studio_consultation",
          "public_sector_quote",
          "physio_consultation",
          "bulk_discount",
          "leasing",
          "maintenance",
          "general",
        ]),
        message: z
          .string()
          .describe(
            "Kurze, einladende Erklärung warum persönlicher Kontakt der richtige nächste Schritt ist (1-2 Sätze)."
          ),
        productIds: z
          .array(z.string())
          .optional()
          .describe(
            "Produkte die im Gespräch relevant sind, werden im Formular vorausgefüllt."
          ),
      }),
      execute: async () => ({ ok: true }),
    }),

    offer_email_summary: tool({
      description: `Bietet dem Kunden an, eine Zusammenfassung dieses Gesprächs samt vorausgefülltem Warenkorb per E-Mail zu erhalten. Der Aufruf blendet im Widget ein DSGVO-konformes Erfassungsformular ein (E-Mail-Feld + zwei GETRENNTE Einwilligungs-Checkboxen: Zusammenfassung jetzt vs. optionales Marketing).

WANN aufrufen (wertgetriggert):
- Erst NACHDEM du nachweislich Wert geliefert hast — der Kunde reagiert positiv auf eine konkrete Empfehlung, du hast einen hilfreichen Vergleich geliefert, der Kunde will in Ruhe überlegen, oder es gibt ein klares Kaufsignal. Setze den passenden trigger.
- NIE als erste Nachricht, nie bevor du etwas empfohlen hast, nie nach festem Raster — und nie als Bedingung für weitere Beratung.
- Maximal ZWEI Mal pro Gespräch: Lehnt der Kunde ab oder reagiert nicht, höchstens EIN weiteres Angebot an einem späteren, klar wertvolleren Moment (typisch checkout_intent) — danach nie wieder.

NICHT aufrufen bei segment=studio/public_sector/physio mit Beschaffungssignalen — dort ist show_contact_form der richtige Weg.

Das eigentliche Versenden + die Einwilligungen passieren über das Formular und /api/capture-email. Die Zusammenfassung gibt es IMMER auch ohne Marketing-Einwilligung (nie bündeln); du sammelst hier KEINE E-Mail-Adresse im Chat ein.`,
      inputSchema: z.object({
        message: z
          .string()
          .describe(
            "Kurze, freundliche Einladung um den konkreten Nutzen JETZT. z.B. 'Soll ich dir deine persönliche Empfehlung und den fertigen Warenkorb per Mail schicken?'"
          ),
        trigger: z
          .enum([
            "recommendation_accepted",
            "comparison_delivered",
            "consideration_pause",
            "buying_intent",
            "checkout_intent",
          ])
          .describe(
            "Der Wert-Moment, der dieses Angebot auslöst. recommendation_accepted=Kunde reagiert positiv auf eine Empfehlung; comparison_delivered=nach hilfreichem Vergleich; consideration_pause=Kunde will in Ruhe überlegen; buying_intent=klares Kaufsignal; checkout_intent=Moment rund um den Direkt-Checkout."
          ),
        productIds: z
          .array(z.string())
          .optional()
          .describe(
            "Die im Gespräch besprochenen Produkt-IDs (für die Warenkorb-Vorschau im Formular). Optional/advisory — die tatsächlichen Produkte ermittelt das Backend serverseitig."
          ),
      }),
      // The tool result carries the canonical capture-form consent copy (it
      // streams to the widget as the tool part's `output`). The widget renders
      // these strings verbatim and echoes `consentTextShown` back unchanged on
      // /api/capture-email — the Art. 7 audit record can never drift from what
      // was displayed, and lawyer copy changes need no widget release. See
      // src/lib/consent-copy.ts and API_CONTRACT.md §7.4.
      execute: async () => ({ ok: true, consentCopy: captureConsentCopy() }),
    }),
  };
}
