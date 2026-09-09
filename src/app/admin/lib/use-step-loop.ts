"use client";

// useStepLoop — drives a server-side generator to completion by POSTing
// "step" requests until the server reports `done` (Komplettanalyse,
// Verbesserungslauf). One loop instance per report/run:
//
//   · network failures (a dropped connection while the serverless step keeps
//     working) are retried with a delay — up to `retry.max` times in a row —
//     and shown as "reconnecting", never as a dead end;
//   · a non-2xx answer stops the loop with the server's message and offers a
//     manual resume;
//   · `busy` answers (another step for the same id is running server-side)
//     are polled;
//   · pause()/resume() stop after the current request and continue later;
//   · unmounting stops the loop (the server state stays resumable).

import * as React from "react";
import { AdminApiError, adminFetch, errorMessage } from "./admin-fetch";

export interface StepLoopOptions<T> {
  path: string;
  body: Record<string, unknown>;
  /** Called for every successful step response. */
  onStep?: (data: T) => void;
  isDone: (data: T) => boolean;
  /** Server signals another step is in flight — poll instead of stepping. */
  isBusy?: (data: T) => boolean;
  /** Called once when the server reports the terminal state. */
  onDone: () => void;
  autoStart?: boolean;
  retry?: { max: number; delayMs: number };
  pollDelayMs?: number;
}

export interface StepLoop {
  running: boolean;
  paused: boolean;
  reconnecting: boolean;
  error: string | null;
  start: () => void;
  pause: () => void;
  resume: () => void;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function useStepLoop<T>({
  path,
  body,
  onStep,
  isDone,
  isBusy,
  onDone,
  autoStart = true,
  retry = { max: 60, delayMs: 5_000 },
  pollDelayMs = 5_000,
}: StepLoopOptions<T>): StepLoop {
  const [running, setRunning] = React.useState(false);
  const [paused, setPaused] = React.useState(false);
  const [reconnecting, setReconnecting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const runningRef = React.useRef(false);
  const pausedRef = React.useRef(false);
  const mountedRef = React.useRef(true);
  // Latest callbacks/config without restarting the loop on re-render.
  const cfg = React.useRef({ path, body, onStep, isDone, isBusy, onDone, retry, pollDelayMs });
  React.useEffect(() => {
    cfg.current = { path, body, onStep, isDone, isBusy, onDone, retry, pollDelayMs };
  });

  const start = React.useCallback(() => {
    if (runningRef.current) return;
    runningRef.current = true;
    pausedRef.current = false;
    setRunning(true);
    setPaused(false);
    setError(null);
    setReconnecting(false);
    void (async () => {
      let failures = 0;
      try {
        while (!pausedRef.current) {
          const c = cfg.current;
          let data: T;
          try {
            data = await adminFetch<T>(c.path, { body: c.body });
          } catch (err) {
            if (err instanceof AdminApiError) {
              if (mountedRef.current) setError(errorMessage(err, "Ein Schritt ist fehlgeschlagen."));
              return;
            }
            // Local network hiccup — the server may still be working. Keep
            // going, mark the reconnect state and try again shortly.
            failures += 1;
            if (failures >= c.retry.max) {
              if (mountedRef.current) {
                setError("Verbindung dauerhaft unterbrochen — bitte „Fortsetzen“ klicken.");
              }
              return;
            }
            if (mountedRef.current) setReconnecting(true);
            await sleep(c.retry.delayMs);
            continue;
          }
          failures = 0;
          if (!mountedRef.current) return;
          setReconnecting(false);
          c.onStep?.(data);
          if (c.isDone(data)) {
            c.onDone();
            return;
          }
          if (c.isBusy?.(data)) await sleep(c.pollDelayMs);
        }
      } finally {
        runningRef.current = false;
        if (mountedRef.current) setRunning(false);
      }
    })();
  }, []);

  const pause = React.useCallback(() => {
    pausedRef.current = true;
    setPaused(true);
  }, []);

  const resume = React.useCallback(() => {
    setPaused(false);
    start();
  }, [start]);

  React.useEffect(() => {
    mountedRef.current = true;
    if (autoStart) start();
    return () => {
      mountedRef.current = false;
      pausedRef.current = true;
    };
  }, [autoStart, start]);

  return { running, paused, reconnecting, error, start, pause, resume };
}
