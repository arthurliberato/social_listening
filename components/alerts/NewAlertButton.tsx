"use client";

import Link from "next/link";
import { useState } from "react";
import { PaywallModal } from "@/components/listening/PaywallModal";
import { PLANS, type PlanTier } from "@/lib/entitlements/plans";

/** "New alert" — at the plan's alert limit it opens the paywall instead of the builder. */
export function NewAlertButton({
  ws,
  atLimit,
  upgradeTo,
  used,
  limit,
  label = "New alert",
  testId = "new-alert",
}: {
  ws: string;
  atLimit: boolean;
  upgradeTo: PlanTier;
  used: number;
  limit: number;
  label?: string;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const cls =
    "inline-flex min-h-9 items-center rounded-md bg-[var(--primary)] px-4 text-sm font-medium text-[var(--primary-contrast)]";
  const p = PLANS[upgradeTo];
  if (!atLimit)
    return (
      <Link href={`/w/${ws}/alerts/new`} className={cls} data-testid={testId}>
        {label}
      </Link>
    );
  return (
    <>
      <button type="button" className={cls} onClick={() => setOpen(true)} data-testid={testId}>
        {label}
      </button>
      {open && (
        <PaywallModal
          trigger="alert_limit"
          title="You've reached your alert limit"
          reason={`You're using ${used} of ${limit} alerts. Delete or mute-and-remove one, or upgrade for more.`}
          planLabel={p.label}
          priceLine={p.priceMonthly ? `${p.label} is $${p.priceMonthly}/month.` : undefined}
          bullets={[
            `${p.alerts.toLocaleString()} alerts`,
            p.features.sentimentAlerts ? "Sentiment-surge alerts" : "Volume-spike alerts",
            p.features.crisisRoom ? "Crisis Rooms" : "Alerts by email",
          ]}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
