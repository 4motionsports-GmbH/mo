// GET /api/newsletter-rating?r=1..5&k=<kind> — the smiley rating row carried by
// the image-first email designs ("Wie hilfreich war diese Empfehlung?").
//
// Clicked as a top-level navigation from a mail client → no CORS/widget-secret
// guard (the widget's shared key isn't available there), same as the
// unsubscribe/DOI-confirm links. Instead:
//   - the link is ANONYMOUS by design: score + email kind only, no recipient
//     identity, so a forwarded email can never reveal who received it;
//   - the rate limiter's feedback bucket caps abuse;
//   - the score is validated against the closed 1–5 vocabulary.
//
// The click is stored as a normal feedback row (migration 0020), so newsletter
// ratings appear in the admin Feedback tab next to the widget comments — no
// separate table, no new admin surface.

import { checkRateLimit } from "@/lib/rate-limit";
import { insertFeedback } from "@/lib/feedback-store";
import { parseEmailThemeKind } from "@/lib/email-theme.mjs";
import { emailRatingMessage, parseEmailRating } from "@/lib/email-rating.mjs";
import { renderResultPage } from "@/lib/result-page";
import { resolveLocale } from "@/lib/locale";
import { reportError } from "@/lib/observability";

export const maxDuration = 10;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const locale = resolveLocale(req);
  const en = locale === "en";
  const rating = parseEmailRating(url.searchParams.get("r"));
  const kind = parseEmailThemeKind(url.searchParams.get("k")) ?? "email";

  if (rating == null) {
    return renderResultPage({
      status: 400,
      heading: en ? "Invalid link" : "Ungültiger Link",
      body: en
        ? "This rating link is not valid."
        : "Dieser Bewertungs-Link ist leider ungültig.",
      tone: "error",
      locale,
    });
  }

  try {
    const rl = await checkRateLimit(req, "feedback");
    if (!rl.ok) {
      return renderResultPage({
        status: 429,
        heading: en ? "Too many requests" : "Zu viele Anfragen",
        body: en
          ? "Please try again in a moment."
          : "Bitte versuche es gleich noch einmal.",
        tone: "error",
        locale,
      });
    }

    // Fail-soft: a storage outage must not show the customer an error for a
    // one-click courtesy action — the thank-you page renders either way.
    await insertFeedback({
      message: emailRatingMessage(rating, kind),
      sessionId: null,
      conversationId: null,
      tier: null,
      email: null,
      page: `email:${kind}`,
    }).catch((err) => {
      reportError(err, { route: "api/newsletter-rating", phase: "insert" });
      return null;
    });

    return renderResultPage({
      status: 200,
      heading: en ? "Thank you!" : "Danke dir!",
      body: en
        ? "Your rating helps us make our recommendations even more relevant."
        : "Deine Bewertung hilft uns, die Empfehlungen noch passender zu machen.",
      tone: "success",
      locale,
    });
  } catch (err) {
    reportError(err, { route: "api/newsletter-rating" });
    return renderResultPage({
      status: 200,
      heading: en ? "Thank you!" : "Danke dir!",
      body: en
        ? "Your rating helps us make our recommendations even more relevant."
        : "Deine Bewertung hilft uns, die Empfehlungen noch passender zu machen.",
      tone: "success",
      locale,
    });
  }
}
