// Geschenkgutscheine — private Vercel Blob files (docs/GIFT_VOUCHERS.md).
//
// Two prefixes, nothing else is ever read, written or deleted here:
//   gift-voucher-photos/<photoId>.jpg              customer photos (design „Eigenes Foto“)
//   gift-voucher-print/<assetToken>-<side>.jpg     the Premium-Karte print spreads,
//                                                  served to the print partner by
//                                                  /api/gift-vouchers/print-asset while
//                                                  the job is open
// The store is private (like the catalog and the hero images): files are read
// back server-side with the token and never get a public URL of their own.
// Pathnames are fixed (no random suffix) — the database row is the reference,
// and a retry overwrites its own file. Never the template-/campaign-default-
// files of the mail designer: those live under email-heroes/ and are shared.
//
// Fail-soft: no BLOB_READ_WRITE_TOKEN, a network error or a timeout give
// false / null / 0 / [] and a reportError — never a throw. The timeout is a
// plain AbortController (as in mail-template-image.ts), not
// AbortSignal.timeout.

import { del, get, list, put } from "@vercel/blob";
import { GIFT_VOUCHER_PHOTO_PREFIX, GIFT_VOUCHER_PRINT_PREFIX } from "./gift-voucher-core.mjs";
import { reportError } from "./observability";

const ROUTE = "lib/gift-voucher-blob";
const TIMEOUT_MS = 25_000;
/** Largest file read back (a photo is ≤ 4 MB after processing, a print spread a few MB). */
const MAX_READ_BYTES = 20_000_000;
/** Pathnames per delete request. */
const DELETE_CHUNK = 100;
/** Upper bound of one listing (pages × 1000). */
const LIST_MAX_PAGES = 10;

export const GIFT_VOUCHER_BLOB_PREFIXES = [GIFT_VOUCHER_PHOTO_PREFIX, GIFT_VOUCHER_PRINT_PREFIX] as const;
export type GiftVoucherBlobPrefix = (typeof GIFT_VOUCHER_BLOB_PREFIXES)[number];

export function isGiftVoucherBlobConfigured(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

/**
 * Only our own files: one of the two prefixes, then a plain file name (letters,
 * digits, _ - . — no separators, no traversal).
 */
export function isGiftVoucherBlobPathname(pathname: unknown): pathname is string {
  if (typeof pathname !== "string" || pathname.length > 200) return false;
  const prefix = GIFT_VOUCHER_BLOB_PREFIXES.find((p) => pathname.startsWith(p));
  if (!prefix) return false;
  const file = pathname.slice(prefix.length);
  return /^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,150}$/.test(file) && !file.includes("..");
}

async function withTimeout<T>(run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  try {
    return await run(abort.signal);
  } finally {
    clearTimeout(timer);
  }
}

/** Store (or overwrite) one file privately. Never throws. */
export async function putGiftVoucherBlob(pathname: string, bytes: Buffer | Uint8Array, contentType: string): Promise<boolean> {
  if (!isGiftVoucherBlobConfigured() || !isGiftVoucherBlobPathname(pathname)) return false;
  try {
    await withTimeout((abortSignal) =>
      put(pathname, Buffer.from(bytes), {
        access: "private",
        contentType,
        addRandomSuffix: false,
        allowOverwrite: true,
        token: process.env.BLOB_READ_WRITE_TOKEN,
        abortSignal,
      })
    );
    return true;
  } catch (err) {
    reportError(err, { route: ROUTE, phase: "put" });
    return false;
  }
}

/** Read one file back, or null (missing, too large, not configured, error). Never throws. */
export async function getGiftVoucherBlob(pathname: string): Promise<{ bytes: Buffer; contentType: string } | null> {
  if (!isGiftVoucherBlobConfigured() || !isGiftVoucherBlobPathname(pathname)) return null;
  try {
    return await withTimeout(async (abortSignal) => {
      const res = await get(pathname, {
        access: "private",
        token: process.env.BLOB_READ_WRITE_TOKEN,
        useCache: false,
        abortSignal,
      });
      if (!res || res.statusCode !== 200) return null;
      if (typeof res.blob.size === "number" && res.blob.size > MAX_READ_BYTES) return null;
      const bytes = Buffer.from(await new Response(res.stream).arrayBuffer());
      if (bytes.length > MAX_READ_BYTES) return null;
      return { bytes, contentType: res.blob.contentType || "application/octet-stream" };
    });
  } catch (err) {
    reportError(err, { route: ROUTE, phase: "get" });
    return null;
  }
}

/**
 * Delete files (only pathnames under our two prefixes; others are ignored).
 * Returns how many were sent to a delete request that succeeded. Never throws.
 */
export async function deleteGiftVoucherBlobs(pathnames: readonly string[]): Promise<number> {
  if (!isGiftVoucherBlobConfigured()) return 0;
  const own = [...new Set(pathnames.filter(isGiftVoucherBlobPathname))];
  let deleted = 0;
  for (let i = 0; i < own.length; i += DELETE_CHUNK) {
    const chunk = own.slice(i, i + DELETE_CHUNK);
    try {
      await withTimeout((abortSignal) => del(chunk, { token: process.env.BLOB_READ_WRITE_TOKEN, abortSignal }));
      deleted += chunk.length;
    } catch (err) {
      reportError(err, { route: ROUTE, phase: "delete" });
    }
  }
  return deleted;
}

/**
 * Pathnames under one of our prefixes (e.g. "gift-voucher-photos/"),
 * optionally only those uploaded before `olderThan`. At most 10 000 per call.
 * Never throws ([] on error).
 */
export async function listGiftVoucherBlobs(prefix: string, opts: { olderThan?: Date | null } = {}): Promise<string[]> {
  if (!isGiftVoucherBlobConfigured() || !(GIFT_VOUCHER_BLOB_PREFIXES as readonly string[]).includes(prefix)) return [];
  const before = opts.olderThan instanceof Date && !Number.isNaN(opts.olderThan.getTime()) ? opts.olderThan.getTime() : null;
  const out: string[] = [];
  try {
    let cursor: string | undefined;
    for (let page = 0; page < LIST_MAX_PAGES; page++) {
      const res = await withTimeout((abortSignal) =>
        list({ prefix, cursor, limit: 1000, token: process.env.BLOB_READ_WRITE_TOKEN, abortSignal })
      );
      for (const b of res.blobs) {
        if (!isGiftVoucherBlobPathname(b.pathname)) continue;
        if (before !== null && !(new Date(b.uploadedAt).getTime() < before)) continue;
        out.push(b.pathname);
      }
      if (!res.hasMore || !res.cursor) break;
      cursor = res.cursor;
    }
  } catch (err) {
    reportError(err, { route: ROUTE, phase: "list" });
  }
  return out;
}
