// Product-qualified-account (PQA) and account-health scoring. Pure functions over a signals snapshot,
// so the rules are easy to read, test and tune. The nightly job gathers the signals (signals.ts).
export interface Signals {
  tier: string;
  billingStatus: string;
  motion: string;
  liveQueries: number;
  alerts: number;
  dashboards: number;
  schedules: number;
  /** People on seats (client viewers excluded). */
  seatsUsed: number;
  seatsLimit: number;
  mentionsPct: number; // 0-100, this month
  aiPct: number; // 0-100, this month
  paywallsViewed14d: number;
  /** Distinct days with activity in the last 14 days, and distinct people active in the last 14 days. */
  activeDays14d: number;
  activeUsers14d: number;
  /** Whole days since anyone last did anything (null = never). */
  daysSinceActive: number | null;
  cancelAtPeriodEnd: boolean;
  openSalesRequest: boolean;
  /** Influencers: creator lists, draft or running campaigns, and how much of this month's allowances are used. */
  creatorLists: number;
  activeCampaigns: number;
  creatorProfilesPct: number;
  invitationsPct: number;
  /** Which products the account actually uses ("listening", "influencers"). */
  productsUsed: string[];
}

export const PQA_THRESHOLD = 60;

export interface Pqa {
  score: number;
  reasons: string[];
  /** Whether sales should hear about it: already-enterprise and already-talking accounts are not leads. */
  eligible: boolean;
}

/** How ready an account looks for a sales conversation. Each rule adds points and a plain reason. */
export function pqa(s: Signals): Pqa {
  let score = 0;
  const reasons: string[] = [];
  const add = (pts: number, why: string) => {
    score += pts;
    reasons.push(`${why} (+${pts})`);
  };
  if (s.liveQueries >= 3) add(10, `${s.liveQueries} live queries`);
  if (s.alerts >= 1) add(10, "uses alerts");
  if (s.dashboards >= 2) add(10, `${s.dashboards} dashboards`);
  if (s.schedules >= 1) add(10, "scheduled reports");
  if (s.seatsUsed >= 3) add(15, `${s.seatsUsed} people on seats`);
  if (s.seatsLimit >= 2 && s.seatsUsed >= s.seatsLimit) add(10, "all seats used");
  if (s.mentionsPct >= 80) add(15, `${s.mentionsPct}% of monthly mentions used`);
  if (s.aiPct >= 50) add(5, "heavy AI use");
  if (s.paywallsViewed14d >= 2) add(10, "hit paywalls repeatedly");
  if (s.activeDays14d >= 7) add(10, `${s.activeDays14d} active days in two weeks`);
  if (s.activeCampaigns >= 3) add(10, `${s.activeCampaigns} active campaigns`);
  if (s.creatorProfilesPct >= 80)
    add(10, `${s.creatorProfilesPct}% of monthly creator profiles used`);
  if (s.invitationsPct >= 80) add(10, `${s.invitationsPct}% of monthly creator invitations used`);
  if (s.productsUsed.length >= 2) add(10, "uses both products");
  const eligible =
    s.tier !== "enterprise" &&
    s.motion !== "sales_assisted" &&
    !s.openSalesRequest &&
    ["trialing", "active", "past_due", "grace"].includes(s.billingStatus);
  return { score: Math.min(100, score), reasons, eligible };
}

export type HealthBand = "healthy" | "watch" | "at_risk";
export interface Health {
  score: number;
  band: HealthBand;
  reasons: string[];
}

export const bandOf = (score: number): HealthBand =>
  score >= 70 ? "healthy" : score >= 40 ? "watch" : "at_risk";

/** How well an account is doing: recent activity, breadth of use, collaboration, minus risks. */
export function health(s: Signals): Health {
  let score = 0;
  const reasons: string[] = [];
  const add = (pts: number, why: string) => {
    score += pts;
    reasons.push(`${pts > 0 ? "+" : ""}${pts} ${why}`);
  };
  if (s.daysSinceActive === null) add(0, "no activity yet");
  else if (s.daysSinceActive <= 2) add(35, "active in the last 2 days");
  else if (s.daysSinceActive <= 7) add(20, "active in the last week");
  else if (s.daysSinceActive <= 14) add(8, "active in the last two weeks");
  else add(0, `quiet for ${s.daysSinceActive} days`);
  add(Math.min(15, s.activeDays14d * 2), `${s.activeDays14d} active days in two weeks`);
  const breadth = [
    s.liveQueries > 0,
    s.alerts > 0,
    s.dashboards > 0,
    s.schedules > 0,
    s.productsUsed.includes("influencers"),
  ].filter(Boolean).length;
  add(breadth * 7, `${breadth} of 5 core features in use`);
  if (s.activeUsers14d >= 3) add(22, `${s.activeUsers14d} people active`);
  else if (s.activeUsers14d === 2) add(14, "2 people active");
  else if (s.activeUsers14d === 1) add(6, "1 person active");
  if (s.billingStatus === "past_due") add(-20, "payment past due");
  if (s.billingStatus === "locked" || s.billingStatus === "canceled")
    add(-40, `account ${s.billingStatus}`);
  if (s.cancelAtPeriodEnd) add(-25, "cancellation scheduled");
  const final = Math.max(0, Math.min(100, score));
  return { score: final, band: bandOf(final), reasons };
}
