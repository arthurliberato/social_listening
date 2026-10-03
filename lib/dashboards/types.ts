// Shapes returned by the widget data loader. Client-safe: charts and table views consume these.
import type { Spike } from "@/lib/analytics/spikes";

export interface Period {
  from: string;
  to: string;
  days: number;
}
export interface DayPoint {
  day: string;
  value: number;
}
export interface SentimentDay {
  day: string;
  positive: number;
  neutral: number;
  negative: number;
  mixed: number;
}

export type WidgetData =
  | {
      kind: "kpi";
      metric: string;
      label: string;
      value: number;
      previous: number;
      deltaPct: number | null;
      format: "count" | "percent" | "points";
      spark: number[];
    }
  | {
      kind: "volume";
      metric: string;
      label: string;
      days: DayPoint[];
      total: number;
      spikes: Spike[];
    }
  | { kind: "sentiment_area"; days: SentimentDay[]; total: number }
  | { kind: "sentiment_donut"; total: number; parts: { sentiment: string; count: number }[] }
  | {
      kind: "bar";
      breakdown: string;
      label: string;
      total: number;
      rows: { key: string; label: string; count: number }[];
    }
  | {
      kind: "share_of_voice";
      total: number;
      rows: { queryId: string; name: string; count: number; share: number }[];
    }
  | { kind: "topic_cloud"; rows: { topic: string; count: number }[] }
  | {
      kind: "top_authors";
      rows: {
        handle: string;
        name: string;
        source: string;
        mentions: number;
        reach: number;
        avgSentiment: number;
      }[];
    }
  | {
      kind: "top_mentions";
      rows: {
        id: number;
        text: string;
        author: string;
        source: string;
        reach: number;
        sentiment: string;
        publishedAt: string;
      }[];
    }
  | { kind: "geo"; total: number; rows: { country: string; name: string; count: number }[] }
  | { kind: "emotion"; total: number; rows: { emotion: string; count: number }[] }
  | {
      kind: "heatmap";
      total: number;
      max: number;
      cells: { dow: number; hour: number; count: number }[];
    };

export interface WidgetPayload {
  data: WidgetData;
  period: Period;
  /** Names of the queries this widget is scoped to, for the subtitle. */
  scope: string[];
}

export type WidgetResult =
  | { ok: true; payload: WidgetPayload }
  | { ok: false; error: string; code: "plan" | "not_found" | "failed"; requires?: string };

export const COUNTRY_NAMES: Record<string, string> = {
  US: "United States",
  GB: "United Kingdom",
  CA: "Canada",
  AU: "Australia",
  IN: "India",
  BR: "Brazil",
  PT: "Portugal",
  MX: "Mexico",
  ES: "Spain",
  AR: "Argentina",
  FR: "France",
  DE: "Germany",
  IT: "Italy",
};
