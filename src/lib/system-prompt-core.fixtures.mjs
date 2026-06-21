// Shared fixtures for the prompt golden test + its one-off golden generator
// (scripts/gen-prompt-golden.mjs), so the committed golden can never drift from
// the inputs the test asserts against. Pure data — not a test file itself.

export const emptyProfile = () => ({
  segment: "unknown",
  experienceLevel: "unknown",
  trainingFocus: "unknown",
  spaceM2: "unknown",
  budgetEUR: "unknown",
  trainingFrequency: "unknown",
  housing: "unknown",
  noiseSensitive: "unknown",
  procurementNeeds: [],
  confidence: 0,
});

export const fullProfile = () => ({
  segment: "private",
  experienceLevel: "beginner",
  trainingFocus: "strength",
  spaceM2: 8,
  budgetEUR: { min: 200, max: 800 },
  trainingFrequency: "3-5x",
  housing: "apartment",
  noiseSensitive: true,
  procurementNeeds: ["invoice", "bulk_discount"],
  confidence: 0.7,
});

export const product = (over = {}) => ({
  id: "p1",
  name: "Test Gerät",
  category: "Laufband",
  brand: "MoBrand",
  price: 999,
  currency: "EUR",
  shortDescription: "Kurzbeschreibung hier.",
  detailedDescription: "",
  specifications: { Motor: "3 PS", Fläche: "150x50" },
  features: ["leise", "klappbar", "App"],
  dimensions: { width: 150, height: 140, depth: 80, weight: 90 },
  targetGroup: [],
  shopifyUrl: "https://x",
  images: [],
  inStock: true,
  deliveryTime: "2-3 Tage",
  tags: [],
  ...over,
});

export const memorySignedIn = () => ({
  signedIn: true,
  personalised: true,
  displayName: "Max Mustermann",
  firstSeenAt: "2024-01-15T10:00:00Z",
  priorConversationCount: 3,
  ownedItems: ["Kurzhantel-Set", "Klimmzugstange"],
  lastPurchaseAt: "2025-03-20T10:00:00Z",
  addressContext: { city: "München", countryCode: "DE" },
  profileSummary: "Ambitionierter Heimtrainer, Fokus Kraft.",
  welcomeAlreadyIssued: true,
});

export const SEP = "\n\n=====CASE_SEP=====\n\n";

/** The exact case set the German golden snapshot is generated from. */
export function goldenCases() {
  const products = [
    product(),
    product({
      id: "p2",
      name: "Sale Bike",
      salePrice: 500,
      price: 800,
      footprintM2: 1.5,
      noiseLevelDb: 40,
      medicalCertification: { ceClass: "IIa", suitableForRehab: true, notes: "Reha ok" },
      inStock: false,
    }),
  ];
  return [
    { profile: fullProfile(), archetype: "pragmatic_beginner", retrievedProducts: products },
    {
      profile: emptyProfile(),
      archetype: "unknown",
      retrievedProducts: products,
      productContext: { id: "p1", name: "Test Gerät" },
    },
    {
      profile: emptyProfile(),
      archetype: "unknown",
      retrievedProducts: [],
      customerMemory: memorySignedIn(),
      emailOffer: { offersMade: 1, emailCaptured: false },
    },
    {
      profile: emptyProfile(),
      archetype: "physio",
      retrievedProducts: [],
      emailOffer: { offersMade: 2, emailCaptured: false },
    },
  ];
}
