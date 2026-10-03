import { describe, expect, it } from "vitest";
import { csvCell, toCsv } from "@/lib/csv";
import type { WidgetData } from "@/lib/dashboards/types";
import { summarize, toTable } from "./tables";

const volume: WidgetData = {
  kind: "volume",
  metric: "mentions",
  label: "Mentions",
  total: 30,
  spikes: [],
  days: [
    { day: "2026-09-01", value: 10 },
    { day: "2026-09-02", value: 20 },
  ],
};

describe("table twins", () => {
  it("renders every widget kind to a table with matching column counts", () => {
    const samples: WidgetData[] = [
      {
        kind: "kpi",
        metric: "mentions",
        label: "Mentions",
        value: 120,
        previous: 100,
        deltaPct: 20,
        format: "count",
        spark: [],
      },
      volume,
      {
        kind: "sentiment_area",
        total: 3,
        days: [{ day: "2026-09-01", positive: 1, neutral: 1, negative: 1, mixed: 0 }],
      },
      {
        kind: "sentiment_donut",
        total: 4,
        parts: [
          { sentiment: "positive", count: 1 },
          { sentiment: "negative", count: 3 },
        ],
      },
      {
        kind: "bar",
        breakdown: "source",
        label: "Source",
        total: 5,
        rows: [{ key: "x", label: "x", count: 5 }],
      },
      {
        kind: "share_of_voice",
        total: 10,
        rows: [{ queryId: "q", name: "Brand", count: 10, share: 100 }],
      },
      { kind: "topic_cloud", rows: [{ topic: "price", count: 4 }] },
      {
        kind: "top_authors",
        rows: [
          { handle: "jane", name: "Jane", source: "x", mentions: 2, reach: 900, avgSentiment: 0.5 },
        ],
      },
      {
        kind: "top_mentions",
        rows: [
          {
            id: 1,
            text: "hi",
            author: "Jane",
            source: "x",
            reach: 5,
            sentiment: "positive",
            publishedAt: "2026-09-01T00:00:00Z",
          },
        ],
      },
      { kind: "geo", total: 3, rows: [{ country: "US", name: "United States", count: 3 }] },
      { kind: "emotion", total: 2, rows: [{ emotion: "joy", count: 2 }] },
      { kind: "heatmap", total: 7, max: 7, cells: [{ dow: 1, hour: 9, count: 7 }] },
    ];
    for (const d of samples) {
      const t = toTable(d);
      expect(t.caption.length, d.kind).toBeGreaterThan(0);
      expect(t.numeric).toHaveLength(t.columns.length);
      for (const r of t.rows) expect(r, d.kind).toHaveLength(t.columns.length);
      expect(summarize(d, { days: 30 }).length, d.kind).toBeGreaterThan(10);
    }
  });
  it("lays the heatmap out Monday-first with zeros for empty cells", () => {
    const t = toTable({
      kind: "heatmap",
      total: 7,
      max: 7,
      cells: [
        { dow: 1, hour: 9, count: 7 },
        { dow: 0, hour: 0, count: 2 },
      ],
    });
    expect(t.rows.map((r) => r[0])).toEqual([
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
      "Sunday",
    ]);
    expect(t.rows[0]![1 + 9]).toBe(7);
    expect(t.rows[6]![1]).toBe(2);
    expect(t.rows[2]!.slice(1).every((v) => v === 0)).toBe(true);
  });
  it("describes charts in words for screen readers", () => {
    expect(summarize(volume, { days: 2 })).toContain("peaking at 20 on 2026-09-02");
  });
});

describe("csv", () => {
  it("escapes quotes and neutralises formula injection", () => {
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("=HYPERLINK(1)")).toBe(`"'=HYPERLINK(1)"`);
    expect(csvCell("-2+3")).toBe(`"'-2+3"`);
    expect(csvCell(null)).toBe('""');
    expect(toCsv(["a", "b"], [[1, "x"]])).toBe('"a","b"\n"1","x"\n');
  });
});
