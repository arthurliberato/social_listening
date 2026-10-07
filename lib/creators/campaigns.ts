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

/** Plain, serialisable view of a campaign. Server actions return it so the page can update without waiting on a re-render. */
export interface CampaignSnapshot {
  campaign: {
    id: string;
    name: string;
    objective: string;
    brief: string;
    budgetUsd: number;
    startsOn: string | null;
    endsOn: string | null;
    status: string;
  };
  budget: BudgetSummary;
  roster: {
    creatorId: number;
    displayName: string;
    handle: string;
    platform: string;
    country: string;
    followers: number;
    avatarSeed: number;
    status: string;
    feeUsd: number | null;
    note: string;
    suggestedFee: number;
  }[];
}

export function snapshotOf(
  data: NonNullable<Awaited<ReturnType<typeof getCampaign>>>,
): CampaignSnapshot {
  const c = data.campaign;
  return {
    campaign: {
      id: c.id,
      name: c.name,
      objective: c.objective,
      brief: c.brief,
      budgetUsd: c.budgetUsd,
      startsOn: c.startsOn,
      endsOn: c.endsOn,
      status: c.status,
    },
    budget: data.budget,
    roster: data.roster.map((r) => ({
      creatorId: r.creatorId,
      displayName: r.displayName,
      handle: r.handle,
      platform: r.platform,
      country: r.country,
      followers: r.followers,
      avatarSeed: r.avatarSeed,
      status: r.status,
      feeUsd: r.feeUsd,
      note: r.note,
      suggestedFee: r.ratePerPostUsd,
    })),
  };
}
