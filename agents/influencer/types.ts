// Shapes for the influencer-marketing agent. Kept apart from the listening agent's types: a different case, a different
// brain, a different deliverable.
export interface InfluencerCase {
  id: string;
  kind: "influencers";
  client_project_id: string;
  /** The brand the campaign is for, as the agency would name it. */
  client: string;
  requester_role: string;
  /** What the agent is told, in a person's words. Which platform and niche it means is the agent's job to work out. */
  brief: string;
  deliverable: "campaign_plan";
  budget_usd: number;
  creators_wanted: number;
  invites_wanted: number;
  due_in_days: number;
}

/** Only the evaluator reads this. */
export interface InfluencerTruth {
  id: string;
  platform: string;
  niche: string;
  min_authenticity: number;
  brand_safe_required: boolean;
  budget_usd: number;
  creators_wanted: number;
  invites_wanted: number;
}

/** One row of the discovery table, as a person reads it. Authenticity is null when the agent doesn't look at it. */
export interface Candidate {
  id: number;
  name: string;
  handle: string;
  platform: string;
  niche: string;
  followers: number;
  engagement: number;
  avgViews: number;
  authenticity: number | null;
  brandSafe: boolean;
  rateUsd: number;
}

export interface SearchPlan {
  platform: string | null;
  niche: string | null;
  rationale: string;
}

export interface PartnershipsBrain {
  readonly name: string;
  readonly model: string | null;
  planSearch(i: { brief: string; platforms: string[]; niches: string[] }): Promise<SearchPlan>;
  choose(i: {
    brief: string;
    budgetUsd: number;
    wanted: number;
    candidates: Candidate[];
  }): Promise<{ ids: number[]; rationale: string }>;
  writeInvite(i: {
    campaign: string;
    brand: string;
    creator: Candidate;
    offerUsd: number;
  }): Promise<string>;
}

export interface CampaignPlan {
  campaignId: string;
  campaignName: string;
  picked: Candidate[];
  invited: { id: number; offerUsd: number }[];
  committedUsd: number;
  rationale: string;
  injected: { type: string; detail: string }[];
}
