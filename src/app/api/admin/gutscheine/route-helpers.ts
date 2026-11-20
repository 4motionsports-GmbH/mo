// Shared bits of the /api/admin/gutscheine/* routes (not a route itself).

import { adminJsonError } from "@/lib/admin-api";
import { isDbConfigured } from "@/lib/db";
import { giftVoucherTablesExist } from "@/lib/gift-voucher-store";

/**
 * Who issued or released something. The admin login is one shared password,
 * so there is no person to name; the audit log (admin_access_log) tells
 * sessions apart by their fingerprint.
 */
export const ADMIN_ACTOR = "admin";

/** 503 without a database or before migration 0083; null when the tables exist. */
export async function giftVoucherTablesGate(): Promise<Response | null> {
  if (!isDbConfigured()) return adminJsonError("no_database", "Keine Datenbank konfiguriert.", 503);
  if (!(await giftVoucherTablesExist())) {
    return adminJsonError("migration_missing", "Migration 0083 fehlt — bitte zuerst ausführen.", 503);
  }
  return null;
}

/** A positive integer id from a query parameter, else null. */
export function idFromQuery(req: Request, name = "id"): number | null {
  const raw = new URL(req.url).searchParams.get(name);
  if (raw === null || !/^\d{1,15}$/.test(raw.trim())) return null;
  const id = Number(raw.trim());
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** A file name part from a voucher number (G-2026-00042) — letters, digits and hyphens only. */
export function fileSafe(value: string): string {
  return value.replace(/[^A-Za-z0-9-]/g, "") || "Gutschein";
}
