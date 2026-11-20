"use client";

// Download a binary from a GET admin route (the voucher PDF, the print files)
// as a file — with the admin JSON error envelope turned into an Error with the
// server's German message (adminFetch is JSON-only; a plain <a href> would
// save an error answer as the file). A 401 sends the operator to the login.

import { AdminApiError, redirectToLogin } from "../lib/admin-fetch";

/** The file name from Content-Disposition (filename="…"), else the fallback. */
function fileNameOf(res: Response, fallback: string): string {
  const cd = res.headers.get("content-disposition") ?? "";
  const m = cd.match(/filename="([^"]+)"/);
  return m ? m[1] : fallback;
}

export async function downloadFile(path: string, fallbackName: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(path, { credentials: "same-origin" });
  } catch (err) {
    throw new AdminApiError("Netzwerkfehler — bitte Verbindung prüfen.", 0, "network", err);
  }
  if (!res.ok) {
    const json = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
    if (res.status === 401) redirectToLogin();
    throw new AdminApiError(json?.error?.message || `Fehler (${res.status})`, res.status, json?.error?.code ?? null, json);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = fileNameOf(res, fallbackName);
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    // Give the browser a moment to start the download before the URL goes.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}
