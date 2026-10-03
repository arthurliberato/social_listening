"use client";

import { Calendar, Lock } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { PLANS, type PlanTier } from "@/lib/entitlements/plans";
import { RANGE_DAYS, RANGES } from "@/lib/mentions/filters";

export interface RangeValue {
  range: string;
  from?: string;
  to?: string;
}

const LABEL: Record<string, string> = {
  "24h": "Last 24 hours",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  "12m": "Last 12 months",
  custom: "Custom range",
};

/** Cheapest plan whose history covers `days`, for the lock tooltip. */
function planFor(days: number): string {
  const t = (["starter", "growth", "agency", "enterprise"] as PlanTier[]).find(
    (p) => PLANS[p].historyDays >= days,
  );
  return PLANS[t ?? "enterprise"].label;
}

export function DateRangePicker({
  value,
  historyDays,
  onChange,
  onLocked,
}: {
  value: RangeValue;
  historyDays: number;
  onChange: (range: string, from?: string, to?: string) => void;
  onLocked: (range: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(value.from ?? "");
  const [to, setTo] = useState(value.to ?? "");
  const root = useRef<HTMLDivElement>(null);
  const earliest = new Date(Date.now() - historyDays * 86_400_000).toISOString().slice(0, 10);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const label =
    value.range === "custom" && value.from
      ? `${value.from} → ${value.to ?? "now"}`
      : LABEL[value.range];
  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        data-testid="date-range"
        className="inline-flex min-h-9 items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 text-sm hover:bg-[var(--surface-2)]"
      >
        <Calendar size={16} aria-hidden /> {label}
        <span aria-hidden>▾</span>
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Date range"
          className="absolute left-0 z-30 mt-1 w-72 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 shadow-lg"
          data-testid="date-range-panel"
        >
          <ul className="flex flex-col gap-1">
            {RANGES.map((r) => {
              const locked = RANGE_DAYS[r] > historyDays;
              return (
                <li key={r}>
                  <button
                    type="button"
                    aria-pressed={value.range === r}
                    data-testid={`range-${r}`}
                    title={locked ? `Available on ${planFor(RANGE_DAYS[r])}` : undefined}
                    onClick={() => {
                      if (locked) {
                        setOpen(false);
                        onLocked(r);
                      } else {
                        setOpen(false);
                        onChange(r);
                      }
                    }}
                    className={`flex min-h-8 w-full items-center justify-between rounded px-2 text-left text-sm hover:bg-[var(--surface-2)] ${value.range === r ? "font-semibold" : ""} ${locked ? "text-[var(--text-muted)]" : ""}`}
                  >
                    <span>{LABEL[r]}</span>
                    {locked && (
                      <span className="inline-flex items-center gap-1 text-xs">
                        <Lock size={12} aria-hidden /> Available on {planFor(RANGE_DAYS[r])}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
          <fieldset className="mt-3 border-t border-[var(--border)] pt-3">
            <legend className="text-xs font-medium text-[var(--text-muted)]">
              Custom range (UTC)
            </legend>
            <div className="mt-1 flex items-center gap-2">
              <label className="sr-only" htmlFor="rng-from">
                From
              </label>
              <input
                id="rng-from"
                type="date"
                min={earliest}
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="min-h-8 flex-1 rounded border border-[var(--border)] bg-[var(--surface)] px-1 text-sm"
                data-testid="range-from"
              />
              <label className="sr-only" htmlFor="rng-to">
                To
              </label>
              <input
                id="rng-to"
                type="date"
                min={from || earliest}
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="min-h-8 flex-1 rounded border border-[var(--border)] bg-[var(--surface)] px-1 text-sm"
                data-testid="range-to"
              />
            </div>
            <Button
              size="sm"
              className="mt-2"
              disabled={!from}
              onClick={() => {
                setOpen(false);
                onChange("custom", from, to || undefined);
              }}
              data-testid="range-apply"
            >
              Apply
            </Button>
          </fieldset>
          <p className="mt-2 text-xs text-[var(--text-muted)]">
            Your plan includes{" "}
            {historyDays >= 365
              ? `${Math.round(historyDays / 365)} year(s)`
              : `${historyDays} days`}{" "}
            of history.
          </p>
        </div>
      )}
    </div>
  );
}
