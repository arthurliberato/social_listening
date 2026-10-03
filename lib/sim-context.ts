import { cookies } from "next/headers";

export interface SimContext {
  persona: string | null;
  run: string | null;
  model: string | null;
}

/**
 * Ground-truth labels for synthetic agents, supplied by the agent harness as a cookie (`rw_sim`,
 * base64 JSON). This only labels analytics; it changes no product behaviour.
 */
export async function readSimContext(): Promise<SimContext> {
  try {
    const raw = (await cookies()).get("rw_sim")?.value;
    if (!raw) return { persona: null, run: null, model: null };
    const j = JSON.parse(Buffer.from(raw, "base64").toString("utf8")) as Partial<SimContext>;
    return { persona: j.persona ?? null, run: j.run ?? null, model: j.model ?? null };
  } catch {
    return { persona: null, run: null, model: null };
  }
}
