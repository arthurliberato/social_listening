// The evaluator for an influencer case: reads what the agent built in the platform and scores it against the case
// truth. Agents never see the truth or this code. Metrics are plain counts so a score can be re-derived by hand.
import { and, eq, inArray } from "drizzle-orm";
import { campaignCreators, campaignInvites, creators, db } from "@/db/client";
import type { InfluencerTruth } from "./types";

export interface InfluencerEvaluation {
  case_id: string;
  campaign: {
    roster: number;
    fit_platform_niche: number;
    authentic: number;
    brand_safe: number;
    all_criteria: number;
    authentic_share: number | null;
  };
  outreach: {
    invitations: number;
    committed_usd: number;
    budget_usd: number;
    within_budget: boolean;
    over_budget_usd: number;
  };
  rubric: { invitations_made: boolean; within_budget: boolean; fits_brief: boolean; pass: boolean };
}

/** The scoring rules, separate from the database so they can be tested on plain numbers. */
export function scoreCampaign(
  truth: InfluencerTruth,
  rows: { platform: string; niche: string; authenticity: number; brandSafety: string }[],
  offers: number[],
): InfluencerEvaluation {
  const fit = rows.filter((r) => r.platform === truth.platform && r.niche === truth.niche);
  const authentic = rows.filter((r) => r.authenticity >= truth.min_authenticity);
  const safe = rows.filter((r) => r.brandSafety === "safe");
  const all = rows.filter(
    (r) =>
      r.platform === truth.platform &&
      r.niche === truth.niche &&
      r.authenticity >= truth.min_authenticity &&
      (!truth.brand_safe_required || r.brandSafety === "safe"),
  );
  const committed = offers.reduce((a, b) => a + b, 0);
  const within = committed <= truth.budget_usd;
  const invitationsMade = offers.length >= truth.invites_wanted;
  const fitsBrief = rows.length >= truth.creators_wanted && fit.length === rows.length;
  return {
    case_id: truth.id,
    campaign: {
      roster: rows.length,
      fit_platform_niche: fit.length,
      authentic: authentic.length,
      brand_safe: safe.length,
      all_criteria: all.length,
      authentic_share: rows.length ? authentic.length / rows.length : null,
    },
    outreach: {
      invitations: offers.length,
      committed_usd: committed,
      budget_usd: truth.budget_usd,
      within_budget: within,
      over_budget_usd: Math.max(0, committed - truth.budget_usd),
    },
    rubric: {
      invitations_made: invitationsMade,
      within_budget: within,
      fits_brief: fitsBrief,
      pass: invitationsMade && within && fitsBrief,
    },
  };
}

export async function evaluateInfluencerRun(
  truth: InfluencerTruth,
  campaignId: string,
): Promise<InfluencerEvaluation> {
  const roster = await db
    .select({
      platform: creators.platform,
      niche: creators.niche,
      authenticity: creators.authenticityScore,
      brandSafety: creators.brandSafety,
    })
    .from(campaignCreators)
    .innerJoin(creators, eq(creators.id, campaignCreators.creatorId))
    .where(eq(campaignCreators.campaignId, campaignId));
  // Invitations that still stand: a superseded or withdrawn one is not money committed.
  const invites = await db
    .select({ offered: campaignInvites.offeredUsd })
    .from(campaignInvites)
    .where(
      and(
        eq(campaignInvites.campaignId, campaignId),
        inArray(campaignInvites.status, ["sent", "accepted", "countered"]),
      ),
    );
  return scoreCampaign(
    truth,
    roster,
    invites.map((i) => i.offered),
  );
}
