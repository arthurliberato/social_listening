// Gather the signals the scoring rules read, for one account, as of `now`.
import { and, count, eq, gt, inArray, sql } from "drizzle-orm";
import {
  accounts,
  analyticsEvents,
  dashboards,
  db,
  reportSchedules,
  salesRequests,
  workspaces,
} from "@/db/client";
import { accountUsage } from "@/lib/billing/usage";
import { accountActiveCampaigns } from "@/lib/creators/campaigns";
import { invitationsUsed } from "@/lib/creators/outreach";
import { accountListCount, profileViewUsage } from "@/lib/creators/service";
import { limits, type PlanTier } from "@/lib/entitlements/plans";
import type { Signals } from "./score";

const DAY = 86_400_000;

export async function gatherSignals(accountId: string, now: Date): Promise<Signals | null> {
  const [a] = await db.select().from(accounts).where(eq(accounts.id, accountId));
  if (!a) return null;
  const meters = Object.fromEntries(
    (await accountUsage(accountId, a.planTier as PlanTier, now)).map((m) => [m.key, m]),
  );
  const wsIds = (
    await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.accountId, accountId))
  ).map((w) => w.id);
  const [dash] = wsIds.length
    ? await db.select({ n: count() }).from(dashboards).where(inArray(dashboards.workspaceId, wsIds))
    : [{ n: 0 }];
  const [sched] = wsIds.length
    ? await db
        .select({ n: count() })
        .from(reportSchedules)
        .where(and(inArray(reportSchedules.workspaceId, wsIds), eq(reportSchedules.active, true)))
    : [{ n: 0 }];
  const since = new Date(now.getTime() - 14 * DAY);
  const act = (
    await db.execute(sql`
      SELECT count(DISTINCT (ts AT TIME ZONE 'UTC')::date)::int AS days,
             count(DISTINCT user_id)::int AS users,
             max(ts) AS last
      FROM analytics_events
      WHERE account_id = ${accountId}::uuid AND user_id IS NOT NULL AND ts <= ${now}
        AND ts > ${new Date(now.getTime() - 3650 * DAY)}`)
  ).rows[0] as { days: number; users: number; last: string | null };
  const recent = (
    await db.execute(sql`
      SELECT count(DISTINCT (ts AT TIME ZONE 'UTC')::date)::int AS days,
             count(DISTINCT user_id)::int AS users
      FROM analytics_events
      WHERE account_id = ${accountId}::uuid AND user_id IS NOT NULL AND ts > ${since} AND ts <= ${now}`)
  ).rows[0] as { days: number; users: number };
  const [pw] = await db
    .select({ n: count() })
    .from(analyticsEvents)
    .where(
      and(
        eq(analyticsEvents.accountId, accountId),
        eq(analyticsEvents.name, "Paywall Viewed"),
        gt(analyticsEvents.ts, since),
      ),
    );
  const [open] = await db
    .select({ n: count() })
    .from(salesRequests)
    .where(
      and(
        eq(salesRequests.accountId, accountId),
        gt(salesRequests.createdAt, new Date(now.getTime() - 60 * DAY)),
      ),
    );
  const [lists, campaignsActive, profiles, invitesUsed] = await Promise.all([
    accountListCount(wsIds),
    accountActiveCampaigns(accountId),
    profileViewUsage(accountId, a.planTier as PlanTier),
    invitationsUsed(accountId),
  ]);
  const inviteLimit = limits(a.planTier as PlanTier).invitationsPerMonth;
  const listening =
    (meters.queries?.used ?? 0) > 0 ||
    (meters.alerts?.used ?? 0) > 0 ||
    (dash?.n ?? 0) > 0 ||
    (sched?.n ?? 0) > 0;
  const influencers = lists > 0 || campaignsActive > 0 || profiles.used > 0;
  return {
    tier: a.planTier,
    billingStatus: a.billingStatus,
    motion: a.motion,
    liveQueries: meters.queries?.used ?? 0,
    alerts: meters.alerts?.used ?? 0,
    dashboards: dash?.n ?? 0,
    schedules: sched?.n ?? 0,
    seatsUsed: meters.seats?.used ?? 0,
    seatsLimit: meters.seats?.limit ?? 0,
    mentionsPct: meters.mentions?.pct ?? 0,
    aiPct: meters.ai?.pct ?? 0,
    paywallsViewed14d: pw?.n ?? 0,
    activeDays14d: recent.days,
    activeUsers14d: recent.users,
    daysSinceActive: act.last
      ? Math.max(0, Math.floor((now.getTime() - new Date(act.last).getTime()) / DAY))
      : null,
    cancelAtPeriodEnd: a.cancelAtPeriodEnd,
    openSalesRequest: (open?.n ?? 0) > 0,
    creatorLists: lists,
    activeCampaigns: campaignsActive,
    creatorProfilesPct: profiles.pct,
    invitationsPct: Math.min(100, Math.round((invitesUsed / inviteLimit) * 100)),
    productsUsed: [listening ? "listening" : null, influencers ? "influencers" : null].filter(
      (x): x is string => !!x,
    ),
  };
}
