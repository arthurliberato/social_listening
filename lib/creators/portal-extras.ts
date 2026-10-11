// The creator's page in full: the outreach view plus their agreement and payout. Kept apart from outreach.ts so that
// contracts and payouts (which import outreach) can be read here without a loop.
import { eq } from "drizzle-orm";
import { accounts, db } from "@/db/client";
import { PLANS, type PlanTier } from "@/lib/entitlements/plans";
import { simNow } from "@/lib/simclock";
import { latestContract, latestPayout, payoutDetailsOf } from "./contract-state";
import { portalFor, portalView, trackingLinkOf, type Portal, type PortalView } from "./outreach";
import { settleDuePayouts } from "./payouts";

export async function fullPortalView(p: Portal): Promise<PortalView> {
  const view = portalView(p, await trackingLinkOf(p));
  const [contract, details, payout, [acct]] = await Promise.all([
    latestContract(p.campaign.id, p.creator.id),
    payoutDetailsOf(p.campaign.id, p.creator.id),
    latestPayout(p.campaign.id, p.creator.id),
    db.select({ tier: accounts.planTier }).from(accounts).where(eq(accounts.id, p.accountId)),
  ]);
  const tier = (acct?.tier ?? "trial") as PlanTier;
  return {
    ...view,
    contract:
      contract && contract.status !== "withdrawn"
        ? {
            version: contract.version,
            status: contract.status,
            text: contract.bodyText,
            signedName: contract.signedName,
            signedAt: contract.signedAt?.toISOString() ?? null,
            requestNote: contract.requestNote,
          }
        : null,
    payout: {
      enabled: PLANS[tier].features.creatorPayouts,
      details: details
        ? { holderName: details.holderName, last4: details.last4, country: details.country }
        : null,
      latest: payout
        ? {
            status: payout.status,
            amountUsd: payout.amountUsd,
            reference: payout.reference,
            settleAt: payout.settleAt.toISOString(),
            failureReason: payout.failureReason,
          }
        : null,
    },
  };
}

/** The creator's page for a link. Any payout that has come due is settled first, so the page tells the truth. */
export async function portalViewOf(token: string): Promise<PortalView | null> {
  let p = await portalFor(token);
  if (!p) return null;
  if (await settleDuePayouts(simNow(), p.campaign.id)) p = (await portalFor(token)) ?? p;
  return fullPortalView(p);
}
