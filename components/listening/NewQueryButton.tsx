"use client";

import Link from "next/link";
import { useState } from "react";
import { PaywallModal } from "@/components/listening/PaywallModal";
import { PLANS, type PlanTier } from "@/lib/entitlements/plans";

/** "New query" — at the plan's limit it opens the paywall instead of the builder. */
export function NewQueryButton({
  ws,
  atLimit,
  upgradeTo,
  used,
  limit,
}: {
  ws: string;
  atLimit: boolean;
  upgradeTo: PlanTier;
  used: number;
  limit: number;
}) {
  const [open, setOpen] = useState(false);
  const cls =
    "inline-flex min-h-9 items-center rounded-md bg-[var(--primary)] px-4 text-sm font-medium text-[var(--primary-contrast)]";
  const p = PLANS[upgradeTo];
  if (!atLimit)
    return (
      <Link href={`/w/${ws}/queries/new?entry=list`} className={cls} data-testid="new-query">
        New query
      </Link>
    );
  return (
    <>
      <button type="button" className={cls} onClick={() => setOpen(true)} data-testid="new-query">
        New query
      </button>
      {open && (
        <PaywallModal
          trigger="query_limit"
          title="You've reached your query limit"
          reason={`You're using ${used} of ${limit} active queries. Pause or delete one, or upgrade for more.`}
          planLabel={p.label}
          priceLine={p.priceMonthly ? `${p.label} is $${p.priceMonthly}/month.` : undefined}
          bullets={[
            `${p.activeQueries} active queries`,
            `${p.mentionsPerMonth.toLocaleString()} mentions per month`,
            `${p.seats} seats`,
          ]}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
