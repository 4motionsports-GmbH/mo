import { tool } from "ai";
import { z } from "zod";
import { retrieve, embedQuery } from "./retrieval";
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
        "Blendet einen Direkt-Checkout-Button für EIN Produkt ein. Ein Klick bringt den Privatkunden mit diesem Produkt (Menge 1) direkt zur Kasse. Nutze ihn bei klaren Kaufsignalen ('Das nehme ich', 'Wie bestelle ich?') ODER von dir aus, wenn die Beratung rund ist und der Kunde zu einem konkreten Produkt zufrieden/entschieden wirkt — dann als niedrigschwelliges Angebot, ohne Druck und pro Produktentscheidung nur einmal. Immer mit show_product fürs selbe Produkt kombinieren. NUR bei segment=private; bei studio/public_sector/physio stattdessen show_contact_form.",
      inputSchema: z.object({
        productId: z.string().describe("Die ID des Produkts"),
        message: z
          .string()
          .describe(
            "Kurze, einladende Nachricht zum Direkt-Checkout — bestätigend und hilfsbereit, nie drängend. z.B. 'Wenn es für dich passt, kannst du es hier direkt bestellen.'"
          ),
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
  };
}
