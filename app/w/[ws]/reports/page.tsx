import { desc, eq, sql } from "drizzle-orm";
import Link from "next/link";
import { db, reports, reportSchedules, users } from "@/db/client";
import { requireWorkspace } from "@/lib/auth/session";
import { relativeTime } from "@/lib/format";
import { canEdit } from "@/lib/queries";
import { describeSchedule, type Frequency } from "@/lib/reports/schedule";
import { sectionsOf } from "@/lib/reports/service";
import { RANGE_LABEL, type ReportRange } from "@/lib/reports/types";

export const metadata = { title: "Reports · Ripplewise" };
export const dynamic = "force-dynamic";

export default async function ReportsPage({ params }: { params: Promise<{ ws: string }> }) {
  const { ws: slug } = await params;
  const { ws } = await requireWorkspace(slug);
  const rows = await db
    .select({
      r: reports,
      owner: users.name,
      freq: reportSchedules.frequency,
      weekday: reportSchedules.weekday,
      dom: reportSchedules.dayOfMonth,
      hour: reportSchedules.hourUtc,
      active: reportSchedules.active,
      lastSent: sql<
        string | null
      >`(SELECT max(delivered_at) FROM report_deliveries d WHERE d.report_id = ${reports.id})`,
    })
    .from(reports)
    .leftJoin(users, eq(users.id, reports.createdBy))
    .leftJoin(reportSchedules, eq(reportSchedules.reportId, reports.id))
    .where(eq(reports.workspaceId, ws.id))
    .orderBy(desc(reports.updatedAt));
  const editable = canEdit(ws.role);
  const newBtn =
    "inline-flex min-h-9 items-center rounded-md bg-[var(--primary)] px-4 text-sm font-medium text-[var(--primary-contrast)]";

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-[30px] font-semibold leading-[38px]">Reports</h1>
        <div className="ml-auto">
          {editable && (
            <Link href={`/w/${slug}/reports/new`} className={newBtn} data-testid="new-report">
              New report
            </Link>
          )}
        </div>
      </div>
      {rows.length === 0 ? (
        <section
          className="mt-8 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-10 text-center"
          data-testid="reports-empty"
        >
          <h2 className="text-xl font-semibold">Send the numbers to the people who need them</h2>
          <p className="mx-auto mt-2 max-w-md text-[var(--text-muted)]">
            Build a report from charts and tables, download it as a PDF or CSV, or have it emailed
            on a schedule.
          </p>
          {editable ? (
            <Link
              href={`/w/${slug}/reports/new`}
              className={`${newBtn} mt-4`}
              data-testid="empty-new-report"
            >
              Create your first report
            </Link>
          ) : (
            <p className="mt-4 text-sm text-[var(--text-muted)]">
              Ask a workspace admin to create one.
            </p>
          )}
        </section>
      ) : (
        <ul className="mt-6 grid gap-4 sm:grid-cols-2" data-testid="report-list">
          {rows.map(({ r, owner, freq, weekday, dom, hour, active, lastSent }) => (
            <li
              key={r.id}
              className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4"
              data-testid="report-card"
            >
              <h2 className="font-semibold">
                <Link
                  href={`/w/${slug}/reports/${r.id}`}
                  className="underline-offset-2 hover:underline"
                >
                  {r.name}
                </Link>
              </h2>
              {r.description && (
                <p className="mt-1 line-clamp-2 text-sm text-[var(--text-muted)]">
                  {r.description}
                </p>
              )}
              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-[var(--text-muted)]">
                <div>
                  <dt className="sr-only">Contents</dt>
                  <dd>
                    {sectionsOf(r).length} section{sectionsOf(r).length === 1 ? "" : "s"} ·{" "}
                    {RANGE_LABEL[r.range as ReportRange] ?? r.range}
                  </dd>
                </div>
                <div>
                  <dt className="sr-only">Owner</dt>
                  <dd>By {owner ?? "—"}</dd>
                </div>
                <div>
                  <dt className="sr-only">Schedule</dt>
                  <dd>
                    {freq && active
                      ? describeSchedule({
                          frequency: freq as Frequency,
                          weekday: weekday!,
                          dayOfMonth: dom!,
                          hourUtc: hour!,
                        })
                      : "Not scheduled"}
                  </dd>
                </div>
                <div>
                  <dt className="sr-only">Last sent</dt>
                  <dd>
                    {lastSent
                      ? `Last sent ${relativeTime(new Date(lastSent).toISOString())}`
                      : "Never sent"}
                  </dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
