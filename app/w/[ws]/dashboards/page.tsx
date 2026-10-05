import Link from "next/link";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { NewDashboardProvider, NewDashboardTrigger } from "@/components/dashboards/NewDashboard";
import { requireWorkspace } from "@/lib/auth/session";
import { workspaceAccount } from "@/lib/dashboards/service";
import { canEdit } from "@/lib/queries";
import { relativeTime } from "@/lib/format";

export const metadata = { title: "Dashboards · Ripplewise" };
export const dynamic = "force-dynamic";

export default async function DashboardsPage({ params }: { params: Promise<{ ws: string }> }) {
  const { ws: slug } = await params;
  const { ws } = await requireWorkspace(slug);
  const { plan } = await workspaceAccount(ws.id);
  const rows = (
    await db.execute(sql`
    SELECT d.id, d.name, d.description, u.name AS owner, d.updated_at,
           (SELECT count(*)::int FROM widgets w WHERE w.dashboard_id = d.id) AS widgets,
           (SELECT max(v.viewed_at) FROM dashboard_views v WHERE v.dashboard_id = d.id) AS last_viewed,
           (SELECT count(DISTINCT v.user_id)::int FROM dashboard_views v WHERE v.dashboard_id = d.id AND v.user_id IS NOT NULL) AS viewers,
           (d.public_token IS NOT NULL) AS is_public
    FROM dashboards d LEFT JOIN users u ON u.id = d.created_by
    WHERE d.workspace_id = ${ws.id}::uuid ORDER BY d.updated_at DESC`)
  ).rows as {
    id: string;
    name: string;
    description: string;
    owner: string | null;
    updated_at: string;
    widgets: number;
    last_viewed: string | null;
    viewers: number;
    is_public: boolean;
  }[];
  const editable = canEdit(ws.role);

  return (
    <NewDashboardProvider ws={slug} features={plan.features}>
      <div className="mx-auto max-w-[1600px]">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-[30px] font-semibold leading-[38px]">Dashboards</h1>
          <div className="ml-auto">{editable && <NewDashboardTrigger />}</div>
        </div>
        {rows.length === 0 ? (
          <section
            className="mt-8 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-10 text-center"
            data-testid="dashboards-empty"
          >
            <h2 className="text-xl font-semibold">Build your first dashboard</h2>
            <p className="mx-auto mt-2 max-w-md text-[var(--text-muted)]">
              Start from a template — brand health, competitor benchmark, campaign tracker, crisis
              monitor or an executive summary — and make it yours.
            </p>
            {editable && (
              <div className="mt-4">
                <NewDashboardTrigger label="Choose a template" testId="new-dashboard-empty" />
              </div>
            )}
          </section>
        ) : (
          <ul
            className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
            data-testid="dashboard-list"
          >
            {rows.map((d) => (
              <li
                key={d.id}
                className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4"
                data-testid="dashboard-card"
              >
                <h2 className="font-semibold">
                  <Link
                    href={`/w/${slug}/dashboards/${d.id}`}
                    className="underline-offset-2 hover:underline"
                  >
                    {d.name}
                  </Link>
                </h2>
                {d.description && (
                  <p className="mt-1 line-clamp-2 text-sm text-[var(--text-muted)]">
                    {d.description}
                  </p>
                )}
                <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-[var(--text-muted)]">
                  <div>
                    <dt className="sr-only">Owner</dt>
                    <dd>By {d.owner ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="sr-only">Widgets</dt>
                    <dd>
                      {d.widgets} widget{d.widgets === 1 ? "" : "s"}
                    </dd>
                  </div>
                  <div>
                    <dt className="sr-only">Last viewed</dt>
                    <dd>
                      {d.last_viewed
                        ? `Viewed ${relativeTime(new Date(d.last_viewed).toISOString())}`
                        : "Not viewed yet"}
                    </dd>
                  </div>
                  <div>
                    <dt className="sr-only">Viewers</dt>
                    <dd>
                      {d.viewers} viewer{d.viewers === 1 ? "" : "s"}
                      {d.is_public ? " · public link" : ""}
                    </dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
        )}
      </div>
    </NewDashboardProvider>
  );
}
