"use client";

import { useState } from "react";
import {
  sendContractAction,
  withdrawContractAction,
} from "@/app/w/[ws]/creators/campaigns/contract-actions";
import { PaywallModal } from "@/components/listening/PaywallModal";
import { Button } from "@/components/ui/button";
import type { CampaignSnapshot } from "@/lib/creators/campaigns";
import { PAYMENT_DAY_OPTIONS, USAGE_OPTIONS, termsSummary } from "@/lib/creators/contract-flow";
import { PLANS, type PlanTier } from "@/lib/entitlements/plans";
import { useBusy } from "@/lib/use-busy";

type Row = CampaignSnapshot["roster"][number];
const box =
  "min-h-8 rounded-[var(--radius-input)] border border-[var(--border)] bg-[var(--surface)] px-2 text-sm";
const small =
  "min-h-8 rounded-md border border-[var(--border)] px-3 text-sm hover:bg-[var(--surface-2)] disabled:opacity-60";
const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** The agreement for one creator: write the terms, send it, follow the answer, revise after a request for changes. */
export function ContractPanel({
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
  const k = row.contract;
  const [open, setOpen] = useState(false);
  const [deliverables, setDeliverables] = useState(k?.terms.deliverables ?? "");
  const [usageDays, setUsageDays] = useState(String(k?.terms.usageDays ?? 90));
  const [exclusivityDays, setExclusivityDays] = useState(String(k?.terms.exclusivityDays ?? 0));
  const [paymentDays, setPaymentDays] = useState(String(k?.terms.paymentDays ?? 14));
  const [dueOn, setDueOn] = useState(k?.terms.dueOn ?? "");
  const [extra, setExtra] = useState(k?.terms.extra ?? "");
  const [error, setError] = useState("");
  const [paywall, setPaywall] = useState<{ reason: string; to: PlanTier } | null>(null);
  const [busy, run] = useBusy();
  const ids = { campaignId, creatorId: row.creatorId };
  const eligible = ["confirmed", "content_submitted", "approved"].includes(row.status);
  const p = paywall ? PLANS[paywall.to] : null;

  // Nothing to show before the creator is confirmed, or once they're paid with no agreement on file.
  if (!eligible && !k) return null;

  // Offered on every plan: where the plan doesn't include agreements, sending shows what the plan would add.
  const canSend = editable && eligible && k?.status !== "signed" && !!row.invite;

  return (
    <div className="flex flex-col gap-2" data-testid="contract-panel">
      {k && (
        <div className="text-sm" data-testid="contract-summary" data-status={k.status}>
          <p>
            <strong data-testid="contract-state">
              {k.status === "signed"
                ? "Agreement signed"
                : k.status === "changes_requested"
                  ? "Creator asked for changes"
                  : "Agreement sent"}
            </strong>{" "}
            · version {k.version} · {termsSummary(k.terms)}
            {k.status === "signed" && k.signedAt
              ? ` · signed by ${k.signedName} on ${day(k.signedAt)}`
              : ""}
          </p>
          {k.status === "changes_requested" && k.requestNote && (
            <p
              className="mt-1 rounded-md border border-[var(--warning)] p-2"
              data-testid="contract-request-note"
            >
              “{k.requestNote}”
            </p>
          )}
          <details className="mt-1">
            <summary className="min-h-8 cursor-pointer text-[var(--primary)]">
              Read the agreement
            </summary>
            <p className="mt-1 whitespace-pre-line rounded-md bg-[var(--surface-2)] p-3 text-xs">
              {k.text}
            </p>
          </details>
        </div>
      )}

      {open && (
        <form
          noValidate
          aria-label={`Agreement for ${row.displayName}`}
          className="grid max-w-lg gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3"
          data-testid="contract-form"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              setError("");
              const r = await sendContractAction(ws, {
                ...ids,
                terms: {
                  deliverables,
                  usageDays: Number(usageDays),
                  exclusivityDays: Number(exclusivityDays),
                  paymentDays: Number(paymentDays),
                  dueOn: dueOn || null,
                  extra,
                },
              });
              if (!r.ok) {
                if (r.upgradeTo) return setPaywall({ reason: r.error, to: r.upgradeTo });
                return setError(r.error);
              }
              onSnapshot(r.snapshot);
              setOpen(false);
            });
          }}
        >
          <p className="text-xs text-[var(--text-muted)]">
            The fee is the agreed ${row.feeUsd?.toLocaleString("en-US")}. The creator reads and
            signs from their own page.
          </p>
          <div className="flex flex-col gap-1">
            <label
              htmlFor={`k-deliv-${row.creatorId}`}
              className="text-xs text-[var(--text-muted)]"
            >
              Deliverables
            </label>
            <textarea
              id={`k-deliv-${row.creatorId}`}
              rows={2}
              maxLength={500}
              value={deliverables}
              onChange={(e) => setDeliverables(e.target.value)}
              className={`${box} py-1`}
              data-testid="contract-deliverables"
            />
          </div>
          <div className="flex flex-wrap gap-3">
            <div className="flex flex-col gap-1">
              <label
                htmlFor={`k-use-${row.creatorId}`}
                className="text-xs text-[var(--text-muted)]"
              >
                Usage rights
              </label>
              <select
                id={`k-use-${row.creatorId}`}
                value={usageDays}
                onChange={(e) => setUsageDays(e.target.value)}
                className={box}
                data-testid="contract-usage"
              >
                {USAGE_OPTIONS.map((d) => (
                  <option key={d} value={d}>
                    {d === 0 ? "Creator's own post only" : `${d} days`}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label
                htmlFor={`k-excl-${row.creatorId}`}
                className="text-xs text-[var(--text-muted)]"
              >
                Exclusivity (days)
              </label>
              <input
                id={`k-excl-${row.creatorId}`}
                inputMode="numeric"
                value={exclusivityDays}
                onChange={(e) => setExclusivityDays(e.target.value)}
                className={`${box} w-24`}
                data-testid="contract-exclusivity"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label
                htmlFor={`k-pay-${row.creatorId}`}
                className="text-xs text-[var(--text-muted)]"
              >
                Payment
              </label>
              <select
                id={`k-pay-${row.creatorId}`}
                value={paymentDays}
                onChange={(e) => setPaymentDays(e.target.value)}
                className={box}
                data-testid="contract-payment"
              >
                {PAYMENT_DAY_OPTIONS.map((d) => (
                  <option key={d} value={d}>
                    {d === 0 ? "On approval" : `Within ${d} days`}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label
                htmlFor={`k-due-${row.creatorId}`}
                className="text-xs text-[var(--text-muted)]"
              >
                Content due (optional)
              </label>
              <input
                id={`k-due-${row.creatorId}`}
                type="date"
                value={dueOn}
                onChange={(e) => setDueOn(e.target.value)}
                className={box}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label
              htmlFor={`k-extra-${row.creatorId}`}
              className="text-xs text-[var(--text-muted)]"
            >
              Additional terms (optional)
            </label>
            <textarea
              id={`k-extra-${row.creatorId}`}
              rows={2}
              maxLength={1500}
              value={extra}
              onChange={(e) => setExtra(e.target.value)}
              className={`${box} py-1`}
            />
          </div>
          <div className="flex gap-2">
            <Button type="submit" size="sm" loading={busy} data-testid="contract-send">
              {k ? "Send revised agreement" : "Send agreement"}
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {!open && canSend && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={small}
            disabled={busy}
            data-testid="contract-open"
            onClick={() => setOpen(true)}
          >
            {!k
              ? "Send agreement"
              : k.status === "changes_requested"
                ? "Revise and resend"
                : "Send a revised agreement"}
            <span className="sr-only"> to {row.displayName}</span>
          </button>
          {k && (k.status === "sent" || k.status === "changes_requested") && (
            <button
              type="button"
              className={small}
              disabled={busy}
              data-testid="contract-withdraw"
              onClick={() =>
                run(async () => {
                  setError("");
                  const r = await withdrawContractAction(ws, ids);
                  if (!r.ok) return setError(r.error);
                  onSnapshot(r.snapshot);
                })
              }
            >
              Withdraw agreement<span className="sr-only"> for {row.displayName}</span>
            </button>
          )}
        </div>
      )}
      {!k && editable && eligible && !row.invite && (
        <p className="text-xs text-[var(--text-muted)]">
          To send an agreement, invite the creator through Ripplewise first so they have a page to
          sign on.
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-[var(--danger)]" data-testid="contract-panel-error">
          {error}
        </p>
      )}
      {paywall && p && (
        <PaywallModal
          trigger="creator_contracts"
          title="Creator agreements"
          reason={paywall.reason}
          planLabel={p.label}
          priceLine={p.priceMonthly ? `${p.label} is $${p.priceMonthly}/month.` : undefined}
          bullets={[
            "Terms written once, signed from the creator's own page",
            "The signed text is kept exactly as agreed",
            "Content waits for the signature",
          ]}
          onClose={() => setPaywall(null)}
        />
      )}
    </div>
  );
}
