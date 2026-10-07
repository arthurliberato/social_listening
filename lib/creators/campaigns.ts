import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { campaignCreators, campaigns, creators, db, workspaces } from "@/db/client";
import { COUNTS_AGAINST_PLAN, budgetSummary, type BudgetSummary } from "./campaign-flow";

/** Draft and running campaigns across every workspace in the account (the plan limit is per account). */
export async function accountActiveCampaigns(accountId: string) {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(campaigns)
    .innerJoin(workspaces, eq(workspaces.id, campaigns.workspaceId))
    .where(
      and(eq(workspaces.accountId, accountId), inArray(campaigns.status, [...COUNTS_AGAINST_PLAN])),
    );
  return r?.n ?? 0;
}

export async function workspaceCampaigns(workspaceId: string) {
  const rows = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.workspaceId, workspaceId))
    .orderBy(desc(campaigns.createdAt));
  if (!rows.length) return [];
  const roster = await db
    .select({
      campaignId: campaignCreators.campaignId,
      status: campaignCreators.status,
      feeUsd: campaignCreators.feeUsd,
    })
    .from(campaignCreators)
    .where(
      inArray(
        campaignCreators.campaignId,
        rows.map((r) => r.id),
      ),
    );
  return rows.map((c) => {
    const mine = roster.filter((r) => r.campaignId === c.id);
    return { ...c, creatorCount: mine.length, budget: budgetSummary(c.budgetUsd, mine) };
  });
}

export async function getCampaign(workspaceId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(and(eq(campaigns.id, id), eq(campaigns.workspaceId, workspaceId)));
  if (!campaign) return null;
  const roster = await db
    .select({
      creatorId: campaignCreators.creatorId,
      status: campaignCreators.status,
      feeUsd: campaignCreators.feeUsd,
      note: campaignCreators.note,
      statusChangedAt: campaignCreators.statusChangedAt,
      displayName: creators.displayName,
      handle: creators.handle,
      platform: creators.platform,
      niche: creators.niche,
      country: creators.country,
      followers: creators.followers,
      engagementRate: creators.engagementRate,
      authenticityScore: creators.authenticityScore,
      ratePerPostUsd: creators.ratePerPostUsd,
      avatarSeed: creators.avatarSeed,
    })
    .from(campaignCreators)
    .innerJoin(creators, eq(creators.id, campaignCreators.creatorId))
    .where(eq(campaignCreators.campaignId, campaign.id))
    .orderBy(asc(campaignCreators.addedAt), asc(creators.id));
  const budget: BudgetSummary = budgetSummary(campaign.budgetUsd, roster);
  return { campaign, roster, budget };
}
