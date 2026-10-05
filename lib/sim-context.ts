import { cookies } from "next/headers";

export interface SimContext {
  persona: string | null;
  run: string | null;
  model: string | null;
  /** The agent's simulated "now" (ISO 8601). Stamps its analytics events; product logic keeps the global sim clock. */
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

/**
 * Ground-truth labels for synthetic agents, supplied by the agent harness as a cookie (`rw_sim`,
 * base64 JSON). This only labels analytics; it changes no product behaviour.
 */
export async function readSimContext(): Promise<SimContext> {
  try {
    return parseSim((await cookies()).get("rw_sim")?.value);
  } catch {
    return parseSim(undefined); // outside a request (jobs, scripts)
  }
}
