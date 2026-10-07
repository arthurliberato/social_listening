"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createCampaign } from "@/app/w/[ws]/creators/campaigns/actions";
import { PaywallModal } from "@/components/listening/PaywallModal";
import { Button } from "@/components/ui/button";
import { OBJECTIVES, OBJECTIVE_LABEL } from "@/lib/creators/campaign-flow";
import { PLANS, type PlanTier } from "@/lib/entitlements/plans";
import { useBusy } from "@/lib/use-busy";

const box =
  "min-h-9 rounded-[var(--radius-input)] border border-[var(--border)] bg-[var(--surface)] px-3 text-sm disabled:opacity-60";

export function NewCampaignForm({
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
  const [error, setError] = useState("");
  const [paywall, setPaywall] = useState<{ reason: string; to: PlanTier } | null>(null);
  const [busy, run] = useBusy();
  const p = paywall ? PLANS[paywall.to] : null;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        run(async () => {
          setError("");
          const r = await createCampaign(ws, {
            name: String(f.get("name") ?? ""),
            objective: String(f.get("objective")) as (typeof OBJECTIVES)[number],
            brief: String(f.get("brief") ?? ""),
            budgetUsd: Number(f.get("budget") || 0),
            startsOn: String(f.get("starts") || "") || null,
            endsOn: String(f.get("ends") || "") || null,
          });
          if (!r.ok) {
            if (r.upgradeTo) return setPaywall({ reason: r.error, to: r.upgradeTo });
            return setError(r.error);
          }
          router.push(`/w/${ws}/creators/campaigns/${r.id}`);
        });
      }}
      className="grid max-w-3xl gap-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 md:grid-cols-2"
      data-testid="new-campaign-form"
      aria-label="New campaign"
    >
      <div className="flex flex-col gap-1 md:col-span-2">
        <label htmlFor="cp-name" className="text-sm font-medium">
          Campaign name
        </label>
        <input
          id="cp-name"
          name="name"
          required
          maxLength={100}
          disabled={!canEdit}
          className={box}
          data-testid="campaign-name"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="cp-obj" className="text-sm font-medium">
          Objective
        </label>
        <select id="cp-obj" name="objective" disabled={!canEdit} className={box}>
          {OBJECTIVES.map((o) => (
            <option key={o} value={o}>
              {OBJECTIVE_LABEL[o]}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="cp-budget" className="text-sm font-medium">
          Budget (USD)
        </label>
        <input
          id="cp-budget"
          name="budget"
          type="number"
          min={0}
          step={1}
          defaultValue={0}
          disabled={!canEdit}
          className={box}
          data-testid="campaign-budget"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="cp-start" className="text-sm font-medium">
          Starts
        </label>
        <input id="cp-start" name="starts" type="date" disabled={!canEdit} className={box} />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="cp-end" className="text-sm font-medium">
          Ends
        </label>
        <input id="cp-end" name="ends" type="date" disabled={!canEdit} className={box} />
      </div>
      <div className="flex flex-col gap-1 md:col-span-2">
        <label htmlFor="cp-brief" className="text-sm font-medium">
          Brief
        </label>
        <textarea
          id="cp-brief"
          name="brief"
          rows={3}
          maxLength={4000}
          disabled={!canEdit}
          className={`${box} py-2`}
        />
      </div>
      <div className="flex flex-wrap items-center gap-3 md:col-span-2">
        <Button type="submit" loading={busy} disabled={!canEdit} data-testid="campaign-create">
          Create campaign
        </Button>
        <p className="text-xs text-[var(--text-muted)]">
          {canEdit
            ? `${used} of ${limit} active campaigns used on your plan.`
            : "Your role can view campaigns but not create them."}
        </p>
      </div>
      {error && (
        <p
          role="alert"
          className="text-sm text-[var(--danger)] md:col-span-2"
          data-testid="campaign-error"
        >
          {error}
        </p>
      )}
      {paywall && p && (
        <PaywallModal
          trigger="campaign_limit"
          title="You've reached your campaign limit"
          reason={paywall.reason}
          planLabel={p.label}
          priceLine={p.priceMonthly ? `${p.label} is $${p.priceMonthly}/month.` : undefined}
          bullets={[
            `${p.activeCampaigns} active campaigns`,
            `${p.creatorLists} creator lists`,
            "Audience insights and list export",
          ]}
          onClose={() => setPaywall(null)}
        />
      )}
    </form>
  );
}
