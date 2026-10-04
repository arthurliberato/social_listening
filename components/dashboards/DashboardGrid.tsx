"use client";

import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as RKeyboardEvent,
} from "react";
import { Button } from "@/components/ui/button";
import type { MenuItem } from "@/components/ui/menu";
import { track } from "@/lib/analytics/client";
import { toTable } from "@/lib/charts/tables";
import {
  COLS,
  ROW_PX,
  SIZES,
  type SizeKey,
  type WidgetConfig,
  type WidgetType,
} from "@/lib/dashboards/catalog";
import { drillHref, type Pick } from "@/lib/dashboards/drill";
import { canMove, moveBy, moveTo, resize, type Box } from "@/lib/dashboards/layout";
import type { WidgetResult } from "@/lib/dashboards/types";
import { toCsv } from "@/lib/csv";
import { AddToReportDialog } from "@/components/reports/AddToReportDialog";
import { LockedWidget, WidgetFrame, exportItem } from "./WidgetFrame";
import { WidgetBody, isEmpty } from "./WidgetBody";
import { useElementHeight } from "./parts";
import { useWidgetData } from "./useWidgetData";

export interface DraftWidget extends Box {
  type: WidgetType;
  title: string;
  config: WidgetConfig;
}

const GAP = 16;
export type MoveMethod = "drag" | "keyboard" | "menu";

export interface GridHandlers {
  onLayout: (boxes: Box[], method: MoveMethod, id: string) => void;
  onEdit: (id: string) => void;
  onDuplicate: (id: string) => void;
  onRemove: (id: string) => void;
  onUpgrade: (w: DraftWidget) => void;
}

