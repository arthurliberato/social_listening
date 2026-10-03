// Drill-down: every widget element links to the Mentions feed filtered to exactly the mentions it counts.
import type { WidgetConfig, WidgetType } from "./catalog";

export interface Pick {
  key?: string;
  day?: string;
}

/** Query string for /w/:ws/mentions, carrying the dashboard's date range and the widget's query scope. */
export function drillParams(
  type: WidgetType,
  cfg: WidgetConfig,
  dash: URLSearchParams,
  pick: Pick = {},
  breakdown?: string,
): URLSearchParams {
  const p = new URLSearchParams();
  for (const k of ["range", "from", "to"]) if (dash.get(k)) p.set(k, dash.get(k)!);
  if (cfg.queryId) p.set("q", cfg.queryId);
  const key = pick.key;
  switch (type) {
    case "volume":
    case "sentiment_area":
      if (pick.day) {
        p.set("range", "custom");
        p.set("from", pick.day);
        p.set("to", pick.day);
      }
      break;
    case "sentiment_donut":
      if (key) p.set("sentiment", key);
      break;
    case "bar":
      if (key && key !== "other")
        p.set(
          { source: "source", country: "country", language: "lang", type: "type" }[
            breakdown ?? cfg.breakdown ?? "source"
          ]!,
          key,
        );
      break;
    case "share_of_voice":
      if (key) p.set("q", key);
      break;
    case "topic_cloud":
      if (key) p.set("topic", key);
      break;
    case "top_authors":
      if (key) p.set("author", key);
      break;
    case "top_mentions":
      if (key) p.set("m", key);
      break;
    case "geo":
      if (key) p.set("country", key);
      break;
    case "emotion":
      if (key) p.set("emotion", key);
      break;
    case "heatmap":
      if (key) {
        const [dow, hour] = key.split(":");
        p.set("dow", dow!);
        p.set("hour", hour!);
      }
      break;
    case "kpi":
      break;
  }
  return p;
}

export const drillHref = (ws: string, ...a: Parameters<typeof drillParams>) => {
  const qs = drillParams(...a).toString();
  return `/w/${ws}/mentions${qs ? `?${qs}` : ""}`;
};
