// Alert rules: types, thresholds and the pure evaluation + backtest logic (no database access).
import { z } from "zod";

export const ALERT_TYPES = ["volume_spike", "sentiment_drop", "influencer"] as const;
export type AlertType = (typeof ALERT_TYPES)[number];
export type Severity = "info" | "warning" | "critical";

export const HOUR_MS = 3_600_000;
/** The trailing window every rule looks at, and how much history defines "normal". */
export const WINDOW_MS = HOUR_MS;
export const BASELINE_HOURS = 168;
const MIN_BASELINE_HOURS = 24;

export const TYPE_INFO: Record<
  AlertType,
  { label: string; blurb: string; feature?: "sentimentAlerts" }
> = {
  volume_spike: {
    label: "Volume spike",
    blurb: "Mentions in the last hour far exceed the usual hourly volume.",
  },
  sentiment_drop: {
    label: "Negative sentiment surge",
    blurb: "An unusually large share of the last hour's mentions are negative.",
    feature: "sentimentAlerts",
  },
  influencer: {
    label: "High-reach author",
    blurb: "A mention from an author with a large audience (estimated reach).",
  },
};

export const ParamSchemas = {
  volume_spike: z.object({
    multiple: z.number().min(1.5).max(50).default(3),
    minVolume: z.number().int().min(5).max(10_000).default(20),
  }),
  sentiment_drop: z.object({
    negativeShare: z.number().min(0.2).max(0.95).default(0.4),
    minVolume: z.number().int().min(5).max(10_000).default(15),
  }),
  influencer: z.object({
    minReach: z.number().int().min(10_000).max(100_000_000).default(100_000),
  }),
} as const;

export type Params = {
  volume_spike: z.infer<typeof ParamSchemas.volume_spike>;
  sentiment_drop: z.infer<typeof ParamSchemas.sentiment_drop>;
  influencer: z.infer<typeof ParamSchemas.influencer>;
};

export const CHANNELS = ["in_app", "email"] as const;
export const COOLDOWNS = [30, 60, 180, 720, 1440] as const;

export function parseParams<T extends AlertType>(
  type: T,
  raw: unknown,
): { ok: true; params: Params[T] } | { ok: false; error: string } {
  const r = ParamSchemas[type].safeParse(raw ?? {});
  return r.success
    ? { ok: true, params: r.data as Params[T] }
    : { ok: false, error: r.error.issues[0]?.message ?? "Invalid thresholds" };
}

/** One hour of a query's matches. */
export interface Bucket {
  /** Start of the hour (ms since epoch). */
  t: number;
  count: number;
  negative: number;
  maxReach: number;
}

/** What a rule sees: the trailing window plus the normal hours before it. */
export interface Observation {
  count: number;
  negative: number;
  maxReach: number;
  baseline: Bucket[];
}

export interface Verdict {
  fired: boolean;
  severity: Severity;
  summary: string;
  details: Record<string, number>;
}

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const pct = (x: number) => `${Math.round(x * 100)}%`;
const no: Verdict = { fired: false, severity: "info", summary: "", details: {} };

