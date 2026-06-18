// Resilient embedding orchestrator — the fix for the catalog-sync 503.
//
// ROOT CAUSE (see docs/CATALOG_SYNC_DIAGNOSIS.md): the old embedAll was
// all-or-nothing. A single failed chunk (rate-limit / quota / transient 5xx)
// threw out of the whole function, 503'd the run, and wrote ZERO embeddings.
//
// This core makes embedding resilient and is PURE (the OpenAI call is injected as
// `embed`), so the guarantees are unit-testable without a network:
//   1. Each chunk is wrapped — a failure NEVER throws out of the run.
//   2. On a chunk failure we retry it as smaller SUB-BATCHES, down to per-item,
//      isolating one poison item instead of losing its whole chunk.
//   3. An item that STILL fails CARRIES FORWARD its previous vector from the
//      existing embeddings blob — but ONLY when that vector still matches the
//      current embedded text (same docVersion AND same per-item docHash). After
//      an EMBEDDING_DOC_VERSION bump nothing matches, so a stale vector is never
//      reused; the item is skipped and re-embedded next time (Part D).
//   4. A FATAL error (insufficient_quota / billing / auth) short-circuits: we
//      stop hammering the API and mark the rest carried-forward/skipped, so a
//      billing outage degrades cleanly instead of firing ~1000 doomed calls.
//
// The caller turns the returned summary into the route's response: 200 on partial
// success (synced/carriedForward/skipped), 5xx only when NOTHING usable was
// produced (synced === 0 && carriedForward === 0) — see the cron route.

/** @typedef {{ id: string, text: string, docHash: string }} EmbedDoc */
/** @typedef {{ id: string, vector: number[], docHash: string }} EmbedItem */

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @param {object} opts
 * @param {EmbedDoc[]} opts.docs                 products to embed (id, text, docHash)
 * @param {(texts: string[]) => Promise<number[][]>} opts.embed  injected embedder
 * @param {number} opts.docVersion               current EMBEDDING_DOC_VERSION
 * @param {{ docVersion?: number, byId: Map<string, { vector: number[], docHash?: string }> } | null} [opts.previous]
 *   the previous embeddings blob, indexed by id (for carry-forward)
 * @param {number} [opts.chunkSize=100]          top-level batch size
 * @param {number} [opts.interChunkDelayMs=0]    delay between top-level chunks (TPM/RPM)
 * @param {(err: unknown) => boolean} [opts.isFatal]  true ⇒ stop calling the API
 * @param {(event: { type: string, [k: string]: unknown }) => void} [opts.onEvent]
 * @param {(ms: number) => Promise<void>} [opts.sleep]  injectable for tests
 * @returns {Promise<{ items: EmbedItem[], synced: number, carriedForward: number,
 *   skipped: number, failedIds: string[], chunkErrors: number, fatal: boolean,
 *   lastError: unknown }>}
 */
export async function embedDocsResilient(opts) {
  const {
    docs,
    embed,
    docVersion,
    previous = null,
    chunkSize = 100,
    interChunkDelayMs = 0,
    isFatal = () => false,
    onEvent = () => {},
    sleep = defaultSleep,
  } = opts;

  const items = [];
  let synced = 0;
  let carriedForward = 0;
  let skipped = 0;
  const failedIds = [];
  let chunkErrors = 0;
  let fatal = false;
  let lastError = null;

  const prevVersionMatches = previous != null && previous.docVersion === docVersion;

  // Carry the previous vector for ONE failed item, but only when it still matches
  // the current embedded text — otherwise skip it (re-embed next run).
  function carryOrSkip(doc) {
    const prev = previous?.byId?.get(doc.id);
    const canCarry =
      prevVersionMatches &&
      prev &&
      Array.isArray(prev.vector) &&
      prev.vector.length > 0 &&
      prev.docHash === doc.docHash;
    if (canCarry) {
      items.push({ id: doc.id, vector: prev.vector, docHash: doc.docHash });
      carriedForward++;
      onEvent({ type: "carry-forward", id: doc.id });
    } else {
      skipped++;
      failedIds.push(doc.id);
      onEvent({ type: "skip", id: doc.id, reason: prev ? "doc-changed" : "no-previous" });
    }
  }

  // Embed one slice; on failure subdivide to isolate a poison item, then fall
  // back to carry-forward/skip per item. Recursion depth is ~log2(chunkSize).
  async function embedSlice(slice) {
    if (slice.length === 0) return;
    if (fatal) {
      // A fatal error already fired — don't touch the API again.
      for (const doc of slice) carryOrSkip(doc);
      return;
    }
    try {
      const vectors = await embed(slice.map((d) => d.text));
      if (!Array.isArray(vectors) || vectors.length !== slice.length) {
        throw new Error(
          `embed returned ${Array.isArray(vectors) ? vectors.length : "non-array"} vectors for ${slice.length} inputs`
        );
      }
      slice.forEach((doc, i) => {
        items.push({ id: doc.id, vector: vectors[i], docHash: doc.docHash });
        synced++;
      });
    } catch (err) {
      lastError = err;
      chunkErrors++;
      if (isFatal(err)) {
        // Quota / billing / auth — pointless to retry or subdivide. Stop the API
        // calls for the rest of the run and degrade this slice cleanly.
        fatal = true;
        onEvent({ type: "fatal", size: slice.length, error: err });
        for (const doc of slice) carryOrSkip(doc);
        return;
      }
      onEvent({ type: "chunk-error", size: slice.length, error: err });
      if (slice.length > 1) {
        // Sub-batch retry: split in half and recurse so one bad item can't sink
        // its neighbours.
        const mid = Math.floor(slice.length / 2);
        await embedSlice(slice.slice(0, mid));
        await embedSlice(slice.slice(mid));
      } else {
        // Down to a single item and it STILL failed — carry forward or skip.
        carryOrSkip(slice[0]);
      }
    }
  }

  for (let i = 0; i < docs.length; i += chunkSize) {
    await embedSlice(docs.slice(i, i + chunkSize));
    // Be a good TPM/RPM citizen between top-level chunks. Skipped once fatal
    // (no more API calls are coming) and after the final chunk.
    if (!fatal && interChunkDelayMs > 0 && i + chunkSize < docs.length) {
      await sleep(interChunkDelayMs);
    }
  }

  return { items, synced, carriedForward, skipped, failedIds, chunkErrors, fatal, lastError };
}
