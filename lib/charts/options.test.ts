import { describe, expect, it } from "vitest";
import type { WidgetData } from "@/lib/dashboards/types";
import {
  donutOption,
  geoOption,
  heatmapOption,
  rankedBarOption,
  sentimentAreaOption,
  shareBarOption,
  volumeOption,
} from "./options";
import type { ChartTheme } from "./theme";

const theme: ChartTheme = {
  text: "#111",
  muted: "#555",
  surface: "#fff",
  border: "#ddd",
  grid: "#eee",
  axis: "#ccc",
  primary: "#46e",
  spike: "#e69f00",
  series: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"],
  sentiment: { positive: "#0072b2", neutral: "#8a94a3", negative: "#d55e00", mixed: "#cc79a7" },
  ramp: ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95", "#0d366b"],
  reducedMotion: false,
};
const volume = (
  spikes = [] as { day: string; value: number; baseline: number; multiple: number; z: number }[],
): Extract<WidgetData, { kind: "volume" }> => ({
  kind: "volume",
  metric: "mentions",
  label: "Mentions",
  total: 60,
  spikes,
  days: [
    { day: "2026-09-01", value: 10 },
    { day: "2026-09-02", value: 50 },
  ],
});
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const first = (o: any) => (Array.isArray(o.series) ? o.series[0] : o.series);

describe("mark specs", () => {
  it("draws volume as a 2px line with an 8px+ ringed marker and a 10% area wash", () => {
    const s = first(volumeOption(volume(), theme, "area"));
    expect(s.lineStyle.width).toBe(2);
    expect(s.symbolSize).toBeGreaterThanOrEqual(8);
    expect(s.itemStyle.borderColor).toBe(theme.surface);
    expect(s.itemStyle.borderWidth).toBe(2);
    expect(s.areaStyle.opacity).toBe(0.1);
    expect(first(volumeOption(volume(), theme, "line")).areaStyle).toBeUndefined();
  });
  it("uses solid hairline gridlines, never dashed", () => {
    const o = volumeOption(volume(), theme) as {
      yAxis: { splitLine: { lineStyle: { type: string; width: number } } };
    };
    expect(o.yAxis.splitLine.lineStyle).toMatchObject({ type: "solid", width: 1 });
  });
  it("marks spikes with a dashed rule and a pin, only when there are spikes", () => {
    const withSpike = first(
      volumeOption(
        volume([{ day: "2026-09-02", value: 50, baseline: 10, multiple: 5, z: 9 }]),
        theme,
      ),
    );
    expect(withSpike.markLine.data).toEqual([{ xAxis: "2026-09-02" }]);
    expect(withSpike.markPoint.data[0].coord).toEqual(["2026-09-02", 50]);
    expect(first(volumeOption(volume(), theme)).markLine).toBeUndefined();
  });
  it("stacks sentiment with the semantic colours and surface-coloured separators", () => {
    const o = sentimentAreaOption(
      {
        kind: "sentiment_area",
        total: 4,
        days: [{ day: "2026-09-01", positive: 1, neutral: 1, negative: 1, mixed: 1 }],
      },
      theme,
    ) as {
      series: {
        name: string;
        stack: string;
        areaStyle: { color: string };
        lineStyle: { color: string };
      }[];
    };
    expect(o.series.map((s) => s.name)).toEqual(["Negative", "Mixed", "Neutral", "Positive"]);
    expect(new Set(o.series.map((s) => s.stack))).toEqual(new Set(["total"]));
    expect(o.series.find((s) => s.name === "Positive")!.areaStyle.color).toBe(
      theme.sentiment.positive,
    );
    expect(o.series.every((s) => s.lineStyle.color === theme.surface)).toBe(true);
  });
  it("keeps donut segments apart with a 2px surface border and hides zero segments", () => {
    const s = first(
      donutOption(
        {
          kind: "sentiment_donut",
          total: 5,
          parts: [
            { sentiment: "positive", count: 5 },
            { sentiment: "negative", count: 0 },
          ],
        },
        theme,
      ),
    );
    expect(s.itemStyle).toMatchObject({ borderColor: theme.surface, borderWidth: 2 });
    expect(s.data).toHaveLength(1);
  });
  it("draws ranked bars thin, one colour, rounded at the data end only", () => {
    const s = first(
      rankedBarOption(
        [
          { key: "x", label: "x", count: 9 },
          { key: "reddit", label: "reddit", count: 4 },
        ],
        theme,
        "Mentions",
      ),
    );
    expect(s.barMaxWidth).toBeLessThanOrEqual(24);
    expect(s.itemStyle.borderRadius).toEqual([0, 4, 4, 0]);
    expect(s.itemStyle.color).toBe(theme.series[0]);
  });
  it("colours share-of-voice by entity, not by rank", () => {
    const rows = [
      { queryId: "b", name: "B", count: 9, share: 90 },
      { queryId: "a", name: "A", count: 1, share: 10 },
    ];
    const colorOf = (id: string) => (id === "a" ? theme.series[0]! : theme.series[1]!);
    const o = shareBarOption(rows, theme, colorOf) as {
      series: { name: string; itemStyle: { color: string; borderColor: string } }[];
    };
    expect(o.series.find((s) => s.name === "A")!.itemStyle.color).toBe(theme.series[0]);
    expect(o.series.find((s) => s.name === "B")!.itemStyle.color).toBe(theme.series[1]);
    expect(o.series.every((s) => s.itemStyle.borderColor === theme.surface)).toBe(true);
  });
  it("lays the heatmap out as 7 x 24 cells on the sequential ramp with surface gaps", () => {
    const o = heatmapOption(
      { kind: "heatmap", total: 5, max: 5, cells: [{ dow: 1, hour: 9, count: 5 }] },
      theme,
    ) as { visualMap: { inRange: { color: string[] } } };
    const s = first(o);
    expect(s.data).toHaveLength(168);
    expect(s.itemStyle.borderColor).toBe(theme.surface);
    expect(o.visualMap.inRange.color).toEqual(theme.ramp);
  });
  it("registers countries by ISO code on a map series", () => {
    const s = first(
      geoOption(
        { kind: "geo", total: 3, rows: [{ country: "US", name: "United States", count: 3 }] },
        theme,
      ),
    );
    expect(s.type).toBe("map");
    expect(s.nameProperty).toBe("iso2");
    expect(s.data[0]).toMatchObject({ name: "US", value: 3 });
  });
});

describe("tooltips treat names as untrusted", () => {
  it("escapes HTML in share-of-voice tooltips", () => {
    const evil = "<img src=x onerror=alert(1)>";
    const o = shareBarOption(
      [{ queryId: "q", name: evil, count: 1, share: 100 }],
      theme,
      () => "#000",
    ) as { tooltip: { formatter: (p: unknown) => string } };
    const html = o.tooltip.formatter({
      seriesName: evil,
      data: { count: 1 },
      value: 100,
      color: "#000",
    });
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });
  it("honours reduced motion", () => {
    expect(
      (volumeOption(volume(), { ...theme, reducedMotion: true }) as { animation: boolean })
        .animation,
    ).toBe(false);
  });
});
