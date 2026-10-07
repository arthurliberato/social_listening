"use client";

import { useState } from "react";
import {
  addListToCampaign,
  setCampaignStatus,
  updateCampaign,
} from "@/app/w/[ws]/creators/campaigns/actions";
import { PaywallModal } from "@/components/listening/PaywallModal";
import { Button } from "@/components/ui/button";
import {
  CAMPAIGN_NEXT,
  OBJECTIVES,
  OBJECTIVE_LABEL,
  type CampaignStatus,
} from "@/lib/creators/campaign-flow";
import { PLANS, type PlanTier } from "@/lib/entitlements/plans";
import { useBusy } from "@/lib/use-busy";

const box =
  "min-h-9 rounded-[var(--radius-input)] border border-[var(--border)] bg-[var(--surface)] px-3 text-sm";
const MOVE_LABEL: Record<CampaignStatus, string> = {
  draft: "Move back to draft",
  active: "Start campaign",
  completed: "Mark completed",
  archived: "Archive",
};

/** Lifecycle buttons for the campaign itself. Only the moves the rules allow are offered. */
export function StatusButtons({
  ws,
  id,
  status,
  canEdit,
}: {
  ws: string;
  id: string;
  status: CampaignStatus;
  canEdit: boolean;
}) {
  const [error, setError] = useState("");
  const [paywall, setPaywall] = useState<{ reason: string; to: PlanTier } | null>(null);
  const [busy, run] = useBusy();
  const p = paywall ? PLANS[paywall.to] : null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {CAMPAIGN_NEXT[status].map((to) => (
        <Button
          key={to}
          variant={to === "active" ? "primary" : "secondary"}
          disabled={!canEdit}
          loading={busy}
          data-testid={`campaign-to-${to}`}
          onClick={() =>
            run(async () => {
              setError("");
              const r = await setCampaignStatus(ws, id, to);
              if (!r.ok) {
                if (r.upgradeTo) return setPaywall({ reason: r.error, to: r.upgradeTo });
                return setError(r.error);
              }
            })
          }
        >
          {to === "active" && status === "completed" ? "Re-open" : MOVE_LABEL[to]}
        </Button>
      ))}
      {error && (
        <span role="alert" className="text-sm text-[var(--danger)]">
          {error}
        </span>
      )}
      {paywall && p && (
        <PaywallModal
          trigger="campaign_limit"
          title="You've reached your campaign limit"
          reason={paywall.reason}
          planLabel={p.label}
          priceLine={p.priceMonthly ? `${p.label} is $${p.priceMonthly}/month.` : undefined}
          bullets={[`${p.activeCampaigns} active campaigns`, `${p.creatorLists} creator lists`]}
          onClose={() => setPaywall(null)}
        />
      )}
    </div>
  );
}

export function EditDetails({
  ws,
  id,
  initial,
  canEdit,
}: {
  ws: string;
  id: string;
  initial: {
    name: string;
    objective: string;
    brief: string;
    budgetUsd: number;
    startsOn: string | null;
    endsOn: string | null;
  };
  canEdit: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [busy, run] = useBusy();
  if (!open)
    return (
      <Button
        variant="secondary"
        disabled={!canEdit}
        onClick={() => setOpen(true)}
        data-testid="campaign-edit"
      >
        Edit details
      </Button>
    );
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        run(async () => {
          setError("");
          const r = await updateCampaign(ws, id, {
            name: String(f.get("name") ?? ""),
            objective: String(f.get("objective")) as (typeof OBJECTIVES)[number],
            brief: String(f.get("brief") ?? ""),
            budgetUsd: Number(f.get("budget") || 0),
            startsOn: String(f.get("starts") || "") || null,
            endsOn: String(f.get("ends") || "") || null,
          });
          if (!r.ok) return setError(r.error);
          setOpen(false);
        });
      }}
      className="grid w-full gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 md:grid-cols-2"
      aria-label="Edit campaign details"
      data-testid="campaign-edit-form"
    >
      <div className="flex flex-col gap-1 md:col-span-2">
        <label htmlFor="ed-name" className="text-sm font-medium">
          Campaign name
        </label>
        <input
          id="ed-name"
          name="name"
          defaultValue={initial.name}
          required
          maxLength={100}
          className={box}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="ed-obj" className="text-sm font-medium">
          Objective
        </label>
        <select id="ed-obj" name="objective" defaultValue={initial.objective} className={box}>
          {OBJECTIVES.map((o) => (
            <option key={o} value={o}>
              {OBJECTIVE_LABEL[o]}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="ed-budget" className="text-sm font-medium">
          Budget (USD)
        </label>
        <input
          id="ed-budget"
          name="budget"
          type="number"
          min={0}
          step={1}
          defaultValue={initial.budgetUsd}
          className={box}
          data-testid="edit-budget"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="ed-start" className="text-sm font-medium">
          Starts
        </label>
        <input
          id="ed-start"
          name="starts"
          type="date"
          defaultValue={initial.startsOn ?? ""}
          className={box}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="ed-end" className="text-sm font-medium">
          Ends
        </label>
        <input
          id="ed-end"
          name="ends"
          type="date"
          defaultValue={initial.endsOn ?? ""}
          className={box}
        />
      </div>
      <div className="flex flex-col gap-1 md:col-span-2">
        <label htmlFor="ed-brief" className="text-sm font-medium">
          Brief
        </label>
        <textarea
          id="ed-brief"
          name="brief"
          rows={4}
          defaultValue={initial.brief}
          maxLength={4000}
          className={`${box} py-2`}
        />
      </div>
      <div className="flex gap-3 md:col-span-2">
        <Button type="submit" loading={busy} data-testid="campaign-save">
          Save
        </Button>
        <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-[var(--danger)] md:col-span-2">
          {error}
        </p>
      )}
    </form>
  );
}

export function AddFromList({
  ws,
  id,
  lists,
  canEdit,
}: {
  ws: string;
  id: string;
  lists: { id: string; name: string; size: number }[];
  canEdit: boolean;
}) {
  const [listId, setListId] = useState(lists[0]?.id ?? "");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [busy, run] = useBusy();
  if (!lists.length)
    return (
      <p className="text-sm text-[var(--text-muted)]" data-testid="no-lists-hint">
        Build a creator list first, then add it here.
      </p>
    );
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        run(async () => {
          setError("");
          setMsg("");
          const r = await addListToCampaign(ws, id, listId);
          if (!r.ok) return setError(r.error);
          setMsg(
            `Added ${r.added} creator${r.added === 1 ? "" : "s"}${r.skipped ? `; ${r.skipped} already on the campaign` : ""}.`,
          );
        });
      }}
      className="flex flex-wrap items-end gap-3"
      data-testid="add-from-list"
    >
      <div className="flex flex-col gap-1">
        <label htmlFor="af-list" className="text-sm font-medium">
          Add creators from a list
        </label>
        <select
          id="af-list"
          value={listId}
          onChange={(e) => setListId(e.target.value)}
          disabled={!canEdit}
          className={box}
        >
          {lists.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name} ({l.size})
            </option>
          ))}
        </select>
      </div>
      <Button type="submit" loading={busy} disabled={!canEdit} data-testid="add-from-list-submit">
        Add to campaign
      </Button>
      <p
        role="status"
        className="basis-full text-sm text-[var(--text-muted)]"
        data-testid="add-from-list-status"
      >
        {msg}
      </p>
      {error && (
        <p role="alert" className="basis-full text-sm text-[var(--danger)]">
          {error}
        </p>
      )}
    </form>
  );
}
