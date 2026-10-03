import { desc, eq, inArray } from "drizzle-orm";
import Link from "next/link";
import { alertEvents, alertRules, db, queries } from "@/db/client";
import { AlertRowActions } from "@/components/alerts/AlertRowActions";
import { NewAlertButton } from "@/components/alerts/NewAlertButton";
import { SeverityBadge, StatusBadge } from "@/components/alerts/badges";
import { requireWorkspace } from "@/lib/auth/session";
import { describeRule, TYPE_INFO, type AlertType } from "@/lib/alerts/rules";
import { alertCount } from "@/lib/alerts/service";
import { can } from "@/lib/entitlements/plans";
import { relativeTime } from "@/lib/format";
import { accountPlan, canEdit } from "@/lib/queries";
import { simNow } from "@/lib/simclock";

export const metadata = { title: "Alerts · Ripplewise" };
export const dynamic = "force-dynamic";

export default async function AlertsPage({
  params,
  searchParams,
}: {
  params: Promise<{ ws: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  const { ws: slug } = await params;
  const { created } = await searchParams;
  const { ws } = await requireWorkspace(slug);
  const { accountId, tier, plan } = await accountPlan(ws.id);
  const rules = await db
    .select({ rule: alertRules, queryName: queries.name })
    .from(alertRules)
    .innerJoin(queries, eq(queries.id, alertRules.queryId))
    .where(eq(alertRules.workspaceId, ws.id))
    .orderBy(desc(alertRules.createdAt));
  const events = rules.length
    ? await db
        .select()
        .from(alertEvents)
        .where(eq(alertEvents.workspaceId, ws.id))
        .orderBy(desc(alertEvents.firedAt))
        .limit(20)
    : [];
  const used = await alertCount(accountId);
  const editable = canEdit(ws.role);
  const nameOf = new Map(rules.map((r) => [r.rule.id, r.rule]));
  const lastFired = new Map<string, Date>();
  if (rules.length) {
    const latest = await db
      .select({ ruleId: alertEvents.ruleId, at: alertEvents.firedAt })
      .from(alertEvents)
      .where(
        inArray(
          alertEvents.ruleId,
          rules.map((r) => r.rule.id),
        ),
      )
      .orderBy(desc(alertEvents.firedAt));
    for (const l of latest) if (!lastFired.has(l.ruleId)) lastFired.set(l.ruleId, l.at);
  }
  const lim = can(tier, "create_alert", {
    activeQueries: 0,
    seats: 0,
    workspaces: 0,
    alerts: used,
  });
  const now = simNow().getTime();

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-[30px] font-semibold leading-[38px]">Alerts</h1>
        <span className="text-sm text-[var(--text-muted)]" data-testid="alert-usage">
          {used} of {plan.alerts.toLocaleString()} used
        </span>
        <div className="ml-auto">
          {editable && (
            <NewAlertButton
              ws={slug}
              atLimit={!lim.ok}
              upgradeTo={lim.ok ? tier : lim.upgradeTo}
              used={used}
              limit={plan.alerts}
            />
          )}
        </div>
      </div>
      {created && (
        <p
          role="status"
          className="mt-3 rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm"
          data-testid="alert-created"
        >
          Alert created. It&apos;s checked every time new mentions arrive for its query.
        </p>
      )}

      {rules.length === 0 ? (
        <section
          className="mt-8 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-10 text-center"
          data-testid="alerts-empty"
        >
          <h2 className="text-xl font-semibold">Get told when something changes</h2>
          <p className="mx-auto mt-2 max-w-md text-[var(--text-muted)]">
            Alerts watch a query and ping you when volume spikes, sentiment turns, or a big account
            joins the conversation — so you hear about it before your boss does.
          </p>
          {editable ? (
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Link
                href={`/w/${slug}/alerts/new?type=volume_spike`}
                className="inline-flex min-h-9 items-center rounded-md bg-[var(--primary)] px-4 text-sm font-medium text-[var(--primary-contrast)]"
                data-testid="empty-new-alert"
              >
                Create a volume alert
              </Link>
              <Link
                href={`/w/${slug}/alerts/new?type=influencer`}
                className="inline-flex min-h-9 items-center rounded-md border border-[var(--border)] px-4 text-sm font-medium hover:bg-[var(--surface-2)]"
              >
                Watch for high-reach authors
              </Link>
            </div>
          ) : (
            <p className="mt-4 text-sm text-[var(--text-muted)]">
              Ask a workspace admin to set one up.
            </p>
          )}
        </section>
      ) : (
        <>
          <section className="mt-8" aria-labelledby="triggered">
            <h2 id="triggered" className="text-lg font-semibold">
              Recently triggered
            </h2>
            {events.length === 0 ? (
              <p
                className="mt-2 rounded-lg border border-dashed border-[var(--border)] p-6 text-sm text-[var(--text-muted)]"
                data-testid="no-events"
              >
                Nothing has triggered yet. We check each alert whenever new mentions arrive.
              </p>
            ) : (
              <ul className="mt-3 flex flex-col gap-2" data-testid="event-list">
                {events.map((e) => (
                  <li
                    key={e.id}
                    className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3"
                    data-testid="event-row"
                    data-status={e.status}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <SeverityBadge severity={e.severity} />
                      <Link
                        href={`/w/${slug}/alerts/events/${e.id}`}
                        className="font-medium underline-offset-2 hover:underline"
                      >
                        {nameOf.get(e.ruleId)?.name ?? "Alert"}
                      </Link>
                      <StatusBadge status={e.status} />
                      <span className="ml-auto text-xs text-[var(--text-muted)]">
                        {relativeTime(e.firedAt.toISOString(), now)}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-[var(--text-muted)]">{e.summary}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="mt-8" aria-labelledby="rules">
            <h2 id="rules" className="text-lg font-semibold">
              Your alerts
            </h2>
            <div className="mt-3 overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface)]">
              <table className="w-full text-left text-sm" data-testid="rule-table">
                <caption className="sr-only">Alert rules in this workspace</caption>
                <thead className="text-[var(--text-muted)]">
                  <tr className="border-b border-[var(--border)]">
                    <th scope="col" className="px-3 py-2 font-medium">
                      Alert
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Triggers when
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Last fired
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Status
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rules.map(({ rule, queryName }) => (
                    <tr
                      key={rule.id}
                      className="border-b border-[var(--border)] last:border-0"
                      data-testid="rule-row"
                    >
                      <th scope="row" className="px-3 py-2 font-medium">
                        {rule.name}
                        <span className="block text-xs font-normal text-[var(--text-muted)]">
                          {TYPE_INFO[rule.type as AlertType].label} · {queryName}
                          {rule.channels.includes("email") ? " · email" : ""}
                        </span>
                      </th>
                      <td className="px-3 py-2 text-[var(--text-muted)]">
                        {describeRule(
                          rule.type as AlertType,
                          rule.params as Record<string, unknown>,
                        )}
                      </td>
                      <td className="px-3 py-2 text-[var(--text-muted)]">
                        {lastFired.has(rule.id)
                          ? relativeTime(lastFired.get(rule.id)!.toISOString(), now)
                          : "Never"}
                      </td>
                      <td className="px-3 py-2" data-testid="rule-status">
                        {rule.status === "muted" ? "Muted" : "Active"}
                      </td>
                      <td className="px-3 py-2">
                        <AlertRowActions
                          ws={slug}
                          id={rule.id}
                          name={rule.name}
                          muted={rule.status === "muted"}
                          canEdit={editable}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
