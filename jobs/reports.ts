import { and, eq, lte } from "drizzle-orm";
import { accounts, db, reports, reportSchedules, workspaces } from "@/db/client";
import { isReadOnly } from "@/lib/billing/lifecycle";
import { limits, type PlanTier } from "@/lib/entitlements/plans";
import { deliverReport } from "@/lib/reports/deliver";
import { nextRun, type Frequency } from "@/lib/reports/schedule";
import { simNow } from "@/lib/simclock";

/**
 * Send every scheduled report that is due. A schedule is claimed (its next run moved into the future) in a
 * single UPDATE that only matches while it is still due, so overlapping runs can never send the same
 * report twice. (Matching on "still due" rather than the exact old timestamp avoids microsecond rounding.)
 */
export async function runDueReports(
  now: Date = simNow(),
): Promise<{ scheduleId: string; sent: number }[]> {
  const due = await db
    .select()
    .from(reportSchedules)
    .where(and(eq(reportSchedules.active, true), lte(reportSchedules.nextRunAt, now)));
  const out: { scheduleId: string; sent: number }[] = [];
  for (const s of due) {
    // Read-only accounts, and plans without scheduled reports, don't send (nothing is claimed, so it resumes if they return).
    const [acct] = await db
      .select({ status: accounts.billingStatus, tier: accounts.planTier })
      .from(workspaces)
      .innerJoin(accounts, eq(accounts.id, workspaces.accountId))
      .where(eq(workspaces.id, s.workspaceId));
    if (
      !acct ||
      isReadOnly(acct.status) ||
      !limits(acct.tier as PlanTier).features.scheduledReports
    )
      continue;
    const when = {
      frequency: s.frequency as Frequency,
      weekday: s.weekday,
      dayOfMonth: s.dayOfMonth,
      hourUtc: s.hourUtc,
    };
    const claimed = await db
      .update(reportSchedules)
      .set({ nextRunAt: nextRun(now, when), lastRunAt: now })
      .where(
        and(
          eq(reportSchedules.id, s.id),
          eq(reportSchedules.active, true),
          lte(reportSchedules.nextRunAt, now),
        ),
      )
      .returning({ id: reportSchedules.id });
    if (!claimed.length) continue; // another run got it
    try {
      const [report] = await db.select().from(reports).where(eq(reports.id, s.reportId));
      if (!report) continue;
      const sent = await deliverReport({
        report,
        recipientIds: s.recipientIds,
        externalEmails: s.externalEmails,
        trigger: "schedule",
        scheduleId: s.id,
        schedule: when,
      });
      out.push({ scheduleId: s.id, sent });
    } catch (e) {
      console.error("[reports] delivery failed for schedule", s.id, e);
    }
  }
  return out;
}
