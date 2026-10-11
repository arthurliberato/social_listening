import { cookies } from "next/headers";
import { parseSim, type SimContext } from "./sim-clock-cookie";

export { parseSim, type SimContext };

/**
 * Ground-truth labels for synthetic agents, supplied by the agent harness as a cookie (`rw_sim`,
 * base64 JSON). Labels analytics; the optional clock is honoured only when ALLOW_SIM_CLOCK=true (lib/simclock.ts).
 */
export async function readSimContext(): Promise<SimContext> {
  try {
    return parseSim((await cookies()).get("rw_sim")?.value);
  } catch {
    return parseSim(undefined); // outside a request (jobs, scripts)
  }
}
