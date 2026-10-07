"use client";

import { Lock } from "lucide-react";
import { useState } from "react";
import { PaywallModal } from "@/components/listening/PaywallModal";
import { PLANS, type PlanTier } from "@/lib/entitlements/plans";
import type { PaywallTrigger } from "@/lib/billing/paywalls";

export interface LockCopy {
  trigger: PaywallTrigger;
  title: string;
  reason: string;
  upgradeTo: PlanTier;
  bullets: string[];
}

/** A paywall dialog that opens from a button; "Not now" closes it and nothing else changes. */
export function PaywallButton({
  copy,
  children,
  className,
  testId,
}: {
  copy: LockCopy;
  children: React.ReactNode;
  className?: string;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const plan = PLANS[copy.upgradeTo];
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={className}
        data-testid={testId}
      >
        {children}
      </button>
      {open && (
        <PaywallModal
          trigger={copy.trigger}
          title={copy.title}
          reason={copy.reason}
          planLabel={plan.label}
          priceLine={
            plan.priceMonthly ? `${plan.label} is $${plan.priceMonthly}/month.` : undefined
          }
          bullets={copy.bullets}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

/** Placeholder where a plan feature would be: says what it is, why it's locked, and offers the plan once. */
export function LockedPanel({
  heading,
  blurb,
  copy,
  testId,
}: {
  heading: string;
  blurb: string;
  copy: LockCopy;
  testId: string;
}) {
  return (
    <section
      aria-labelledby={`${testId}-h`}
      data-testid={testId}
      className="rounded-lg border border-dashed border-[var(--border)] bg-[var(--surface)] p-6"
    >
      <h2 id={`${testId}-h`} className="flex items-center gap-2 text-lg font-semibold">
        <Lock size={18} aria-hidden /> {heading}
      </h2>
      <p className="mt-2 max-w-prose text-[var(--text-muted)]">{blurb}</p>
      <PaywallButton
        copy={copy}
        testId={`${testId}-unlock`}
        className="mt-4 inline-flex min-h-9 items-center rounded-md border border-[var(--border)] bg-[var(--surface)] px-4 text-sm font-medium hover:bg-[var(--surface-2)]"
      >
        See what&apos;s included in {PLANS[copy.upgradeTo].label}
      </PaywallButton>
    </section>
  );
}
