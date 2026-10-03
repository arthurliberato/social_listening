"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { deleteReport, saveReport } from "@/app/w/[ws]/reports/actions";
import type { DraftWidget } from "@/components/dashboards/DashboardGrid";
import { WidgetConfigDialog } from "@/components/dashboards/WidgetConfigDialog";
import { WidgetPicker } from "@/components/dashboards/WidgetPicker";
import { PaywallModal, type PaywallProps } from "@/components/listening/PaywallModal";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Menu } from "@/components/ui/menu";
import { track } from "@/lib/analytics/client";
import { WIDGETS, type WidgetType } from "@/lib/dashboards/catalog";
import { PLANS, planUnlocking, type Entitlements, type PlanTier } from "@/lib/entitlements/plans";
import { describeSchedule } from "@/lib/reports/schedule";
import { RANGE_LABEL, RANGES, type ReportRange, type Section } from "@/lib/reports/types";
import { ScheduleDialog, type ScheduleState } from "./ScheduleDialog";
import { SectionCard } from "./SectionCard";

interface Member {
  id: string;
  name: string;
  role: string;
}

const uid = () => Math.random().toString(36).slice(2, 10);
const sel =
  "min-h-9 rounded-[var(--radius-input)] border border-[var(--border)] bg-[var(--surface)] px-3 text-sm";

