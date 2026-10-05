// Deliberately imperfect "classifier": ~70% agreement with ground truth, worse on sarcasm and
// non-English, with errors biased toward neutral (mirrors common review complaints).
import type { Lang } from "./config";
import type { Rng } from "./rng";

export type Sentiment = "positive" | "neutral" | "negative" | "mixed";
export const SENTIMENTS: Sentiment[] = ["positive", "neutral", "negative", "mixed"];

export function predictSentiment(
  rng: Rng,
  truth: Sentiment,
  opts: { lang: Lang; sarcastic: boolean; spam: boolean },
): { pred: Sentiment; conf: number } {
  let pAgree = opts.lang === "en" ? 0.76 : 0.62;
  if (truth === "mixed") pAgree -= 0.2;
  if (truth === "neutral") pAgree += 0.06;
  if (opts.sarcastic) pAgree = 0.2;
  if (opts.spam) pAgree = 0.5;
  if (rng.bool(pAgree)) return { pred: truth, conf: rng.range(0.55, 0.97) };

  let pred: Sentiment;
  if (truth === "neutral") pred = rng.bool(0.5) ? "positive" : "negative";
  else if (opts.sarcastic) pred = rng.bool(0.7) ? "positive" : "neutral";
  else
    pred = rng.bool(0.7)
      ? "neutral"
      : truth === "mixed"
        ? rng.bool(0.5)
          ? "positive"
          : "negative"
        : truth === "positive"
          ? "negative"
          : "positive";
  return { pred, conf: rng.range(0.4, 0.8) };
}

const EMOTIONS: Record<Sentiment, [string, number][]> = {
  positive: [
    ["joy", 6],
    ["love", 3],
    ["surprise", 1],
  ],
  negative: [
    ["anger", 5],
    ["sadness", 2],
    ["disgust", 2],
    ["fear", 1],
  ],
  neutral: [
    ["neutral", 8],
    ["surprise", 1],
  ],
  mixed: [
    ["surprise", 3],
    ["sadness", 2],
    ["joy", 2],
    ["anger", 2],
  ],
};

export function predictEmotion(rng: Rng, sentiment: Sentiment): string {
  const e = EMOTIONS[sentiment];
  return e[rng.weighted(e.map((x) => x[1]))]![0];
}
