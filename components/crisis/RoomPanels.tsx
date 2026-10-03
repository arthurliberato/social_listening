"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { addTask, sendUpdate, setResolved, toggleTask } from "@/app/w/[ws]/crisis/actions";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { track } from "@/lib/analytics/client";

/** Fires "Crisis Room Opened" once per page view. */
export function RoomOpened({
  crisisId,
  peakVolume,
  negativeShare,
}: {
  crisisId: string;
  peakVolume: number;
  negativeShare: number;
}) {
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    track("Crisis Room Opened", {
      crisis_id: crisisId,
      peak_volume: peakVolume,
      negative_share: negativeShare,
    });
  }, [crisisId, peakVolume, negativeShare]);
  return null;
}

interface Task {
  id: string;
  title: string;
  done: boolean;
  assignee: string | null;
}
interface Member {
  id: string;
  name: string;
  role: string;
}

export function TaskList({
  ws,
  crisisId,
  tasks,
  members,
  canEdit,
}: {
  ws: string;
  crisisId: string;
  tasks: Task[];
  members: Member[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [assignee, setAssignee] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // Optimistic: the box flips at once and reverts if the server refuses.
  const [flipped, setFlipped] = useState<Record<string, boolean>>({});

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const r = await addTask(ws, crisisId, title, assignee || null);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    track("Crisis Task Created", { crisis_id: crisisId });
    setTitle("");
    router.refresh();
  };
  const toggle = async (t: Task) => {
    setError("");
    const next = !(flipped[t.id] ?? t.done);
    setFlipped((f) => ({ ...f, [t.id]: next }));
    const r = await toggleTask(ws, crisisId, t.id, next);
    if (!r.ok) {
      setFlipped((f) => ({ ...f, [t.id]: !next }));
      return setError(r.error);
    }
    router.refresh();
  };

  return (
    <section aria-labelledby="tasks-h" data-testid="tasks">
      <h2 id="tasks-h" className="text-lg font-semibold">
        Response plan
      </h2>
      {tasks.length === 0 ? (
        <p className="mt-2 text-sm text-[var(--text-muted)]" data-testid="tasks-empty">
          No tasks yet. Write down who is doing what so nothing falls through.
        </p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1">
          {tasks.map((raw) => {
            const t = { ...raw, done: flipped[raw.id] ?? raw.done };
            return (
              <li key={t.id} className="flex items-center gap-2 text-sm" data-testid="task">
                <label className="flex min-h-6 items-center gap-2">
                  <input
                    type="checkbox"
                    checked={t.done}
                    disabled={!canEdit}
                    onChange={() => toggle(raw)}
                    className="h-4 w-4"
                  />
                  <span className={t.done ? "text-[var(--text-muted)] line-through" : ""}>
                    {t.title}
                  </span>
                </label>
                {t.assignee && (
                  <span className="text-xs text-[var(--text-muted)]">· {t.assignee}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {canEdit && (
        <form onSubmit={add} className="mt-3 flex flex-wrap items-end gap-2">
          <div className="min-w-56 flex-1">
            <Field
              label="New task"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              data-testid="task-title"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="task-assignee" className="text-sm font-medium">
              Owner
            </label>
            <select
              id="task-assignee"
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
              className="min-h-9 rounded-[var(--radius-input)] border border-[var(--border)] bg-[var(--surface)] px-3 text-sm"
              data-testid="task-assignee"
            >
              <option value="">Unassigned</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
          <Button type="submit" variant="secondary" loading={busy} data-testid="add-task">
            Add task
          </Button>
        </form>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-[var(--danger)]">
          {error}
        </p>
      )}
    </section>
  );
}

export function UpdateComposer({
  ws,
  crisisId,
  members,
  draftSubject,
  draftBody,
}: {
  ws: string;
  crisisId: string;
  members: Member[];
  draftSubject: string;
  draftBody: string;
}) {
  const router = useRouter();
  const [subject, setSubject] = useState(draftSubject);
  const [body, setBody] = useState(draftBody);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState<number | null>(null);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    setSent(null);
    const r = await sendUpdate(ws, crisisId, { subject, body, recipientIds: [...picked] });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    track("Stakeholder Update Sent", {
      crisis_id: crisisId,
      recipients_count: r.sent,
      is_ai_drafted: false,
    });
    setSent(r.sent);
    router.refresh();
  };

  return (
    <section aria-labelledby="update-h" data-testid="update-composer">
      <h2 id="update-h" className="text-lg font-semibold">
        Stakeholder update
      </h2>
      <p className="mt-1 text-sm text-[var(--text-muted)]">
        Drafted from the latest numbers. Edit it, pick who should hear it, and send.
      </p>
      <form onSubmit={send} className="mt-3 flex flex-col gap-3" noValidate>
        <Field
          label="Subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          maxLength={150}
          data-testid="update-subject"
        />
        <div className="flex flex-col gap-1">
          <label htmlFor="update-body" className="text-sm font-medium">
            Message
          </label>
          <textarea
            id="update-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={9}
            maxLength={5000}
            className="rounded-[var(--radius-input)] border border-[var(--border)] bg-[var(--surface)] p-3 text-sm"
            data-testid="update-body"
          />
        </div>
        <fieldset>
          <legend className="text-sm font-medium">Send to</legend>
          <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
            {members.map((m) => (
              <li key={m.id}>
                <label className="flex min-h-6 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={picked.has(m.id)}
                    onChange={(e) => {
                      const n = new Set(picked);
                      if (e.target.checked) n.add(m.id);
                      else n.delete(m.id);
                      setPicked(n);
                    }}
                    className="h-4 w-4"
                    data-testid={`recipient-${m.name}`}
                  />
                  {m.name}{" "}
                  <span className="text-xs text-[var(--text-muted)]">
                    ({m.role.replace("_", " ")})
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
        <div className="flex items-center gap-3">
          <Button type="submit" loading={busy} data-testid="send-update">
            Send update
          </Button>
          {sent !== null && (
            <span role="status" className="text-sm" data-testid="update-sent">
              Sent to {sent} {sent === 1 ? "person" : "people"}.
            </span>
          )}
        </div>
        {error && (
          <p role="alert" className="text-sm text-[var(--danger)]" data-testid="update-error">
            {error}
          </p>
        )}
      </form>
    </section>
  );
}

export function ResolveButton({
  ws,
  crisisId,
  resolved,
  openTasks,
}: {
  ws: string;
  crisisId: string;
  resolved: boolean;
  openTasks: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState("");

  const run = async () => {
    setBusy(true);
    setError("");
    const r = await setResolved(ws, crisisId, !resolved);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    if (!resolved)
      track("Crisis Room Resolved", { crisis_id: crisisId, duration_ms: r.durationMs });
    setConfirm(false);
    router.refresh();
  };

  if (resolved)
    return (
      <Button variant="secondary" onClick={run} loading={busy} data-testid="reopen">
        Reopen
      </Button>
    );
  return (
    <div className="flex flex-wrap items-center gap-2">
      {confirm ? (
        <div
          role="group"
          aria-label="Confirm resolving"
          className="flex flex-wrap items-center gap-2"
        >
          <span className="text-sm">
            {openTasks > 0
              ? `${openTasks} task${openTasks === 1 ? " is" : "s are"} still open. `
              : ""}
            Mark this crisis resolved?
          </span>
          <Button onClick={run} loading={busy} data-testid="resolve-confirm">
            Yes, resolve
          </Button>
          <Button variant="ghost" onClick={() => setConfirm(false)}>
            Not yet
          </Button>
        </div>
      ) : (
        <Button variant="secondary" onClick={() => setConfirm(true)} data-testid="resolve">
          Mark resolved
        </Button>
      )}
      {error && (
        <span role="alert" className="text-sm text-[var(--danger)]">
          {error}
        </span>
      )}
    </div>
  );
}
