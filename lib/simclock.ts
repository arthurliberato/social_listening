import { HISTORY_START, WORLD_END } from "@/datagen/config";

/**
 * The simulated "now". Defaults to the wall clock clamped to the corpus window; set
 * SIM_CLOCK_OFFSET_MS to fast-forward (renewals, trial ends) in experiments.
 */
export function simNow(): Date {
  const offset = Number(process.env.SIM_CLOCK_OFFSET_MS ?? 0);
  const t = Date.now() + (Number.isFinite(offset) ? offset : 0);
  return new Date(Math.min(Math.max(t, HISTORY_START), WORLD_END));
}
