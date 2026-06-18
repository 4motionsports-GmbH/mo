import { test } from "node:test";
import assert from "node:assert/strict";
import { embedDocsResilient } from "./embed-resilience.mjs";

const V = [0.1, 0.2]; // a stand-in vector
const doc = (id, text = id, docHash = `h-${id}`) => ({ id, text, docHash });

// An embedder that succeeds for everything EXCEPT inputs equal to "POISON",
// which throw — so a chunk containing it fails and must be subdivided.
function poisonEmbedder(poison = "POISON") {
  return async (texts) => {
    if (texts.some((t) => t === poison)) throw new Error("bad input");
    return texts.map(() => V.slice());
  };
}

test("happy path: every doc is embedded, nothing skipped", async () => {
  const res = await embedDocsResilient({
    docs: [doc("a"), doc("b"), doc("c")],
    embed: async (texts) => texts.map(() => V.slice()),
    docVersion: 2,
    chunkSize: 2,
  });
  assert.equal(res.synced, 3);
  assert.equal(res.skipped, 0);
  assert.equal(res.carriedForward, 0);
  assert.equal(res.items.length, 3);
});

test("a per-item failure does NOT abort the run — the rest still sync", async () => {
  const docs = [doc("a"), doc("b", "POISON"), doc("c")];
  const res = await embedDocsResilient({
    docs,
    embed: poisonEmbedder(),
    docVersion: 2,
    chunkSize: 2, // [a,POISON] fails → subdivides to [a] ok + [POISON] fail
    previous: null,
  });
  // b had no previous vector ⇒ skipped; a and c still embedded. No throw.
  assert.equal(res.synced, 2);
  assert.equal(res.skipped, 1);
  assert.deepEqual(res.failedIds, ["b"]);
  assert.ok(res.items.find((i) => i.id === "a"));
  assert.ok(res.items.find((i) => i.id === "c"));
  assert.ok(!res.items.find((i) => i.id === "b"));
});

test("a still-failing item CARRIES FORWARD its previous vector (same version + hash)", async () => {
  const prevVec = [9, 9];
  const previous = {
    docVersion: 2,
    byId: new Map([["b", { vector: prevVec, docHash: "h-b" }]]),
  };
  const res = await embedDocsResilient({
    docs: [doc("a"), doc("b", "POISON")],
    embed: poisonEmbedder(),
    docVersion: 2,
    chunkSize: 2,
    previous,
  });
  assert.equal(res.synced, 1);
  assert.equal(res.carriedForward, 1);
  assert.equal(res.skipped, 0);
  const carried = res.items.find((i) => i.id === "b");
  assert.deepEqual(carried.vector, prevVec);
});

test("a docVersion bump forces re-embed: a stale previous vector is NOT reused", async () => {
  // Previous blob was built with docVersion 1; current is 2. Even though a vector
  // exists for the failing item, it must NOT be carried forward (it's stale).
  const previous = {
    docVersion: 1,
    byId: new Map([["b", { vector: [9, 9], docHash: "h-b" }]]),
  };
  const res = await embedDocsResilient({
    docs: [doc("a"), doc("b", "POISON")],
    embed: poisonEmbedder(),
    docVersion: 2,
    chunkSize: 2,
    previous,
  });
  assert.equal(res.carriedForward, 0);
  assert.equal(res.skipped, 1);
  assert.deepEqual(res.failedIds, ["b"]);
});

test("a changed doc (hash mismatch) is not carried forward even at same version", async () => {
  const previous = {
    docVersion: 2,
    byId: new Map([["b", { vector: [9, 9], docHash: "OLD-HASH" }]]),
  };
  const res = await embedDocsResilient({
    docs: [doc("b", "POISON", "NEW-HASH")],
    embed: poisonEmbedder(),
    docVersion: 2,
    chunkSize: 1,
    previous,
  });
  assert.equal(res.carriedForward, 0);
  assert.equal(res.skipped, 1);
});

test("a FATAL error short-circuits: the API is not called again", async () => {
  let calls = 0;
  const embed = async () => {
    calls++;
    const err = new Error("insufficient_quota");
    throw err;
  };
  const res = await embedDocsResilient({
    docs: [doc("a"), doc("b"), doc("c"), doc("d")],
    embed,
    docVersion: 2,
    chunkSize: 2,
    isFatal: () => true,
    previous: null,
  });
  // First chunk fails fatally ⇒ remaining docs are skipped without more calls.
  assert.equal(calls, 1);
  assert.equal(res.fatal, true);
  assert.equal(res.synced, 0);
  assert.equal(res.skipped, 4);
});

test("inter-chunk delay uses the injected sleep (TPM/RPM politeness)", async () => {
  const sleeps = [];
  await embedDocsResilient({
    docs: [doc("a"), doc("b"), doc("c")],
    embed: async (texts) => texts.map(() => V.slice()),
    docVersion: 2,
    chunkSize: 1,
    interChunkDelayMs: 50,
    sleep: async (ms) => sleeps.push(ms),
  });
  // 3 chunks ⇒ a delay after the first two (not after the last).
  assert.deepEqual(sleeps, [50, 50]);
});
