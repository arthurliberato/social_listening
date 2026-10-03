"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createDashboard } from "@/app/w/[ws]/dashboards/actions";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { WIDGETS, widgetAllowed } from "@/lib/dashboards/catalog";
import { TEMPLATES } from "@/lib/dashboards/templates";
import type { Entitlements } from "@/lib/entitlements/plans";

/** Start from a template (or blank). Widgets the plan doesn't include are listed, then left out. */
export function NewDashboardDialog({
  ws,
  features,
  open,
  onClose,
}: {
  ws: string;
  features: Entitlements["features"];
  open: boolean;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  const create = async (templateId?: string) => {
    setBusy(templateId ?? "blank");
    setError("");
    const r = await createDashboard(ws, { templateId });
    setBusy(null);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    if (r.skipped.length)
      toast.success(
        `Created. Left out ${[...new Set(r.skipped)].map((t) => WIDGETS[t as keyof typeof WIDGETS].label).join(", ")}: not on your plan.`,
      );
    router.push(`/w/${ws}/dashboards/${r.id}?edit=1`);
  };

  return (
    <dialog
      ref={ref}
      aria-labelledby="nd-title"
      onClose={onClose}
      data-testid="new-dashboard-dialog"
      className="m-auto w-full max-w-2xl rounded-[var(--radius-modal)] border border-[var(--border)] bg-[var(--surface)] p-6 text-[var(--text)] backdrop:bg-black/40"
    >
      <h2 id="nd-title" className="text-xl font-semibold">
        New dashboard
      </h2>
      <p className="mt-1 text-sm text-[var(--text-muted)]">
        Pick a starting point. You can change everything afterwards.
      </p>
      <ul className="mt-4 grid gap-3 sm:grid-cols-2">
        {TEMPLATES.map((t) => {
          const locked = t.widgets.filter((w) => !widgetAllowed(w.type, features));
          return (
            <li
              key={t.id}
              className="flex flex-col gap-2 rounded-lg border border-[var(--border)] p-3"
            >
              <h3 className="font-medium">{t.label}</h3>
              <p className="text-sm text-[var(--text-muted)]">{t.description}</p>
              <p className="text-xs text-[var(--text-muted)]">
                {t.widgets.length - locked.length} widgets
                {locked.length
                  ? ` · ${[...new Set(locked.map((w) => WIDGETS[w.type].label))].join(", ")} need a higher plan`
                  : ""}
              </p>
              <Button
                size="sm"
                onClick={() => create(t.id)}
                loading={busy === t.id}
                data-testid={`template-${t.id}`}
              >
                Use this template
              </Button>
            </li>
          );
        })}
        <li className="flex flex-col gap-2 rounded-lg border border-dashed border-[var(--border)] p-3">
          <h3 className="font-medium">Blank dashboard</h3>
          <p className="text-sm text-[var(--text-muted)]">
            Start empty and add the widgets you want.
          </p>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => create()}
            loading={busy === "blank"}
            data-testid="template-blank"
          >
            Start blank
          </Button>
        </li>
      </ul>
      {error && (
        <p role="alert" className="mt-3 text-sm text-[var(--danger)]">
          {error}
        </p>
      )}
      <div className="mt-4 flex justify-end">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </dialog>
  );
}
