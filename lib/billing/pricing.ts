// What plans cost and how changes are prorated. Pure; amounts are integer cents (USD).
import { PLANS, type PlanTier } from "@/lib/entitlements/plans";

export type Interval = "monthly" | "yearly";
export const INTERVALS: Interval[] = ["monthly", "yearly"];
export const PAID_TIERS = ["starter", "growth", "agency"] as const;
export type PaidTier = (typeof PAID_TIERS)[number];
export const isPaidTier = (t: string): t is PaidTier =>
  (PAID_TIERS as readonly string[]).includes(t);

/** Yearly billing is 10 months for 12. */
export const YEARLY_MONTHS = 10;
export const TRIAL_DAYS = 14;
export const GRACE_DAYS = 3;
/** Retries after a failed renewal: days after the due date. The attempt after the last one suspends the account. */
export const DUNNING_RETRY_DAYS = [1, 3, 5] as const;
export const SAVE_OFFER = { pct: 25, cycles: 2 } as const;

const DAY = 86_400_000;

/** Price for one billing period, in cents. Enterprise is quoted by sales, so it has no list price. */
export function periodPriceCents(tier: PlanTier, interval: Interval): number | null {
  const monthly = PLANS[tier].priceMonthly;
  if (monthly === null) return null;
  return monthly * 100 * (interval === "yearly" ? YEARLY_MONTHS : 1);
}

/** Monthly-equivalent revenue, for MRR figures. */
export function mrrCents(tier: PlanTier, interval: Interval): number {
  const p = periodPriceCents(tier, interval);
  return p === null ? 0 : Math.round(p / (interval === "yearly" ? 12 : 1));
}

export const periodLengthMs = (interval: Interval, from: Date): number => {
  const end = addPeriod(from, interval);
  return end.getTime() - from.getTime();
};

/** One billing period after `from`, calendar-based (Jan 31 + 1 month = Feb 28/29). */
export function addPeriod(from: Date, interval: Interval): Date {
  const d = new Date(from);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + (interval === "yearly" ? 12 : 1));
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}

/** Whether changing to (tier, interval) costs more per month, so it should take effect right away. */
export const isUpgrade = (
  from: { tier: PlanTier; interval: Interval },
  to: { tier: PlanTier; interval: Interval },
) => mrrCents(to.tier, to.interval) > mrrCents(from.tier, from.interval);

/** Unused part of the current period, in cents, to credit against a new one. */
export function unusedCreditCents(o: {
  tier: PlanTier;
  interval: Interval;
  periodStart: Date;
  periodEnd: Date;
  now: Date;
  discountPct?: number;
}): number {
  const price = periodPriceCents(o.tier, o.interval);
  if (price === null) return 0;
  const total = o.periodEnd.getTime() - o.periodStart.getTime();
  const left = Math.max(0, Math.min(total, o.periodEnd.getTime() - o.now.getTime()));
  if (total <= 0) return 0;
  const paid = Math.round(price * (1 - (o.discountPct ?? 0) / 100));
  return Math.round((paid * left) / total);
}

export const applyDiscount = (cents: number, pct: number) => {
  const discount = Math.round((cents * pct) / 100);
  return { charge: cents - discount, discount };
};

export const money = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

export const daysBetween = (a: Date, b: Date) => Math.floor((b.getTime() - a.getTime()) / DAY);
