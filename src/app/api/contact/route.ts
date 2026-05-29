import { Resend } from "resend";
import { corsHeaders, guardRequest, preflightResponse } from "@/lib/security";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { errorResponse, reportError } from "@/lib/observability";

export const maxDuration = 10;

interface ContactPayload {
  reason: string;
  productIds?: string[];
  name: string;
  email: string;
  organization?: string;
  phone?: string;
  message: string;
}

function isValid(p: Partial<ContactPayload>): p is ContactPayload {
  return (
    typeof p.reason === "string" &&
    typeof p.name === "string" &&
    p.name.trim().length > 0 &&
    typeof p.email === "string" &&
    /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p.email) &&
    typeof p.message === "string" &&
    p.message.trim().length > 0
  );
}

const REASON_LABELS: Record<string, string> = {
  studio_consultation: "Studio-Beratung",
  public_sector_quote: "Angebot öffentlicher Sektor",
  physio_consultation: "Physio-Beratung",
  bulk_discount: "Mengenrabatt",
  leasing: "Leasing",
  maintenance: "Wartung",
  general: "Allgemeine Anfrage",
};

function subjectFor(reason: string): string {
  const label = REASON_LABELS[reason] ?? reason;
  return `[motionsports.de] Kontaktanfrage: ${label}`;
}

function renderBody(p: ContactPayload): { text: string; html: string } {
  const productIds = p.productIds ?? [];
  const fields: Array<[string, string]> = [
    ["Grund", REASON_LABELS[p.reason] ?? p.reason],
    ["Name", p.name],
    ["E-Mail", p.email],
    ["Organisation", p.organization?.trim() || "—"],
    ["Telefon", p.phone?.trim() || "—"],
    ["Produkt-IDs", productIds.length ? productIds.join(", ") : "—"],
    ["Eingegangen", new Date().toISOString()],
  ];

  const text = [
    ...fields.map(([k, v]) => `${k}: ${v}`),
    "",
    "Nachricht:",
    p.message,
  ].join("\n");

  const escape = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  const rows = fields
    .map(
      ([k, v]) =>
        `<tr><td style="padding:4px 12px 4px 0;color:#666;vertical-align:top">${escape(k)}</td><td style="padding:4px 0">${escape(v)}</td></tr>`
    )
    .join("");
  const html = `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.5">
<table style="border-collapse:collapse">${rows}</table>
<h3 style="margin:24px 0 8px 0;font-size:14px">Nachricht</h3>
<pre style="white-space:pre-wrap;font-family:inherit;margin:0">${escape(p.message)}</pre>
</div>`;

  return { text, html };
}

export async function OPTIONS(req: Request) {
  return preflightResponse(req);
}

function okJson(body: unknown, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

export async function POST(req: Request) {
  const guard = guardRequest(req);
  if (!guard.ok) return guard.response;
  const headers = corsHeaders(guard.origin);

  try {
    const rl = await checkRateLimit(req, "chat");
    if (!rl.ok) return rateLimitResponse(rl.retryAfter, headers);

    let payload: Partial<ContactPayload>;
    try {
      payload = await req.json();
    } catch {
      return errorResponse("bad_request", "Ungültiger JSON-Body", 400, headers);
    }

    if (!isValid(payload)) {
      return errorResponse(
        "bad_request",
        "Pflichtfelder fehlen oder ungültig (name, email, message, reason)",
        400,
        headers
      );
    }

    const apiKey = process.env.RESEND_API_KEY;
    const to = process.env.CONTACT_TO_EMAIL;
    const from = process.env.CONTACT_FROM_EMAIL;

    if (!apiKey || !to || !from) {
      // Local-dev fallback: keep working without a Resend key configured.
      console.log(
        "[contact-form] new submission (no email sent — RESEND_API_KEY/CONTACT_TO_EMAIL/CONTACT_FROM_EMAIL not set)",
        {
          timestamp: new Date().toISOString(),
          reason: payload.reason,
          productIds: payload.productIds ?? [],
          name: payload.name,
          email: payload.email,
          organization: payload.organization ?? "",
          phone: payload.phone ?? "",
          message: payload.message,
        }
      );
      return okJson({ ok: true }, headers);
    }

    const { text, html } = renderBody(payload);

    try {
      const resend = new Resend(apiKey);
      const result = await resend.emails.send({
        from,
        to,
        replyTo: payload.email,
        subject: subjectFor(payload.reason),
        text,
        html,
      });
      if (result.error) {
        reportError(result.error, {
          route: "api/contact",
          reason: payload.reason,
          phase: "resend",
        });
        return errorResponse(
          "upstream_unavailable",
          "E-Mail konnte nicht zugestellt werden",
          502,
          headers
        );
      }
    } catch (err) {
      reportError(err, {
        route: "api/contact",
        reason: payload.reason,
        phase: "resend",
      });
      return errorResponse(
        "upstream_unavailable",
        "E-Mail konnte nicht zugestellt werden",
        502,
        headers
      );
    }

    return okJson({ ok: true }, headers);
  } catch (err) {
    reportError(err, { route: "api/contact" });
    return errorResponse("internal_error", "Unexpected server error", 500, headers);
  }
}
