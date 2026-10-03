"use client";

// POST for a binary response (a letter PDF) with the admin JSON error
// envelope — adminFetch() is JSON-only. Kunden → Brief and Kampagne → Briefe.

export async function fetchPdf(path: string, payload: unknown): Promise<Blob> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(json?.error?.message ?? `Fehler (${res.status})`);
  }
  return res.blob();
}
