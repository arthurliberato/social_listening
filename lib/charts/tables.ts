// Every chart has a table twin: the WCAG-clean equivalent, and the source for CSV export.
import { compact } from "@/lib/format";
import type { WidgetData } from "@/lib/dashboards/types";

export interface TableModel {
  caption: string;
  columns: string[];
  rows: (string | number)[][];
  /** Right-align these columns (numbers). */
  numeric: boolean[];
}

export const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
/** Display order: Monday first. */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
const share = (n: number, total: number) =>
  total ? `${Math.round((n / total) * 1000) / 10}%` : "0%";
const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function toTable(d: WidgetData): TableModel {
  switch (d.kind) {
    case "kpi":
      return {
        caption: d.label,
        columns: ["Measure", "This period", "Previous period", "Change"],
        numeric: [false, true, true, true],
        rows: [
          [
            d.label,
            d.value,
            d.previous,
            d.deltaPct === null
              ? "—"
              : `${d.deltaPct > 0 ? "+" : ""}${d.deltaPct}${d.format === "count" ? "%" : d.format === "points" ? " pts" : " pts"}`,
          ],
        ],
      };
    case "volume":
      return {
        caption: `${d.label} per day`,
        columns: ["Day", d.label],
        numeric: [false, true],
        rows: d.days.map((p) => [p.day, p.value]),
      };
    case "sentiment_area":
      return {
        caption: "Mentions per day by sentiment",
        columns: ["Day", "Positive", "Neutral", "Negative", "Mixed"],
        numeric: [false, true, true, true, true],
        rows: d.days.map((p) => [p.day, p.positive, p.neutral, p.negative, p.mixed]),
      };
    case "sentiment_donut":
      return {
        caption: "Mentions by sentiment",
        columns: ["Sentiment", "Mentions", "Share"],
        numeric: [false, true, true],
        rows: d.parts.map((p) => [titleCase(p.sentiment), p.count, share(p.count, d.total)]),
      };
    case "bar":
      return {
        caption: `Mentions by ${d.label.toLowerCase()}`,
        columns: [d.label, "Mentions", "Share"],
        numeric: [false, true, true],
        rows: d.rows.map((r) => [r.label, r.count, share(r.count, d.total)]),
      };
    case "share_of_voice":
      return {
        caption: "Share of voice by query",
        columns: ["Query", "Mentions", "Share"],
        numeric: [false, true, true],
        rows: d.rows.map((r) => [r.name, r.count, `${r.share}%`]),
      };
    case "topic_cloud":
      return {
        caption: "Topics",
        columns: ["Topic", "Mentions"],
        numeric: [false, true],
        rows: d.rows.map((r) => [r.topic, r.count]),
      };
    case "top_authors":
      return {
        caption: "Top authors by estimated reach",
        columns: ["Author", "Source", "Mentions", "Est. reach", "Average sentiment"],
        numeric: [false, false, true, true, true],
        rows: d.rows.map((r) => [
          `${r.name} (@${r.handle})`,
          r.source,
          r.mentions,
          r.reach,
          r.avgSentiment > 0.15
            ? "Positive"
            : r.avgSentiment < -0.15
              ? "Negative"
              : "Mixed or neutral",
        ]),
      };
    case "top_mentions":
      return {
        caption: "Top mentions by estimated reach",
        columns: ["Published", "Author", "Source", "Sentiment", "Est. reach", "Mention"],
        numeric: [false, false, false, false, true, false],
        rows: d.rows.map((r) => [
          r.publishedAt.slice(0, 10),
          r.author,
          r.source,
          titleCase(r.sentiment),
          r.reach,
          r.text,
        ]),
      };
    case "geo":
      return {
        caption: "Mentions by country",
        columns: ["Country", "Mentions", "Share"],
        numeric: [false, true, true],
        rows: d.rows.map((r) => [r.name, r.count, share(r.count, d.total)]),
      };
    case "emotion":
      return {
        caption: "Mentions by emotion",
        columns: ["Emotion", "Mentions", "Share"],
        numeric: [false, true, true],
        rows: d.rows.map((r) => [titleCase(r.emotion), r.count, share(r.count, d.total)]),
      };
    case "heatmap": {
      const grid = new Map(d.cells.map((c) => [`${c.dow}:${c.hour}`, c.count]));
      return {
        caption: "Mentions by weekday and hour (UTC)",
        columns: [
          "Weekday",
          ...Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, "0")}:00`),
        ],
        numeric: [false, ...Array(24).fill(true)],
        rows: WEEK_ORDER.map((dow) => [
          WEEKDAYS[dow]!,
          ...Array.from({ length: 24 }, (_, h) => grid.get(`${dow}:${h}`) ?? 0),
        ]),
      };
    }
  }
}

/** One-sentence description for screen readers (the chart canvas itself is not navigable). */
export function summarize(d: WidgetData, period?: { days: number }): string {
  const span = period ? ` over ${period.days} days` : "";
  switch (d.kind) {
    case "kpi":
      return `${d.label}: ${compact(Math.round(d.value))}${d.format === "count" ? "" : d.format === "percent" ? "%" : " points"}${d.deltaPct === null ? "" : `, ${d.deltaPct > 0 ? "up" : d.deltaPct < 0 ? "down" : "unchanged"} ${Math.abs(d.deltaPct)}${d.format === "count" ? "%" : " points"} versus the previous period`}.`;
    case "volume": {
      const top = [...d.days].sort((a, b) => b.value - a.value)[0];
      return `${d.label} per day${span}: ${d.total.toLocaleString()} total${top ? `, peaking at ${top.value.toLocaleString()} on ${top.day}` : ""}${d.spikes.length ? `; ${d.spikes.length} spike${d.spikes.length === 1 ? "" : "s"} flagged` : ""}.`;
    }
    case "sentiment_area":
      return `Daily mentions by sentiment${span}, ${d.total.toLocaleString()} in total.`;
    case "sentiment_donut":
      return `Sentiment split of ${d.total.toLocaleString()} mentions: ${d.parts.map((p) => `${share(p.count, d.total)} ${p.sentiment}`).join(", ")}.`;
    case "bar":
      return `Mentions by ${d.label.toLowerCase()}: ${d.rows
        .slice(0, 3)
        .map((r) => `${r.label} ${r.count.toLocaleString()}`)
        .join(", ")}${d.rows.length > 3 ? " and more" : ""}.`;
    case "share_of_voice":
      return `Share of voice: ${d.rows.map((r) => `${r.name} ${r.share}%`).join(", ")}.`;
    case "topic_cloud":
      return `Top topics: ${d.rows
        .slice(0, 5)
        .map((r) => `${r.topic} ${r.count.toLocaleString()}`)
        .join(", ")}.`;
    case "top_authors":
      return `Top authors by reach: ${d.rows
        .slice(0, 3)
        .map((r) => r.name)
        .join(", ")}.`;
    case "top_mentions":
      return `Top mentions by reach, led by ${d.rows[0]?.author ?? "no one"}.`;
    case "geo":
      return `Mentions by country, led by ${d.rows[0]?.name ?? "none"}.`;
    case "emotion":
      return `Emotions: ${d.rows
        .slice(0, 3)
        .map((r) => `${r.emotion} ${share(r.count, d.total)}`)
        .join(", ")}.`;
    case "heatmap":
      return `Mentions by weekday and hour (UTC), ${d.total.toLocaleString()} in total.`;
  }
}
