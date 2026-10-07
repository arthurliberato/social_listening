"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createList, deleteList } from "@/app/w/[ws]/creators/actions";
import { Button } from "@/components/ui/button";
import { PaywallModal } from "@/components/listening/PaywallModal";
import { PLANS, type PlanTier } from "@/lib/entitlements/plans";
import { useBusy } from "@/lib/use-busy";

export function NewListForm({
  ws,
  canEdit,
  used,
  limit,
}: {
  ws: string;
  canEdit: boolean;
  used: number;
  limit: number;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [paywall, setPaywall] = useState<{ reason: string; to: PlanTier } | null>(null);
  const [busy, run] = useBusy();
  const p = paywall ? PLANS[paywall.to] : null;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        run(async () => {
          setError("");
          const r = await createList(ws, name);
          if (!r.ok) {
            if (r.upgradeTo) return setPaywall({ reason: r.error, to: r.upgradeTo });
            return setError(r.error);
          }
          setName("");
          router.push(`/w/${ws}/creators/lists/${r.id}`);
        });
      }}
      className="flex flex-wrap items-end gap-3"
      data-testid="new-list-form"
    >
      <div className="flex flex-col gap-1">
        <label htmlFor="new-list" className="text-sm font-medium">
          New list name
        </label>
        <input
          id="new-list"
          value={name}
          maxLength={80}
          disabled={!canEdit}
          onChange={(e) => setName(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "new-list-err" : "new-list-hint"}
          className="min-h-9 w-72 rounded-[var(--radius-input)] border border-[var(--border)] bg-[var(--surface)] px-3 text-sm disabled:opacity-60"
          data-testid="new-list-input"
        />
      </div>
      <Button type="submit" loading={busy} disabled={!canEdit} data-testid="new-list-submit">
        Create list
      </Button>
      <p id="new-list-hint" className="basis-full text-xs text-[var(--text-muted)]">
        {canEdit
          ? `${used} of ${limit} lists used on your plan.`
          : "Your role can view lists but not create them."}
      </p>
      {error && (
        <p id="new-list-err" role="alert" className="basis-full text-sm text-[var(--danger)]">
          {error}
        </p>
      )}
      {paywall && p && (
        <PaywallModal
          trigger="creator_list_limit"
          title="You've reached your creator list limit"
          reason={paywall.reason}
          planLabel={p.label}
          priceLine={p.priceMonthly ? `${p.label} is $${p.priceMonthly}/month.` : undefined}
          bullets={[
            `${p.creatorLists} creator lists`,
            `${p.creatorProfilesPerMonth} new creator profiles per month`,
            "Audience insights and list export",
          ]}
          onClose={() => setPaywall(null)}
        />
      )}
    </form>
  );
}

export function DeleteListButton({
  ws,
  listId,
  name,
}: {
  ws: string;
  listId: string;
  name: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const [busy, run] = useBusy();
  if (!confirming)
    return (
      <Button variant="secondary" onClick={() => setConfirming(true)} data-testid="delete-list">
        Delete list
      </Button>
    );
  return (
    <span
      className="inline-flex flex-wrap items-center gap-2"
      role="group"
      aria-label={`Delete ${name}?`}
    >
      <span className="text-sm">Delete “{name}”? Creators stay in the directory.</span>
      <Button
        variant="destructive"
        loading={busy}
        data-testid="delete-list-confirm"
        onClick={() =>
          run(async () => {
            const r = await deleteList(ws, listId);
            if (!r.ok) return setError(r.error);
            router.push(`/w/${ws}/creators/lists`);
          })
        }
      >
        Delete
      </Button>
      <Button variant="secondary" onClick={() => setConfirming(false)}>
        Keep
      </Button>
      {error && (
        <span role="alert" className="text-sm text-[var(--danger)]">
          {error}
        </span>
      )}
    </span>
  );
}