function download(name: string, text: string, type: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Rasterise a chart's SVG to PNG (the SVG renderer has no built-in PNG export). */
async function exportPng(root: HTMLElement, name: string) {
  const svg = root.querySelector("svg:not([data-sparkline])");
  if (!svg) return false;
  const box = svg.getBoundingClientRect();
  const xml = new XMLSerializer().serializeToString(svg);
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = box.width * 2;
  c.height = box.height * 2;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle =
    getComputedStyle(document.documentElement).getPropertyValue("--surface").trim() || "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const a = document.createElement("a");
  a.href = c.toDataURL("image/png");
  a.download = name;
  a.click();
  return true;
}

function WidgetCell({
  readOnly,
  canReport,
  ws,
  w,
  boxes,
  editing,
  selected,
  rangeQs,
  fetchWidget,
  h,
}: {
  readOnly?: boolean;
  canReport?: boolean;
  ws: string;
  w: DraftWidget;
  boxes: Box[];
  editing: boolean;
  selected: boolean;
  rangeQs: string;
  h: GridHandlers;
  fetchWidget: (w: DraftWidget, rangeQs: string) => Promise<WidgetResult>;
}) {
  const router = useRouter();
  const [view, setView] = useState<"chart" | "table">("chart");
  const [bodyRef, bodyH] = useElementHeight();
  const frameRef = useRef<HTMLElement>(null);
  const key = JSON.stringify([w.type, w.config, rangeQs]);
  const { state, reload } = useWidgetData(key, () => fetchWidget(w, rangeQs));
  const payload =
    state.status === "ready"
      ? state.payload
      : state.status === "loading"
        ? state.previous
        : undefined;
  const dash = useMemo(() => new URLSearchParams(rangeQs), [rangeQs]);
  const move = canMove(boxes, w.id);
  const [addOpen, setAddOpen] = useState(false);

  const drill = useCallback(
    (pick: Pick, breakdown?: string) => {
      if (readOnly) return; // public viewers have no workspace to drill into
      track("Widget Drilled Down", { widget_type: w.type });
      router.push(drillHref(ws, w.type, w.config, dash, pick, breakdown));
    },
    [router, ws, w.type, w.config, dash, readOnly],
  );

  const menu: MenuItem[] = [];
  if (payload) {
    menu.push(
      exportItem("Export CSV", () => {
        const t = toTable(payload.data);
        download(
          `${w.title.replace(/\W+/g, "-").toLowerCase()}.csv`,
          toCsv(t.columns, t.rows),
          "text/csv",
        );
        track("Export Downloaded", { format: "csv", row_count: t.rows.length });
      }),
    );
    if (!["kpi", "topic_cloud", "top_authors", "top_mentions"].includes(w.type))
      menu.push(
        exportItem("Export PNG", () => {
          void exportPng(
            frameRef.current!,
            `${w.title.replace(/\W+/g, "-").toLowerCase()}.png`,
          ).then((ok) => ok && track("Export Downloaded", { format: "png", row_count: 1 }));
        }),
      );
  }
  if (!readOnly) menu.push({ key: "open", label: "Open in Mentions", onSelect: () => drill({}) });
  if (!readOnly && canReport)
    menu.push({
      key: "report",
      label: "Add to report…",
      testId: "menu-add-to-report",
      onSelect: () => setAddOpen(true),
    });
  if (editing) {
    const m = (label: string, dx: number, dy: number, ok: boolean): MenuItem => ({
      key: label,
      label,
      disabled: !ok,
      testId: `menu-${label.toLowerCase().replace(/\W+/g, "-")}`,
      onSelect: () => h.onLayout(moveBy(boxes, w.id, dx, dy), "menu", w.id),
    });
    menu.push(
      { key: "edit", label: "Edit settings", onSelect: () => h.onEdit(w.id), testId: "menu-edit" },
      {
        key: "dup",
        label: "Duplicate",
        onSelect: () => h.onDuplicate(w.id),
        testId: "menu-duplicate",
      },
      m("Move left", -1, 0, move.left),
      m("Move right", 1, 0, move.right),
      m("Move up", 0, -1, move.up),
      m("Move down", 0, 1, move.down),
      ...(Object.keys(SIZES) as SizeKey[]).map((s): MenuItem => ({
        key: `size-${s}`,
        label: `Resize to ${s} (${SIZES[s].w}×${SIZES[s].h})`,
        testId: `menu-size-${s}`,
        disabled: w.w === SIZES[s].w && w.h === SIZES[s].h,
        onSelect: () => h.onLayout(resize(boxes, w.id, SIZES[s].w, SIZES[s].h), "menu", w.id),
      })),
      { key: "rm", label: "Remove", onSelect: () => h.onRemove(w.id), testId: "menu-remove" },
    );
  }

  let body: React.ReactNode;
  if (state.status === "error" && state.code === "plan") {
    body = <LockedWidget type={w.type} plan="a higher plan" onUpgrade={() => h.onUpgrade(w)} />;
  } else if (state.status === "error") {
    body = (
      <div
        role="alert"
        className="flex h-full flex-col items-start justify-center gap-2 text-sm"
        data-testid="widget-error"
      >
        <p className="font-medium">{state.error}</p>
        <Button size="sm" variant="secondary" onClick={reload} data-testid="widget-retry">
          Retry
        </Button>
      </div>
    );
  } else if (!payload) {
    body = (
      <div
        role="status"
        aria-label={`Loading ${w.title}`}
        className="h-full animate-pulse rounded-md bg-[var(--surface-2)] motion-reduce:animate-none"
        data-testid="widget-loading"
      />
    );
  } else if (isEmpty(payload.data)) {
    body = (
      <div
        className="flex h-full flex-col items-start justify-center gap-1 text-sm"
        data-testid="widget-empty"
      >
        <p className="font-medium">No mentions in this period</p>
        <p className="text-[var(--text-muted)]">
          Try a wider date range, or check the query this widget uses.
        </p>
      </div>
    );
  } else {
    body = (
      <WidgetBody
        type={w.type}
        config={w.config}
        payload={payload}
        view={view}
        height={bodyH}
        onDrill={drill}
      />
    );
  }

  return (
    <WidgetFrame
      ref={frameRef}
      id={w.id}
      type={w.type}
      title={w.title}
      payload={payload}
      editing={editing}
      selected={selected}
      view={view}
      onView={setView}
      canTable={!!payload && !isEmpty(payload.data)}
      menu={menu}
      onHandlePointerDown={(e) =>
        e.currentTarget.dispatchEvent(
          new CustomEvent("rw-drag-start", {
            bubbles: true,
            detail: { id: w.id, x: e.clientX, y: e.clientY, pointerId: e.pointerId },
          }),
        )
      }
      onHandleKey={(e: RKeyboardEvent<HTMLButtonElement>) => {
        const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[
          e.key
        ];
        if (d) {
          e.preventDefault();
          h.onLayout(moveBy(boxes, w.id, d[0]!, d[1]!), "keyboard", w.id);
        }
      }}
    >
      <div ref={bodyRef} className="h-full min-h-0" aria-busy={state.status === "loading"}>
        {body}
      </div>
      {addOpen && (
        <AddToReportDialog
          ws={ws}
          source="dashboard"
          draft={{ type: w.type, title: w.title, config: w.config as Record<string, unknown> }}
          onClose={() => setAddOpen(false)}
        />
      )}
    </WidgetFrame>
  );
}

/**
 * The 12-column widget grid. In edit mode every widget can be dragged by its handle, or moved/resized from
 * its menu or the handle's arrow keys, so nothing requires a drag (WCAG 2.5.7).
 */
export function DashboardGrid({
  readOnly,
  canReport,
  ws,
  widgets,
  editing,
  selectedId,
  rangeQs,
  fetchWidget,
  handlers,
}: {
  readOnly?: boolean;
  /** Offer "Add to report…" in each widget's menu (people who can edit reports). */
  canReport?: boolean;
  ws: string;
  widgets: DraftWidget[];
  editing: boolean;
  selectedId: string | null;
  rangeQs: string;
  handlers: GridHandlers;
  fetchWidget: (w: DraftWidget, rangeQs: string) => Promise<WidgetResult>;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [preview, setPreview] = useState<Box[] | null>(null);
  const drag = useRef<{
    id: string;
    sx: number;
    sy: number;
    start: Box[];
    x0: number;
    y0: number;
    last: Box[];
  } | null>(null);
  const live = useRef(handlers);
  live.current = handlers;
  const boxesOf = (ws_: DraftWidget[]): Box[] =>
    ws_.map(({ id, x, y, w, h }) => ({ id, x, y, w, h }));
  const shown = preview ?? boxesOf(widgets);
  const byId = new Map(widgets.map((w) => [w.id, w]));
  const boxes = boxesOf(widgets);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const start = (ev: Event) => {
      const { id, x, y, pointerId } = (ev as CustomEvent).detail as {
        id: string;
        x: number;
        y: number;
        pointerId: number;
      };
      const b = boxesOf(widgets);
      const me = b.find((i) => i.id === id)!;
      drag.current = { id, sx: x, sy: y, start: b, x0: me.x, y0: me.y, last: b };
      (el as HTMLElement).setPointerCapture?.(pointerId);
      document.body.style.userSelect = "none";
    };
    const move = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const colW = (el.clientWidth - (COLS - 1) * GAP) / COLS;
      const dx = Math.round((e.clientX - d.sx) / (colW + GAP));
      const dy = Math.round((e.clientY - d.sy) / (ROW_PX + GAP));
      const next = moveTo(d.start, d.id, d.x0 + dx, d.y0 + dy);
      d.last = next;
      setPreview(next);
    };
    const end = (cancel: boolean) => {
      const d = drag.current;
      if (!d) return;
      drag.current = null;
      document.body.style.userSelect = "";
      setPreview(null);
      if (!cancel && JSON.stringify(d.last) !== JSON.stringify(d.start))
        live.current.onLayout(d.last, "drag", d.id);
    };
    const up = () => end(false);
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") end(true);
    };
    el.addEventListener("rw-drag-start", start);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("keydown", esc);
    return () => {
      el.removeEventListener("rw-drag-start", start);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("keydown", esc);
    };
  }, [widgets]);

  // Reading order on narrow screens follows the grid: top to bottom, left to right.
  const ordered = [...shown].sort((a, b) => a.y - b.y || a.x - b.x);
  return (
    <div
      ref={host}
      className="grid grid-cols-1 gap-4 md:grid-cols-12 md:auto-rows-[80px]"
      data-testid="dashboard-grid"
      data-dragging={preview ? "true" : undefined}
    >
      {ordered.map((b) => {
        const w = byId.get(b.id)!;
        return (
          <div
            key={b.id}
            data-testid="widget-cell"
            data-x={b.x}
            data-y={b.y}
            data-w={b.w}
            data-h={b.h}
            style={{
              ["--gc" as string]: `${b.x + 1} / span ${b.w}`,
              ["--gr" as string]: `${b.y + 1} / span ${b.h}`,
              ["--mh" as string]: `${b.h * ROW_PX + (b.h - 1) * GAP}px`,
            }}
            className="min-h-[var(--mh)] md:min-h-0 md:[grid-column:var(--gc)] md:[grid-row:var(--gr)]"
          >
            <WidgetCell
              readOnly={readOnly}
              canReport={canReport}
              ws={ws}
              w={w}
              boxes={boxes}
              editing={editing}
              selected={selectedId === b.id}
              rangeQs={rangeQs}
              h={handlers}
              fetchWidget={fetchWidget}
            />
          </div>
        );
      })}
    </div>
  );
}
