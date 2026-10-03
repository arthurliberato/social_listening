// Widget catalog: what exists, how big it starts, what plan it needs, and how its numbers are computed.
// Client-safe (no server imports) — used by the picker, the editor, and server-side validation.
import type { Entitlements } from "@/lib/entitlements/plans";

export const COLS = 12;
export const ROW_PX = 80;
export const SIZES = {
  S: { w: 3, h: 3 },
  M: { w: 6, h: 3 },
  L: { w: 6, h: 5 },
  XL: { w: 12, h: 5 },
} as const;
export type SizeKey = keyof typeof SIZES;

export const WIDGET_TYPES = [
  "kpi",
  "volume",
  "sentiment_area",
  "sentiment_donut",
  "bar",
  "share_of_voice",
  "topic_cloud",
  "top_authors",
  "top_mentions",
  "geo",
  "emotion",
  "heatmap",
] as const;
export type WidgetType = (typeof WIDGET_TYPES)[number];

export const KPI_METRICS = [
  "mentions",
  "reach",
  "net_sentiment",
  "engagement",
  "share_of_voice",
] as const;
export const BREAKDOWNS = ["source", "country", "language", "type"] as const;
export const VOLUME_METRICS = ["mentions", "reach", "engagement"] as const;

/** Per-widget options. Everything is optional; defaults come from the catalog. */
export interface WidgetConfig {
  /** Scope to one query (default: all of the workspace's queries). */
  queryId?: string;
  metric?: string;
  breakdown?: (typeof BREAKDOWNS)[number];
  topN?: number;
  style?: "line" | "area";
}

export type ConfigField = "query" | "metric" | "breakdown" | "topN" | "style";

export interface WidgetDef {
  type: WidgetType;
  label: string;
  description: string;
  size: SizeKey;
  /** Plan feature that unlocks it (null = every plan). */
  requires: keyof Entitlements["features"] | null;
  fields: ConfigField[];
  howCalculated: string;
}

export const WIDGETS: Record<WidgetType, WidgetDef> = {
  kpi: {
    type: "kpi",
    label: "KPI tile",
    description: "One headline number with change vs the previous period and a sparkline.",
    size: "S",
    requires: null,
    fields: ["query", "metric"],
    howCalculated:
      "Counts mentions in the selected period, compared with the equal-length period just before it. Likely spam is excluded. Net sentiment is (positive − negative) ÷ total.",
  },
  volume: {
    type: "volume",
    label: "Volume over time",
    description: "Mentions per day with spikes marked and explained.",
    size: "XL",
    requires: null,
    fields: ["query", "metric", "style"],
    howCalculated:
      "Daily totals for the selected queries. A spike is flagged when a day sits well above its trailing 14-day median (robust z-score) and at least 2× baseline, with a minimum volume.",
  },
  sentiment_area: {
    type: "sentiment_area",
    label: "Sentiment over time",
    description: "Daily positive, neutral, negative and mixed mentions, stacked.",
    size: "L",
    requires: null,
    fields: ["query"],
    howCalculated:
      "Daily mentions split by sentiment. Sentiment is the classifier's label, with your team's edits applied. The classifier is imperfect, so treat small shifts with care.",
  },
  sentiment_donut: {
    type: "sentiment_donut",
    label: "Sentiment split",
    description: "Share of positive, neutral, negative and mixed mentions.",
    size: "M",
    requires: null,
    fields: ["query"],
    howCalculated:
      "Share of mentions in the period by effective sentiment (classifier label, with team edits applied).",
  },
  bar: {
    type: "bar",
    label: "Top sources, countries or languages",
    description: "Where the conversation happens, ranked.",
    size: "M",
    requires: null,
    fields: ["query", "breakdown", "topN"],
    howCalculated:
      "Mentions in the period grouped by the chosen dimension, largest first. Beyond the top N the rest are grouped as “Other”.",
  },
  share_of_voice: {
    type: "share_of_voice",
    label: "Share of voice",
    description: "Your queries’ share of all mentions across the workspace.",
    size: "L",
    requires: "shareOfVoice",
    fields: [],
    howCalculated:
      "Each query’s mentions as a share of the total across all live queries in the workspace. Create one query per brand or competitor to compare them.",
  },
  topic_cloud: {
    type: "topic_cloud",
    label: "Topics",
    description: "What people talk about, sized by volume.",
    size: "M",
    requires: null,
    fields: ["query", "topN"],
    howCalculated:
      "Topic labels attached to each mention, counted over the period. Word size reflects volume; the list view shows exact counts.",
  },
  top_authors: {
    type: "top_authors",
    label: "Top authors",
    description: "Who is driving the conversation.",
    size: "L",
    requires: null,
    fields: ["query", "topN"],
    howCalculated:
      "Authors ranked by estimated reach of their mentions in the period, with their mention count and average sentiment.",
  },
  top_mentions: {
    type: "top_mentions",
    label: "Top mentions",
    description: "The posts with the biggest estimated reach.",
    size: "L",
    requires: null,
    fields: ["query", "topN"],
    howCalculated:
      "Mentions in the period ranked by estimated reach (audience × platform reach multiplier).",
  },
  geo: {
    type: "geo",
    label: "Map",
    description: "Mentions by country.",
    size: "L",
    requires: null,
    fields: ["query"],
    howCalculated:
      "Mentions in the period grouped by the author’s country. Darker means more mentions.",
  },
  emotion: {
    type: "emotion",
    label: "Emotions",
    description: "The emotions behind the mentions.",
    size: "M",
    requires: "emotionWidget",
    fields: ["query"],
    howCalculated:
      "Count of mentions by the classifier’s emotion label. Emotion detection is approximate.",
  },
  heatmap: {
    type: "heatmap",
    label: "When people post",
    description: "Mentions by weekday and hour.",
    size: "L",
    requires: null,
    fields: ["query"],
    howCalculated:
      "Mentions in the period grouped by weekday and hour (UTC). Darker means more mentions.",
  },
};

export const isWidgetType = (v: string): v is WidgetType =>
  (WIDGET_TYPES as readonly string[]).includes(v);

export const widgetAllowed = (type: WidgetType, features: Entitlements["features"]): boolean => {
  const need = WIDGETS[type].requires;
  return need === null || features[need];
};

export const METRIC_LABEL: Record<string, string> = {
  mentions: "Mentions",
  reach: "Estimated reach",
  net_sentiment: "Net sentiment",
  engagement: "Engagement",
  share_of_voice: "Share of voice",
};