export function ReportView({
  ws,
  report,
  canEdit,
  canExport,
  features,
  queries,
  members,
  meId,
  schedule: initialSchedule,
  startEditing,
}: {
  ws: string;
  report: {
    id: string;
    name: string;
    description: string;
    range: ReportRange;
    templateId: string | null;
    sections: Section[];
  };
  canEdit: boolean;
  canExport: boolean;
  features: Entitlements["features"];
  queries: { id: string; name: string }[];
  members: Member[];
  meId: string;
  schedule: ScheduleState | null;
  startEditing: boolean;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState(report);
  const [editing, setEditing] = useState(startEditing && canEdit);
  const [name, setName] = useState(saved.name);
  const [description, setDescription] = useState(saved.description);
  const [range, setRange] = useState<ReportRange>(saved.range);
  const [sections, setSections] = useState<Section[]>(saved.sections);
  const [schedule, setSchedule] = useState(initialSchedule);
  const [busy, setBusy] = useState<"save" | "delete" | null>(null);
  const [error, setError] = useState("");
  const [picker, setPicker] = useState(false);
  const [configId, setConfigId] = useState<string | null>(null);
  const [scheduling, setScheduling] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [paywall, setPaywall] = useState<PaywallProps | null>(null);

  const shown = editing ? { name, range, sections } : saved;
  const dirty =
    editing &&
    (name !== saved.name ||
      description !== saved.description ||
      range !== saved.range ||
      JSON.stringify(sections) !== JSON.stringify(saved.sections));

  const upsell = (
    trigger: string,
    title: string,
    reason: string,
    to: PlanTier,
    bullets: string[],
  ) => {
    const p = PLANS[to];
    setPaywall({
      trigger,
      title,
      reason,
      planLabel: p.label,
      priceLine: p.priceMonthly ? `${p.label} is $${p.priceMonthly}/month.` : undefined,
      bullets,
      onClose: () => setPaywall(null),
    });
  };
  const lockedWidget = (t: WidgetType) => {
    const need = WIDGETS[t].requires!;
    const to = planUnlocking(need);
    upsell(
      "report_section_locked",
      `${WIDGETS[t].label} is on a higher plan`,
      `Add it to your reports on the ${PLANS[to].label} plan and above.`,
      to,
      [WIDGETS[t].description, "Scheduled reports by email", "Public share links"],
    );
  };
  const scheduleLocked = (reason: string) => {
    setScheduling(false);
    const to = planUnlocking("scheduledReports");
    upsell("scheduled_reports", "Scheduled reports are on a higher plan", reason, to, [
      "Reports emailed on a schedule",
      "Daily, weekly or monthly",
      "Outside recipients",
    ]);
  };

  const move = (i: number, dir: -1 | 1) =>
    setSections((s) => {
      const n = [...s];
      const [x] = n.splice(i, 1);
      n.splice(i + dir, 0, x!);
      return n;
    });
  const configFor: DraftWidget | null = useMemo(() => {
    const s = sections.find((x) => x.id === configId);
    return s
      ? { id: s.id, type: s.type, title: s.title, config: s.config, x: 0, y: 0, w: 12, h: 3 }
      : null;
  }, [configId, sections]);

  const save = async () => {
    setBusy("save");
    setError("");
    const next = { name, description, range, sections };
    const r = await saveReport(ws, saved.id, next);
    setBusy(null);
    if (!r.ok) return setError(r.error);
    setSaved({ ...saved, ...next });
    setEditing(false);
    router.refresh();
  };
  const cancel = () => {
    setName(saved.name);
    setDescription(saved.description);
    setRange(saved.range);
    setSections(saved.sections);
    setEditing(false);
    setError("");
  };
  const remove = async () => {
    setBusy("delete");
    const r = await deleteReport(ws, saved.id);
    setBusy(null);
    if (!r.ok) return setError(r.error);
    router.push(`/w/${ws}/reports`);
  };
  const download = (format: "pdf" | "csv") => {
    track("Report Exported", { format, template_id: saved.templateId ?? "custom" });
    window.location.assign(`/api/w/${ws}/reports/${saved.id}/export?format=${format}`);
  };

  return (
    <div className="mx-auto max-w-5xl" data-testid="report">
      {paywall && <PaywallModal {...paywall} />}
      <div className="flex flex-wrap items-center gap-3">
        {editing ? (
          <div className="min-w-64 flex-1">
            <Field
              label="Report name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              data-testid="report-name"
            />
          </div>
        ) : (
          <h1 className="text-[30px] font-semibold leading-[38px]" data-testid="report-title">
            {saved.name}
          </h1>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {editing ? (
            <>
              <Button
                onClick={save}
                loading={busy === "save"}
                disabled={!dirty}
                data-testid="save-report"
              >
                Save report
              </Button>
              <Button variant="secondary" onClick={cancel} data-testid="cancel-edit">
                Cancel
              </Button>
            </>
          ) : (
            <>
              {canExport && (
                <Menu
                  label="Export"
                  testId="export-menu"
                  align="right"
                  items={[
                    {
                      key: "pdf",
                      label: "PDF (formatted report)",
                      onSelect: () => download("pdf"),
                      testId: "export-pdf",
                    },
                    {
                      key: "csv",
                      label: "CSV (all the tables)",
                      onSelect: () => download("csv"),
                      testId: "export-csv",
                    },
                  ]}
                />
              )}
              {canEdit && (
                <>
                  <Button
                    variant="secondary"
                    onClick={() => setScheduling(true)}
                    data-testid="open-schedule"
                  >
                    {schedule ? "Schedule" : "Schedule…"}
                  </Button>
                  <Button onClick={() => setEditing(true)} data-testid="edit-report">
                    Edit
                  </Button>
                </>
              )}
            </>
          )}
        </div>
      </div>

      {editing ? (
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div className="min-w-64 flex-1">
            <Field
              label="Description (optional)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={300}
              data-testid="report-description"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="report-range" className="text-sm font-medium">
              Date range
            </label>
            <select
              id="report-range"
              value={range}
              onChange={(e) => setRange(e.target.value as ReportRange)}
              className={sel}
              data-testid="report-range"
            >
              {RANGES.map((r) => (
                <option key={r} value={r}>
                  {RANGE_LABEL[r]}
                </option>
              ))}
            </select>
          </div>
        </div>
      ) : (
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          {RANGE_LABEL[saved.range]}
          {saved.description ? ` · ${saved.description}` : ""}
          {schedule && (
            <span data-testid="schedule-badge">
              {" · "}
              {describeSchedule(schedule)}
            </span>
          )}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-[var(--danger)]" data-testid="report-error">
          {error}
        </p>
      )}

      {shown.sections.length === 0 ? (
        <section
          className="mt-6 rounded-lg border border-dashed border-[var(--border)] p-10 text-center"
          data-testid="report-empty"
        >
          <h2 className="text-lg font-semibold">This report has no sections yet</h2>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Add charts and tables to build it.
          </p>
          {canEdit && (
            <Button
              className="mt-4"
              onClick={() => {
                setEditing(true);
                setPicker(true);
              }}
              data-testid="empty-add-section"
            >
              Add a section
            </Button>
          )}
        </section>
      ) : (
        <div className="mt-6 flex flex-col gap-4" data-testid="report-sections">
          {shown.sections.map((s, i) => (
            <SectionCard
              key={s.id}
              ws={ws}
              section={s}
              range={shown.range}
              editing={editing}
              first={i === 0}
              last={i === shown.sections.length - 1}
              onMove={(d) => move(i, d)}
              onSettings={() => setConfigId(s.id)}
              onRemove={() => setSections((x) => x.filter((y) => y.id !== s.id))}
              onUpgrade={() => lockedWidget(s.type)}
            />
          ))}
        </div>
      )}

      {editing && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            onClick={() => setPicker(true)}
            disabled={sections.length >= 20}
            data-testid="add-section"
          >
            Add a section
          </Button>
          {sections.length >= 20 && (
            <span className="text-sm text-[var(--text-muted)]">
              A report can have up to 20 sections.
            </span>
          )}
          <span className="ml-auto" />
          {confirmDelete ? (
            <span
              role="group"
              aria-label="Confirm deleting this report"
              className="flex items-center gap-2"
            >
              <span className="text-sm">Delete this report and its schedule?</span>
              <Button
                variant="destructive"
                onClick={remove}
                loading={busy === "delete"}
                data-testid="delete-confirm"
              >
                Delete report
              </Button>
              <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
                Keep it
              </Button>
            </span>
          ) : (
            <Button
              variant="ghost"
              onClick={() => setConfirmDelete(true)}
              data-testid="delete-report"
            >
              Delete report
            </Button>
          )}
        </div>
      )}

      <WidgetPicker
        open={picker}
        features={features}
        onAdd={(t) => {
          const def = WIDGETS[t];
          setSections((s) => [...s, { id: uid(), type: t, title: def.label, config: {} }]);
          setPicker(false);
        }}
        onLocked={(t) => {
          setPicker(false);
          lockedWidget(t);
        }}
        onClose={() => setPicker(false)}
      />
      <WidgetConfigDialog
        widget={configFor}
        queries={queries}
        features={features}
        onApply={(id, patch) => {
          setSections((s) => s.map((x) => (x.id === id ? { ...x, ...patch } : x)));
          setConfigId(null);
        }}
        onClose={() => setConfigId(null)}
      />
      <ScheduleDialog
        open={scheduling}
        ws={ws}
        reportId={saved.id}
        members={members}
        meId={meId}
        schedule={schedule}
        onSaved={setSchedule}
        onPaywall={scheduleLocked}
        onClose={() => setScheduling(false)}
      />
    </div>
  );
}
