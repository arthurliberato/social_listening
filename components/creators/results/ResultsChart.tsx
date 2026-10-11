"use client";

import { useState } from "react";
import { EChart } from "@/components/charts/EChart";
import { DataTable, Legend } from "@/components/dashboards/parts";
import { clicksAndConversionsOption } from "@/lib/charts/tracking-options";
import { useChartTheme } from "@/lib/charts/theme";
import type { DayPoint } from "@/lib/creators/tracking-flow";

/** Daily clicks and conversions, with the same numbers available as a table. */
export function ResultsChart({ points }: { points: DayPoint[] }) {
  const theme = useChartTheme();
  const [table, setTable] = useState(false);
  return (
    <figure
      className="m-0 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4"
      data-testid="results-chart"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <figcaption className="text-sm font-medium">
          Clicks and conversions, last {points.length} days (UTC)
        </figcaption>
        <button
          type="button"
          aria-pressed={table}
          onClick={() => setTable(!table)}
          className="min-h-8 rounded-md border border-[var(--border)] px-3 text-xs hover:bg-[var(--surface-2)]"
          data-testid="results-chart-toggle"
        >
          {table ? "Show chart" : "Show as table"}
        </button>
      </div>
      {table ? (
        <div style={{ maxHeight: 260 }}>
          <DataTable
            caption="Clicks and conversions per day"
            columns={["Day (UTC)", "Clicks", "Conversions"]}
            numeric={[false, true, true]}
            rows={[...points]
              .reverse()
              .map((p) => [p.day, p.clicks.toLocaleString(), p.conversions.toLocaleString()])}
          />
        </div>
      ) : theme ? (
        <>
          <EChart
            option={clicksAndConversionsOption(points, theme)}
            height={240}
            label="Clicks and conversions per day"
          />
          <div className="mt-2">
            <Legend
              items={[
                { label: "Clicks (left axis)", color: theme.series[0]! },
                { label: "Conversions (right axis)", color: theme.series[1]! },
              ]}
            />
          </div>
        </>
      ) : (
        <div className="h-60 animate-pulse rounded bg-[var(--surface-2)] motion-reduce:animate-none" />
      )}
    </figure>
  );
}
