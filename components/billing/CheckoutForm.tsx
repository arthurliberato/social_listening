"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { changePlanAction, checkoutAction } from "@/app/settings/billing/actions";
import { Button } from "@/components/ui/button";
import type { Interval } from "@/lib/billing/pricing";
import { CardForm } from "./CardForm";

export function CheckoutForm({
  mode,
  tier,
  tierLabel,
  interval,
  card,
  payLabel,
}: {
  mode: "subscribe" | "upgrade" | "downgrade";
  tier: string;
  tierLabel: string;
  interval: Interval;
  card: { brand: string; last4: string } | null;
  payLabel: string;
}) {
  const router = useRouter();
  const [useNew, setUseNew] = useState(!card);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [blockers, setBlockers] = useState<string[]>([]);

  const change = async () => {
    setBusy(true);
    setError("");
    setBlockers([]);
    const r = await changePlanAction({ tier, interval });
    setBusy(false);
    if (r.ok)
      return router.push(
        `/settings/billing?changed=${r.applied === "scheduled" ? "scheduled" : "now"}`,
      );
    setError(r.error);
    setBlockers(r.blockers ?? []);
  };

  if (mode !== "subscribe")
    return (
      <div className="flex flex-col gap-3">
        <Button onClick={change} loading={busy} data-testid="confirm-change">
          {payLabel}
        </Button>
        {error && (
          <div role="alert" className="text-sm text-[var(--danger)]" data-testid="change-error">
            <p>{error}</p>
            {blockers.length > 0 && (
              <ul className="mt-1 list-disc pl-5" data-testid="blockers">
                {blockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    );

  const subscribe = async (cardValues?: {
    number: string;
    expMonth: number;
    expYear: number;
    cvc: string;
    name: string;
  }) => {
    const r = await checkoutAction({ tier, interval, card: cardValues });
    if (!r.ok) return r;
    router.push(`/settings/billing?welcome=${tier}`);
    return { ok: true as const };
  };

  return (
    <div className="flex flex-col gap-4">
      {card && !useNew ? (
        <>
          <p className="text-sm" data-testid="saved-card">
            Pay with {card.brand} ending in <strong>{card.last4}</strong>.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button
              loading={busy}
              onClick={async () => {
                setBusy(true);
                setError("");
                const r = await subscribe();
                setBusy(false);
                if (!r.ok) setError(r.error);
              }}
              data-testid="pay-saved"
            >
              {payLabel}
            </Button>
            <Button variant="secondary" onClick={() => setUseNew(true)} data-testid="use-new-card">
              Use a different card
            </Button>
          </div>
          {error && (
            <p role="alert" className="text-sm text-[var(--danger)]">
              {error}
            </p>
          )}
        </>
      ) : (
        <CardForm
          submitLabel={payLabel}
          note={`By subscribing you agree to be charged for the ${tierLabel} plan. Your card number is checked and never stored.`}
          onSubmit={subscribe}
        />
      )}
    </div>
  );
}
