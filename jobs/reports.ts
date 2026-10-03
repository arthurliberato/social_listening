import { and, eq, lte } from "drizzle-orm";
import { db, reports, reportSchedules } from "@/db/client";
import { deliverReport } from "@/lib/reports/deliver";
import { nextRun, type Frequency } from "@/lib/reports/schedule";
import { simNow } from "@/lib/simclock";

/**
 * Send every scheduled report that is due. A schedule is claimed (its next run advanced) in a single
 * UPDATE before sending, so overlapping runs can never send the same report twice.
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
    const when = {
      frequency: s.frequency as Frequency,
      weekday: s.weekday,
      dayOfMonth: s.dayOfMonth,
      hourUtc: s.hourUtc,
    };
    const claimed = await db
      .update(reportSchedules)
      .set({ nextRunAt: nextRun(now, when), lastRunAt: now })
      .where(and(eq(reportSchedules.id, s.id), eq(reportSchedules.nextRunAt, s.nextRunAt)))
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
