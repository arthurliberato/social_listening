// The model behind the AI features, behind one small interface so a real provider can be swapped in.
// Ripplewise ships a SIMULATED provider: deterministic and extractive (it only restates what is in the
// evidence it is handed), and every answer is labelled as such. No network, no API key.
export interface Evidence {
  /** 1-based; the number an answer uses to cite it, like "[2]". */
  n: number;
  mentionId: number;
  text: string;
  author: string;
  source: string;
  publishedAt: string;
  sentiment: string;
  reach: number;
  topics: string[];
}

export interface Stats {
  total: number;
  negativeShare: number;
  topTopics: string[];
}

export interface AnswerRequest {
  kind: "ask" | "summary" | "peak";
  prompt: string;
  /** Plain-words description of what was searched, e.g. "the last 14 days of 3 queries". */
  scope: string;
  evidence: Evidence[];
  stats: Stats;
}

export interface AiProvider {
  readonly id: string;
  answer(req: AnswerRequest): Promise<string>;
}

const excerpt = (t: string, n = 140) => {
  const s = t.replace(/\s+/g, " ").trim();
  return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;
};
const pct = (x: number) => `${Math.round(x * 100)}%`;
const list = (xs: string[]) =>
  xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;

export const SIMULATED_NOTICE =
  "Simulated AI: this answer is assembled directly from the mentions cited below, not written by a language model.";

export const simulatedProvider: AiProvider = {
  id: "simulated",
  async answer({ kind, scope, evidence, stats }) {
    const lead =
      kind === "peak"
        ? `The busiest stretch (${scope}) had ${stats.total.toLocaleString("en-US")} mentions, ${pct(stats.negativeShare)} of them negative.`
        : kind === "summary"
          ? `Summary of ${scope}: ${stats.total.toLocaleString("en-US")} mentions, ${pct(stats.negativeShare)} negative.`
          : `Across ${stats.total.toLocaleString("en-US")} mentions in ${scope}, ${pct(stats.negativeShare)} were negative.`;
    const themes = stats.topTopics.length
      ? ` The most frequent themes were ${list(stats.topTopics)}.`
      : "";
    const lines = evidence
      .slice(0, 5)
      .map((e) => `- ${e.author} on ${e.source} (${e.sentiment}): “${excerpt(e.text)}” [${e.n}]`);
    return `${lead}${themes}\n\nWhat people are saying:\n${lines.join("\n")}`;
  },
};

/** Which provider is configured. Only the simulated one exists today. */
export function getProvider(): AiProvider {
  return simulatedProvider;
}
