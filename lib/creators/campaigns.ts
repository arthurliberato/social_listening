import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  accounts,
  campaignContent,
  campaignCreators,
  campaignInvites,
  campaigns,
  creatorContracts,
  creatorPayoutDetails,
  creatorPayouts,
  creators,
  db,
  workspaces,
} from "@/db/client";
import { limits, type PlanTier } from "@/lib/entitlements/plans";
import { simNow } from "@/lib/simclock";
import type { Terms } from "./contract-flow";
import { invitationsUsed } from "./outreach";
import { settleDuePayouts } from "./payouts";
import { inviteState } from "./outreach-flow";
import { portalLink } from "./outreach-emails";
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
  // Latest invitation and latest content version for each creator.
  const [allInvites, allContent] = await Promise.all([
    db
      .select()
      .from(campaignInvites)
      .where(eq(campaignInvites.campaignId, campaign.id))
      .orderBy(asc(campaignInvites.sentAt)),
    db
      .select()
      .from(campaignContent)
      .where(eq(campaignContent.campaignId, campaign.id))
      .orderBy(asc(campaignContent.version)),
  ]);
  const invites = new Map<number, (typeof allInvites)[number]>();
  const rounds = new Map<number, number>();
  for (const i of allInvites) {
    invites.set(i.creatorId, i);
    rounds.set(i.creatorId, (rounds.get(i.creatorId) ?? 0) + 1);
  }
  const content = new Map<number, (typeof allContent)[number]>();
  for (const c of allContent) content.set(c.creatorId, c);

  // Agreements, payouts and payout details: the latest of each for every creator.
  const [allContracts, allPayouts, allDetails] = await Promise.all([
    db
      .select()
      .from(creatorContracts)
      .where(eq(creatorContracts.campaignId, campaign.id))
      .orderBy(asc(creatorContracts.version)),
    db
      .select()
      .from(creatorPayouts)
      .where(eq(creatorPayouts.campaignId, campaign.id))
      .orderBy(asc(creatorPayouts.initiatedAt)),
    db.select().from(creatorPayoutDetails).where(eq(creatorPayoutDetails.campaignId, campaign.id)),
  ]);
  const contracts = new Map<number, (typeof allContracts)[number]>();
  for (const c of allContracts) contracts.set(c.creatorId, c);
  const payouts = new Map<number, (typeof allPayouts)[number]>();
  const attempts = new Map<number, number>();
  for (const p of allPayouts) {
    payouts.set(p.creatorId, p);
    attempts.set(p.creatorId, (attempts.get(p.creatorId) ?? 0) + 1);
  }
  const details = new Map(allDetails.map((d) => [d.creatorId, d]));
  return {
    campaign,
    roster,
    budget,
    invites,
    rounds,
    content,
    contracts,
    payouts,
    attempts,
    details,
  };
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
  /** Creator invitations used this month, against the plan's allowance. */
  quota: { used: number; limit: number };
  /** What the plan allows, so the page can offer or lock agreements and payouts. */
  features: { contracts: boolean; payouts: boolean };
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
    invite: {
      status: string;
      offeredUsd: number;
      viewed: boolean;
      /** Still answerable: sent and not past its expiry (judged on the simulated clock). */
      open: boolean;
      counterUsd: number | null;
      creatorNote: string;
      sentAt: string;
      expiresAt: string;
      link: string;
      round: number;
    } | null;
    content: {
      version: number;
      url: string;
      caption: string;
      status: string;
      feedback: string;
      submittedAt: string;
    } | null;
    contract: {
      version: number;
      status: string;
      terms: Terms;
      text: string;
      signedName: string | null;
      signedAt: string | null;
      requestNote: string;
    } | null;
    /** Where the creator wants to be paid: the last four digits and holder, never the number. */
    payoutDetails: { holderName: string; last4: string; country: string } | null;
    payout: {
      status: string;
      amountUsd: number;
      reference: string;
      settleAt: string;
      failureReason: string;
      attempt: number;
    } | null;
  }[];
}

export function snapshotOf(
  data: NonNullable<Awaited<ReturnType<typeof getCampaign>>>,
  quota: { used: number; limit: number },
  features: { contracts: boolean; payouts: boolean },
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
    quota,
    features,
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
      invite: (() => {
        const i = data.invites.get(r.creatorId);
        return i
          ? {
              status: i.status,
              offeredUsd: i.offeredUsd,
              viewed: !!i.viewedAt,
              open: inviteState(i, simNow()) === "open",
              counterUsd: i.counterUsd,
              creatorNote: i.creatorNote,
              sentAt: i.sentAt.toISOString(),
              expiresAt: i.expiresAt.toISOString(),
              link: portalLink(i.token),
              round: data.rounds.get(r.creatorId) ?? 1,
            }
          : null;
      })(),
      content: (() => {
        const c = data.content.get(r.creatorId);
        return c
          ? {
              version: c.version,
              url: c.url,
              caption: c.caption,
              status: c.status,
              feedback: c.feedback,
              submittedAt: c.submittedAt.toISOString(),
            }
          : null;
      })(),
      contract: (() => {
        const k = data.contracts.get(r.creatorId);
        return k && k.status !== "withdrawn"
          ? {
              version: k.version,
              status: k.status,
              terms: k.terms as Terms,
              text: k.bodyText,
              signedName: k.signedName,
              signedAt: k.signedAt?.toISOString() ?? null,
              requestNote: k.requestNote,
            }
          : null;
      })(),
      payoutDetails: (() => {
        const d = data.details.get(r.creatorId);
        return d ? { holderName: d.holderName, last4: d.last4, country: d.country } : null;
      })(),
      payout: (() => {
        const p = data.payouts.get(r.creatorId);
        return p
          ? {
              status: p.status,
              amountUsd: p.amountUsd,
              reference: p.reference,
              settleAt: p.settleAt.toISOString(),
              failureReason: p.failureReason,
              attempt: data.attempts.get(r.creatorId) ?? 1,
            }
          : null;
      })(),
    })),
  };
}

/** The campaign as it is now (for server actions to hand back to the page). */
export async function freshSnapshot(workspaceId: string, id: string): Promise<CampaignSnapshot> {
  // Settle anything that has come due first, so what the brand sees is true.
  await settleDuePayouts(simNow(), id);
  const data = (await getCampaign(workspaceId, id))!;
  const [w] = await db
    .select({ accountId: workspaces.accountId, tier: accounts.planTier })
    .from(workspaces)
    .innerJoin(accounts, eq(accounts.id, workspaces.accountId))
    .where(eq(workspaces.id, workspaceId));
  const used = await invitationsUsed(w!.accountId);
  const plan = limits(w!.tier as PlanTier);
  return snapshotOf(
    data,
    { used, limit: plan.invitationsPerMonth },
    { contracts: plan.features.creatorContracts, payouts: plan.features.creatorPayouts },
  );
}
