"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { track } from "@/lib/analytics/client";
import type { PaywallTrigger } from "@/lib/billing/paywalls";

export interface PaywallProps {
  trigger: PaywallTrigger;
  title: string;
  /** What is locked / why the user hit the wall. */
  reason: string;
  planLabel: string;
  priceLine?: string;
  bullets: string[];
  onClose: () => void;
}

/** Equal-weight "Not now": no confirmshaming, always dismissible with Esc. */
export function PaywallModal(p: PaywallProps) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    track("Paywall Viewed", {
      paywall_trigger: p.trigger,
      required_plan: p.planLabel.toLowerCase(),
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const plan = p.planLabel.toLowerCase();
  const fromPlan = () => document.querySelector<HTMLElement>("[data-plan]")?.dataset.plan ?? null;
  const close = () => {
    track("Paywall Dismissed", { paywall_trigger: p.trigger });
    p.onClose();
  };
  return (
    <dialog
      ref={ref}
      aria-labelledby="paywall-title"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      className="m-auto w-full max-w-md rounded-[var(--radius-modal)] border border-[var(--border)] bg-[var(--surface)] p-6 text-[var(--text)] backdrop:bg-black/40"
      data-testid="paywall-modal"
    >
      <h2 id="paywall-title" className="text-xl font-semibold">
        {p.title}
      </h2>
      <p className="mt-2 text-[var(--text-muted)]">{p.reason}</p>
      <ul className="mt-4 list-disc pl-5 text-sm">
        {p.bullets.map((b) => (
          <li key={b}>{b}</li>
        ))}
      </ul>
      {p.priceLine && <p className="mt-4 text-sm font-medium">{p.priceLine}</p>}
      <div className="mt-6 flex flex-wrap gap-3">
        <Link
          href={`/upgrade?from=${p.trigger}&plan=${plan}`}
          onClick={() =>
            track("Upgrade Started", {
              paywall_trigger: p.trigger,
              from_plan: fromPlan(),
              to_plan: plan,
              billing_interval: "monthly",
            })
          }
          className="inline-flex min-h-9 items-center rounded-md bg-[var(--primary)] px-4 text-sm font-medium text-[var(--primary-contrast)]"
          data-testid="paywall-upgrade"
        >
          Upgrade to {p.planLabel}
        </Link>
        <Link
          href={`/upgrade?from=${p.trigger}`}
          className="inline-flex min-h-9 items-center rounded-md border border-[var(--border)] px-4 text-sm font-medium"
        >
          Compare plans
        </Link>
        <Button variant="secondary" onClick={close} data-testid="paywall-dismiss">
          Not now
        </Button>
      </div>
    </dialog>
  );
}
