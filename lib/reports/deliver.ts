// Emailing a report: one tracked message per workspace member, a plain one per outside address.
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { accounts, db, memberships, reportDeliveries, users, workspaces } from "@/db/client";
import { trackServer } from "@/lib/analytics/server";
import { summarize } from "@/lib/charts/tables";
import { APP_URL, sendEmail } from "@/lib/email/service";
import { loadReportSections, periodLabel, type ReportRow } from "./service";
import { describeSchedule, type Frequency } from "./schedule";

export interface DeliverOpts {
  report: ReportRow;
  recipientIds: string[];
  externalEmails?: string[];
  trigger: "schedule" | "manual";
  scheduleId?: string | null;
  schedule?: { frequency: Frequency; weekday: number; dayOfMonth: number; hourUtc: number } | null;
}

/** Returns how many people the report went to. */
export async function deliverReport(o: DeliverOpts): Promise<number> {
  const { report } = o;
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, report.workspaceId));
  const [acct] = await db.select().from(accounts).where(eq(accounts.id, ws!.accountId));
  // Only people who are (still) members of this workspace can receive it as a member.
  const members = o.recipientIds.length
    ? await db
        .select({ id: users.id, email: users.email, name: users.name })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(
          and(eq(memberships.workspaceId, ws!.id), inArray(memberships.userId, o.recipientIds)),
        )
    : [];
  const external = [...new Set(o.externalEmails ?? [])];
  if (!members.length && !external.length) return 0;

  const loaded = await loadReportSections(ws!.id, report);
  const lines = loaded
    .filter((l) => l.result.ok)
    .slice(0, 6)
    .map((l) =>
      l.result.ok ? `• ${summarize(l.result.payload.data, l.result.payload.period)}` : "",
    );
  const cadence = o.schedule ? describeSchedule(o.schedule).toLowerCase() : "sent on request";
  const subject = `${report.name} — ${periodLabel(report, loaded).split(" (")[1]?.replace(")", "") ?? "report"}`;
  const reportPath = `/w/${ws!.slug}/reports/${report.id}`;
  const body = (link: string, tail: string) =>
    [
      `Here is your Ripplewise report "${report.name}" (${periodLabel(report, loaded)}).`,
      "",
      ...(lines.length ? lines : ["No data in this period yet."]),
      "",
      `Open the full report: ${link}`,
      "",
      tail,
    ].join("\n");

  for (const m of members) {
    const emailId = randomUUID();
    const link = `${APP_URL}/api/t/c/${emailId}?to=${encodeURIComponent(reportPath)}`;
    await sendEmail({
      id: emailId,
      toUserId: m.id,
      to: m.email,
      type: "report",
      subject,
      text: body(
        link,
        `Schedule: ${cadence}. Change or stop it from the report's Schedule button.`,
      ),
    });
    await db.insert(reportDeliveries).values({
      reportId: report.id,
      workspaceId: ws!.id,
      scheduleId: o.scheduleId ?? null,
      emailId,
      userId: m.id,
      trigger: o.trigger,
    });
  }
  for (const to of external)
    await sendEmail({
      to,
      type: "report",
      subject,
      text: body(
        `${APP_URL}/login`,
        `Sign in to Ripplewise to see the full report. Schedule: ${cadence}.`,
      ),
    });

  const count = members.length + external.length;
  if (o.trigger === "schedule")
    await trackServer(
      "Report Delivered",
      { userId: report.createdBy, workspaceId: ws!.id, accountId: acct!.id },
      { report_id: report.id, recipients_count: count },
    );
  return count;
}
