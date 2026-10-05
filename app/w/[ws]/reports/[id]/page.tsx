import { and, asc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db, memberships, queries, reportSchedules, users } from "@/db/client";
import { ReportView } from "@/components/reports/ReportView";
import { trackServer } from "@/lib/analytics/server";
import { requireWorkspace } from "@/lib/auth/session";
import { accountPlan, canEdit } from "@/lib/queries";
import type { Frequency } from "@/lib/reports/schedule";
import { getReport, sectionsOf } from "@/lib/reports/service";
import type { ReportRange } from "@/lib/reports/types";

export const metadata = { title: "Report · Ripplewise" };
export const dynamic = "force-dynamic";

export default async function ReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ ws: string; id: string }>;
  searchParams: Promise<{ edit?: string }>;
}) {
  const { ws: slug, id } = await params;
  const sp = await searchParams;
  const { user, ws } = await requireWorkspace(slug);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const report = await getReport(ws.id, id);
  if (!report) notFound();
  const { plan } = await accountPlan(ws.id);
  const [qs, members, sched] = await Promise.all([
    db
      .select({ id: queries.id, name: queries.name })
      .from(queries)
      .where(eq(queries.workspaceId, ws.id))
      .orderBy(queries.name),
    db
      .select({ id: users.id, name: users.name, role: memberships.role })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.workspaceId, ws.id))
      .orderBy(asc(users.name)),
    db
      .select()
      .from(reportSchedules)
      .where(and(eq(reportSchedules.reportId, id), eq(reportSchedules.active, true))),
  ]);
  if (!sp.edit)
    await trackServer(
      "Report Opened",
      { userId: user.id, workspaceId: ws.id, accountId: ws.accountId },
      { report_id: id, channel: "app" },
    );
  const s = sched[0];
  return (
    <>
      <p className="mx-auto max-w-5xl">
        <Link
          href={`/w/${slug}/reports`}
          className="text-sm text-[var(--primary)] underline underline-offset-2"
        >
          ← All reports
        </Link>
      </p>
      <ReportView
        ws={slug}
        report={{
          id,
          name: report.name,
          description: report.description,
          range: report.range as ReportRange,
          templateId: report.templateId,
          sections: sectionsOf(report),
        }}
        canEdit={canEdit(ws.role)}
        canExport={ws.role !== "client_viewer"}
        features={plan.features}
        queries={qs}
        members={members}
        meId={user.id}
        startEditing={!!sp.edit}
        schedule={
          s
            ? {
                frequency: s.frequency as Frequency,
                weekday: s.weekday,
                dayOfMonth: s.dayOfMonth,
                hourUtc: s.hourUtc,
                recipientIds: s.recipientIds,
                externalEmails: s.externalEmails,
                nextRunAt: s.nextRunAt.toISOString(),
              }
            : null
        }
      />
    </>
  );
}
