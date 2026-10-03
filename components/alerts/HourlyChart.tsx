"use client";

import { useState } from "react";
import { EChart } from "@/components/charts/EChart";
import { DataTable, Legend } from "@/components/dashboards/parts";
import { hourLabel, hourlyOption, type HourPoint } from "@/lib/charts/options";
import { useChartTheme } from "@/lib/charts/theme";

/** Hourly volume with the negative share broken out. The table twin carries the same numbers. */
export function HourlyChart({
  hours,
  marks,
  title,
  height = 220,
}: {
  hours: HourPoint[];
  marks?: { t: number }[];
  title: string;
  height?: number;
}) {
  const theme = useChartTheme();
  const [table, setTable] = useState(false);
  if (!hours.length || hours.every((h) => h.count === 0))
    return (
      <p
        className="rounded-md border border-dashed border-[var(--border)] p-6 text-center text-sm text-[var(--text-muted)]"
        data-testid="hourly-empty"
      >
        No mentions in this window yet.
      </p>
    );
  return (
    <figure className="m-0" data-testid="hourly-chart">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <figcaption className="text-sm font-medium">{title}</figcaption>
        <button
          type="button"
          onClick={() => setTable(!table)}
          aria-pressed={table}
          data-testid="hourly-table-toggle"
          className="min-h-8 rounded-md border border-[var(--border)] px-3 text-xs hover:bg-[var(--surface-2)]"
        >
          {table ? "Show chart" : "Show as table"}
        </button>
      </div>
      {table ? (
        <div style={{ maxHeight: height }}>
          <DataTable
            caption={`${title} (UTC)`}
            columns={["Hour (UTC)", "Mentions", "Negative", "Negative share"]}
            numeric={[false, true, true, true]}
            rows={hours.map((h) => [
              hourLabel(h.t),
              h.count.toLocaleString(),
              h.negative.toLocaleString(),
              h.count ? `${Math.round((h.negative / h.count) * 100)}%` : "—",
            ])}
          />
        </div>
      ) : (
        theme && (
          <>
            <EChart
              option={hourlyOption(hours, theme, marks)}
              height={height}
              label={title}
              testId="hourly-echart"
            />
            <div className="mt-2">
              <Legend
                items={[
                  { label: "Other mentions", color: theme.series[0]! },
                  { label: "Negative mentions", color: theme.sentiment.negative },
                  ...(marks?.length ? [{ label: "Alert fired", color: theme.spike }] : []),
                ]}
              />
            </div>
          </>
        )
      )}
    </figure>
  );
}
