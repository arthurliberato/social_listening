"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteAlert, setAlertMuted } from "@/app/w/[ws]/alerts/actions";
import { Button } from "@/components/ui/button";
import { track } from "@/lib/analytics/client";

export function AlertRowActions({
  ws,
  id,
  name,
  muted,
  canEdit,
}: {
  ws: string;
  id: string;
  name: string;
  muted: boolean;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  if (!canEdit) return <span className="text-xs text-[var(--text-muted)]">View only</span>;

  const toggle = () =>
    start(async () => {
      setError("");
      const r = await setAlertMuted(ws, id, !muted);
      if (!r.ok) return setError(r.error);
      if (!muted) track("Alert Muted", { alert_id: id });
      router.refresh();
    });
  const remove = () =>
    start(async () => {
      const r = await deleteAlert(ws, id);
      if (!r.ok) return setError(r.error);
      track("Alert Deleted", { alert_id: id });
      router.refresh();
    });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        variant="secondary"
        onClick={toggle}
        loading={pending}
        aria-label={`${muted ? "Unmute" : "Mute"} ${name}`}
        data-testid="alert-mute"
      >
        {muted ? "Unmute" : "Mute"}
      </Button>
      {confirming ? (
        <span className="flex items-center gap-2" role="group" aria-label={`Delete ${name}?`}>
          <Button
            size="sm"
            variant="destructive"
            onClick={remove}
            loading={pending}
            data-testid="alert-delete-confirm"
          >
            Delete alert
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
            Keep it
          </Button>
        </span>
      ) : (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setConfirming(true)}
          aria-label={`Delete ${name}`}
          data-testid="alert-delete"
        >
          Delete
        </Button>
      )}
      {error && (
        <span role="alert" className="text-xs text-[var(--danger)]">
          {error}
        </span>
      )}
    </div>
  );
}
