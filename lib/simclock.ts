import { workUnitAsyncStorage } from "next/dist/server/app-render/work-unit-async-storage.external";
import { HISTORY_START, WORLD_END } from "../datagen/config";
import { parseSim } from "./sim-clock-cookie";

/**
 * The simulated "now".
 *
 * - In a request (page, server action, route handler) from an agent that carries a clock in the `rw_sim` cookie,
 *   that agent's own clock. Honoured only when ALLOW_SIM_CLOCK=true, so a production deployment ignores the cookie.
 * - Otherwise the wall clock plus SIM_CLOCK_OFFSET_MS (the process-wide fast-forward, used by jobs and experiments),
 *   clamped to the corpus window.
 *
 * It is synchronous, so the request's cookies are read from Next's request store rather than `cookies()`.
 */
export function simNow(): Date {
  const agent = agentClock();
  const offset = Number(process.env.SIM_CLOCK_OFFSET_MS ?? 0);
  const t = agent ?? Date.now() + (Number.isFinite(offset) ? offset : 0);
  return new Date(Math.min(Math.max(t, HISTORY_START), WORLD_END));
}

function agentClock(): number | null {
  if (process.env.ALLOW_SIM_CLOCK !== "true") return null;
  try {
    const store = workUnitAsyncStorage.getStore();
    if (store?.type !== "request") return null;
    const clock = parseSim(store.cookies.get("rw_sim")?.value).clock;
    return clock ? Date.parse(clock) : null;
  } catch {
    return null; // outside a request, or Next changed its internals: fall back to the global clock
  }
}
