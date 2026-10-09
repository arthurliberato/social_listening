// The `rw_sim` cookie: labels and a simulated clock supplied by the agent harness (base64 JSON). Pure, so both
// the clock and the analytics code can read it.

export interface SimContext {
  persona: string | null;
  run: string | null;
  model: string | null;
  /** The agent's simulated "now" (ISO 8601). Used for its events, its rows and everything the product reads as "now" (see lib/simclock.ts). */
  clock: string | null;
}

/** Decode the `rw_sim` cookie value. Anything malformed reads as "no labels". */
export function parseSim(raw: string | undefined): SimContext {
  const none: SimContext = { persona: null, run: null, model: null, clock: null };
  if (!raw) return none;
  try {
    const j = JSON.parse(Buffer.from(raw, "base64").toString("utf8")) as Partial<SimContext>;
    const clock =
      typeof j.clock === "string" && !Number.isNaN(Date.parse(j.clock)) ? j.clock : null;
    return { persona: j.persona ?? null, run: j.run ?? null, model: j.model ?? null, clock };
  } catch {
    return none;
  }
}
