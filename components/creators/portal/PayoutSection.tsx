"use client";

import { useState } from "react";
import { savePayoutDetailsAction } from "@/app/creator/[token]/actions";
import { Button } from "@/components/ui/button";
import { COUNTRIES } from "@/datagen/config";
import { TEST_ACCOUNTS } from "@/lib/creators/contract-flow";
import type { PortalView } from "@/lib/creators/outreach";
import { useBusy } from "@/lib/use-busy";

const usd = (n: number) => `$${n.toLocaleString("en-US")}`;
const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
const box =
  "min-h-9 rounded-[var(--radius-input)] border border-[var(--border)] bg-[var(--surface)] px-3 text-sm";
const COUNTRY_OPTIONS = [...COUNTRIES].sort((a, b) => a.name.localeCompare(b.name));

/** Where to be paid, and how the payment is going. Only the last four digits of the account are ever kept. */
export function PayoutSection({
  token,
  payout,
  agreedUsd,
  onView,
}: {
  token: string;
  payout: PortalView["payout"];
  agreedUsd: number | null;
  onView: (v: PortalView) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [holder, setHolder] = useState("");
  const [account, setAccount] = useState("");
  const [country, setCountry] = useState("US");
  const [error, setError] = useState("");
  const [busy, run] = useBusy();
  const showForm = !payout.details || editing;
  const latest = payout.latest;

  return (
    <section aria-labelledby="payout-h" className="mt-6" data-testid="portal-payout">
      <h2 id="payout-h" className="text-xl font-semibold">
        Getting paid
      </h2>

      {latest && (
        <div
          role="status"
          className="mt-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 text-sm"
          data-testid="payout-status"
          data-status={latest.status}
        >
          {latest.status === "processing" && (
            <p>
              A payment of <strong>{usd(latest.amountUsd)}</strong> is on its way (reference{" "}
              {latest.reference}). It should arrive by {day(latest.settleAt)}.
            </p>
          )}
          {latest.status === "paid" && (
            <p>
              <strong>{usd(latest.amountUsd)}</strong> was sent to the account ending{" "}
              {payout.details?.last4} (reference {latest.reference}).
            </p>
          )}
          {latest.status === "failed" && (
            <p>
              The payment of {usd(latest.amountUsd)} (reference {latest.reference}) didn&apos;t go
              through: {latest.failureReason} Check your details below; the brand will try again.
            </p>
          )}
        </div>
      )}

      {payout.details && !editing && (
        <p className="mt-2 text-sm" data-testid="payout-details-saved">
          You&apos;ll be paid {agreedUsd ? <strong>{usd(agreedUsd)}</strong> : "your fee"} to the
          account ending <strong>{payout.details.last4}</strong> ({payout.details.holderName},{" "}
          {payout.details.country}).{" "}
          {latest?.status !== "paid" && latest?.status !== "processing" && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="min-h-8 rounded-md px-1 text-[var(--primary)] underline"
              data-testid="payout-edit"
            >
              Change account
            </button>
          )}
        </p>
      )}

      {showForm && latest?.status !== "paid" && latest?.status !== "processing" && (
        <form
          noValidate
          aria-label="Payout details"
          className="mt-3 grid max-w-md gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              setError("");
              const r = await savePayoutDetailsAction(token, {
                holderName: holder,
                accountNumber: account,
                country,
              });
              if (!r.ok) return setError(r.error);
              onView(r.view);
              setEditing(false);
              setAccount("");
            });
          }}
        >
          <p className="text-sm text-[var(--text-muted)]">
            Add the account you&apos;d like to be paid into. We keep only the last four digits.
          </p>
          <div className="flex flex-col gap-1">
            <label htmlFor="payout-holder" className="text-sm font-medium">
              Name on the account
            </label>
            <input
              id="payout-holder"
              value={holder}
              autoComplete="name"
              onChange={(e) => setHolder(e.target.value)}
              className={box}
              data-testid="payout-holder"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="payout-account" className="text-sm font-medium">
              Account number
            </label>
            <input
              id="payout-account"
              value={account}
              inputMode="numeric"
              autoComplete="off"
              onChange={(e) => setAccount(e.target.value)}
              className={box}
              data-testid="payout-account"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="payout-country" className="text-sm font-medium">
              Country of the account
            </label>
            <select
              id="payout-country"
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              className={box}
              data-testid="payout-country"
            >
              {COUNTRY_OPTIONS.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <details className="text-sm">
            <summary className="min-h-8 cursor-pointer">
              Simulated payouts: test account numbers
            </summary>
            <ul className="mt-1 list-disc pl-5 text-[var(--text-muted)]">
              {TEST_ACCOUNTS.map((a) => (
                <li key={a.number}>
                  <code>{a.number}</code>: {a.what}
                </li>
              ))}
            </ul>
          </details>
          <div className="flex gap-2">
            <Button type="submit" loading={busy} data-testid="payout-save">
              Save payout details
            </Button>
            {editing && (
              <Button type="button" variant="secondary" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            )}
          </div>
        </form>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-[var(--danger)]" data-testid="payout-error">
          {error}
        </p>
      )}
    </section>
  );
}
