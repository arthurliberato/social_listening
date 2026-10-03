// Alert evaluation against a workspace's matched mentions. Called by the release job whenever a
// query's data advances, so an alert fires within one release cycle of its condition being true.
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { alertEvents, alertRules, db, memberships, queries, users, workspaces } from "@/db/client";
import { trackServer } from "@/lib/analytics/server";
import { APP_URL, sendEmail } from "@/lib/email/service";
import { EFFECTIVE_SENTIMENT, SPAM_SQL } from "@/lib/mentions/feed";
import {
  BASELINE_HOURS,
  HOUR_MS,
  WINDOW_MS,
  denseBuckets,
  evaluate,
  parseParams,
  type AlertType,
  type Bucket,
  type Observation,
  type Params,
} from "./rules";

/**
 * Hourly buckets of a query's visible (non-spam, override-aware) mentions in [fromMs, toMs).
 * Mirrors what the Mentions feed shows, so an alert's numbers match what people see when they click through.
 */
export async function loadBuckets(
  workspaceId: string,
  queryId: string,
  fromMs: number,
  toMs: number,
): Promise<Bucket[]> {
  const res = await db.execute(sql`
    SELECT (extract(epoch FROM date_trunc('hour', m.published_at AT TIME ZONE 'UTC')) * 1000)::bigint AS t,
           count(*)::int AS count,
           count(*) FILTER (WHERE ${EFFECTIVE_SENTIMENT} = 'negative')::int AS negative,
           coalesce(max(m.reach_est), 0)::bigint AS max_reach
    FROM query_matches qm
    JOIN mentions m ON m.id = qm.mention_id
    JOIN authors a ON a.id = m.author_id
    LEFT JOIN mention_overrides o ON o.workspace_id = ${workspaceId}::uuid AND o.mention_id = m.id
    WHERE qm.query_id = ${queryId}::uuid
      AND qm.published_at >= ${new Date(fromMs)} AND qm.published_at < ${new Date(toMs)}
      AND NOT ${SPAM_SQL}
    GROUP BY 1`);
  return (res.rows as { t: string; count: number; negative: number; max_reach: string }[]).map(
    (r) => ({
      t: Number(r.t),
      count: r.count,
      negative: r.negative,
      maxReach: Number(r.max_reach),
    }),
  );
}

/** The trailing hour ending at `until`, plus the week of normal hours before it. */
export async function observe(
  workspaceId: string,
  queryId: string,
  until: Date,
): Promise<Observation> {
  const end = until.getTime();
  const start = end - WINDOW_MS;
  const [win] = await loadBucketsExact(workspaceId, queryId, start, end);
  // Whole hours only: a partial hour at the boundary would drag the "usual" volume down.
  const baseEnd = Math.floor(start / HOUR_MS) * HOUR_MS;
  const baseStart = baseEnd - BASELINE_HOURS * HOUR_MS;
  const baseline = denseBuckets(
    await loadBuckets(workspaceId, queryId, baseStart, baseEnd),
    baseStart,
    baseEnd,
  );
  return {
    count: win?.count ?? 0,
    negative: win?.negative ?? 0,
    maxReach: win?.maxReach ?? 0,
    baseline,
  };
}

/** One bucket covering exactly [fromMs, toMs) (not clock-aligned). */
async function loadBucketsExact(
  workspaceId: string,
  queryId: string,
  fromMs: number,
  toMs: number,
): Promise<Bucket[]> {
  const res = await db.execute(sql`
    SELECT count(*)::int AS count,
           count(*) FILTER (WHERE ${EFFECTIVE_SENTIMENT} = 'negative')::int AS negative,
           coalesce(max(m.reach_est), 0)::bigint AS max_reach
    FROM query_matches qm
    JOIN mentions m ON m.id = qm.mention_id
    JOIN authors a ON a.id = m.author_id
    LEFT JOIN mention_overrides o ON o.workspace_id = ${workspaceId}::uuid AND o.mention_id = m.id
    WHERE qm.query_id = ${queryId}::uuid
      AND qm.published_at >= ${new Date(fromMs)} AND qm.published_at < ${new Date(toMs)}
      AND NOT ${SPAM_SQL}`);
  const r = res.rows[0] as { count: number; negative: number; max_reach: string };
  return [{ t: fromMs, count: r.count, negative: r.negative, maxReach: Number(r.max_reach) }];
}

export interface Fired {
  ruleId: string;
  eventId: string;
  severity: string;
  summary: string;
}

/** Evaluate every active rule on a query as of `until`; record, notify and track the ones that fire. */
export async function evaluateAlerts(queryId: string, until: Date): Promise<Fired[]> {
  const [q] = await db.select().from(queries).where(eq(queries.id, queryId));
  if (!q || q.status !== "live") return [];
  const rules = await db
    .select()
    .from(alertRules)
    .where(and(eq(alertRules.queryId, queryId), eq(alertRules.status, "active")));
  if (!rules.length) return [];
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, q.workspaceId));
  const obs = await observe(q.workspaceId, queryId, until);
  const fired: Fired[] = [];

  for (const rule of rules) {
    const type = rule.type as AlertType;
    const parsed = parseParams(type, rule.params);
    if (!parsed.ok) continue;
    const verdict = evaluate(type, parsed.params as Params[typeof type], obs);
    if (!verdict.fired) continue;

    const [last] = await db
      .select({ firedAt: alertEvents.firedAt })
      .from(alertEvents)
      .where(eq(alertEvents.ruleId, rule.id))
      .orderBy(desc(alertEvents.firedAt))
      .limit(1);
    if (last && until.getTime() - last.firedAt.getTime() < rule.cooldownMin * 60_000) continue;

    const [ev] = await db
      .insert(alertEvents)
      .values({
        ruleId: rule.id,
        workspaceId: rule.workspaceId,
        firedAt: until,
        severity: verdict.severity,
        summary: verdict.summary,
        details: { ...verdict.details, queryName: q.name },
      })
      .returning({ id: alertEvents.id });
    fired.push({
      ruleId: rule.id,
      eventId: ev!.id,
      severity: verdict.severity,
      summary: verdict.summary,
    });

    const ctx = { userId: rule.createdBy, workspaceId: rule.workspaceId, accountId: ws!.accountId };
    await trackServer("Alert Triggered", ctx, {
      alert_id: rule.id,
      alert_type: type,
      severity: verdict.severity,
    });
    for (const channel of rule.channels) {
      if (channel === "email") {
        await emailMembers(rule.workspaceId, ws!.slug, rule.name, verdict.summary, ev!.id);
      }
      await trackServer("Alert Notification Sent", ctx, { alert_id: rule.id, channel });
    }
  }
  return fired;
}

/** Owners, admins and editors get alert emails (viewers and client viewers don't triage). */
async function emailMembers(
  workspaceId: string,
  slug: string,
  ruleName: string,
  summary: string,
  eventId: string,
) {
  const rows = await db
    .select({ id: users.id, email: users.email })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        eq(memberships.workspaceId, workspaceId),
        inArray(memberships.role, ["owner", "admin", "editor"]),
      ),
    );
  for (const u of rows) {
    await sendEmail({
      toUserId: u.id,
      to: u.email,
      type: "alert",
      subject: `Alert: ${ruleName}`,
      text: `${summary}\n\nSee what's driving it:\n${APP_URL}/w/${slug}/alerts/events/${eventId}\n\nYou're getting this because "${ruleName}" is set to email you. Mute or change it any time from Alerts.`,
    });
  }
}
