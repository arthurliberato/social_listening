"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createReport } from "@/app/w/[ws]/reports/actions";
import { Button } from "@/components/ui/button";
import { track } from "@/lib/analytics/client";
import { WIDGETS } from "@/lib/dashboards/catalog";
import { RANGE_LABEL } from "@/lib/reports/types";
import type { ReportTemplate } from "@/lib/reports/templates";

export function TemplatePicker({ ws, templates }: { ws: string; templates: ReportTemplate[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const create = async (id: string | null) => {
    setBusy(id ?? "blank");
    setError("");
    const r = await createReport(ws, id);
    if (!r.ok) {
      setBusy(null);
      return setError(r.error);
    }
    track("Report Created", { template_id: id ?? "blank" });
    router.push(`/w/${ws}/reports/${r.id}?edit=1`);
  };
  return (
    <div>
      <ul className="grid gap-4 sm:grid-cols-2" data-testid="template-list">
        {templates.map((t) => (
          <li
            key={t.id}
            className="flex flex-col gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4"
          >
            <h2 className="font-semibold">{t.label}</h2>
            <p className="text-sm text-[var(--text-muted)]">{t.description}</p>
            <p className="text-xs text-[var(--text-muted)]">
              {RANGE_LABEL[t.range]} · {t.sections.length} sections:{" "}
              {[...new Set(t.sections.map((s) => WIDGETS[s.type].label))].slice(0, 4).join(", ")}
              {new Set(t.sections.map((s) => s.type)).size > 4 ? "…" : ""}
            </p>
            <Button
              onClick={() => create(t.id)}
              loading={busy === t.id}
              disabled={busy !== null}
              className="mt-auto self-start"
              data-testid={`template-${t.id}`}
            >
              Use this template
            </Button>
          </li>
        ))}
        <li className="flex flex-col gap-2 rounded-lg border border-dashed border-[var(--border)] p-4">
          <h2 className="font-semibold">Start from scratch</h2>
          <p className="text-sm text-[var(--text-muted)]">
            An empty report. Add exactly the charts and tables you want.
          </p>
          <Button
            variant="secondary"
            onClick={() => create(null)}
            loading={busy === "blank"}
            disabled={busy !== null}
            className="mt-auto self-start"
            data-testid="template-blank"
          >
            Blank report
          </Button>
        </li>
      </ul>
      {error && (
        <p role="alert" className="mt-3 text-sm text-[var(--danger)]">
          {error}
        </p>
      )}
    </div>
  );
}
