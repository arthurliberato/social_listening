"use client";

import { useEffect, useMemo, useState } from "react";
import { SentimentPill } from "@/components/listening/SentimentPill";
import { EChart, type PickEvent } from "@/components/charts/EChart";
import { ensureWorldMap } from "@/components/charts/worldMap";
import { compact, relativeTime } from "@/lib/format";
import {
  donutOption,
  geoOption,
  heatmapOption,
  rankedBarOption,
  sentimentAreaOption,
  shareBarOption,
  volumeOption,
} from "@/lib/charts/options";
import { summarize, toTable } from "@/lib/charts/tables";
import { useChartTheme, type ChartTheme } from "@/lib/charts/theme";
import type { WidgetConfig, WidgetType } from "@/lib/dashboards/catalog";
import type { Pick } from "@/lib/dashboards/drill";
import type { WidgetData, WidgetPayload } from "@/lib/dashboards/types";
import { DataTable, Legend } from "./parts";

export function isEmpty(d: WidgetData): boolean {
  switch (d.kind) {
    case "kpi":
      return d.value === 0 && d.previous === 0;
    case "volume":
    case "sentiment_area":
    case "sentiment_donut":
    case "bar":
    case "geo":
    case "emotion":
    case "heatmap":
      return d.total === 0;
    case "share_of_voice":
      return d.total === 0;
    case "topic_cloud":
    case "top_authors":
    case "top_mentions":
      return d.rows.length === 0;
  }
}

const fmtValue = (d: Extract<WidgetData, { kind: "kpi" }>) => {
  if (d.format === "percent") return `${d.value}%`;
  if (d.format === "points") return `${d.value > 0 ? "+" : ""}${d.value}`;
  return d.value >= 10_000 ? compact(Math.round(d.value)) : Math.round(d.value).toLocaleString();
};

