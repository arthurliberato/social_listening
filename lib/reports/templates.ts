// Starter reports. Each section is a dashboard widget rendered as a chart plus its table.
import type { ReportRange, Section } from "./types";

export interface ReportTemplate {
  id: string;
  label: string;
  description: string;
  range: ReportRange;
  sections: Omit<Section, "id">[];
}

export const REPORT_TEMPLATES: ReportTemplate[] = [
  {
    id: "weekly_brand_summary",
    label: "Weekly brand summary",
    description: "What happened this week: volume, sentiment, where and who.",
    range: "7d",
    sections: [
      { type: "kpi", title: "Mentions", config: { metric: "mentions" } },
      { type: "kpi", title: "Net sentiment", config: { metric: "net_sentiment" } },
      { type: "volume", title: "Mentions over time", config: {} },
      { type: "sentiment_donut", title: "Sentiment split", config: {} },
      { type: "bar", title: "Top sources", config: { breakdown: "source" } },
      { type: "top_mentions", title: "Top mentions", config: {} },
    ],
  },
  {
    id: "executive_overview",
    label: "Executive overview",
    description: "One page for leadership: headline numbers, trend, themes and voices.",
    range: "30d",
    sections: [
      { type: "kpi", title: "Mentions", config: { metric: "mentions" } },
      { type: "kpi", title: "Estimated reach", config: { metric: "reach" } },
      { type: "kpi", title: "Net sentiment", config: { metric: "net_sentiment" } },
      { type: "volume", title: "Mentions over time", config: {} },
      { type: "sentiment_area", title: "Sentiment over time", config: {} },
      { type: "topic_cloud", title: "Topics", config: {} },
      { type: "top_authors", title: "Top authors", config: {} },
    ],
  },
  {
    id: "competitor_brief",
    label: "Competitor brief",
    description: "Share of voice and how the conversation differs by market.",
    range: "30d",
    sections: [
      { type: "share_of_voice", title: "Share of voice", config: {} },
      { type: "sentiment_donut", title: "Sentiment split", config: {} },
      { type: "bar", title: "Top countries", config: { breakdown: "country" } },
      { type: "topic_cloud", title: "Topics", config: {} },
    ],
  },
  {
    id: "crisis_recap",
    label: "Crisis recap",
    description: "After a spike: the shape of it, the sentiment, and who drove it.",
    range: "7d",
    sections: [
      { type: "volume", title: "Mentions over time", config: {} },
      { type: "sentiment_area", title: "Sentiment over time", config: {} },
      { type: "top_mentions", title: "Top mentions", config: {} },
      { type: "top_authors", title: "Top authors", config: {} },
    ],
  },
];

export const getReportTemplate = (id: string) => REPORT_TEMPLATES.find((t) => t.id === id);
