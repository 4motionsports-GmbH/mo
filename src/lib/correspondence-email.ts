// The correspondence email's text+HTML pair — DELIBERATELY minimal, NOT the
// marketing template (no cart button, no discount, no unsubscribe footer). The
// body is the operator's plain text; the HTML escapes it and turns newlines
// into pre-wrap so there is no HTML-injection surface (mirrors the
// sanitized-render discipline of the admin Markdown renderer).
//
// Shared by the send route (api/admin/correspondence/send) and the Vorschau
// route (api/admin/correspondence/email-preview) so the preview can never
// drift from what actually ships.

export function renderCorrespondenceEmail(body: string): { text: string; html: string } {
  const escaped = body
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  const html =
    `<div style="font-family:system-ui,Segoe UI,Helvetica,Arial,sans-serif;` +
    `font-size:15px;line-height:1.6;color:#111;white-space:pre-wrap;">` +
    escaped +
    `</div>`;
  return { text: body, html };
}
