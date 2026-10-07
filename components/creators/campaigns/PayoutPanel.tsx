"use client";

import { useState } from "react";
import { initiatePayoutAction } from "@/app/w/[ws]/creators/campaigns/contract-actions";
import { PaywallModal } from "@/components/listening/PaywallModal";
import type { CampaignSnapshot } from "@/lib/creators/campaigns";
import { payBlocker } from "@/lib/creators/contract-flow";
import { PLANS, type PlanTier } from "@/lib/entitlements/plans";
import { useBusy } from "@/lib/use-busy";

type Row = CampaignSnapshot["roster"][number];
const usd = (n: number) => `$${n.toLocaleString("en-US")}`;
const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const small =
  "min-h-8 rounded-md border border-[var(--border)] px-3 text-sm hover:bg-[var(--surface-2)] disabled:opacity-60";

/** Paying one creator: what is still missing, the button when nothing is, and how the payout is going. */
export function PayoutPanel({
  ws,
  campaignId,
  row,
  editable,
  onSnapshot,
}: {
  ws: string;
  campaignId: string;
  row: Row;
  editable: boolean;
  onSnapshot: (s: CampaignSnapshot) => void;
}) {
  const [error, setError] = useState("");
  const [paywall, setPaywall] = useState<{ reason: string; to: PlanTier } | null>(null);
  const [busy, run] = useBusy();
  const p = paywall ? PLANS[paywall.to] : null;
  const pay = row.payout;
  // Only relevant once the content is approved (or the creator has been paid).
  if (row.status !== "approved" && row.status !== "paid" && !pay) return null;

  const blocker = payBlocker({
    rosterStatus: row.status,
    feeUsd: row.feeUsd,
    hasDetails: !!row.payoutDetails,
    contractOutstanding:
      row.contract?.status === "sent" || row.contract?.status === "changes_requested",
    activePayout: pay?.status === "processing" || pay?.status === "paid",
  });

  return (
    <div className="flex flex-col gap-2 text-sm" data-testid="payout-panel">
      <p data-testid="payout-details-line">
        {row.payoutDetails ? (
          <>
            Pays to the account ending <strong>{row.payoutDetails.last4}</strong> (
            {row.payoutDetails.holderName}, {row.payoutDetails.country}).
          </>
        ) : (
          <span className="text-[var(--text-muted)]">
            The creator hasn&apos;t added payout details yet. They do it on their page.
          </span>
        )}
      </p>
      {pay && (
        <p data-testid="payout-state" data-status={pay.status}>
          <strong>
            {pay.status === "processing"
              ? "Payout on its way"
              : pay.status === "paid"
                ? "Payout sent"
                : pay.status === "failed"
                  ? "Payout failed"
                  : "Payout canceled"}
          </strong>{" "}
          · {usd(pay.amountUsd)} · {pay.reference}
          {pay.status === "processing" ? ` · arrives by ${day(pay.settleAt)}` : ""}
          {pay.attempt > 1 ? ` · attempt ${pay.attempt}` : ""}
          {pay.status === "failed" && pay.failureReason ? ` · ${pay.failureReason}` : ""}
        </p>
      )}
      {editable && row.status === "approved" && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={small}
            disabled={busy || !!blocker}
            data-testid="payout-send"
            onClick={() =>
              run(async () => {
                setError("");
                const r = await initiatePayoutAction(ws, { campaignId, creatorId: row.creatorId });
                if (!r.ok) {
                  if (r.upgradeTo) return setPaywall({ reason: r.error, to: r.upgradeTo });
                  return setError(r.error);
                }
                onSnapshot(r.snapshot);
              })
            }
          >
            {pay?.status === "failed" ? "Retry payout" : `Pay ${usd(row.feeUsd ?? 0)}`}
            <span className="sr-only"> to {row.displayName}</span>
          </button>
          {blocker && (
            <span className="text-xs text-[var(--text-muted)]" data-testid="payout-blocker">
              {blocker}
            </span>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="text-xs text-[var(--danger)]" data-testid="payout-panel-error">
          {error}
        </p>
      )}
      {paywall && p && (
        <PaywallModal
          trigger="creator_payouts"
          title="Pay creators from Ripplewise"
          reason={paywall.reason}
          planLabel={p.label}
          priceLine={p.priceMonthly ? `${p.label} is $${p.priceMonthly}/month.` : undefined}
          bullets={[
            "Creators add their own payout details",
            "Payouts settle and report back automatically",
            "Failed payouts can be retried",
          ]}
          onClose={() => setPaywall(null)}
        />
      )}
    </div>
  );
}
