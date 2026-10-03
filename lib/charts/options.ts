// ECharts option builders. Pure functions of (data, theme): no DOM access, so they are unit-testable.
// Mark specs: 2px lines, >=8px markers with a surface ring, 4px rounded data-ends on bars, 2px surface gaps
// between touching fills, solid hairline gridlines, one tooltip listing every series at the hovered x.
import type { EChartsOption } from "echarts";
import { compact } from "@/lib/format";
import type { WidgetData } from "@/lib/dashboards/types";
import type { ChartTheme } from "./theme";
import { WEEK_ORDER, WEEKDAYS } from "./tables";

type Of<K extends WidgetData["kind"]> = Extract<WidgetData, { kind: K }>;
const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
const dayLabel = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
const dayLong = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

/** Series names are untrusted (they can come from query names), so they are escaped before entering tooltip HTML. */
const keyRow = (t: ChartTheme, color: string, label: string, value: string) =>
  `<div style="display:flex;align-items:center;gap:8px;line-height:20px"><span style="display:inline-block;width:12px;height:2px;border-radius:1px;background:${color}"></span><strong style="color:${t.text}">${esc(value)}</strong><span style="color:${t.muted}">${esc(label)}</span></div>`;

const tooltipBase = (t: ChartTheme) => ({
  backgroundColor: t.surface,
  borderColor: t.border,
  borderWidth: 1,
  padding: [8, 10],
  confine: true,
  textStyle: { color: t.text, fontSize: 12 },
  extraCssText: "box-shadow:0 4px 12px rgba(0,0,0,.12);border-radius:8px;",
});

const base = (
  t: ChartTheme,
): Pick<EChartsOption, "animation" | "animationDuration" | "textStyle" | "aria"> => ({
  animation: !t.reducedMotion,
  animationDuration: 400,
  textStyle: { fontFamily: "inherit", color: t.muted },
  aria: { enabled: false },
});

const valueAxis = (t: ChartTheme, extra: Record<string, unknown> = {}) => ({
  type: "value" as const,
  axisLine: { show: false },
  axisTick: { show: false },
  axisLabel: { color: t.muted, fontSize: 12, formatter: (n: number) => compact(n) },
  splitLine: { lineStyle: { color: t.grid, width: 1, type: "solid" as const } },
  ...extra,
});

const dayAxis = (t: ChartTheme, days: string[]) => ({
  type: "category" as const,
  data: days,
  boundaryGap: false,
  axisLine: { lineStyle: { color: t.axis, width: 1 } },
  axisTick: { show: false },
  axisLabel: { color: t.muted, fontSize: 12, hideOverlap: true, formatter: dayLabel },
});

// ---- volume over time ------------------------------------------------------------------------
export function volumeOption(
  d: Of<"volume">,
  t: ChartTheme,
  style: "line" | "area" = "area",
): EChartsOption {
  const days = d.days.map((p) => p.day);
  const color = t.series[0]!;
  const valueOf = new Map(d.days.map((p) => [p.day, p.value]));
  const spikeDays = d.spikes.map((s) => s.day);
  return {
    ...base(t),
    grid: { left: 8, right: 16, top: 24, bottom: 8, containLabel: true },
    xAxis: dayAxis(t, days),
    yAxis: valueAxis(t),
    tooltip: {
      ...tooltipBase(t),
      trigger: "axis",
      axisPointer: { type: "line", lineStyle: { color: t.axis, width: 1 } },
      formatter: (raw: unknown) => {
        const day = (
          Array.isArray(raw) ? (raw[0] as { axisValue: string }).axisValue : ""
        ) as string;
        const spike = d.spikes.find((s) => s.day === day);
        return `<div style="margin-bottom:4px;color:${t.muted}">${esc(dayLong(day))}</div>${keyRow(t, color, d.label, (valueOf.get(day) ?? 0).toLocaleString())}${spike ? `<div style="margin-top:4px;color:${t.text}">⚡ ${spike.multiple.toFixed(1)}× the usual (${Math.round(spike.baseline).toLocaleString()}/day)</div>` : ""}`;
      },
    },
    series: [
      {
        type: "line",
        name: d.label,
        data: d.days.map((p) => p.value),
        smooth: false,
        lineStyle: { width: 2, color, cap: "round", join: "round" },
        itemStyle: { color, borderColor: t.surface, borderWidth: 2 },
        symbol: "circle",
        symbolSize: 8,
        showSymbol: false,
        areaStyle: style === "area" ? { color, opacity: 0.1 } : undefined,
        emphasis: { focus: "series" },
        markLine: spikeDays.length
          ? {
              silent: true,
              symbol: "none",
              label: { show: false },
              lineStyle: { color: t.spike, width: 1, type: "dashed" },
              data: spikeDays.map((x) => ({ xAxis: x })),
            }
          : undefined,
        markPoint: spikeDays.length
          ? {
              symbol: "circle",
              symbolSize: 18,
              itemStyle: { color: t.spike, borderColor: t.surface, borderWidth: 2 },
              label: { show: true, formatter: "⚡", color: "#111827", fontSize: 10 },
              data: d.spikes.map((s) => ({ name: s.day, coord: [s.day, s.value] })),
            }
          : undefined,
      },
    ],
  };
}

