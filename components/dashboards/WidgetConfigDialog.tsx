"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import {
  BREAKDOWNS,
  KPI_METRICS,
  METRIC_LABEL,
  VOLUME_METRICS,
  WIDGETS,
  type WidgetConfig,
} from "@/lib/dashboards/catalog";
import type { DraftWidget } from "./DashboardGrid";

const sel = "min-h-9 rounded border border-[var(--border)] bg-[var(--surface)] px-2 font-normal";

export function WidgetConfigDialog({
  widget,
  queries,
  features,
  onApply,
  onClose,
}: {
  widget: DraftWidget | null;
  queries: { id: string; name: string }[];
  features: { shareOfVoice: boolean };
  onApply: (id: string, patch: { title: string; config: WidgetConfig }) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [title, setTitle] = useState("");
  const [cfg, setCfg] = useState<WidgetConfig>({});
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (widget && !el.open) {
      setTitle(widget.title);
      setCfg(widget.config);
      el.showModal();
    }
    if (!widget && el.open) el.close();
  }, [widget]);
  const def = widget ? WIDGETS[widget.type] : null;
  const has = (f: string) => def?.fields.includes(f as never);
  const metrics =
    widget?.type === "kpi"
      ? KPI_METRICS.filter((m) => m !== "share_of_voice" || features.shareOfVoice)
      : VOLUME_METRICS;

  return (
    <dialog
      ref={ref}
      aria-labelledby="wc-title"
      onClose={onClose}
      data-testid="widget-config"
      className="m-auto w-full max-w-md rounded-[var(--radius-modal)] border border-[var(--border)] bg-[var(--surface)] p-6 text-[var(--text)] backdrop:bg-black/40"
    >
      <h2 id="wc-title" className="text-lg font-semibold">
        Widget settings
      </h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (widget && title.trim()) onApply(widget.id, { title: title.trim(), config: cfg });
        }}
        className="mt-3 flex flex-col gap-4"
      >
        <Field
          label="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={80}
          required
          data-testid="cfg-title"
        />
        {has("query") && (
          <label className="flex flex-col gap-1 text-sm font-medium">
            Query
            <select
              className={sel}
              value={cfg.queryId ?? ""}
              onChange={(e) => setCfg({ ...cfg, queryId: e.target.value || undefined })}
              data-testid="cfg-query"
            >
              <option value="">All queries</option>
              {queries.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {has("metric") && (
          <label className="flex flex-col gap-1 text-sm font-medium">
            Measure
            <select
              className={sel}
              value={cfg.metric ?? "mentions"}
              onChange={(e) => setCfg({ ...cfg, metric: e.target.value })}
              data-testid="cfg-metric"
            >
              {metrics.map((m) => (
                <option key={m} value={m}>
                  {METRIC_LABEL[m]}
                </option>
              ))}
            </select>
          </label>
        )}
        {has("breakdown") && (
          <label className="flex flex-col gap-1 text-sm font-medium">
            Break down by
            <select
              className={sel}
              value={cfg.breakdown ?? "source"}
              onChange={(e) =>
                setCfg({ ...cfg, breakdown: e.target.value as WidgetConfig["breakdown"] })
              }
              data-testid="cfg-breakdown"
            >
              {BREAKDOWNS.map((b) => (
                <option key={b} value={b}>
                  {
                    {
                      source: "Source",
                      country: "Country",
                      language: "Language",
                      type: "Content type",
                    }[b]
                  }
                </option>
              ))}
            </select>
          </label>
        )}
        {has("topN") && (
          <label className="flex flex-col gap-1 text-sm font-medium">
            How many to show
            <input
              type="number"
              min={3}
              max={20}
              className={sel}
              value={cfg.topN ?? 8}
              onChange={(e) =>
                setCfg({ ...cfg, topN: Math.max(3, Math.min(20, Number(e.target.value) || 8)) })
              }
              data-testid="cfg-topn"
            />
          </label>
        )}
        {has("style") && (
          <label className="flex flex-col gap-1 text-sm font-medium">
            Chart style
            <select
              className={sel}
              value={cfg.style ?? "area"}
              onChange={(e) => setCfg({ ...cfg, style: e.target.value as "line" | "area" })}
              data-testid="cfg-style"
            >
              <option value="area">Line with soft fill</option>
              <option value="line">Line only</option>
            </select>
          </label>
        )}
        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" data-testid="cfg-apply">
            Apply
          </Button>
        </div>
      </form>
    </dialog>
  );
}
