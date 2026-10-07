// The campaign pipeline, in one place: which statuses exist, which moves are allowed, and how the budget adds up.
// The server actions enforce it and the interface only offers the moves that are allowed.

export const CREATOR_STATUSES = [
  "shortlisted",
  "invited",
  "negotiating",
  "confirmed",
  "content_submitted",
  "approved",
  "paid",
  "declined",
] as const;
export type CreatorStatus = (typeof CREATOR_STATUSES)[number];
export const isCreatorStatus = (s: string): s is CreatorStatus =>
  (CREATOR_STATUSES as readonly string[]).includes(s);

export const STATUS_LABEL: Record<CreatorStatus, string> = {
  shortlisted: "Shortlisted",
  invited: "Invited",
  negotiating: "Negotiating",
  confirmed: "Confirmed",
  content_submitted: "Content submitted",
  approved: "Content approved",
  paid: "Paid",
  declined: "Declined",
};

const NEXT: Record<CreatorStatus, CreatorStatus[]> = {
  shortlisted: ["invited", "declined"],
  invited: ["negotiating", "confirmed", "declined"],
  negotiating: ["confirmed", "declined"],
  confirmed: ["content_submitted", "declined"],
  // "Changes requested" sends the content back to confirmed.
  content_submitted: ["approved", "confirmed"],
  approved: ["paid"],
  paid: [],
  declined: ["shortlisted"],
};

/** Statuses where the creator's fee is agreed and counts against the budget. */
export const COMMITTED: readonly CreatorStatus[] = [
  "confirmed",
  "content_submitted",
  "approved",
  "paid",
];

export const nextStatuses = (from: CreatorStatus) => NEXT[from];

export function checkMove(
  from: CreatorStatus,
  to: CreatorStatus,
  feeUsd: number | null,
): { ok: true } | { ok: false; reason: string } {
  if (!NEXT[from].includes(to))
    return {
      ok: false,
      reason: `A creator who is ${STATUS_LABEL[from].toLowerCase()} can't move to ${STATUS_LABEL[to].toLowerCase()}.`,
    };
  if (to === "confirmed" && from !== "content_submitted" && !(feeUsd && feeUsd > 0))
    return { ok: false, reason: "Set the agreed fee before confirming a creator." };
  return { ok: true };
}

export interface BudgetSummary {
  budget: number;
  committed: number;
  paid: number;
  remaining: number;
  /** Share of the budget committed, 0-100 for the bar; `over` says whether it is exceeded. */
  pct: number;
  over: boolean;
}

export function budgetSummary(
  budget: number,
  rows: { status: string; feeUsd: number | null }[],
): BudgetSummary {
  let committed = 0;
  let paid = 0;
  for (const r of rows) {
    if (!isCreatorStatus(r.status) || !COMMITTED.includes(r.status)) continue;
    committed += r.feeUsd ?? 0;
    if (r.status === "paid") paid += r.feeUsd ?? 0;
  }
  return {
    budget,
    committed,
    paid,
    remaining: budget - committed,
    pct:
      budget > 0 ? Math.min(100, Math.round((committed / budget) * 100)) : committed > 0 ? 100 : 0,
    over: committed > budget,
  };
}

export const OBJECTIVES = ["awareness", "conversions", "content", "launch"] as const;
export type Objective = (typeof OBJECTIVES)[number];
export const OBJECTIVE_LABEL: Record<Objective, string> = {
  awareness: "Brand awareness",
  conversions: "Conversions",
  content: "Content creation",
  launch: "Product launch",
};
export const CAMPAIGN_STATUSES = ["draft", "active", "completed", "archived"] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];
/** Draft and active campaigns count against the plan. */
export const COUNTS_AGAINST_PLAN: readonly CampaignStatus[] = ["draft", "active"];
export const CAMPAIGN_NEXT: Record<CampaignStatus, CampaignStatus[]> = {
  draft: ["active", "archived"],
  active: ["completed", "archived"],
  completed: ["archived", "active"],
  archived: ["draft"],
};
