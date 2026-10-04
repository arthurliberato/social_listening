"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  addSectionToReport,
  listReportTargets,
  type ReportTarget,
} from "@/app/w/[ws]/reports/actions";
import { Button } from "@/components/ui/button";
import { track } from "@/lib/analytics/client";
import { MAX_SECTIONS } from "@/lib/reports/types";

export interface SectionDraft {
  type: string;
  title: string;
  config: Record<string, unknown>;
}

const NEW = "__new";

/** Add one widget to a report as a new section: pick an existing report or start a new one. */
export function AddToReportDialog({
  ws,
  draft,
  source,
  onClose,
}: {
  ws: string;
  draft: SectionDraft;
  source: "dashboard" | "topics" | "authors";
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [targets, setTargets] = useState<ReportTarget[] | null>(null);
  const [choice, setChoice] = useState(NEW);
  const [error, setError] = useState<{ text: string; upgrade?: boolean } | null>(null);
  const [done, setDone] = useState<{ id: string; name: string; created: boolean } | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    ref.current?.showModal();
    void listReportTargets(ws).then((r) => {
      if (!r.ok) return setError({ text: r.error });
      setTargets(r.reports);
      const first = r.reports.find((x) => !x.full);
      setChoice(first ? first.id : NEW);
    });
  }, [ws]);

  function add() {
    setError(null);
    start(async () => {
      const r = await addSectionToReport(ws, {
        reportId: choice === NEW ? null : choice,
        ...draft,
        source,
      });
      if (!r.ok) return setError({ text: r.error, upgrade: "paywall" in r && !!r.paywall });
      if (r.created) track("Report Created", { template_id: "blank" });
      track("Report Section Added", {
        widget_type: draft.type,
        source,
        is_new_report: r.created,
      });
      setDone({ id: r.id, name: r.name, created: r.created });
    });
  }

  return (
    <dialog
      ref={ref}
      aria-labelledby="atr-title"
      onClose={onClose}
      className="m-auto w-full max-w-md rounded-[var(--radius-modal)] border border-[var(--border)] bg-[var(--surface)] p-6 text-[var(--text)] backdrop:bg-black/40"
      data-testid="add-to-report-dialog"
    >
      <h2 id="atr-title" className="text-lg font-semibold">
        Add to report
      </h2>
      <p className="mt-1 text-sm text-[var(--text-muted)]">
        “{draft.title}” becomes a section at the end of the report.
      </p>
      {done ? (
        <div role="status" className="mt-4 text-sm" data-testid="atr-done">
          <p>
            Added to <strong>{done.name}</strong>
            {done.created ? " (a new report)" : ""}.
          </p>
          <div className="mt-4 flex gap-3">
            <Link
              href={`/w/${ws}/reports/${done.id}`}
              className="inline-flex min-h-9 items-center rounded-md bg-[var(--primary)] px-4 text-sm font-medium text-[var(--primary-contrast)]"
              data-testid="atr-open"
            >
              Open report
            </Link>
            <Button
              variant="secondary"
              onClick={() => ref.current?.close()}
              data-testid="atr-close"
            >
              Keep browsing
            </Button>
          </div>
        </div>
      ) : (
        <form
          className="mt-4"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <fieldset className="flex flex-col gap-2" disabled={!targets && !error}>
            <legend className="sr-only">Choose a report</legend>
            {!targets && !error && (
              <p className="text-sm text-[var(--text-muted)]" role="status">
                Loading your reports…
              </p>
            )}
            {targets?.map((t) => (
              <label
                key={t.id}
                className={`flex min-h-9 items-start gap-2 rounded-md border border-[var(--border)] p-2 text-sm ${t.full ? "opacity-60" : "cursor-pointer"}`}
              >
                <input
                  type="radio"
                  name="report"
                  value={t.id}
                  checked={choice === t.id}
                  disabled={t.full}
                  onChange={() => setChoice(t.id)}
                  className="mt-1"
                  data-testid="atr-report"
                />
                <span>
                  {t.name}
                  <span className="block text-xs text-[var(--text-muted)]">
                    {t.full
                      ? `Full: ${MAX_SECTIONS} sections`
                      : `${t.sections} section${t.sections === 1 ? "" : "s"}`}
                  </span>
                </span>
              </label>
            ))}
            {targets && (
              <label className="flex min-h-9 cursor-pointer items-start gap-2 rounded-md border border-[var(--border)] p-2 text-sm">
                <input
                  type="radio"
                  name="report"
                  value={NEW}
                  checked={choice === NEW}
                  onChange={() => setChoice(NEW)}
                  className="mt-1"
                  data-testid="atr-new"
                />
                <span>
                  A new report
                  <span className="block text-xs text-[var(--text-muted)]">
                    Starts with just this section. Rename it and add more from Reports.
                  </span>
                </span>
              </label>
            )}
          </fieldset>
          <div aria-live="polite">
            {error && (
              <p role="alert" className="mt-3 text-sm text-[var(--danger)]" data-testid="atr-error">
                {error.text}{" "}
                {error.upgrade && (
                  <Link href="/upgrade?from=report_section_locked" className="underline">
                    See plans
                  </Link>
                )}
              </p>
            )}
          </div>
          <div className="mt-5 flex gap-3">
            <Button type="submit" loading={pending} disabled={!targets} data-testid="atr-submit">
              Add section
            </Button>
            <Button type="button" variant="secondary" onClick={() => ref.current?.close()}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </dialog>
  );
}

/** A button that opens the dialog; used on pages that aren't dashboards. */
export function AddToReportButton({
  ws,
  draft,
  source,
}: {
  ws: string;
  draft: SectionDraft;
  source: "topics" | "authors";
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="min-h-9 rounded-md border border-[var(--border)] px-4 text-sm hover:bg-[var(--surface-2)]"
        data-testid="add-to-report"
      >
        Add to report
      </button>
      {open && (
        <AddToReportDialog ws={ws} draft={draft} source={source} onClose={() => setOpen(false)} />
      )}
    </>
  );
}
