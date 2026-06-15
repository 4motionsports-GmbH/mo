#!/usr/bin/env node
// Verify the Pingen integration end-to-end WITHOUT sending a letter.
//
// Checks performed (all READ-SAFE — no letter is created, nothing is mutated,
// and NO secret value is ever printed):
//   1. env present     — PINGEN_CLIENT_ID / _SECRET / _ORGANISATION_ID set;
//                        reports the selected environment + webhook-secret count.
//   2. OAuth grant      — client_credentials token from identity.pingen.com.
//   3. organisation     — GET /organisations/{id} proves the token + that the
//                        organisation id is valid and accessible.
//   4. file-upload      — GET /file-upload proves we can request a signed PDF
//                        upload URL (the first step of every real send).
//
// Run: npm run verify:pingen   (loads .env automatically via --env-file)

import process from "node:process";
import {
  pingenHosts,
  tokenUrl,
  fileUploadUrl,
} from "../src/lib/pingen-core.mjs";
import { parseSecrets } from "../src/lib/pingen-webhook.mjs";
import { isPhysicalMailSendsApproved } from "../src/lib/pingen-flag.mjs";

const TRUTHY = new Set(["1", "true", "yes", "on"]);
const staging = TRUTHY.has((process.env.PINGEN_STAGING ?? "").trim().toLowerCase());

const REQUIRED = ["PINGEN_CLIENT_ID", "PINGEN_CLIENT_SECRET", "PINGEN_ORGANISATION_ID"];
const missing = REQUIRED.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(
    `\nFAILURE: Missing env vars: ${missing.join(", ")}.` +
      `\nSet them in .env (see .env.example). Run with: npm run verify:pingen`
  );
  process.exit(1);
}

const clientId = process.env.PINGEN_CLIENT_ID.trim();
const clientSecret = process.env.PINGEN_CLIENT_SECRET.trim();
const organisationId = process.env.PINGEN_ORGANISATION_ID.trim();
const hosts = pingenHosts(staging);

function ok(msg) {
  console.log(`  ✓ ${msg}`);
}
function fail(msg, detail) {
  console.error(`  ✗ ${msg}${detail ? `\n      ${detail}` : ""}`);
}

console.log(`\nPingen verification — environment: ${staging ? "STAGING" : "PRODUCTION"}`);
console.log(`  API:      ${hosts.api}`);
console.log(`  Identity: ${hosts.identity}`);

// Informational: the flag + how many webhook secrets are configured (no values).
const secretCount = parseSecrets(process.env.PINGEN_WEBHOOK_SECRET).length;
console.log(
  `  Webhook secrets configured: ${secretCount}` +
    (secretCount === 0 ? "  (status webhook will fail closed until set)" : "")
);
console.log(
  `  PHYSICAL_MAIL_SENDS_APPROVED: ${isPhysicalMailSendsApproved() ? "true (sends ENABLED)" : "false (sends DISABLED)"}\n`
);

async function bodyPreview(res) {
  try {
    const text = await res.text();
    return text ? text.slice(0, 300) : "(empty body)";
  } catch {
    return "(unreadable body)";
  }
}

async function main() {
  // 1) OAuth client_credentials grant.
  let token;
  try {
    const res = await fetch(tokenUrl(staging), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });
    if (!res.ok) {
      fail(`OAuth token grant failed (HTTP ${res.status})`, await bodyPreview(res));
      console.error(
        "\n    → Check PINGEN_CLIENT_ID / PINGEN_CLIENT_SECRET, and that PINGEN_STAGING " +
          "matches the account the credentials came from (staging ≠ production)."
      );
      process.exit(1);
    }
    const json = await res.json();
    token = json.access_token;
    if (!token) {
      fail("OAuth grant returned no access_token", JSON.stringify(json).slice(0, 200));
      process.exit(1);
    }
    ok(`OAuth client_credentials grant (token type ${json.token_type ?? "?"}, expires_in ${json.expires_in ?? "?"}s)`);
  } catch (err) {
    fail("OAuth grant request errored", String(err?.message ?? err));
    process.exit(1);
  }

  const authHeaders = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.api+json",
  };

  // 2) Organisation read — proves the org id is valid + accessible.
  try {
    const url = `${hosts.api}/organisations/${organisationId}`;
    const res = await fetch(url, { method: "GET", headers: authHeaders });
    if (!res.ok) {
      fail(`Organisation read failed (HTTP ${res.status})`, await bodyPreview(res));
      console.error(
        "\n    → Check PINGEN_ORGANISATION_ID is the UUID of an organisation this " +
          "client can access (and matches the selected environment)."
      );
      process.exit(1);
    }
    const json = await res.json();
    const name = json?.data?.attributes?.name;
    ok(`Organisation accessible${name ? ` (“${name}”)` : ""}`);
  } catch (err) {
    fail("Organisation read errored", String(err?.message ?? err));
    process.exit(1);
  }

  // 3) File-upload URL issuance — the first step of every real send.
  try {
    const res = await fetch(fileUploadUrl(staging), { method: "GET", headers: authHeaders });
    if (!res.ok) {
      fail(`file-upload request failed (HTTP ${res.status})`, await bodyPreview(res));
      process.exit(1);
    }
    const json = await res.json();
    const hasUrl = Boolean(json?.data?.attributes?.url && json?.data?.attributes?.url_signature);
    if (!hasUrl) {
      fail("file-upload returned no signed URL / signature", JSON.stringify(json).slice(0, 200));
      process.exit(1);
    }
    ok("file-upload issues a signed PDF upload URL");
  } catch (err) {
    fail("file-upload request errored", String(err?.message ?? err));
    process.exit(1);
  }

  console.log(
    `\nSUCCESS — Pingen is reachable and configured for ${staging ? "STAGING" : "PRODUCTION"}.` +
      `\nNo letter was created. You can now send a test letter from the admin panel.\n`
  );
}

main().catch((err) => {
  console.error("\nFAILURE: unexpected error:", err);
  process.exit(1);
});
