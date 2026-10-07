"use client";

import type { CampaignSnapshot } from "@/lib/creators/campaigns";
import { useState } from "react";
import {
  removeCampaignCreator,
  updateCampaignCreator,
} from "@/app/w/[ws]/creators/campaigns/actions";
import {
  STATUS_LABEL,
  isCreatorStatus,
  nextStatuses,
  type CreatorStatus,
} from "@/lib/creators/campaign-flow";
import { useBusy } from "@/lib/use-busy";
import { OutreachPanel } from "./OutreachPanel";

/**
 * Moves the outreach panel owns: sending an invitation, and reviewing content the creator submitted. When content
 * was marked received by hand (no submission to review), the manual approve / send-back moves stay available.
 */
function handledByOutreach(
  status: CreatorStatus,
  to: CreatorStatus,
  full: CampaignSnapshot["roster"][number],
) {
  if (status === "shortlisted") return to === "invited";
  if (status === "content_submitted" && full.content?.status === "submitted")
    return to === "approved" || to === "confirmed";
  return false;
}

const STEP_VERB: Record<CreatorStatus, string> = {
  shortlisted: "Reconsider",
  invited: "Mark invited",
  negotiating: "Start negotiating",
  confirmed: "Confirm",
  content_submitted: "Content received",
  approved: "Approve content",
  paid: "Mark paid",
  declined: "Decline",
};

/** One creator on the roster: their status, the moves the pipeline allows next, the agreed fee, and a note. */
export function RosterRow({
  ws,
  campaignId,
  row,
  editable,
  onSnapshot,
  brand,
  campaignName,
  quota,
  full,
}: {
  onSnapshot: (s: CampaignSnapshot) => void;
  brand: string;
  campaignName: string;
  quota: { used: number; limit: number };
  full: CampaignSnapshot["roster"][number];
  ws: string;
  campaignId: string;
  row: {
    creatorId: number;
    name: string;
    status: string;
    feeUsd: number | null;
    note: string;
    suggestedFee: number;
  };
  editable: boolean;
}) {
  const status: CreatorStatus = isCreatorStatus(row.status) ? row.status : "shortlisted";
  const [fee, setFee] = useState(row.feeUsd == null ? "" : String(row.feeUsd));
  const [note, setNote] = useState(row.note);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [busy, run] = useBusy();

  const send = (to: string, extra: { note?: string } = {}) =>
    run(async () => {
      setError("");
      setWarning("");
      const r = await updateCampaignCreator(ws, campaignId, row.creatorId, {
        to,
        feeUsd: fee === "" ? null : Number(fee),
        ...extra,
      });
      if (!r.ok) return setError(r.error);
      onSnapshot(r.snapshot);
      if (r.warning) setWarning(r.warning);
    });

  return (
    <div className="flex flex-col gap-2">
      <OutreachPanel
        ws={ws}
        campaignId={campaignId}
        brand={brand}
        campaignName={campaignName}
        row={full}
        quota={quota}
        editable={editable}
        onSnapshot={onSnapshot}
      />
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor={`fee-${row.creatorId}`} className="text-xs text-[var(--text-muted)]">
            Agreed fee (USD)
          </label>
          <input
            id={`fee-${row.creatorId}`}
            type="number"
            min={0}
            step={1}
            value={fee}
            placeholder={String(row.suggestedFee)}
            disabled={!editable || status === "paid"}
            onChange={(e) => setFee(e.target.value)}
            onBlur={() => {
              if ((row.feeUsd == null ? "" : String(row.feeUsd)) !== fee) send(status);
            }}
            className="min-h-8 w-28 rounded-[var(--radius-input)] border border-[var(--border)] bg-[var(--surface)] px-2 text-sm tabular-nums disabled:opacity-60"
            data-testid="creator-fee"
          />
        </div>
        <div
          className="flex flex-wrap gap-2"
          role="group"
          aria-label={`Next steps for ${row.name}`}
        >
          {nextStatuses(status)
            .filter((to) => !handledByOutreach(status, to, full))
            .map((to) => (
              <button
                key={to}
                type="button"
                disabled={!editable || busy}
                onClick={() => send(to)}
                data-testid={`move-${to}`}
                className="min-h-8 rounded-md border border-[var(--border)] px-3 text-sm hover:bg-[var(--surface-2)] disabled:opacity-60"
              >
                {status === "content_submitted" && to === "confirmed"
                  ? "Request changes"
                  : STEP_VERB[to]}
                <span className="sr-only"> for {row.name}</span>
              </button>
            ))}
          <button
            type="button"
            disabled={!editable || busy}
            onClick={() =>
              run(async () => {
                const r = await removeCampaignCreator(ws, campaignId, row.creatorId);
                if (!r.ok) return setError(r.error);
                onSnapshot(r.snapshot);
              })
            }
            data-testid="remove-creator"
            className="min-h-8 rounded-md px-3 text-sm text-[var(--text-muted)] underline disabled:opacity-60"
          >
            Remove<span className="sr-only"> {row.name}</span>
          </button>
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={`note-${row.creatorId}`} className="text-xs text-[var(--text-muted)]">
          Note
        </label>
        <input
          id={`note-${row.creatorId}`}
          value={note}
          maxLength={500}
          disabled={!editable}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => {
            if (note !== row.note) send(status, { note });
          }}
          className="min-h-8 rounded-[var(--radius-input)] border border-[var(--border)] bg-[var(--surface)] px-2 text-sm disabled:opacity-60"
        />
      </div>
      {error && (
        <p role="alert" className="text-xs text-[var(--danger)]" data-testid="roster-error">
          {error}
        </p>
      )}
      {warning && (
        <p role="status" className="text-xs text-[var(--warning)]" data-testid="roster-warning">
          {warning}
        </p>
      )}
      <span className="sr-only">Status: {STATUS_LABEL[status]}</span>
    </div>
  );
}
