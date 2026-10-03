// Story planning: launches, campaigns, news, memes, seasonal windows and (≥1 per brand per
// calendar quarter) crises. Stories drive volume spikes, sentiment shifts and seeded high-reach
// posts (trigger -> influencer pickup -> news pickup).
import { DAY_MS, HOUR_MS, VERTICALS, type BrandDef } from "./config";
import type { Sentiment } from "./noise";
import { rngFor, type Rng } from "./rng";

export type StoryType = "launch" | "campaign" | "crisis" | "news" | "meme" | "seasonal";

export interface SeededPost {
  tMs: number;
  kind: "trigger" | "influencer" | "news";
  sentiment: Sentiment;
  boost: number;
}

export interface Story {
  id: number;
  brandIdx: number;
  type: StoryType;
  startMs: number;
  peakMs: number;
  /** Volume half-life after the peak, in hours. */
  volHlHours: number;
  /** Sentiment-drift half-life after the peak, in hours (lingers longer than volume). */
  sentHlHours: number;
  /** Peak daily volume as a multiple of the brand's baseline. */
  peakMult: number;
  /** Target share of the story's dominant sentiment at peak. */
  sentTarget: { sentiment: Sentiment; share: number } | null;
  seeds: SeededPost[];
  keywords: string[];
  /** Seasonal stories only shift baseline volume; they emit no crowd posts. */
  crowdless: boolean;
  endMs: number;
}

const Q_STARTS = [0, 3, 6, 9];

function quarters(startMs: number, endMs: number): [number, number][] {
  const out: [number, number][] = [];
  const s = new Date(startMs);
  let y = s.getUTCFullYear();
  let q = Math.floor(s.getUTCMonth() / 3);
  for (;;) {
    const qs = Date.UTC(y, Q_STARTS[q]!, 1);
    if (qs >= endMs) break;
    const qe = Date.UTC(q === 3 ? y + 1 : y, Q_STARTS[(q + 1) % 4]!, 1);
    out.push([Math.max(qs, startMs), Math.min(qe, endMs)]);
    if (++q === 4) {
      q = 0;
      y++;
    }
  }
  return out;
}

function loguniform(rng: Rng, a: number, b: number): number {
  return Math.exp(rng.range(Math.log(a), Math.log(b)));
}

function seedsFor(rng: Rng, type: StoryType, t0: number, endMs: number): SeededPost[] {
  const seeds: SeededPost[] = [];
  const add = (p: SeededPost) => p.tMs < endMs && seeds.push(p);
  if (type === "crisis") {
    add({ tMs: t0, kind: "trigger", sentiment: "negative", boost: 3 });
    const inf = 2 + rng.int(4);
    for (let i = 0; i < inf; i++)
      add({
        tMs: t0 + Math.round(rng.range(1, 8) * HOUR_MS),
        kind: "influencer",
        sentiment: rng.bool(0.8) ? "negative" : "mixed",
        boost: 2,
      });
    const news = 3 + rng.int(13);
    for (let i = 0; i < news; i++)
      add({
        tMs: t0 + Math.round(rng.range(4, 40) * HOUR_MS),
        kind: "news",
        sentiment: rng.bool(0.6) ? "negative" : "neutral",
        boost: 1.5,
      });
  } else if (type === "launch" || type === "campaign") {
    const inf = 3 + rng.int(6);
    for (let i = 0; i < inf; i++)
      add({
        tMs: t0 + Math.round(rng.range(0, 36) * HOUR_MS),
        kind: "influencer",
        sentiment: rng.bool(0.8) ? "positive" : "neutral",
        boost: 1.8,
      });
    const news = 1 + rng.int(4);
    for (let i = 0; i < news; i++)
      add({
        tMs: t0 + Math.round(rng.range(0, 24) * HOUR_MS),
        kind: "news",
        sentiment: "neutral",
        boost: 1.2,
      });
  } else if (type === "news") {
    const news = 1 + rng.int(6);
    for (let i = 0; i < news; i++)
      add({
        tMs: t0 - Math.round(rng.range(2, 12) * HOUR_MS),
        kind: "news",
        sentiment: rng.pick(["neutral", "positive", "negative"] as Sentiment[]),
        boost: 1.2,
      });
  } else if (type === "meme") {
    add({ tMs: t0, kind: "trigger", sentiment: "positive", boost: 2 });
  }
  return seeds;
}

