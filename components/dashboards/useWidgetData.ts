"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { WidgetPayload, WidgetResult } from "@/lib/dashboards/types";

export type WidgetState =
  | { status: "loading"; previous?: WidgetPayload }
  | { status: "ready"; payload: WidgetPayload }
  | { status: "error"; error: string; code: "plan" | "not_found" | "failed"; requires?: string };

const cache = new Map<string, { at: number; result: WidgetResult }>();
const TTL_MS = 60_000;

/**
 * Loads one widget independently, so a slow or failing widget never blocks the rest of the page.
 * While refetching it keeps showing the previous render (no skeleton flash, no layout jump).
 */
export function useWidgetData(
  key: string,
  fetcher: () => Promise<WidgetResult>,
): { state: WidgetState; reload: () => void } {
  const [state, setState] = useState<WidgetState>(() => {
    const hit = cache.get(key);
    return hit && Date.now() - hit.at < TTL_MS && hit.result.ok
      ? { status: "ready", payload: hit.result.payload }
      : { status: "loading" };
  });
  const [nonce, setNonce] = useState(0);
  const latest = useRef(fetcher);
  latest.current = fetcher;

  useEffect(() => {
    let live = true;
    const hit = cache.get(key);
    if (nonce === 0 && hit && Date.now() - hit.at < TTL_MS) {
      setState(
        hit.result.ok
          ? { status: "ready", payload: hit.result.payload }
          : {
              status: "error",
              error: hit.result.error,
              code: hit.result.code,
              requires: hit.result.requires,
            },
      );
      return;
    }
    setState((s) => ({
      status: "loading",
      previous: s.status === "ready" ? s.payload : s.status === "loading" ? s.previous : undefined,
    }));
    latest
      .current()
      .then((result) => {
        if (!live) return;
        if (result.ok) cache.set(key, { at: Date.now(), result });
        setState(
          result.ok
            ? { status: "ready", payload: result.payload }
            : {
                status: "error",
                error: result.error,
                code: result.code,
                requires: result.requires,
              },
        );
      })
      .catch(
        () =>
          live &&
          setState({ status: "error", error: "We couldn't load this widget.", code: "failed" }),
      );
    return () => {
      live = false;
    };
  }, [key, nonce]);

  const reload = useCallback(() => {
    cache.delete(key);
    setNonce((n) => n + 1);
  }, [key]);
  return { state, reload };
}
