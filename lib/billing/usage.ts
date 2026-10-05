// One snapshot of everything a plan limits, for the Usage page and for checking a downgrade fits.
import { and, count, eq, isNull } from "drizzle-orm";
import { alertRules, db, queries, usageCounters, workspaces } from "@/db/client";
import { limits, type PlanTier } from "@/lib/entitlements/plans";
import { seatUsage } from "@/lib/team/seats";
import { simNow } from "@/lib/simclock";
import { periodOf } from "@/lib/usage";

export interface Meter {
  key: "mentions" | "queries" | "alerts" | "seats" | "workspaces" | "ai";
  label: string;
  used: number;
  limit: number;
  pct: number;
  /** What counts toward it, in plain words. */
  note: string;
}

export async function accountUsage(
  accountId: string,
  tier: PlanTier,
  now: Date = simNow(),
): Promise<Meter[]> {
  const p = limits(tier);
  const [mentions] = await db
    .select({ v: usageCounters.value })
    .from(usageCounters)
    .where(
      and(
        eq(usageCounters.accountId, accountId),
        eq(usageCounters.period, periodOf(now)),
        eq(usageCounters.metric, "mentions"),
      ),
    );
  const [ai] = await db
    .select({ v: usageCounters.value })
    .from(usageCounters)
    .where(
      and(
        eq(usageCounters.accountId, accountId),
        eq(usageCounters.period, periodOf(now)),
        eq(usageCounters.metric, "ai_questions"),
      ),
    );
  const [q] = await db
    .select({ n: count() })
    .from(queries)
    .innerJoin(workspaces, eq(workspaces.id, queries.workspaceId))
    .where(and(eq(workspaces.accountId, accountId), eq(queries.status, "live")));
  const [a] = await db
    .select({ n: count() })
    .from(alertRules)
    .innerJoin(workspaces, eq(workspaces.id, alertRules.workspaceId))
    .where(eq(workspaces.accountId, accountId));
  const seats = await seatUsage(accountId);
  const [w] = await db
    .select({ n: count() })
    .from(workspaces)
    .where(and(eq(workspaces.accountId, accountId), isNull(workspaces.archivedAt)));
  const meter = (
    key: Meter["key"],
    label: string,
    used: number,
    limit: number,
    note: string,
  ): Meter => ({
    key,
    label,
    used,
    limit,
    pct: limit ? Math.min(100, Math.round((used / limit) * 100)) : 0,
    note,
  });
  return [
    meter(
      "mentions",
      "Mentions this month",
      mentions?.v ?? 0,
      p.mentionsPerMonth,
      "Resets on the 1st. At the limit, new mentions stop collecting; what you have stays visible.",
    ),
    meter(
      "queries",
      "Active queries",
      q?.n ?? 0,
      p.activeQueries,
      "Live queries across all workspaces. Pause one to free a slot.",
    ),
    meter("alerts", "Alerts", a?.n ?? 0, p.alerts, "Alert rules across all workspaces."),
    meter(
      "seats",
      "Seats",
      seats.used,
      p.seats,
      "People who work in your workspaces (counted once, even in several) plus invitations not yet accepted. Client viewers are free.",
    ),
    meter(
      "workspaces",
      "Workspaces",
      w?.n ?? 0,
      p.workspaces,
      "Brands or clients you track separately.",
    ),
    meter("ai", "Ask AI questions this month", ai?.v ?? 0, p.askAiPerMonth, "Resets on the 1st."),
  ];
}

/** What would stop an account moving to `target`: a list of plain-language things to fix first. */
export async function downgradeBlockers(accountId: string, target: PlanTier): Promise<string[]> {
  const meters = await accountUsage(accountId, target);
  const label: Record<string, (over: number) => string> = {
    queries: (n) => `Pause ${n} active ${n === 1 ? "query" : "queries"}`,
    alerts: (n) => `Delete ${n} ${n === 1 ? "alert" : "alerts"}`,
    seats: (n) =>
      `Remove ${n} ${n === 1 ? "person or pending invitation" : "people or pending invitations"}`,
    workspaces: (n) => `Archive ${n} ${n === 1 ? "workspace" : "workspaces"}`,
  };
  return meters
    .filter((m) => m.key in label && m.used > m.limit)
    .map(
      (m) =>
        `${label[m.key]!(m.used - m.limit)} (${limits(target).label} allows ${m.limit}, you have ${m.used}).`,
    );
}
