"use client";

import { useEffect, useRef, useState } from "react";
import { saveSchedule, sendCopyNow, stopSchedule } from "@/app/w/[ws]/reports/actions";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { track } from "@/lib/analytics/client";
import {
  describeSchedule,
  FREQUENCIES,
  WEEKDAY_NAMES,
  type Frequency,
} from "@/lib/reports/schedule";

export interface ScheduleState {
  frequency: Frequency;
  weekday: number;
  dayOfMonth: number;
  hourUtc: number;
  recipientIds: string[];
  externalEmails: string[];
  nextRunAt: string;
}
interface Member {
  id: string;
  name: string;
  role: string;
}

const sel =
  "min-h-9 rounded-[var(--radius-input)] border border-[var(--border)] bg-[var(--surface)] px-3 text-sm";

export function ScheduleDialog({
  open,
  ws,
  reportId,
  members,
  meId,
  schedule,
  onSaved,
  onPaywall,
  onClose,
}: {
  open: boolean;
  ws: string;
  reportId: string;
  members: Member[];
  meId: string;
  schedule: ScheduleState | null;
  onSaved: (s: ScheduleState | null) => void;
  onPaywall: (reason: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [frequency, setFrequency] = useState<Frequency>(schedule?.frequency ?? "weekly");
  const [weekday, setWeekday] = useState(schedule?.weekday ?? 1);
  const [dayOfMonth, setDayOfMonth] = useState(schedule?.dayOfMonth ?? 1);
  const [hourUtc, setHourUtc] = useState(schedule?.hourUtc ?? 8);
  const [picked, setPicked] = useState(new Set(schedule?.recipientIds ?? [meId]));
  const [external, setExternal] = useState((schedule?.externalEmails ?? []).join(", "));
  const [busy, setBusy] = useState<"save" | "stop" | "copy" | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  const externals = external.split(/[\s,;]+/).filter(Boolean);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy("save");
    setError("");
    setNote("");
    const r = await saveSchedule(ws, reportId, {
      frequency,
      weekday,
      dayOfMonth,
      hourUtc,
      recipientIds: [...picked],
      externalEmails: externals,
    });
    setBusy(null);
    if (!r.ok) {
      if ("paywall" in r && r.paywall) return onPaywall(r.error);
      return setError(r.error);
    }
    track("Report Scheduled", {
      schedule_frequency: frequency,
      recipients_count: r.recipients + r.external,
      has_external_recipient: r.external > 0,
    });
    onSaved({
      frequency,
      weekday,
      dayOfMonth,
      hourUtc,
      recipientIds: [...picked],
      externalEmails: externals,
      nextRunAt: r.nextRunAt,
    });
    setNote(`Scheduled. ${describeSchedule({ frequency, weekday, dayOfMonth, hourUtc })}.`);
  };
  const stop = async () => {
    setBusy("stop");
    const r = await stopSchedule(ws, reportId);
    setBusy(null);
    if (!r.ok) return setError(r.error);
    onSaved(null);
    onClose();
  };
  const copy = async () => {
    setBusy("copy");
    setError("");
    setNote("");
    const r = await sendCopyNow(ws, reportId);
    setBusy(null);
    if (!r.ok) return setError(r.error);
    setNote("Sent. Check your inbox.");
  };

  return (
    <dialog
      ref={ref}
      aria-labelledby="sch-title"
      onClose={onClose}
      data-testid="schedule-dialog"
      className="m-auto w-full max-w-lg rounded-[var(--radius-modal)] border border-[var(--border)] bg-[var(--surface)] p-6 text-[var(--text)] backdrop:bg-black/40"
    >
      <h2 id="sch-title" className="text-xl font-semibold">
        Schedule this report
      </h2>
      <form onSubmit={save} className="mt-4 flex flex-col gap-4" noValidate>
        <div className="flex flex-wrap gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="sch-freq" className="text-sm font-medium">
              Repeat
            </label>
            <select
              id="sch-freq"
              value={frequency}
              onChange={(e) => setFrequency(e.target.value as Frequency)}
              className={sel}
              data-testid="sch-frequency"
            >
              {FREQUENCIES.map((f) => (
                <option key={f} value={f}>
                  {f[0]!.toUpperCase() + f.slice(1)}
                </option>
              ))}
            </select>
          </div>
          {frequency === "weekly" && (
            <div className="flex flex-col gap-1">
              <label htmlFor="sch-day" className="text-sm font-medium">
                On
              </label>
              <select
                id="sch-day"
                value={weekday}
                onChange={(e) => setWeekday(Number(e.target.value))}
                className={sel}
                data-testid="sch-weekday"
              >
                {WEEKDAY_NAMES.map((n, i) => (
                  <option key={n} value={i}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
          )}
          {frequency === "monthly" && (
            <div className="flex flex-col gap-1">
              <label htmlFor="sch-dom" className="text-sm font-medium">
                On day
              </label>
              <select
                id="sch-dom"
                value={dayOfMonth}
                onChange={(e) => setDayOfMonth(Number(e.target.value))}
                className={sel}
                data-testid="sch-dom"
              >
                {Array.from({ length: 28 }, (_, i) => (
                  <option key={i + 1} value={i + 1}>
                    {i + 1}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="flex flex-col gap-1">
            <label htmlFor="sch-hour" className="text-sm font-medium">
              At (UTC)
            </label>
            <select
              id="sch-hour"
              value={hourUtc}
              onChange={(e) => setHourUtc(Number(e.target.value))}
              className={sel}
              data-testid="sch-hour"
            >
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {String(h).padStart(2, "0")}:00
                </option>
              ))}
            </select>
          </div>
        </div>
        <p className="text-sm text-[var(--text-muted)]" data-testid="sch-summary">
          {describeSchedule({ frequency, weekday, dayOfMonth, hourUtc })}.
          {schedule &&
            ` Next send: ${new Date(schedule.nextRunAt).toISOString().slice(0, 16).replace("T", " ")} UTC.`}
        </p>
        <fieldset>
          <legend className="text-sm font-medium">Send to people in this workspace</legend>
          <ul className="mt-1 flex flex-col gap-1">
            {members.map((m) => (
              <li key={m.id}>
                <label className="flex min-h-6 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={picked.has(m.id)}
                    onChange={(e) => {
                      const n = new Set(picked);
                      if (e.target.checked) n.add(m.id);
                      else n.delete(m.id);
                      setPicked(n);
                    }}
                    data-testid={`sch-recipient-${m.name}`}
                  />
                  {m.name}
                  {m.id === meId ? " (you)" : ""}{" "}
                  <span className="text-xs text-[var(--text-muted)]">
                    · {m.role.replace("_", " ")}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
        <Field
          label="Also send to outside addresses (optional)"
          value={external}
          onChange={(e) => setExternal(e.target.value)}
          placeholder="client@example.com, board@example.org"
          hint="They get a plain copy and a link to sign in. Only add people who should see this data."
          data-testid="sch-external"
        />
        {error && (
          <p role="alert" className="text-sm text-[var(--danger)]" data-testid="sch-error">
            {error}
          </p>
        )}
        {note && (
          <p role="status" className="text-sm" data-testid="sch-note">
            {note}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" loading={busy === "save"} data-testid="sch-save">
            {schedule ? "Update schedule" : "Start schedule"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={copy}
            loading={busy === "copy"}
            data-testid="sch-send-now"
          >
            Email me a copy now
          </Button>
          {schedule && (
            <Button
              type="button"
              variant="ghost"
              onClick={stop}
              loading={busy === "stop"}
              data-testid="sch-stop"
            >
              Stop schedule
            </Button>
          )}
          <Button type="button" variant="ghost" onClick={onClose} className="ml-auto">
            Close
          </Button>
        </div>
      </form>
    </dialog>
  );
}
