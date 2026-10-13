// The correspondence email's text+HTML pair — DELIBERATELY minimal, NOT the
// marketing template (no cart button, no discount, no unsubscribe footer). The
// body is the operator's plain text; the HTML escapes it and turns every line
// break into <br> (plainTextEmailHtml) so there is no HTML-injection surface
// (mirrors the sanitized-render discipline of the admin Markdown renderer).
//
// Shared by the send route (api/admin/correspondence/send) and the Vorschau
// route (api/admin/correspondence/email-preview) so the preview can never
// drift from what actually ships.

import { plainTextEmailHtml } from "./email-prose.mjs";
import { forOutlook } from "./email-outlook.mjs";

export function renderCorrespondenceEmail(body: string): { text: string; html: string } {
  const html =
    // Montserrat is the brand font; the <style> @import is progressive
    // enhancement (Apple Mail etc.) — clients that strip it fall back to the
    // system stack in the inline style below. Outlook for Windows (Word) never
    // sees the import and gets Arial instead: with a web font first in the
    // stack it would ignore the stack and fall back to Times New Roman.
    forOutlook(
      `<style>div { font-family: Arial, Helvetica, sans-serif !important; }</style>`,
      `<style>@import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;700&display=swap');</style>`
    ) +
    // pre-wrap keeps runs of spaces; the line breaks are <br> because Word
    // ignores pre-wrap and would run the whole reply into one paragraph.
    `<div style="font-family:'Montserrat',system-ui,Segoe UI,Helvetica,Arial,sans-serif;` +
    `font-size:15px;line-height:1.6;color:#111;white-space:pre-wrap;">` +
    plainTextEmailHtml(body) +
    `</div>`;
  return { text: body, html };
}
