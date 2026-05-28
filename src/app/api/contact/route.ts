import { NextResponse } from "next/server";
import { corsHeaders, guardRequest, preflightResponse } from "@/lib/security";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";

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

export async function OPTIONS(req: Request) {
  return preflightResponse(req);
}

export async function POST(req: Request) {
  const guard = guardRequest(req);
  if (!guard.ok) return guard.response;
  const headers = corsHeaders(guard.origin);

  const rl = await checkRateLimit(req);
  if (!rl.ok) return rateLimitResponse(rl.retryAfter, headers);

  let payload: Partial<ContactPayload>;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Ungültiger JSON-Body" }, { status: 400, headers });
  }

  if (!isValid(payload)) {
    return NextResponse.json(
      { error: "Pflichtfelder fehlen oder ungültig (name, email, message, reason)" },
      { status: 400, headers }
    );
  }

  // Prototype: log to server console. Production would forward to CRM /
  // ticket system / email service. Vercel logs are visible in the dashboard.
  console.log("[contact-form] new submission", {
    timestamp: new Date().toISOString(),
    reason: payload.reason,
    productIds: payload.productIds ?? [],
    name: payload.name,
    email: payload.email,
    organization: payload.organization ?? "",
    phone: payload.phone ?? "",
    message: payload.message,
  });

  return NextResponse.json({ ok: true }, { headers });
}