// ---- sentiment over time (stacked) -----------------------------------------------------------
const SENT_ORDER = ["negative", "mixed", "neutral", "positive"] as const;
export function sentimentAreaOption(d: Of<"sentiment_area">, t: ChartTheme): EChartsOption {
  const days = d.days.map((p) => p.day);
  return {
    ...base(t),
    grid: { left: 8, right: 16, top: 16, bottom: 8, containLabel: true },
    xAxis: dayAxis(t, days),
    yAxis: valueAxis(t),
    tooltip: {
      ...tooltipBase(t),
      trigger: "axis",
      axisPointer: { type: "line", lineStyle: { color: t.axis, width: 1 } },
      formatter: (raw: unknown) => {
        const items = raw as {
          axisValue: string;
          seriesName: string;
          value: number;
          color: string;
        }[];
        return `<div style="margin-bottom:4px;color:${t.muted}">${esc(dayLong(items[0]!.axisValue))}</div>${[
          ...items,
        ]
          .reverse()
          .map((i) => keyRow(t, i.color, i.seriesName, i.value.toLocaleString()))
          .join("")}`;
      },
    },
    series: SENT_ORDER.map((s) => ({
      type: "line" as const,
      name: s[0]!.toUpperCase() + s.slice(1),
      stack: "total",
      data: d.days.map((p) => p[s]),
      symbol: "none",
      smooth: false,
      lineStyle: { width: 1, color: t.surface },
      areaStyle: { color: t.sentiment[s], opacity: 1 },
      itemStyle: { color: t.sentiment[s] },
      emphasis: { focus: "series" as const },
    })),
  };
}

// ---- sentiment donut -------------------------------------------------------------------------
export function donutOption(d: Of<"sentiment_donut">, t: ChartTheme): EChartsOption {
  return {
    ...base(t),
    tooltip: {
      ...tooltipBase(t),
      trigger: "item",
      formatter: (p: unknown) => {
        const i = p as { name: string; value: number; percent: number; color: string };
        return keyRow(t, i.color, i.name, `${i.value.toLocaleString()} (${i.percent}%)`);
      },
    },
    graphic: [
      {
        type: "text",
        left: "center",
        top: "42%",
        style: {
          text: compact(d.total),
          fill: t.text,
          font: "600 26px system-ui, sans-serif",
          textAlign: "center",
        },
      },
      {
        type: "text",
        left: "center",
        top: "56%",
        style: {
          text: "mentions",
          fill: t.muted,
          font: "12px system-ui, sans-serif",
          textAlign: "center",
        },
      },
    ] as never,
    series: [
      {
        type: "pie",
        radius: ["58%", "82%"],
        avoidLabelOverlap: true,
        label: { show: false },
        labelLine: { show: false },
        itemStyle: { borderColor: t.surface, borderWidth: 2 },
        emphasis: { scaleSize: 4 },
        data: d.parts
          .filter((p) => p.count > 0)
          .map((p) => ({
            name: p.sentiment[0]!.toUpperCase() + p.sentiment.slice(1),
            value: p.count,
            key: p.sentiment,
            itemStyle: { color: t.sentiment[p.sentiment as keyof ChartTheme["sentiment"]] },
          })),
      },
    ],
  };
}