export function planStories(
  seed: number,
  brandIdx: number,
  brand: BrandDef,
  startMs: number,
  endMs: number,
): Story[] {
  const rng = rngFor(seed, "stories", brandIdx);
  const nouns = VERTICALS[brand.vertical].nouns;
  const stories: Story[] = [];
  let n = 0;
  const push = (s: Omit<Story, "id" | "brandIdx" | "endMs" | "keywords">) => {
    const endMsStory = s.peakMs + s.volHlHours * HOUR_MS * 8;
    stories.push({
      ...s,
      id: (brandIdx + 1) * 1000 + ++n,
      brandIdx,
      endMs: endMsStory,
      keywords: [rng.pick(nouns), brand.short.toLowerCase()],
    });
  };

  // Crises: at least one per brand per calendar quarter.
  for (const [qs, qe] of quarters(startMs, endMs)) {
    const lo = qs + 3 * DAY_MS;
    const hi = qe - 14 * DAY_MS;
    if (hi <= lo) continue;
    const t0 = lo + Math.floor(rng.float() * ((hi - lo) / HOUR_MS)) * HOUR_MS;
    const decayDays = rng.range(3, 10);
    push({
      type: "crisis",
      startMs: t0,
      peakMs: t0 + Math.round(rng.range(10, 30) * HOUR_MS),
      volHlHours: decayDays * 24 * 0.25,
      sentHlHours: decayDays * 24,
      peakMult: loguniform(rng, 10, 50),
      sentTarget: { sentiment: "negative", share: rng.range(0.5, 0.7) },
      seeds: seedsFor(rng, "crisis", t0, endMs),
      crowdless: false,
    });
  }

  const years = (endMs - startMs) / (365 * DAY_MS);
  const scatter = (
    type: StoryType,
    perYear: number,
    mk: (
      t0: number,
    ) => Omit<
      Story,
      "id" | "brandIdx" | "endMs" | "keywords" | "type" | "seeds" | "crowdless" | "startMs"
    >,
    lagH = 0,
  ) => {
    const count = rng.poisson(perYear * years);
    for (let i = 0; i < count; i++) {
      const t0 =
        startMs +
        2 * DAY_MS +
        Math.floor(rng.float() * ((endMs - startMs - 12 * DAY_MS) / HOUR_MS)) * HOUR_MS;
      const body = mk(t0 + lagH * HOUR_MS);
      push({
        type,
        startMs: t0 + (type === "news" ? Math.round(rng.range(2, 12) * HOUR_MS) : 0),
        seeds: seedsFor(rng, type, t0, endMs),
        crowdless: false,
        ...body,
      });
    }
  };
  scatter("launch", 3, (t0) => ({
    peakMs: t0 + Math.round(rng.range(12, 48) * HOUR_MS),
    volHlHours: rng.range(1, 3) * 24 * 0.5,
    sentHlHours: rng.range(2, 5) * 24,
    peakMult: rng.range(2, 6),
    sentTarget: { sentiment: "positive", share: rng.range(0.5, 0.6) },
  }));
  scatter("campaign", 3, (t0) => ({
    peakMs: t0 + Math.round(rng.range(24, 72) * HOUR_MS),
    volHlHours: rng.range(2, 6) * 24 * 0.5,
    sentHlHours: rng.range(3, 7) * 24,
    peakMult: rng.range(1.5, 4),
    sentTarget: { sentiment: "positive", share: rng.range(0.42, 0.55) },
  }));
  scatter(
    "news",
    5,
    (t0) => ({
      peakMs: t0 + Math.round(rng.range(6, 18) * HOUR_MS),
      volHlHours: rng.range(0.7, 2) * 24 * 0.5,
      sentHlHours: 36,
      peakMult: rng.range(1.5, 5),
      sentTarget: null,
    }),
    0,
  );
  scatter("meme", 1.5, (t0) => ({
    peakMs: t0 + Math.round(rng.range(6, 24) * HOUR_MS),
    volHlHours: rng.range(0.5, 1.5) * 24 * 0.5,
    sentHlHours: 24,
    peakMult: rng.range(2, 8),
    sentTarget: { sentiment: "positive", share: 0.4 },
  }));

  // Seasonal windows: baseline multipliers (crowdless) repeated each year.
  for (const [month, d0, d1, mult, label] of VERTICALS[brand.vertical].seasonal) {
    for (let y = new Date(startMs).getUTCFullYear(); y <= new Date(endMs).getUTCFullYear(); y++) {
      const s = Date.UTC(y, month - 1, d0);
      const e = Date.UTC(y, month - 1, d1) + DAY_MS;
      if (e < startMs || s > endMs) continue;
      stories.push({
        id: (brandIdx + 1) * 1000 + ++n,
        brandIdx,
        type: "seasonal",
        startMs: s,
        peakMs: (s + e) / 2,
        volHlHours: 0,
        sentHlHours: 0,
        peakMult: mult,
        sentTarget: null,
        seeds: [],
        keywords: [label],
        crowdless: true,
        endMs: e,
      });
    }
  }
  return stories.sort((a, b) => a.startMs - b.startMs);
}

/** Volume intensity relative to peak, in [0, 1]. */
export function intensity(s: Story, t: number): number {
  if (s.crowdless || t < s.startMs) return 0;
  if (t <= s.peakMs) return Math.pow((t - s.startMs) / Math.max(1, s.peakMs - s.startMs), 1.5);
  return Math.pow(0.5, (t - s.peakMs) / (s.volHlHours * HOUR_MS));
}

/** Share of the story's target sentiment at time t (ramps up, then lingers with sentHl). */
export function sentimentGauge(s: Story, t: number): number {
  if (t < s.startMs) return 0;
  if (t <= s.peakMs) return (t - s.startMs) / Math.max(1, s.peakMs - s.startMs);
  return Math.pow(0.5, (t - s.peakMs) / (s.sentHlHours * HOUR_MS));
}
