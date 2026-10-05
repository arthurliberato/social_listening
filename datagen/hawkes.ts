// Self-exciting cascades: every post may spawn replies/reposts, with probability rising with
// author reach and decaying over generations and hours. This yields heavy-tailed engagement.
import type { Rng } from "./rng";

export interface CascadeNode {
  /** Index of the parent within the returned array, or -1 for the root. */
  parent: number;
  generation: number;
  /** Milliseconds after the root post. */
  delayMs: number;
  kind: "root" | "repost" | "comment";
  /** Follower count of the node's (pre-chosen) reach tier; caller assigns a real author. */
  followersHint: number;
}

const MAX_CASCADE = 1500;

/** Expected number of direct children for a post by an author with `followers`, in `gen`. */
export function expectedChildren(followers: number, gen: number, boost: number): number {
  if (gen === 0) return Math.min(150, 0.0035 * Math.pow(followers + 20, 0.75) * boost);
  return Math.min(
    0.9,
    0.14 * Math.pow((followers + 20) / 200, 0.3) * boost * Math.pow(0.6, gen - 1),
  );
}

export function cascade(rng: Rng, rootFollowers: number, boost = 1): CascadeNode[] {
  const nodes: CascadeNode[] = [
    { parent: -1, generation: 0, delayMs: 0, kind: "root", followersHint: rootFollowers },
  ];
  for (let i = 0; i < nodes.length && nodes.length < MAX_CASCADE; i++) {
    const n = nodes[i]!;
    if (n.generation >= 5) continue;
    const kids = rng.poisson(expectedChildren(n.followersHint, n.generation, boost));
    for (let k = 0; k < kids && nodes.length < MAX_CASCADE; k++) {
      // Mostly fast responses, with a slow tail.
      const mean = rng.bool(0.8) ? 1.5 : 14;
      const delayMs = n.delayMs + Math.round(rng.exp(mean) * 3_600_000) + 30_000;
      nodes.push({
        parent: i,
        generation: n.generation + 1,
        delayMs,
        kind: rng.bool(0.4) ? "repost" : "comment",
        followersHint: Math.round(rng.pareto(25, 0.9)),
      });
    }
  }
  return nodes;
}
