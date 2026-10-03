"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteQuery, setQueryStatus } from "@/app/w/[ws]/queries/actions";
import { Button } from "@/components/ui/button";
import { PaywallModal, type PaywallProps } from "@/components/listening/PaywallModal";
import { PLANS } from "@/lib/entitlements/plans";

export function QueryRowActions({
  ws,
  id,
  name,
  status,
  canEdit,
}: {
  ws: string;
  id: string;
  name: string;
  status: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const [paywall, setPaywall] = useState<PaywallProps | null>(null);
  if (!canEdit) return <span className="text-xs text-[var(--text-muted)]">View only</span>;

  const toggle = () =>
    start(async () => {
      setError("");
      const r = await setQueryStatus(ws, id, status === "live" ? "paused" : "live");
      if (r.ok) return router.refresh();
      if (r.upgradeTo) {
        const p = PLANS[r.upgradeTo];
        setPaywall({
          trigger: "query_limit",
          title: "You've reached your query limit",
          reason: r.error,
          planLabel: p.label,
          priceLine: p.priceMonthly ? `${p.label} is $${p.priceMonthly}/month.` : undefined,
          bullets: [
            `${p.activeQueries} active queries`,
            `${p.mentionsPerMonth.toLocaleString()} mentions per month`,
          ],
          onClose: () => setPaywall(null),
        });
      } else setError(r.error);
    });
  const remove = () =>
    start(async () => {
      const r = await deleteQuery(ws, id);
      if (r.ok) router.refresh();
      else setError(r.error);
    });

  return (
    <div className="flex flex-wrap items-center gap-2">
      {paywall && <PaywallModal {...paywall} />}
      <Button
        size="sm"
        variant="secondary"
        onClick={toggle}
        loading={pending}
        data-testid={`toggle-${id}`}
      >
        {status === "live" ? "Pause" : "Resume"}
      </Button>
      {confirming ? (
        <span
          role="group"
          aria-label={`Confirm deleting ${name}`}
          className="flex items-center gap-2 text-sm"
        >
          Delete “{name}”?
          <Button
            size="sm"
            variant="destructive"
            onClick={remove}
            loading={pending}
            data-testid={`confirm-delete-${id}`}
          >
            Delete
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
        </span>
      ) : (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setConfirming(true)}
          data-testid={`delete-${id}`}
          aria-label={`Delete ${name}`}
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
