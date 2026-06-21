import { Resend } from "resend";
import { corsHeaders, guardRequest, preflightResponse } from "@/lib/security";
import { checkRateLimit, checkRateLimitKeyed, clientIp, rateLimitResponse } from "@/lib/rate-limit";
import { errorResponse, reportError } from "@/lib/observability";
import { escapeHtml } from "@/lib/html-escape";
import { resolveLocale } from "@/lib/locale";
import { apiMessage } from "@/lib/api-messages.mjs";

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
  order_support: "Bestellung & Service",
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

  const rows = fields
    .map(
      ([k, v]) =>
        `<tr><td style="padding:4px 12px 4px 0;color:#666;vertical-align:top">${escapeHtml(k)}</td><td style="padding:4px 0">${escapeHtml(v)}</td></tr>`
    )
    .join("");
  const html = `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.5">
<table style="border-collapse:collapse">${rows}</table>
<h3 style="margin:24px 0 8px 0;font-size:14px">Nachricht</h3>
<pre style="white-space:pre-wrap;font-family:inherit;margin:0">${escapeHtml(p.message)}</pre>
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

    // Per-IP cap (the chat bucket above is keyed by a rotatable session header):
    // the contact form lands in our own inbox, so cap inbox spam per source IP.
    const ipRl = await checkRateLimitKeyed("contact-ip", `ip:${clientIp(req)}`);
    if (!ipRl.ok) return rateLimitResponse(ipRl.retryAfter, headers);

    let payload: Partial<ContactPayload>;
    try {
      payload = await req.json();
    } catch {
      return errorResponse("bad_request", apiMessage("invalid_json", resolveLocale(req)), 400, headers);
    }

    // Storefront-selected language for the user-facing response messages (the
    // internal team email body stays German). Default German.
    const locale = resolveLocale(req, (payload as { locale?: unknown }).locale);

    if (!isValid(payload)) {
      return errorResponse(
        "bad_request",
        apiMessage("contact_required_fields", locale),
        400,
        headers
      );
    }

    const apiKey = process.env.RESEND_API_KEY;
    const to = process.env.CONTACT_TO_EMAIL;
    const from = process.env.CONTACT_FROM_EMAIL;

    if (!apiKey || !to || !from) {
      // Local-dev fallback: keep working without a Resend key configured. Do NOT
      // log the submitter's PII (name / email / phone / message) to stdout —
      // application logs are a processor-visible sink (GDPR — OQ-18). Log only
      // non-identifying metadata so the dev still sees a submission arrived.
      console.log(
        "[contact-form] new submission (no email sent — RESEND_API_KEY/CONTACT_TO_EMAIL/CONTACT_FROM_EMAIL not set)",
        {
          timestamp: new Date().toISOString(),
          reason: payload.reason,
          productCount: (payload.productIds ?? []).length,
          hasOrganization: Boolean(payload.organization?.trim()),
          hasPhone: Boolean(payload.phone?.trim()),
          messageLength: payload.message?.length ?? 0,
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
          apiMessage("email_delivery_failed", locale),
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
