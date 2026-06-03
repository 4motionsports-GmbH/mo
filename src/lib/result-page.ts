// Minimal, self-contained HTML page for the two user-facing GET endpoints that
// are clicked from an email (confirm-marketing, unsubscribe). No framework, no
// external assets — just a small branded page with a heading and a line of
// copy. German strings come from consent-copy.ts (lawyer-review-required).

export interface ResultPageOptions {
  status: number;
  heading: string;
  body: string;
  tone: "success" | "error";
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function renderResultPage(opts: ResultPageOptions): Response {
  const accent = opts.tone === "success" ? "#16a34a" : "#dc2626";
  const html = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(opts.heading)}</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; background:#fafafa; color:#111;
         margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center; }
  .card { background:#fff; max-width:480px; margin:24px; padding:40px 32px; border-radius:14px;
          box-shadow:0 1px 3px rgba(0,0,0,.08); text-align:center; }
  .badge { width:48px; height:48px; border-radius:50%; background:${accent}1a; color:${accent};
           display:flex; align-items:center; justify-content:center; margin:0 auto 20px;
           font-size:26px; font-weight:700; }
  h1 { font-size:20px; margin:0 0 12px; }
  p { font-size:15px; line-height:1.6; color:#444; margin:0; }
  .brand { margin-top:28px; font-size:13px; color:#999; }
</style>
</head>
<body>
  <main class="card">
    <div class="badge">${opts.tone === "success" ? "✓" : "!"}</div>
    <h1>${escapeHtml(opts.heading)}</h1>
    <p>${escapeHtml(opts.body)}</p>
    <div class="brand">motion sports</div>
  </main>
</body>
</html>`;

  return new Response(html, {
    status: opts.status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}
