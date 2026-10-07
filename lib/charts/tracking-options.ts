// Clicks per day as bars and conversions per day as a line on a second axis (their scales differ by an order of
// magnitude, so one axis would flatten the conversions). Pure, so it is testable without a browser.
import type { EChartsOption } from "echarts";
import type { DayPoint } from "@/lib/creators/tracking-flow";
import type { ChartTheme } from "./theme";

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
const dayLabel = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

export function clicksAndConversionsOption(points: DayPoint[], t: ChartTheme): EChartsOption {
  const days = points.map((p) => p.day);
  const axis = (extra: Record<string, unknown> = {}) => ({
    type: "value" as const,
    minInterval: 1,
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { color: t.muted, fontSize: 12 },
    ...extra,
  });
  return {
    animation: !t.reducedMotion,
    textStyle: { fontFamily: "inherit", color: t.muted },
    aria: { enabled: false },
    grid: { left: 8, right: 8, top: 16, bottom: 8, containLabel: true },
    xAxis: {
      type: "category",
      data: days,
      axisLine: { lineStyle: { color: t.axis } },
      axisTick: { show: false },
      axisLabel: {
        color: t.muted,
        fontSize: 12,
        hideOverlap: true,
        formatter: (d: string) => dayLabel(d),
      },
    },
    yAxis: [
      axis({ splitLine: { lineStyle: { color: t.grid } } }),
      axis({ splitLine: { show: false } }),
    ],
    tooltip: {
      trigger: "axis",
      confine: true,
      backgroundColor: t.surface,
      borderColor: t.border,
      borderWidth: 1,
      textStyle: { color: t.text },
      formatter: (raw: unknown) => {
        const items = raw as {
          axisValue: string;
          seriesName: string;
          value: number;
          color: string;
        }[];
        return `<div style="margin-bottom:4px;color:${t.muted}">${esc(dayLabel(items[0]!.axisValue))}</div>${items
          .map(
            (i) =>
              `<div style="line-height:20px"><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${i.color};margin-right:6px"></span><strong>${i.value.toLocaleString()}</strong> ${esc(i.seriesName.toLowerCase())}</div>`,
          )
          .join("")}`;
      },
    },
    series: [
      {
        type: "bar",
        name: "Clicks",
        data: points.map((p) => p.clicks),
        barMaxWidth: 24,
        itemStyle: { color: t.series[0], borderRadius: [4, 4, 0, 0] },
      },
      {
        type: "line",
        name: "Conversions",
        yAxisIndex: 1,
        data: points.map((p) => p.conversions),
        symbol: "circle",
        symbolSize: 8,
        lineStyle: { color: t.series[1], width: 2 },
        itemStyle: { color: t.series[1], borderColor: t.surface, borderWidth: 2 },
      },
    ],
  };
}
