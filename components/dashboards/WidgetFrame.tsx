"use client";

import { Download, GripVertical, Lock, Table2, BarChart3 } from "lucide-react";
import {
  forwardRef,
  type ReactNode,
  type PointerEvent as RPointerEvent,
  type KeyboardEvent as RKeyboardEvent,
} from "react";
import { Menu, type MenuItem } from "@/components/ui/menu";
import { WIDGETS, type WidgetType } from "@/lib/dashboards/catalog";
import type { WidgetPayload } from "@/lib/dashboards/types";
import { InfoPopover } from "./parts";

const dateOnly = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });

export interface FrameProps {
  id: string;
  type: WidgetType;
  title: string;
  payload?: WidgetPayload;
  editing: boolean;
  selected?: boolean;
  view: "chart" | "table";
  onView: (v: "chart" | "table") => void;
  menu: MenuItem[];
  /** Drag handle wiring (edit mode). */
  onHandlePointerDown?: (e: RPointerEvent<HTMLButtonElement>) => void;
  onHandleKey?: (e: RKeyboardEvent<HTMLButtonElement>) => void;
  /** Table view is only offered once there is data. */
  canTable: boolean;
  children: ReactNode;
}

export const WidgetFrame = forwardRef<HTMLElement, FrameProps>(function WidgetFrame(p, ref) {
  const def = WIDGETS[p.type];
  const subtitle = p.payload
    ? `${dateOnly(p.payload.period.from)} – ${dateOnly(p.payload.period.to)} · ${p.payload.scope.length ? p.payload.scope.slice(0, 2).join(", ") + (p.payload.scope.length > 2 ? ` +${p.payload.scope.length - 2}` : "") : "All queries"}`
    : " ";
  return (
    <section
      ref={ref}
      aria-labelledby={`w-${p.id}`}
      data-testid="widget"
      data-widget-type={p.type}
      data-widget-id={p.id}
      data-selected={p.selected || undefined}
      className={`flex h-full min-h-0 flex-col rounded-lg border bg-[var(--surface)] ${p.selected ? "border-[var(--primary)] ring-2 ring-[var(--primary)]" : "border-[var(--border)]"}`}
    >
      <header className="flex items-start gap-1 px-3 pt-3">
        {p.editing && (
          <button
            type="button"
            aria-label={`Move ${p.title}. Press arrow keys to move one step, or drag.`}
            data-testid="drag-handle"
            onPointerDown={p.onHandlePointerDown}
            onKeyDown={p.onHandleKey}
            className="inline-flex h-7 w-7 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--surface-2)] active:cursor-grabbing"
          >
            <GripVertical size={16} aria-hidden />
          </button>
        )}
        <div className="min-w-0 flex-1">
          <h3 id={`w-${p.id}`} className="truncate text-sm font-semibold">
            {p.title}
          </h3>
          <p className="truncate text-xs text-[var(--text-muted)]" data-testid="widget-subtitle">
            {subtitle}
          </p>
        </div>
        <InfoPopover title={p.title}>
          <p className="font-medium">{def.label}</p>
          <p className="mt-1 text-[var(--text-muted)]">{def.howCalculated}</p>
        </InfoPopover>
        {p.canTable && (
          <button
            type="button"
            aria-pressed={p.view === "table"}
            aria-label={
              p.view === "table" ? `Show ${p.title} as a chart` : `View ${p.title} as a table`
            }
            data-testid="widget-table-toggle"
            onClick={() => p.onView(p.view === "table" ? "chart" : "table")}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--surface-2)]"
          >
            {p.view === "table" ? (
              <BarChart3 size={16} aria-hidden />
            ) : (
              <Table2 size={16} aria-hidden />
            )}
          </button>
        )}
        <Menu
          label={<span className="sr-only">Widget options for {p.title}</span>}
          testId="widget-menu"
          align="right"
          items={p.menu}
          buttonClassName="!min-h-7 !px-1.5 border-transparent"
        />
      </header>
      <div className="min-h-0 flex-1 p-3">{p.children}</div>
    </section>
  );
});

export function LockedWidget({
  type,
  onUpgrade,
  plan,
}: {
  type: WidgetType;
  onUpgrade: () => void;
  plan: string;
}) {
  return (
    <div
      className="flex h-full flex-col items-start justify-center gap-2 text-sm"
      data-testid="widget-locked"
    >
      <p className="flex items-center gap-2 font-medium">
        <Lock size={16} aria-hidden /> {WIDGETS[type].label} is available on {plan}
      </p>
      <p className="text-[var(--text-muted)]">{WIDGETS[type].description}</p>
      <button
        type="button"
        onClick={onUpgrade}
        className="min-h-8 rounded-md border border-[var(--border)] px-3 hover:bg-[var(--surface-2)]"
      >
        See what&apos;s included
      </button>
    </div>
  );
}

export const exportItem = (label: string, onSelect: () => void): MenuItem => ({
  key: label,
  label: (
    <span className="flex items-center gap-2">
      <Download size={14} aria-hidden /> {label}
    </span>
  ),
  onSelect,
});
