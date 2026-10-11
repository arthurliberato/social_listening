// Small reads about a creator's agreement and payout, kept in a module of their own (database only) so that outreach,
// contracts and payouts can all ask without importing one another.
import { and, desc, eq } from "drizzle-orm";
import { creatorContracts, creatorPayoutDetails, creatorPayouts, db } from "@/db/client";

export type ContractRow = typeof creatorContracts.$inferSelect;
export type PayoutRow = typeof creatorPayouts.$inferSelect;
export type PayoutDetailsRow = typeof creatorPayoutDetails.$inferSelect;

export async function latestContract(
  campaignId: string,
  creatorId: number,
): Promise<ContractRow | null> {
  const [c] = await db
    .select()
    .from(creatorContracts)
    .where(
      and(eq(creatorContracts.campaignId, campaignId), eq(creatorContracts.creatorId, creatorId)),
    )
    .orderBy(desc(creatorContracts.version))
    .limit(1);
  return c ?? null;
}

/** An agreement has been sent and the creator hasn't signed it: it is waiting on them, or on a revision. */
export async function contractOutstanding(campaignId: string, creatorId: number): Promise<boolean> {
  const c = await latestContract(campaignId, creatorId);
  return !!c && (c.status === "sent" || c.status === "changes_requested");
}

export async function latestPayout(
  campaignId: string,
  creatorId: number,
): Promise<PayoutRow | null> {
  const [p] = await db
    .select()
    .from(creatorPayouts)
    .where(and(eq(creatorPayouts.campaignId, campaignId), eq(creatorPayouts.creatorId, creatorId)))
    .orderBy(desc(creatorPayouts.initiatedAt))
    .limit(1);
  return p ?? null;
}

export async function payoutDetailsOf(
  campaignId: string,
  creatorId: number,
): Promise<PayoutDetailsRow | null> {
  const [d] = await db
    .select()
    .from(creatorPayoutDetails)
    .where(
      and(
        eq(creatorPayoutDetails.campaignId, campaignId),
        eq(creatorPayoutDetails.creatorId, creatorId),
      ),
    );
  return d ?? null;
}
