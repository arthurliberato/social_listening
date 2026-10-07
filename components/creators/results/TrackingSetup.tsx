"use client";

import { useState } from "react";
import { setDestinationAction } from "@/app/w/[ws]/creators/campaigns/tracking-actions";
import { PaywallModal } from "@/components/listening/PaywallModal";
import { Button } from "@/components/ui/button";
import { PLANS, type PlanTier } from "@/lib/entitlements/plans";
import { useBusy } from "@/lib/use-busy";
import { CopyField } from "./CopyField";

/** Where tracking links lead, and how the brand's site reports conversions back. */
export function TrackingSetup({
  ws,
  campaignId,
  initialUrl,
  initialKey,
  postbackBase,
  canEdit,
}: {
  ws: string;
  campaignId: string;
  initialUrl: string | null;
  initialKey: string | null;
  postbackBase: string;
  canEdit: boolean;
}) {
  const [url, setUrl] = useState(initialUrl ?? "");
  const [saved, setSaved] = useState(initialUrl);
  const [key, setKey] = useState(initialKey);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [paywall, setPaywall] = useState<{ reason: string; to: PlanTier } | null>(null);
  const [busy, run] = useBusy();
  const p = paywall ? PLANS[paywall.to] : null;
  return (
    <section
      aria-labelledby="setup-h"
      className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4"
      data-testid="tracking-setup"
    >
      <h2 id="setup-h" className="text-lg font-semibold">
        Tracking setup
      </h2>
      <form
        noValidate
        className="mt-3 flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            setError("");
            setMsg("");
            const r = await setDestinationAction(ws, campaignId, url);
            if (!r.ok) {
              if (r.upgradeTo) return setPaywall({ reason: r.error, to: r.upgradeTo });
              return setError(r.error);
            }
            setSaved(r.destinationUrl);
            setUrl(r.destinationUrl);
            setKey(r.conversionKey);
            setMsg("Saved. Confirmed creators now have tracking links.");
          });
        }}
      >
        <div className="flex min-w-72 flex-1 flex-col gap-1">
          <label htmlFor="dest" className="text-sm font-medium">
            Landing page
          </label>
          <input
            id="dest"
            type="url"
            value={url}
            disabled={!canEdit}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://your-shop.example/launch"
            className="min-h-9 rounded-[var(--radius-input)] border border-[var(--border)] bg-[var(--surface)] px-3 text-sm disabled:opacity-60"
            data-testid="destination-input"
            aria-describedby="dest-hint"
          />
          <p id="dest-hint" className="text-xs text-[var(--text-muted)]">
            Everyone who follows a creator&apos;s link lands here, with the creator and campaign
            added to the address.
          </p>
        </div>
        <Button type="submit" loading={busy} disabled={!canEdit} data-testid="destination-save">
          {saved ? "Update" : "Save"}
        </Button>
      </form>
      <p
        role="status"
        className="mt-2 text-sm text-[var(--text-muted)]"
        data-testid="destination-status"
      >
        {msg}
      </p>
      {error && (
        <p
          role="alert"
          className="mt-2 text-sm text-[var(--danger)]"
          data-testid="destination-error"
        >
          {error}
        </p>
      )}
      {saved && key && (
        <div className="mt-4" data-testid="postback-setup">
          <h3 className="font-medium">Report conversions from your site</h3>
          <p className="mt-1 max-w-prose text-sm text-[var(--text-muted)]">
            Each visit arrives with an <code>rw_cid</code> in the address. When that visitor buys or
            signs up, have your server call this address with the same <code>cid</code>, the amount,
            and your own order reference (each order is counted once):
          </p>
          {canEdit ? (
            <div className="mt-2">
              <CopyField
                label="conversion postback address"
                testId="postback-url"
                value={`${postbackBase}?cid={rw_cid}&key=${key}&value={amount_usd}&ref={order_id}`}
              />
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                The key is a secret: keep it on your server, never in a page. Only the first 30 days
                after a click are credited.
              </p>
            </div>
          ) : (
            <p className="mt-2 text-sm text-[var(--text-muted)]">
              An editor or admin can see the postback address and key.
            </p>
          )}
        </div>
      )}
      {paywall && p && (
        <PaywallModal
          trigger="campaign_results"
          title="Tracking links and results"
          reason={paywall.reason}
          planLabel={p.label}
          priceLine={p.priceMonthly ? `${p.label} is $${p.priceMonthly}/month.` : undefined}
          bullets={[
            "A tracking link for every creator",
            "Clicks, conversions, cost per result and return on spend",
            `${p.invitationsPerMonth} creator invitations per month`,
          ]}
          onClose={() => setPaywall(null)}
        />
      )}
    </section>
  );
}
