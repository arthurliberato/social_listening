"use client";

import { Info } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

export interface LegendItem {
  label: string;
  color: string;
  value?: string;
}

/** Always present for 2+ series: identity never relies on colour matching alone. Text wears text tokens. */
export function Legend({ items }: { items: LegendItem[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-label="Legend" data-testid="legend">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="inline-block h-2.5 w-2.5 rounded-sm"
            style={{ background: i.color }}
          />
          <span className="text-[var(--text-muted)]">{i.label}</span>
          {i.value && <strong className="font-semibold text-[var(--text)]">{i.value}</strong>}
        </li>
      ))}
    </ul>
  );
}

/** "ⓘ How is this calculated?" popover. Esc or outside click closes it. */
export function InfoPopover({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
    };
  }, [open]);
  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={`How is ${title} calculated?`}
        data-testid="widget-info"
        onClick={() => setOpen(!open)}
        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--surface-2)]"
      >
        <Info size={16} aria-hidden />
      </button>
      {open && (
        <div
          id={id}
          role="note"
          className="absolute right-0 z-30 mt-1 w-72 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-xs leading-5 shadow-lg"
          data-testid="widget-info-panel"
        >
          {children}
        </div>
      )}
    </div>
  );
}

export function DataTable({
  caption,
  columns,
  rows,
  numeric,
  onRow,
}: {
  caption: string;
  columns: string[];
  rows: (string | number)[][];
  numeric: boolean[];
  onRow?: (i: number) => void;
}) {
  return (
    <div className="h-full overflow-auto" tabIndex={0} aria-label={`${caption} (scrollable table)`}>
      <table className="w-full text-left text-xs" data-testid="widget-table">
        <caption className="sr-only">{caption}</caption>
        <thead className="sticky top-0 bg-[var(--surface)] text-[var(--text-muted)] shadow-[0_1px_0_var(--border)]">
          <tr>
            {columns.map((c, i) => (
              <th
                key={c + i}
                scope="col"
                className={`px-2 py-1.5 font-medium ${numeric[i] ? "text-right" : ""}`}
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri} className="border-t border-[var(--border)]">
              {r.map((cell, ci) => {
                const content = typeof cell === "number" ? cell.toLocaleString() : cell;
                const first = ci === 0;
                return first && onRow ? (
                  <th key={ci} scope="row" className="px-2 py-1.5 text-left font-normal">
                    <button
                      type="button"
                      onClick={() => onRow(ri)}
                      className="underline-offset-2 hover:underline"
                    >
                      {content}
                    </button>
                  </th>
                ) : first ? (
                  <th key={ci} scope="row" className="px-2 py-1.5 text-left font-normal">
                    {content}
                  </th>
                ) : (
                  <td
                    key={ci}
                    className={`px-2 py-1.5 ${numeric[ci] ? "text-right tabular-nums" : ""}`}
                  >
                    {content}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Track an element's content height so charts can fill their widget exactly. */
export function useElementHeight(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [h, setH] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setH(Math.floor(e!.contentRect.height)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, h];
}
