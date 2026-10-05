"use client";

import { useCallback, useState } from "react";

/**
 * A busy flag for calling a server action from an event handler: `[busy, run]`, where `run(async () => {...})`
 * sets `busy` while the function runs.
 *
 * Why not `useTransition`: in a production build, awaiting a server action that revalidates the page it was
 * called from inside a transition started by our own code intermittently never finished. The server did the work
 * and the browser dropped the result, so the button stayed busy and the answer or row never appeared (about one
 * run in three in the end-to-end tests). A plain flag has no such problem. Keep `useTransition` for navigations.
 */
export function useBusy(): [boolean, (fn: () => Promise<void>) => void] {
  const [busy, setBusy] = useState(false);
  const run = useCallback((fn: () => Promise<void>) => {
    setBusy(true);
    void fn().finally(() => setBusy(false));
  }, []);
  return [busy, run];
}
