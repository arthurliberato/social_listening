"use client";

import { useEffect } from "react";
import { track } from "@/lib/analytics/client";

/** Fires "Experiment Exposed" once per browser session per flag, when the variant is actually on screen. */
export function ExperimentExposure({ flagKey, variant }: { flagKey: string; variant: string }) {
  useEffect(() => {
    const k = `rw_exposed_${flagKey}`;
    try {
      if (sessionStorage.getItem(k) === variant) return;
      sessionStorage.setItem(k, variant);
    } catch {
      /* storage blocked: expose anyway */
    }
    track("Experiment Exposed", { flag_key: flagKey, variant });
  }, [flagKey, variant]);
  return null;
}
