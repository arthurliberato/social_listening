"use client";

import { ArrowDown, ArrowUp, BarChart3, Settings2, Table2, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { getWidgetData } from "@/app/w/[ws]/dashboards/actions";
import { isEmpty, WidgetBody } from "@/components/dashboards/WidgetBody";
import { LockedWidget } from "@/components/dashboards/WidgetFrame";
import { useWidgetData } from "@/components/dashboards/useWidgetData";
import { Button } from "@/components/ui/button";
import { track } from "@/lib/analytics/client";
import { WIDGETS } from "@/lib/dashboards/catalog";
import { drillHref, type Pick } from "@/lib/dashboards/drill";
import { summarize } from "@/lib/charts/tables";
import type { Section } from "@/lib/reports/types";

const HEIGHT: Record<string, number> = {
  kpi: 120,
  top_mentions: 320,
  top_authors: 300,
  topic_cloud: 220,
};
const iconBtn =
  "inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] hover:bg-[var(--surface-2)] disabled:opacity-100 disabled:text-[var(--text-muted)] disabled:hover:bg-transparent";

/** One report section: a widget with its own loading, empty, error and plan-locked states, plus a table twin. */
export function SectionCard({
  ws,
  section,
  range,
  editing,
  first,
  last,
  onMove,
  onSettings,
  onRemove,
  onUpgrade,
}: {
  ws: string;
  section: Section;
  range: string;
  editing: boolean;
  first: boolean;
  last: boolean;
  onMove: (dir: -1 | 1) => void;
  onSettings: () => void;
  onRemove: () => void;
  onUpgrade: () => void;
}) {
  const router = useRouter();
  const [view, setView] = useState<"chart" | "table">("chart");
  const qs = `range=${range}`;
  const key = JSON.stringify([section.type, section.config, qs]);
  const { state, reload } = useWidgetData(key, () =>
    getWidgetData(ws, section.type, section.config, qs),
  );
  const payload =
    state.status === "ready"
      ? state.payload
      : state.status === "loading"
        ? state.previous
        : undefined;
  const dash = useMemo(() => new URLSearchParams(qs), [qs]);
  const drill = useCallback(
    (pick: Pick, breakdown?: string) => {
      track("Widget Drilled Down", { widget_type: section.type });
      router.push(drillHref(ws, section.type, section.config, dash, pick, breakdown));
    },
    [router, ws, section.type, section.config, dash],
  );
  const h = HEIGHT[section.type] ?? 260;

  let body: React.ReactNode;
  if (state.status === "error" && state.code === "plan") {
    body = <LockedWidget type={section.type} plan="a higher plan" onUpgrade={onUpgrade} />;
  } else if (state.status === "error") {
    body = (
      <div
        role="alert"
        className="flex flex-col items-start gap-2 text-sm"
        data-testid="section-error"
      >
        <p className="font-medium">{state.error}</p>
        <Button size="sm" variant="secondary" onClick={reload} data-testid="section-retry">
          Retry
        </Button>
      </div>
    );
  } else if (!payload) {
    body = (
      <div
        role="status"
        aria-label={`Loading ${section.title}`}
        className="animate-pulse rounded-md bg-[var(--surface-2)] motion-reduce:animate-none"
        style={{ height: h }}
        data-testid="section-loading"
      />
    );
  } else if (isEmpty(payload.data)) {
    body = (
      <div className="text-sm" data-testid="section-empty">
        <p className="font-medium">No mentions in this period</p>
        <p className="text-[var(--text-muted)]">
          Try a longer range, or check the query this section uses.
        </p>
      </div>
    );
  } else {
    body = (
      <>
        <p className="mb-2 text-sm text-[var(--text-muted)]" data-testid="section-summary">
          {summarize(payload.data, payload.period)}
        </p>
        <div style={{ height: view === "table" ? Math.max(h, 220) : h }}>
          <WidgetBody
            type={section.type}
            config={section.config}
            payload={payload}
            view={view}
            height={h}
            onDrill={drill}
          />
        </div>
      </>
    );
  }

  return (
    <section
      aria-labelledby={`sec-${section.id}`}
      className="break-inside-avoid rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4"
      data-testid="report-section"
      data-section-type={section.type}
    >
      <header className="mb-3 flex flex-wrap items-center gap-2">
        <h2 id={`sec-${section.id}`} className="text-lg font-semibold" data-testid="section-title">
          {section.title}
        </h2>
        <span className="text-xs text-[var(--text-muted)]">{WIDGETS[section.type].label}</span>
        <div className="ml-auto flex items-center gap-1">
          {!editing && payload && !isEmpty(payload.data) && (
            <button
              type="button"
              aria-pressed={view === "table"}
              aria-label={
                view === "table"
                  ? `Show ${section.title} as a chart`
                  : `Show ${section.title} as a table`
              }
              onClick={() => setView(view === "table" ? "chart" : "table")}
              className={iconBtn}
              data-testid="section-table-toggle"
            >
              {view === "table" ? (
                <BarChart3 size={16} aria-hidden />
              ) : (
                <Table2 size={16} aria-hidden />
              )}
            </button>
          )}
          {editing && (
            <>
              <button
                type="button"
                className={iconBtn}
                disabled={first}
                onClick={() => onMove(-1)}
                aria-label={`Move ${section.title} up`}
                data-testid="section-up"
              >
                <ArrowUp size={16} aria-hidden />
              </button>
              <button
                type="button"
                className={iconBtn}
                disabled={last}
                onClick={() => onMove(1)}
                aria-label={`Move ${section.title} down`}
                data-testid="section-down"
              >
                <ArrowDown size={16} aria-hidden />
              </button>
              <button
                type="button"
                className={iconBtn}
                onClick={onSettings}
                aria-label={`Settings for ${section.title}`}
                data-testid="section-settings"
              >
                <Settings2 size={16} aria-hidden />
              </button>
              <button
                type="button"
                className={iconBtn}
                onClick={onRemove}
                aria-label={`Remove ${section.title}`}
                data-testid="section-remove"
              >
                <Trash2 size={16} aria-hidden />
              </button>
            </>
          )}
        </div>
      </header>
      {body}
    </section>
  );
}
