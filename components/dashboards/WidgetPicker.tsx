"use client";

import { Lock } from "lucide-react";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  SIZES,
  WIDGETS,
  WIDGET_TYPES,
  widgetAllowed,
  type WidgetType,
} from "@/lib/dashboards/catalog";
import { PLANS, planUnlocking, type Entitlements } from "@/lib/entitlements/plans";

/** Add-a-widget dialog. Widgets outside the plan stay visible but locked, with the plan that unlocks them. */
export function WidgetPicker({
  open,
  features,
  onAdd,
  onLocked,
  onClose,
}: {
  open: boolean;
  features: Entitlements["features"];
  onAdd: (t: WidgetType) => void;
  onLocked: (t: WidgetType) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby="wp-title"
      onClose={onClose}
      data-testid="widget-picker"
      className="m-auto w-full max-w-3xl rounded-[var(--radius-modal)] border border-[var(--border)] bg-[var(--surface)] p-6 text-[var(--text)] backdrop:bg-black/40"
    >
      <h2 id="wp-title" className="text-xl font-semibold">
        Add a widget
      </h2>
      <ul className="mt-4 grid gap-3 sm:grid-cols-2">
        {WIDGET_TYPES.map((t) => {
          const def = WIDGETS[t];
          const ok = widgetAllowed(t, features);
          const plan = def.requires ? PLANS[planUnlocking(def.requires)].label : null;
          return (
            <li
              key={t}
              className="flex flex-col gap-2 rounded-lg border border-[var(--border)] p-3"
              data-testid={`pick-${t}`}
              data-locked={!ok || undefined}
            >
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-medium">{def.label}</h3>
                {!ok && (
                  <span className="inline-flex items-center gap-1 text-xs text-[var(--text-muted)]">
                    <Lock size={12} aria-hidden /> {plan}
                  </span>
                )}
              </div>
              <p className="text-sm text-[var(--text-muted)]">{def.description}</p>
              <p className="text-xs text-[var(--text-muted)]">
                Starts at {def.size} ({SIZES[def.size].w}×{SIZES[def.size].h})
              </p>
              {ok ? (
                <Button size="sm" onClick={() => onAdd(t)} data-testid={`add-${t}`}>
                  Add {def.label}
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => onLocked(t)}
                  data-testid={`add-${t}`}
                >
                  Available on {plan}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      <div className="mt-4 flex justify-end">
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      </div>
    </dialog>
  );
}
