"use client";

import { useCallback } from "react";
import { getWidgetData } from "@/app/w/[ws]/dashboards/actions";
import type { WidgetType } from "@/lib/dashboards/catalog";
import { DashboardGrid, type DraftWidget, type GridHandlers } from "./DashboardGrid";

const noop: GridHandlers = {
  onLayout: () => {},
  onEdit: () => {},
  onDuplicate: () => {},
  onRemove: () => {},
  onUpgrade: () => {},
};
const w = (
  id: string,
  type: WidgetType,
  title: string,
  x: number,
  y: number,
  ww: number,
  h: number,
  config = {},
): DraftWidget => ({ id, type, title, config, x, y, w: ww, h });

/** The Home overview is built from the same widgets as dashboards: four KPI tiles and the volume chart. */
export function HomeOverview({ ws }: { ws: string }) {
  const fetchWidget = useCallback(
    (d: DraftWidget, qs: string) => getWidgetData(ws, d.type, d.config, qs),
    [ws],
  );
  const widgets = [
    w("home-kpi-mentions", "kpi", "Mentions", 0, 0, 3, 3, { metric: "mentions" }),
    w("home-kpi-reach", "kpi", "Estimated reach", 3, 0, 3, 3, { metric: "reach" }),
    w("home-kpi-net", "kpi", "Net sentiment", 6, 0, 3, 3, { metric: "net_sentiment" }),
    w("home-kpi-engagement", "kpi", "Engagement", 9, 0, 3, 3, { metric: "engagement" }),
    w("home-volume", "volume", "Mentions over time", 0, 3, 12, 5),
  ];
  return (
    <section aria-label="Overview" data-testid="home-overview">
      <DashboardGrid
        ws={ws}
        widgets={widgets}
        editing={false}
        selectedId={null}
        rangeQs=""
        fetchWidget={fetchWidget}
        handlers={noop}
      />
    </section>
  );
}
