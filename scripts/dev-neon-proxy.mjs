#!/usr/bin/env node
// Local Neon-protocol proxy — run the app against a PLAIN Postgres in development.
//
// The runtime talks to the database through the Neon serverless driver's HTTP
// mode (`neon()` POSTs SQL to https://<host>/sql). A local Postgres has no such
// endpoint, so this tiny proxy implements the same protocol and forwards each
// query to Postgres via `pg`:
//
//   POST /sql   headers: Neon-Connection-String, Neon-Raw-Text-Output, Neon-Array-Mode
//               body:    { query, params }            → { command, rowCount, fields, rows }
//                        { queries: [{query,params}] } → { results: [...] }  (one transaction)
//               errors:  400 { message, code, detail, hint, position, ... }
//
// Usage (see docs/DATABASE.md → "Local database"):
//   npm run db:proxy                       # listens on http://127.0.0.1:4444/sql
//   NEON_FETCH_ENDPOINT=http://127.0.0.1:4444/sql DATABASE_URL=postgres://mo:mo@127.0.0.1:5432/mo npm run dev
//
// Development only: never deploy this, never point it at a production database.
// Requires the `pg` devDependency.

import http from "node:http";
import pg from "pg";

const PORT = Number(process.env.PORT || 4444);
const pools = new Map();

function poolFor(connectionString) {
  let pool = pools.get(connectionString);
  if (!pool) {
    pool = new pg.Pool({ connectionString, max: 8 });
    pools.set(connectionString, pool);
  }
  return pool;
}

// The driver asks for raw text output and parses types itself from dataTypeID.
const rawTypes = { getTypeParser: () => (value) => value };

function shape(result) {
  return {
    command: result.command,
    rowCount: result.rowCount,
    fields: (result.fields || []).map((f) => ({ name: f.name, dataTypeID: f.dataTypeID })),
    rows: result.rows,
  };
}

function errorBody(err) {
  return {
    message: err.message,
    code: err.code,
    severity: err.severity,
    detail: err.detail,
    hint: err.hint,
    position: err.position,
    schema: err.schema,
    table: err.table,
    column: err.column,
    constraint: err.constraint,
  };
}

function beginStatement(headers) {
  const isolation = headers["neon-batch-isolation-level"];
  let stmt = "BEGIN";
  if (isolation) {
    // e.g. "ReadCommitted" → "READ COMMITTED"
    stmt += ` ISOLATION LEVEL ${String(isolation).replace(/([a-z])([A-Z])/g, "$1 $2").toUpperCase()}`;
  }
  if (headers["neon-batch-read-only"] === "true") stmt += " READ ONLY";
  if (headers["neon-batch-deferrable"] === "true") stmt += " DEFERRABLE";
  return stmt;
}

async function readBody(req) {
  let body = "";
  for await (const chunk of req) body += chunk;
  return body;
}

const server = http.createServer(async (req, res) => {
  const json = (status, payload) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(payload));
  };
  if (req.method !== "POST") return json(404, { message: "POST /sql only" });

  const connectionString = req.headers["neon-connection-string"];
  if (!connectionString) return json(400, { message: "Missing Neon-Connection-String header" });

  let payload;
  try {
    payload = JSON.parse(await readBody(req));
  } catch {
    return json(400, { message: "Invalid JSON body" });
  }

  const pool = poolFor(String(connectionString));
  try {
    if (Array.isArray(payload.queries)) {
      const client = await pool.connect();
      try {
        await client.query(beginStatement(req.headers));
        const results = [];
        for (const q of payload.queries) {
          results.push(
            shape(
              await client.query({
                text: q.query,
                values: q.params ?? [],
                rowMode: "array",
                types: rawTypes,
              })
            )
          );
        }
        await client.query("COMMIT");
        return json(200, { results });
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    }
    const result = await pool.query({
      text: payload.query,
      values: payload.params ?? [],
      rowMode: "array",
      types: rawTypes,
    });
    return json(200, shape(result));
  } catch (err) {
    if (process.env.PROXY_LOG) {
      console.error("[dev-neon-proxy]", err.message, "—", String(payload.query ?? "").slice(0, 200));
    }
    return json(400, errorBody(err));
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[dev-neon-proxy] listening on http://127.0.0.1:${PORT}/sql`);
});
