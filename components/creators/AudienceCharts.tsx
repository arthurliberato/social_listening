"use client";

import type { EChartsOption } from "echarts";
import { useState } from "react";
import { EChart } from "@/components/charts/EChart";
import { DataTable } from "@/components/dashboards/parts";
import type { ChartTheme } from "@/lib/charts/theme";
import { useChartTheme } from "@/lib/charts/theme";

export interface Slice {
  label: string;
  value: number;
}

function barOption(rows: Slice[], t: ChartTheme, title: string): EChartsOption {
  return {
    animation: !t.reducedMotion,
    grid: { left: 8, right: 44, top: 8, bottom: 8, containLabel: true },
    tooltip: {
      trigger: "item",
      backgroundColor: t.surface,
      borderColor: t.border,
      textStyle: { color: t.text },
      formatter: (p: unknown) => {
        const d = p as { name: string; value: number };
        return `${d.name.replace(/[<>&]/g, "")}: <strong>${d.value}%</strong> of audience`;
      },
    },
    xAxis: {
      type: "value",
      max: 100,
      axisLabel: { color: t.muted, formatter: "{value}%" },
      splitLine: { lineStyle: { color: t.grid } },
    },
    yAxis: {
      type: "category",
      inverse: true,
      data: rows.map((r) => r.label),
      axisLine: { lineStyle: { color: t.axis } },
      axisLabel: { color: t.text },
      axisTick: { show: false },
    },
    aria: { enabled: true, label: { description: title } },
    series: [
      {
        type: "bar",
        data: rows.map((r) => r.value),
        barMaxWidth: 18,
        itemStyle: { color: t.series[0], borderRadius: [0, 4, 4, 0] },
        label: { show: true, position: "right", color: t.text, formatter: "{c}%" },
      },
    ],
  };
}

/** A share-of-audience bar chart with a table twin carrying the same numbers. */
export function AudienceBar({
  title,
  rows,
  testId,
}: {
  title: string;
  rows: Slice[];
  testId: string;
}) {
  const theme = useChartTheme();
  const [table, setTable] = useState(false);
  return (
    <figure
      className="m-0 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4"
      data-testid={testId}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <figcaption className="text-sm font-medium">{title}</figcaption>
        <button
          type="button"
          aria-pressed={table}
          onClick={() => setTable(!table)}
          className="min-h-8 rounded-md border border-[var(--border)] px-3 text-xs hover:bg-[var(--surface-2)]"
          data-testid={`${testId}-toggle`}
        >
          {table ? "Show chart" : "Show as table"}
        </button>
      </div>
      {table ? (
        <DataTable
          caption={title}
          columns={["Group", "Share of audience"]}
          numeric={[false, true]}
          rows={rows.map((r) => [r.label, `${r.value}%`])}
        />
      ) : theme ? (
        <EChart
          option={barOption(rows, theme, title)}
          height={34 * rows.length + 30}
          label={title}
        />
      ) : (
        <div className="h-32 animate-pulse rounded bg-[var(--surface-2)] motion-reduce:animate-none" />
      )}
    </figure>
  );
}