/** Whether `obs` trips a rule. Too little history means "no verdict", never a false alarm. */
export function evaluate<T extends AlertType>(
  type: T,
  params: Params[T],
  obs: Observation,
): Verdict {
  if (type === "influencer") {
    const p = params as Params["influencer"];
    if (obs.maxReach < p.minReach) return no;
    return {
      fired: true,
      severity: obs.maxReach >= p.minReach * 5 ? "warning" : "info",
      summary: `A mention reached an estimated ${obs.maxReach.toLocaleString("en-US")} people in the last hour.`,
      details: { count: obs.count, maxReach: obs.maxReach, threshold: p.minReach },
    };
  }
  if (obs.baseline.length < MIN_BASELINE_HOURS) return no;
  if (type === "volume_spike") {
    const p = params as Params["volume_spike"];
    const usual = Math.max(median(obs.baseline.map((b) => b.count)), 1);
    const ratio = obs.count / usual;
    if (obs.count < p.minVolume || ratio < p.multiple) return no;
    return {
      fired: true,
      severity: ratio >= p.multiple * 2 ? "critical" : "warning",
      summary: `${obs.count.toLocaleString("en-US")} mentions in the last hour — ${ratio.toFixed(1)}× the usual ${usual.toLocaleString("en-US")} per hour.`,
      details: { count: obs.count, negative: obs.negative, usual, multiple: ratio },
    };
  }
  const p = params as Params["sentiment_drop"];
  const baseTotal = obs.baseline.reduce((a, b) => a + b.count, 0);
  const baseNeg = obs.baseline.reduce((a, b) => a + b.negative, 0);
  const usualShare = baseTotal ? baseNeg / baseTotal : 0;
  const share = obs.count ? obs.negative / obs.count : 0;
  // Must clear the threshold AND be clearly worse than this query's normal, so a
  // permanently grumpy topic doesn't alert every hour.
  if (obs.count < p.minVolume || share < p.negativeShare || share - usualShare < 0.1) return no;
  return {
    fired: true,
    severity: share >= 0.6 ? "critical" : "warning",
    summary: `${pct(share)} of the last hour's ${obs.count.toLocaleString("en-US")} mentions are negative (usually ${pct(usualShare)}).`,
    details: { count: obs.count, negative: obs.negative, share, usualShare },
  };
}

/** Fill in hours with no mentions so "quiet" counts as zero in the baseline. */
export function denseBuckets(rows: Bucket[], fromMs: number, toMs: number): Bucket[] {
  const by = new Map(rows.map((r) => [r.t, r]));
  const out: Bucket[] = [];
  for (let t = Math.floor(fromMs / HOUR_MS) * HOUR_MS; t < toMs; t += HOUR_MS)
    out.push(by.get(t) ?? { t, count: 0, negative: 0, maxReach: 0 });
  return out;
}

export interface Backtest {
  /** Distinct episodes (consecutive firing hours count once). */
  fires: number;
  /** Hour starts of each episode's first hour, newest first (capped). */
  at: number[];
  days: number;
  /** Hours too early in the history to judge. */
  skippedHours: number;
}

/** "How often would this rule have fired?" — replayed over hourly buckets, oldest first. */
export function backtest<T extends AlertType>(
  type: T,
  params: Params[T],
  hours: Bucket[],
): Backtest {
  const at: number[] = [];
  let prev = false;
  let skipped = 0;
  for (let i = 0; i < hours.length; i++) {
    const baseline = hours.slice(Math.max(0, i - BASELINE_HOURS), i);
    if (type !== "influencer" && baseline.length < MIN_BASELINE_HOURS) {
      skipped++;
      continue;
    }
    const h = hours[i]!;
    const v = evaluate(type, params, {
      count: h.count,
      negative: h.negative,
      maxReach: h.maxReach,
      baseline,
    });
    if (v.fired && !prev) at.push(h.t);
    prev = v.fired;
  }
  return {
    fires: at.length,
    at: at.reverse().slice(0, 10),
    days: Math.round((hours.length * HOUR_MS) / 86_400_000),
    skippedHours: skipped,
  };
}

/** Plain-language threshold line for lists and emails. */
export function describeRule(type: AlertType, params: Record<string, unknown>): string {
  switch (type) {
    case "volume_spike": {
      const p = ParamSchemas.volume_spike.parse(params);
      return `≥ ${p.multiple}× usual hourly volume and at least ${p.minVolume} mentions`;
    }
    case "sentiment_drop": {
      const p = ParamSchemas.sentiment_drop.parse(params);
      return `≥ ${pct(p.negativeShare)} negative and at least ${p.minVolume} mentions`;
    }
    case "influencer": {
      const p = ParamSchemas.influencer.parse(params);
      return `Estimated reach ≥ ${p.minReach.toLocaleString("en-US")}`;
    }
  }
}
