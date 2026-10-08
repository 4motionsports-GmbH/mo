"use client";

// useStepLoop — drives a server-side generator to completion by POSTing
// "step" requests until the server reports `done` (Komplettanalyse,
// Verbesserungslauf, Shopify import, letters). One loop instance per run:
//
//   · a response whose body broke off is retried with a delay — up to
//     `retry.max` times in a row — and shown as "reconnecting";
//   · `resumable` steppers (server state resumable and retry-safe through a
//     step claim — Komplettanalyse, Verbesserung) also bridge a dropped
//     connection the same way, and a platform error page (502/503/504, a 5xx
//     without the route's JSON — e.g. a step killed at maxDuration) up to
//     GATEWAY_RETRY_MAX times without progress in between
//     (lib/step-loop-retry.mjs);
//   · any other non-2xx answer stops the loop with the server's message and
//     offers a manual resume;
//   · `busy` answers (another step for the same id is running server-side)
//     are polled;
//   · pause()/resume() stop after the current request and continue later;
//   · unmounting stops the loop (the server state stays resumable).

import * as React from "react";
import { AdminApiError, adminFetch, errorMessage } from "./admin-fetch";
import {
  GATEWAY_GIVE_UP_MESSAGE,
  GATEWAY_RETRY_DELAY_MS,
  GATEWAY_RETRY_MAX,
  NETWORK_GIVE_UP_MESSAGE,
  classifyStepFailure,
} from "@/lib/step-loop-retry.mjs";

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
  /**
   * The server state survives a lost or killed request and a repeated step is
   * safe (step claim): bridge dropped connections and platform errors too.
   */
  resumable?: boolean;
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
  resumable = false,
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
  const cfg = React.useRef({ path, body, onStep, isDone, isBusy, onDone, retry, resumable, pollDelayMs });
  React.useEffect(() => {
    cfg.current = { path, body, onStep, isDone, isBusy, onDone, retry, resumable, pollDelayMs };
  });

  const start = React.useCallback(() => {
    if (runningRef.current) {
      // A loop is still parked in an await (a request or a retry wait): un-pause
      // it so it carries on — returning here would let it exit with nothing
      // left running. No await sits between its `while` check and its
      // `finally`, so there is never a second loop.
      pausedRef.current = false;
      setPaused(false);
      return;
    }
    runningRef.current = true;
    pausedRef.current = false;
    setRunning(true);
    setPaused(false);
    setError(null);
    setReconnecting(false);
    void (async () => {
      let failures = 0;
      // Platform errors since the last step that made progress (a `busy` poll
      // is no progress — a step killed again and again must end the loop).
      let gatewayFailures = 0;
      try {
        while (!pausedRef.current) {
          const c = cfg.current;
          let data: T;
          try {
            data = await adminFetch<T>(c.path, { body: c.body });
          } catch (err) {
            const kind = err instanceof AdminApiError ? (c.resumable ? classifyStepFailure(err) : "fatal") : "network";
            if (kind === "fatal") {
              if (mountedRef.current) setError(errorMessage(err, "Ein Schritt ist fehlgeschlagen."));
              return;
            }
            if (kind === "gateway") {
              gatewayFailures += 1;
              if (gatewayFailures > GATEWAY_RETRY_MAX) {
                if (mountedRef.current) setError(GATEWAY_GIVE_UP_MESSAGE);
                return;
              }
              if (mountedRef.current) setReconnecting(true);
              await sleep(GATEWAY_RETRY_DELAY_MS);
              continue;
            }
            // Network hiccup — the server may still be working. Keep going,
            // mark the reconnect state and try again shortly.
            failures += 1;
            if (failures >= c.retry.max) {
              if (mountedRef.current) {
                // Resumable drivers show „Erneut versuchen“ in the error state,
                // the others a „Fortsetzen“ button.
                setError(c.resumable ? NETWORK_GIVE_UP_MESSAGE : "Verbindung dauerhaft unterbrochen — bitte „Fortsetzen“ klicken.");
              }
              return;
            }
            if (mountedRef.current) setReconnecting(true);
            await sleep(c.retry.delayMs);
            continue;
          }
          failures = 0;
          const busyNow = Boolean(c.isBusy?.(data));
          if (!busyNow) gatewayFailures = 0;
          if (!mountedRef.current) return;
          setReconnecting(false);
          c.onStep?.(data);
          if (c.isDone(data)) {
            c.onDone();
            return;
          }
          if (busyNow) await sleep(c.pollDelayMs);
        }
      } finally {
        runningRef.current = false;
        if (mountedRef.current) {
          setRunning(false);
          // Whatever ended the loop (done, error, give-up, pause during a
          // wait), it is no longer reconnecting.
          setReconnecting(false);
        }
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