// ---- ranked horizontal bars (sources / countries / languages / emotions) ----------------------
export function rankedBarOption(
  rows: { key: string; label: string; count: number }[],
  t: ChartTheme,
  seriesName: string,
): EChartsOption {
  const color = t.series[0]!; // one series, one colour: bars are not recoloured by value
  return {
    ...base(t),
    grid: { left: 8, right: 56, top: 8, bottom: 8, containLabel: true },
    xAxis: valueAxis(t, { show: false, splitLine: { show: false } }),
    yAxis: {
      type: "category",
      inverse: true,
      data: rows.map((r) => r.label),
      axisLine: { lineStyle: { color: t.axis } },
      axisTick: { show: false },
      axisLabel: { color: t.muted, fontSize: 12, width: 120, overflow: "truncate" },
    },
    tooltip: {
      ...tooltipBase(t),
      trigger: "item",
      axisPointer: { type: "none" },
      formatter: (p: unknown) => {
        const i = p as { name: string; value: number };
        return keyRow(t, color, i.name || seriesName, i.value.toLocaleString());
      },
    },
    series: [
      {
        type: "bar",
        name: seriesName,
        barMaxWidth: 20,
        itemStyle: { color, borderRadius: [0, 4, 4, 0] },
        label: {
          show: true,
          position: "right",
          color: t.text,
          fontSize: 12,
          formatter: (p: { value?: unknown }) => compact(Number(p.value)),
        },
        emphasis: { itemStyle: { color, opacity: 0.8 } },
        data: rows.map((r) => ({ value: r.count, key: r.key })),
      },
    ],
  };
}

// ---- share of voice (one 100% stacked bar; colour follows the query, not its rank) ------------
export function shareBarOption(
  rows: Of<"share_of_voice">["rows"],
  t: ChartTheme,
  colorOf: (queryId: string) => string,
): EChartsOption {
  return {
    ...base(t),
    grid: { left: 0, right: 0, top: 4, bottom: 4 },
    xAxis: { type: "value", max: 100, show: false },
    yAxis: { type: "category", data: ["Share"], show: false },
    tooltip: {
      ...tooltipBase(t),
      trigger: "item",
      formatter: (p: unknown) => {
        const i = p as {
          seriesName: string;
          data: { count: number };
          value: number;
          color: string;
        };
        return keyRow(
          t,
          i.color,
          i.seriesName,
          `${i.value}% · ${i.data.count.toLocaleString()} mentions`,
        );
      },
    },
    series: rows.map((r) => ({
      type: "bar" as const,
      name: r.name,
      stack: "sov",
      barWidth: 24,
      data: [{ value: r.share, count: r.count, key: r.queryId }],
      itemStyle: { color: colorOf(r.queryId), borderColor: t.surface, borderWidth: 1 },
      emphasis: { itemStyle: { opacity: 0.85 } },
    })),
  };
}

// ---- heatmap: weekday x hour -------------------------------------------------------------------
export function heatmapOption(d: Of<"heatmap">, t: ChartTheme): EChartsOption {
  const grid = new Map(d.cells.map((c) => [`${c.dow}:${c.hour}`, c.count]));
  const data = WEEK_ORDER.flatMap((dow, row) =>
    Array.from({ length: 24 }, (_, h) => ({
      value: [h, row, grid.get(`${dow}:${h}`) ?? 0],
      key: `${dow}:${h}`,
    })),
  );
  return {
    ...base(t),
    grid: { left: 8, right: 8, top: 8, bottom: 24, containLabel: true },
    xAxis: {
      type: "category",
      data: Array.from({ length: 24 }, (_, h) => String(h).padStart(2, "0")),
      splitArea: { show: false },
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: t.muted, fontSize: 11, interval: 2 },
    },
    yAxis: {
      type: "category",
      inverse: true,
      data: WEEK_ORDER.map((dow) => WEEKDAYS[dow]!.slice(0, 3)),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: t.muted, fontSize: 12 },
    },
    visualMap: { show: false, min: 0, max: Math.max(1, d.max), inRange: { color: t.ramp } },
    tooltip: {
      ...tooltipBase(t),
      trigger: "item",
      formatter: (p: unknown) => {
        const i = p as { value: number[] };
        return keyRow(
          t,
          t.series[0]!,
          `${WEEKDAYS[WEEK_ORDER[i.value[1]!]!]} ${String(i.value[0]).padStart(2, "0")}:00 UTC`,
          `${i.value[2]!.toLocaleString()} mentions`,
        );
      },
    },
    series: [
      {
        type: "heatmap",
        data,
        itemStyle: { borderColor: t.surface, borderWidth: 2, borderRadius: 2 },
        emphasis: { itemStyle: { borderColor: t.text, borderWidth: 1 } },
      },
    ],
  };
}

