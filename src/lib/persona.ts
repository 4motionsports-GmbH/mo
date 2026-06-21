import type {
  ArchetypeMeta,
  CustomerProfile,
  PersonaArchetype,
} from "./types";

/**
 * Derive a single persona archetype from the structured profile.
 * The profile is the source of truth — archetype is just a "view" used to
 * pick a tailored consulting style. When signals conflict we fall back to
 * `unknown` rather than guessing wrong.
 */
export function deriveArchetype(profile: CustomerProfile): PersonaArchetype {
  // B2B segments take precedence — different consulting style entirely.
  if (profile.segment === "public_sector") return "public_sector";
  if (profile.segment === "studio") return "studio_operator";
  if (profile.segment === "physio") return "physio";

  if (profile.segment === "private") {
    // Strength vs cardio focus is the next-most-important axis.
    if (profile.trainingFocus === "strength") return "strength_focused";
    if (profile.trainingFocus === "cardio") return "cardio_focused";

    // Otherwise classify by budget + space + experience — pragmatic vs ambitious.
    const budgetMax =
      typeof profile.budgetEUR === "object" && profile.budgetEUR
        ? profile.budgetEUR.max
        : null;
    const spaceM2 =
      typeof profile.spaceM2 === "number" ? profile.spaceM2 : null;

    const looksAmbitious =
      (budgetMax != null && budgetMax >= 2000) ||
      (spaceM2 != null && spaceM2 >= 15) ||
      profile.experienceLevel === "advanced";
    const looksPragmatic =
      (budgetMax != null && budgetMax < 1500) ||
      (spaceM2 != null && spaceM2 < 12) ||
      profile.experienceLevel === "beginner";

    if (looksAmbitious && !looksPragmatic) return "ambitious_home_athlete";
    if (looksPragmatic && !looksAmbitious) return "pragmatic_beginner";
  }

  return "unknown";
}

export const ARCHETYPE_META: Record<PersonaArchetype, ArchetypeMeta> = {
  pragmatic_beginner: {
    id: "pragmatic_beginner",
    label: "Pragmatischer Einsteiger",
    shortLabel: "Einsteiger",
  },
  ambitious_home_athlete: {
    id: "ambitious_home_athlete",
    label: "Ambitionierter Home-Athlet",
    shortLabel: "Home-Athlet",
  },
  strength_focused: {
    id: "strength_focused",
    label: "Kraftsportler",
    shortLabel: "Kraft",
  },
  cardio_focused: {
    id: "cardio_focused",
    label: "Cardio / Gesundheit",
    shortLabel: "Cardio",
  },
  studio_operator: {
    id: "studio_operator",
    label: "Studiobetreiber",
    shortLabel: "Studio (B2B)",
  },
  physio: {
    id: "physio",
    label: "Physio / Reha",
    shortLabel: "Physio",
  },
  public_sector: {
    id: "public_sector",
    label: "Öffentliche Einrichtung",
    shortLabel: "Öffentlich (B2B)",
  },
  unknown: {
    id: "unknown",
    label: "Noch unbestimmt",
    shortLabel: "?",
  },
};

// NOTE: the prompt-only persona helpers (getPersonaAddendum,
// renderProfileForPrompt) moved to system-prompt-core.mjs so their German
// output is covered by the prompt snapshot test and they can switch language by
// locale. ARCHETYPE_META stays here — it is the source of truth for the German
// admin-dashboard labels (KPI, marketing-store, customer-profile), which are NOT
// locale-switched.