function Spark({ values, theme }: { values: number[]; theme: ChartTheme }) {
  if (values.length < 2) return null;
  const lo = Math.min(...values),
    hi = Math.max(...values),
    span = hi - lo || 1;
  const pts = values.map(
    (v, i) => [(i / (values.length - 1)) * 100, 28 - ((v - lo) / span) * 24] as const,
  );
  return (
    <svg
      viewBox="0 0 100 32"
      preserveAspectRatio="none"
      className="h-8 w-full"
      aria-hidden
      data-testid="sparkline"
    >
      <polyline
        points={pts.map((p) => p.join(",")).join(" ")}
        fill="none"
        stroke={theme.axis}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle
        cx={pts.at(-1)![0]}
        cy={pts.at(-1)![1]}
        r={3.5}
        fill={theme.series[0]}
        stroke={theme.surface}
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function Kpi({
  d,
  days,
  theme,
}: {
  d: Extract<WidgetData, { kind: "kpi" }>;
  days: number;
  theme: ChartTheme;
}) {
  const up = (d.deltaPct ?? 0) > 0,
    down = (d.deltaPct ?? 0) < 0;
  const unit = d.format === "count" ? "%" : " pts";
  return (
    <div className="flex h-full flex-col justify-between" data-testid="kpi">
      <div>
        <p className="text-sm text-[var(--text-muted)]">{d.label}</p>
        {/* Proportional figures: tabular-nums makes big standalone numbers look loose. */}
        <p
          className="mt-1 text-[36px] font-semibold leading-[44px] text-[var(--text)]"
          data-testid="kpi-value"
        >
          {fmtValue(d)}
        </p>
        {d.deltaPct !== null && (
          <p
            className={`text-sm ${up ? "text-[var(--success)]" : down ? "text-[var(--danger)]" : "text-[var(--text-muted)]"}`}
            data-testid="kpi-delta"
          >
            <span aria-hidden>{up ? "▲" : down ? "▼" : "–"}</span>{" "}
            <span className="sr-only">{up ? "Up" : down ? "Down" : "Unchanged"} </span>
            {Math.abs(d.deltaPct)}
            {unit} <span className="text-[var(--text-muted)]">vs previous {days} days</span>
          </p>
        )}
      </div>
      <Spark values={d.spark} theme={theme} />
    </div>
  );
}

function TopicCloud({
  d,
  onDrill,
}: {
  d: Extract<WidgetData, { kind: "topic_cloud" }>;
  onDrill: (p: Pick) => void;
}) {
  const max = Math.max(...d.rows.map((r) => r.count), 1),
    min = Math.min(...d.rows.map((r) => r.count), 0);
  return (
    <ul
      className="flex h-full flex-wrap content-start items-baseline gap-x-4 gap-y-1 overflow-auto"
      aria-label="Topics"
      data-testid="topic-cloud"
    >
      {d.rows.map((r) => {
        const size = 13 + ((r.count - min) / Math.max(1, max - min)) * 17;
        return (
          <li key={r.topic}>
            <button
              type="button"
              onClick={() => onDrill({ key: r.topic })}
              style={{ fontSize: size }}
              title={`${r.count.toLocaleString()} mentions`}
              className={`rounded px-1 leading-tight hover:underline ${r.count === max ? "font-semibold text-[var(--text)]" : "text-[var(--text-muted)]"}`}
            >
              {r.topic}
              <span className="sr-only"> ({r.count.toLocaleString()} mentions)</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

const sentimentOf = (v: number) => (v > 0.15 ? "positive" : v < -0.15 ? "negative" : "neutral");

export function WidgetBody({
  type,
  config,
  payload,
  view,
  height,
  onDrill,
}: {
  type: WidgetType;
  config: WidgetConfig;
  payload: WidgetPayload;
  view: "chart" | "table";
  height: number;
  onDrill: (pick: Pick, breakdown?: string) => void;
}) {
  const theme = useChartTheme();
  const d = payload.data;
  const [mapReady, setMapReady] = useState(false);
  useEffect(() => {
    if (type === "geo") void ensureWorldMap().then(() => setMapReady(true));
  }, [type]);

  const table = useMemo(() => toTable(d), [d]);
  const sovColor = useMemo(() => {
    if (d.kind !== "share_of_voice" || !theme) return () => "#000";
    const ids = [...d.rows.map((r) => r.queryId)].sort(); // stable per entity, independent of rank
    return (id: string) => theme.series[ids.indexOf(id) % theme.series.length]!;
  }, [d, theme]);

  if (view === "table") {
    const drillRow =
      d.kind === "top_authors"
        ? (i: number) => onDrill({ key: d.rows[i]!.handle })
        : d.kind === "top_mentions"
          ? (i: number) => onDrill({ key: String(d.rows[i]!.id) })
          : undefined;
    return (
      <DataTable
        caption={table.caption}
        columns={table.columns}
        rows={table.rows}
        numeric={table.numeric}
        onRow={drillRow}
      />
    );
  }
  if (!theme) return <div className="h-full" aria-hidden />;
  const desc = summarize(d, payload.period);
  const chartH = Math.max(80, height);

  switch (d.kind) {
    case "kpi":
      return <Kpi d={d} days={payload.period.days} theme={theme} />;
    case "volume":
      return (
        <EChart
          option={volumeOption(d, theme, config.style ?? "area")}
          height={chartH}
          label={desc}
          testId="chart-volume"
          onAxisPick={(i) => d.days[i] && onDrill({ day: d.days[i]!.day })}
          onPick={(e) => {
            const day = (e as unknown as { name?: string }).name;
            if (day && /^\d{4}-/.test(day)) onDrill({ day });
          }}
        />
      );
    case "sentiment_area":
      return (
        <div className="flex h-full flex-col gap-2">
          <Legend
            items={(["positive", "neutral", "negative", "mixed"] as const).map((s) => ({
              label: s[0]!.toUpperCase() + s.slice(1),
              color: theme.sentiment[s],
            }))}
          />
          <EChart
            option={sentimentAreaOption(d, theme)}
            height={Math.max(80, chartH - 28)}
            label={desc}
            testId="chart-sentiment-area"
            onAxisPick={(i) => d.days[i] && onDrill({ day: d.days[i]!.day })}
          />
        </div>
      );
    case "sentiment_donut":
      return (
        <div className="flex h-full flex-col gap-2 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <EChart
              option={donutOption(d, theme)}
              height={Math.max(120, chartH)}
              label={desc}
              testId="chart-donut"
              onPick={(e) => e.data?.key && onDrill({ key: e.data.key })}
            />
          </div>
          <Legend
            items={d.parts.map((p) => ({
              label: p.sentiment[0]!.toUpperCase() + p.sentiment.slice(1),
              color: theme.sentiment[p.sentiment as keyof ChartTheme["sentiment"]],
              value: `${p.count.toLocaleString()} · ${d.total ? Math.round((p.count / d.total) * 100) : 0}%`,
            }))}
          />
        </div>
      );
    case "bar":
      return (
        <EChart
          option={rankedBarOption(d.rows, theme, "Mentions")}
          height={chartH}
          label={desc}
          testId="chart-bar"
          onPick={(e: PickEvent) => e.data?.key && onDrill({ key: e.data.key }, d.breakdown)}
        />
      );
    case "emotion":
      return (
        <EChart
          option={rankedBarOption(
            d.rows.map((r) => ({ key: r.emotion, label: r.emotion, count: r.count })),
            theme,
            "Mentions",
          )}
          height={chartH}
          label={desc}
          testId="chart-emotion"
          onPick={(e: PickEvent) => e.data?.key && onDrill({ key: e.data.key })}
        />
      );
    case "share_of_voice":
      return (
        <div className="flex h-full flex-col gap-3 overflow-auto">
          <Legend
            items={d.rows.map((r) => ({
              label: r.name,
              color: sovColor(r.queryId),
              value: `${r.share}%`,
            }))}
          />
          <EChart
            option={shareBarOption(d.rows, theme, sovColor)}
            height={40}
            label={desc}
            testId="chart-sov"
            onPick={(e: PickEvent) => e.data?.key && onDrill({ key: e.data.key })}
          />
          <DataTable
            caption={table.caption}
            columns={table.columns}
            rows={table.rows}
            numeric={table.numeric}
            onRow={(i) => onDrill({ key: d.rows[i]!.queryId })}
          />
        </div>
      );
    case "heatmap":
      return (
        <div className="flex h-full flex-col gap-1">
          <EChart
            option={heatmapOption(d, theme)}
            height={Math.max(100, chartH - 22)}
            label={desc}
            testId="chart-heatmap"
            onPick={(e: PickEvent) => e.data?.key && onDrill({ key: e.data.key })}
          />
          <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]" aria-hidden>
            <span>Fewer</span>
            <span
              className="h-2 w-32 rounded-full"
              style={{ background: `linear-gradient(90deg, ${theme.ramp.join(",")})` }}
            />
            <span>More</span>
          </div>
        </div>
      );
    case "geo":
      return mapReady ? (
        <div className="flex h-full flex-col gap-1">
          <EChart
            option={geoOption(d, theme)}
            height={Math.max(100, chartH - 22)}
            label={desc}
            testId="chart-geo"
            onPick={(e: PickEvent) => e.data?.key && onDrill({ key: e.data.key })}
          />
          <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]" aria-hidden>
            <span>Fewer</span>
            <span
              className="h-2 w-32 rounded-full"
              style={{ background: `linear-gradient(90deg, ${theme.ramp.slice(1).join(",")})` }}
            />
            <span>More</span>
          </div>
        </div>
      ) : (
        <p role="status" className="text-sm text-[var(--text-muted)]">
          Loading map…
        </p>
      );
    case "topic_cloud":
      return <TopicCloud d={d} onDrill={onDrill} />;
    case "top_authors":
      return (
        <div className="h-full overflow-auto">
          <table className="w-full text-left text-xs" data-testid="authors-table">
            <caption className="sr-only">Top authors by estimated reach</caption>
            <thead className="text-[var(--text-muted)]">
              <tr>
                <th scope="col" className="py-1 pr-2 font-medium">
                  Author
                </th>
                <th scope="col" className="px-2 text-right font-medium">
                  Mentions
                </th>
                <th scope="col" className="px-2 text-right font-medium">
                  Est. reach
                </th>
                <th scope="col" className="pl-2 font-medium">
                  Sentiment
                </th>
              </tr>
            </thead>
            <tbody>
              {d.rows.map((r) => (
                <tr key={r.handle + r.source} className="border-t border-[var(--border)]">
                  <th scope="row" className="py-1.5 pr-2 text-left font-normal">
                    <button
                      type="button"
                      onClick={() => onDrill({ key: r.handle })}
                      className="text-left hover:underline"
                    >
                      <span className="font-medium">{r.name}</span>{" "}
                      <span className="text-[var(--text-muted)]">
                        @{r.handle} · {r.source}
                      </span>
                    </button>
                  </th>
                  <td className="px-2 text-right tabular-nums">{r.mentions.toLocaleString()}</td>
                  <td className="px-2 text-right tabular-nums">{compact(r.reach)}</td>
                  <td className="pl-2">
                    <SentimentPill sentiment={sentimentOf(r.avgSentiment)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "top_mentions":
      return (
        <ul
          className="flex h-full flex-col gap-2 overflow-auto"
          aria-label="Top mentions"
          data-testid="top-mentions"
        >
          {d.rows.map((r) => (
            <li key={r.id} className="rounded-md border border-[var(--border)] p-2">
              <button
                type="button"
                onClick={() => onDrill({ key: String(r.id) })}
                className="block w-full text-left"
              >
                <span className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
                  <span className="font-medium text-[var(--text)]">{r.author}</span>
                  <span>{r.source}</span>
                  <span>{relativeTime(r.publishedAt)}</span>
                  <span className="tabular-nums">Est. reach {compact(r.reach)}</span>
                </span>
                <span className="mt-1 line-clamp-2 block text-sm">{r.text}</span>
              </button>
              <div className="mt-1">
                <SentimentPill sentiment={r.sentiment} />
              </div>
            </li>
          ))}
        </ul>
      );
  }
}
