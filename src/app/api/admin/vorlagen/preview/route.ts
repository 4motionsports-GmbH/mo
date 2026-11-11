// POST /api/admin/vorlagen/preview → text/html (inert links), header X-Mail-Bytes (the mail's size)
//   { doc, use: "bulk" | "personal", subject?, preheader?, language?, firstName?, sample? }
//
// The live preview of the template editor and the Rundmail editor — the
// UNSAVED document, through the production renderers:
//   bulk     — the document as a Rundmail (mailing-render.ts, the same render
//              a test mail and the release use);
//   personal — the document as the design of a campaign mail: the production
//              composer with sample data (email-design-preview.ts) inside the
//              template design (mail-template-design.ts) — item or set mail.
// Read-only: nothing is stored, sent or minted; every recipient link is inert
// (adminEmailHtml).

import { guardAdminPost, adminEmailHtml, adminJsonError } from "@/lib/admin-api";
import { reportError } from "@/lib/observability";
import { normalizeMailTemplateDoc, docSupportsPersonal, normalizeFirstName } from "@/lib/mail-template-doc.mjs";
import { preloadDocProducts, templateDesignFromDoc } from "@/lib/mail-template-design";
import { renderEmailDesignPreview, parseEmailDesignPreviewSample } from "@/lib/email-design-preview";
import { renderMailingPreview } from "@/lib/mailing-render";

export const maxDuration = 30;

/** The size of the mail as it is sent (before the preview's inert links) — the preview warns near Gmail's 102 KB clip. */
function withMailSize(res: Response, html: string): Response {
  res.headers.set("X-Mail-Bytes", String(Buffer.byteLength(html, "utf8")));
  return res;
}

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return adminJsonError("bad_request", "Ungültige Anfrage (kein JSON).", 400);
  }
  if (JSON.stringify(body.doc ?? {}).length > 400_000) return adminJsonError("too_large", "Die Vorlage ist zu groß.", 413);
  try {
    const doc = normalizeMailTemplateDoc(body.doc);
    const language = body.language === "en" ? "en" : "de";
    if (body.use === "personal") {
      if (!docSupportsPersonal(doc)) {
        return adminJsonError("bad_request", "Für die Vorschau als persönliche Mail fehlt der Baustein „Mos persönlicher Text“.", 400);
      }
      const products = await preloadDocProducts(doc);
      const design = templateDesignFromDoc("vorlage-vorschau", doc, products);
      const kind = body.kind === "marketing" ? "marketing" : "campaign";
      const html = await renderEmailDesignPreview(kind, design, parseEmailDesignPreviewSample(body.sample));
      return withMailSize(adminEmailHtml(html), html);
    }
    const firstName = typeof body.firstName === "string" ? normalizeFirstName(body.firstName) : null;
    const rendered = await renderMailingPreview(
      {
        doc,
        subject: typeof body.subject === "string" ? body.subject.slice(0, 200) : "",
        preheader: typeof body.preheader === "string" ? body.preheader.slice(0, 200) : null,
        language,
      },
      firstName
    );
    return withMailSize(adminEmailHtml(rendered.html), rendered.html);
  } catch (err) {
    reportError(err, { route: "api/admin/vorlagen/preview" });
    return adminJsonError("internal_error", "Vorschau fehlgeschlagen.", 500);
  }
}
