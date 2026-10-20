"use client";

// The rendered-first mail column: the e-mail exactly as it ships, produced by
// POST /api/admin/campaign/email-preview (subject + body ride along so edits
// preview correctly). A small module-level cache of blob URLs keyed by the
// card's preview SIGNATURE — everything the render depends on: prose, Rabatt,
// Empfehlungen, Set, Hero, language, the draft's last write (campaign-desk-
// core.mjs; plus the campaign's Kampagnenbild, which is no draft field) —
// means a card the operator returns to renders instantly, every
// change to the draft re-renders it at once (a new KI-Hero, a swapped
// product, an attached Set — no browser reload), and the NEXT card in the
// rail is prefetched while the current one is read — the 15-second path
// never waits for the renderer.

import * as React from "react";
import { previewSignature } from "@/lib/campaign-desk-core.mjs";
import { errorMessage } from "../lib/admin-fetch";
import type { CampaignQueueItemProps } from "./types";

const CACHE_MAX = 12;
const EDIT_DEBOUNCE_MS = 600;

const cache = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();

/** `campaignHero` = the Kampagnenbild URL (or null): part of the key, so a
 *  picture changed in the editor never shows the cached old render. */
function cacheKey(item: CampaignQueueItemProps, campaignHero: string | null): string {
  return `${item.contactId} ${previewSignature({ ...item, campaignHero })}`;
}

function remember(key: string, url: string): void {
  if (cache.has(key)) {
    const old = cache.get(key);
    if (old && old !== url) URL.revokeObjectURL(old);
    cache.delete(key);
  }
  cache.set(key, url);
  while (cache.size > CACHE_MAX) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) break;
    const oldest = cache.get(oldestKey);
    cache.delete(oldestKey);
    if (oldest) URL.revokeObjectURL(oldest);
  }
}

/** Render (or reuse) the preview of one draft; resolves to a blob URL. */
export function renderPreview(item: CampaignQueueItemProps, campaignHero: string | null = null): Promise<string> {
  const key = cacheKey(item, campaignHero);
  const cached = cache.get(key);
  if (cached) return Promise.resolve(cached);
  const pending = inflight.get(key);
  if (pending) return pending;
  const task = (async () => {
    try {
      const res = await fetch("/api/admin/campaign/email-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactId: item.contactId, subject: item.subject, body: item.body }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        throw new Error(json?.error?.message ?? `Fehler (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      remember(key, url);
      return url;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, task);
  return task;
}

/** Drop a contact's cached renders (after a regenerate or a hero change the
 * stored draft changed; the card's bumped `previewVersion` re-renders it). */
export function forgetPreviews(contactId: number): void {
  const prefix = `${contactId} `;
  for (const [key, url] of [...cache.entries()]) {
    if (key.startsWith(prefix)) {
      cache.delete(key);
      URL.revokeObjectURL(url);
    }
  }
}

export interface RenderedPreview {
  url: string | null;
  loading: boolean;
  error: string | null;
  /** Re-render now (e.g. after a failure). */
  retry: () => void;
}

/**
 * The rendered preview of the card on screen. A new card renders immediately
 * (or instantly from the cache); typing in the editor re-renders the same
 * card after a short pause; every other change of the card (hero, Set,
 * Empfehlungen, Rabatt, a regenerate) re-renders it right away. The last good
 * render stays visible while the next one loads.
 */
export function useRenderedPreview(
  item: CampaignQueueItemProps | null,
  enabled = true,
  campaignHero: string | null = null
): RenderedPreview {
  const [url, setUrl] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [attempt, setAttempt] = React.useState(0);
  const lastIdRef = React.useRef<number | null>(null);
  const lastTextRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!enabled || item === null) {
      setUrl(null);
      setLoading(false);
      setError(null);
      return;
    }
    const key = cacheKey(item, campaignHero);
    const text = `${item.subject}\n${item.body}`;
    const cached = cache.get(key);
    const sameCard = lastIdRef.current === item.contactId;
    const typing = sameCard && lastTextRef.current !== text;
    lastIdRef.current = item.contactId;
    lastTextRef.current = text;
    if (cached) {
      setUrl(cached);
      setLoading(false);
      setError(null);
      return;
    }
    if (!sameCard) setUrl(null);
    let cancelled = false;
    setLoading(true);
    setError(null);
    const handle = setTimeout(
      () => {
        renderPreview(item, campaignHero)
          .then((next) => {
            if (cancelled) return;
            setUrl(next);
            setLoading(false);
          })
          .catch((err: unknown) => {
            if (cancelled) return;
            setError(errorMessage(err, "Vorschau fehlgeschlagen"));
            setLoading(false);
          });
      },
      typing ? EDIT_DEBOUNCE_MS : 0
    );
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [enabled, item, attempt, campaignHero]);

  const retry = React.useCallback(() => setAttempt((a) => a + 1), []);
  return { url, loading, error, retry };
}

/** Warm the cache for the card the operator will most likely open next. */
export function usePrefetchPreview(
  item: CampaignQueueItemProps | null,
  enabled = true,
  campaignHero: string | null = null
): void {
  React.useEffect(() => {
    if (!enabled || item === null) return;
    if (cache.has(cacheKey(item, campaignHero))) return;
    const handle = setTimeout(() => {
      renderPreview(item, campaignHero).catch(() => {
        /* best-effort warm-up */
      });
    }, 300);
    return () => clearTimeout(handle);
  }, [enabled, item, campaignHero]);
}