// ---- world map ---------------------------------------------------------------------------------
export function geoOption(d: Of<"geo">, t: ChartTheme): EChartsOption {
  const max = d.rows.reduce((m, r) => Math.max(m, r.count), 1);
  return {
    ...base(t),
    visualMap: { show: false, min: 0, max, inRange: { color: t.ramp.slice(1) } },
    tooltip: {
      ...tooltipBase(t),
      trigger: "item",
      formatter: (p: unknown) => {
        const i = p as { name: string; value?: number };
        const row = d.rows.find((r) => r.country === i.name);
        return row
          ? keyRow(t, t.series[0]!, row.name, `${row.count.toLocaleString()} mentions`)
          : `<span style="color:${t.muted}">No mentions</span>`;
      },
    },
    series: [
      {
        type: "map",
        map: "world",
        nameProperty: "iso2",
        roam: false,
        layoutCenter: ["50%", "55%"],
        layoutSize: "118%",
        itemStyle: { areaColor: t.grid, borderColor: t.surface, borderWidth: 0.6 },
        emphasis: { label: { show: false }, itemStyle: { borderColor: t.text, borderWidth: 1 } },
        select: { disabled: true },
        data: d.rows.map((r) => ({ name: r.country, value: r.count, key: r.country })),
      },
    ],
  };
}

// ---- hourly volume, split into negative and other (alerts and crisis rooms) -------------------
export interface HourPoint {
  t: number;
  count: number;
  negative: number;
}
export const hourLabel = (t: number) =>
  new Date(t).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    hour12: false,
    timeZone: "UTC",
  }) + ":00";

export function hourlyOption(
  hours: HourPoint[],
  t: ChartTheme,
  marks: { t: number }[] = [],
): EChartsOption {
  const labels = hours.map((h) => hourLabel(h.t));
  const other = t.series[0]!;
  const neg = t.sentiment.negative;
  const markLine = marks.length
    ? {
        silent: true,
        symbol: "none",
        label: { show: false },
        lineStyle: { color: t.spike, width: 1.5, type: "dashed" as const },
        data: marks
          .map((m) => hours.findIndex((h) => h.t === Math.floor(m.t / 3_600_000) * 3_600_000))
          .filter((i) => i >= 0)
          .map((i) => ({ xAxis: labels[i]! })),
      }
    : undefined;
  return {
    ...base(t),
    grid: { left: 8, right: 16, top: 16, bottom: 8, containLabel: true },
    xAxis: {
      type: "category",
      data: labels,
      axisLine: { lineStyle: { color: t.axis, width: 1 } },
      axisTick: { show: false },
      axisLabel: { color: t.muted, fontSize: 12, hideOverlap: true },
    },
    yAxis: valueAxis(t),
    tooltip: {
      ...tooltipBase(t),
      trigger: "axis",
      axisPointer: { type: "shadow", shadowStyle: { color: t.grid, opacity: 0.4 } },
      formatter: (raw: unknown) => {
        const items = raw as {
          axisValue: string;
          seriesName: string;
          value: number;
          color: string;
        }[];
        return `<div style="margin-bottom:4px;color:${t.muted}">${esc(items[0]!.axisValue)} UTC</div>${[
          ...items,
        ]
          .reverse()
          .map((i) => keyRow(t, i.color, i.seriesName, i.value.toLocaleString()))
          .join("")}`;
      },
    },
    series: [
      {
        type: "bar",
        name: "Other mentions",
        stack: "hour",
        data: hours.map((h) => h.count - h.negative),
        itemStyle: { color: other, borderColor: t.surface, borderWidth: 1 },
        barMaxWidth: 28,
        emphasis: { focus: "series" },
      },
      {
        type: "bar",
        name: "Negative mentions",
        stack: "hour",
        data: hours.map((h) => h.negative),
        itemStyle: {
          color: neg,
          borderColor: t.surface,
          borderWidth: 1,
          borderRadius: [4, 4, 0, 0],
        },
        barMaxWidth: 28,
        emphasis: { focus: "series" },
        markLine,
      },
    ],
  };
}
