// Starter dashboards. Widgets are laid out with the same engine the editor uses.
import { SIZES, WIDGETS, type WidgetConfig, type WidgetType } from "./catalog";
import { firstFree, type Box } from "./layout";

export interface TemplateWidget {
  type: WidgetType;
  title: string;
  config?: WidgetConfig;
}
export interface Template {
  id: string;
  label: string;
  description: string;
  widgets: TemplateWidget[];
}

export const TEMPLATES: Template[] = [
  {
    id: "brand_health",
    label: "Brand health",
    description: "Volume, sentiment and the conversation around your brand.",
    widgets: [
      { type: "kpi", title: "Mentions", config: { metric: "mentions" } },
      { type: "kpi", title: "Estimated reach", config: { metric: "reach" } },
      { type: "kpi", title: "Net sentiment", config: { metric: "net_sentiment" } },
      { type: "kpi", title: "Engagement", config: { metric: "engagement" } },
      { type: "volume", title: "Mentions over time" },
      { type: "sentiment_area", title: "Sentiment over time" },
      { type: "sentiment_donut", title: "Sentiment split" },
      { type: "bar", title: "Top sources", config: { breakdown: "source" } },
      { type: "topic_cloud", title: "Topics" },
      { type: "top_mentions", title: "Top mentions" },
    ],
  },
  {
    id: "competitor_benchmark",
    label: "Competitor benchmark",
    description: "How your queries stack up against each other.",
    widgets: [
      { type: "share_of_voice", title: "Share of voice" },
      { type: "sentiment_donut", title: "Sentiment split" },
      { type: "volume", title: "Mentions over time" },
      { type: "bar", title: "Top countries", config: { breakdown: "country" } },
      { type: "topic_cloud", title: "Topics" },
      { type: "top_authors", title: "Top authors" },
    ],
  },
  {
    id: "campaign_tracker",
    label: "Campaign tracker",
    description: "Reach, engagement and where a campaign lands.",
    widgets: [
      { type: "kpi", title: "Mentions", config: { metric: "mentions" } },
      { type: "kpi", title: "Estimated reach", config: { metric: "reach" } },
      { type: "kpi", title: "Engagement", config: { metric: "engagement" } },
      { type: "volume", title: "Mentions over time", config: { style: "area" } },
      { type: "geo", title: "Where it is landing" },
      { type: "bar", title: "Languages", config: { breakdown: "language" } },
      { type: "top_mentions", title: "Top mentions" },
    ],
  },
  {
    id: "crisis_monitor",
    label: "Crisis monitor",
    description: "Spot spikes early and see what is driving them.",
    widgets: [
      { type: "kpi", title: "Mentions", config: { metric: "mentions" } },
      { type: "kpi", title: "Net sentiment", config: { metric: "net_sentiment" } },
      { type: "volume", title: "Mentions over time", config: { style: "line" } },
      { type: "sentiment_area", title: "Sentiment over time" },
      { type: "top_mentions", title: "Top mentions" },
      { type: "emotion", title: "Emotions" },
      { type: "top_authors", title: "Who is driving it" },
      { type: "heatmap", title: "When people post" },
    ],
  },
  {
    id: "executive_summary",
    label: "Executive summary",
    description: "The few numbers and charts leadership needs each week.",
    widgets: [
      { type: "kpi", title: "Mentions", config: { metric: "mentions" } },
      { type: "kpi", title: "Net sentiment", config: { metric: "net_sentiment" } },
      { type: "kpi", title: "Estimated reach", config: { metric: "reach" } },
      { type: "volume", title: "Mentions over time" },
      { type: "sentiment_donut", title: "Sentiment split" },
      { type: "share_of_voice", title: "Share of voice" },
      { type: "top_mentions", title: "Top mentions" },
    ],
  },
];

export const getTemplate = (id: string) => TEMPLATES.find((t) => t.id === id);

export interface PlacedWidget extends Box {
  type: WidgetType;
  title: string;
  config: WidgetConfig;
}

/** Lay widgets out row by row in the first free spot. Skips widgets the plan doesn't include. */
export function layoutTemplate(
  widgets: TemplateWidget[],
  allowed: (t: WidgetType) => boolean,
): { placed: PlacedWidget[]; skipped: WidgetType[] } {
  const placed: PlacedWidget[] = [];
  const skipped: WidgetType[] = [];
  widgets.forEach((w, i) => {
    if (!allowed(w.type)) {
      skipped.push(w.type);
      return;
    }
    const { w: width, h } = SIZES[WIDGETS[w.type].size];
    const pos = firstFree(placed, width, h);
    placed.push({
      id: `t${i}`,
      ...pos,
      w: width,
      h,
      type: w.type,
      title: w.title,
      config: w.config ?? {},
    });
  });
  return { placed, skipped };
}
