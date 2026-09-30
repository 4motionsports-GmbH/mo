// /api/erase-data?token=… — the "Daten löschen" link in every marketing and
// Kampagne mail footer: the recipient deletes EVERYTHING we hold about them,
// without an account (the signed, purpose-bound email token is the proof —
// an unsubscribe token never verifies here).
//
//   GET  → a confirmation page with a button. The link itself never deletes:
//          mail security scanners open links automatically.
//   POST → (the button) runs THE erasure path, lib/customer-erasure.ts — the
//          same deletion as the widget's "Meine Daten löschen" and the
//          operator's "Kunde vollständig löschen".
//
// Clicked from a mail client → no CORS/secret guard, like /api/unsubscribe.

import { verifyErasureToken } from "@/lib/email-capture-store";
import { erasePerson } from "@/lib/customer-erasure";
import { erasurePageCopy } from "@/lib/consent-copy";
import { resolveLocale } from "@/lib/locale";
import { renderResultPage } from "@/lib/result-page";
import { reportError } from "@/lib/observability";

export const maxDuration = 30;

export async function GET(req: Request) {
  const locale = resolveLocale(req);
  const copy = erasurePageCopy(locale);
  const token = new URL(req.url).searchParams.get("token") ?? "";
  if (!token.trim() || !verifyErasureToken(token)) {
    return renderResultPage({ status: 400, heading: copy.invalidHeading, body: copy.invalidBody, tone: "error", locale });
  }
  return renderResultPage({
    status: 200,
    heading: copy.confirmHeading,
    body: copy.confirmBody,
    tone: "error",
    locale,
    action: { label: copy.confirmButton, fields: { token } },
  });
}

export async function POST(req: Request) {
  const locale = resolveLocale(req);
  const copy = erasurePageCopy(locale);
  let token = "";
  try {
    const form = await req.formData();
    token = String(form.get("token") ?? "");
  } catch {
    token = "";
  }
  const email = token.trim() ? verifyErasureToken(token) : null;
  if (!email) {
    return renderResultPage({ status: 400, heading: copy.invalidHeading, body: copy.invalidBody, tone: "error", locale });
  }
  try {
    const result = await erasePerson({ email });
    if (!result) {
      return renderResultPage({ status: 503, heading: copy.confirmHeading, body: copy.failedBody, tone: "error", locale });
    }
    return renderResultPage({ status: 200, heading: copy.doneHeading, body: copy.doneBody, tone: "success", locale });
  } catch (err) {
    reportError(err, { route: "api/erase-data" });
    return renderResultPage({ status: 500, heading: copy.confirmHeading, body: copy.failedBody, tone: "error", locale });
  }
}
