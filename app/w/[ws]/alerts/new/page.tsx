import Link from "next/link";
import { AlertBuilder } from "@/components/alerts/AlertBuilder";
import { requireWorkspace } from "@/lib/auth/session";
import { ALERT_TYPES, TYPE_INFO, type AlertType } from "@/lib/alerts/rules";
import { alertCount, queriesOf } from "@/lib/alerts/service";
import { can } from "@/lib/entitlements/plans";
import { accountPlan, canEdit } from "@/lib/queries";

export const metadata = { title: "New alert · Ripplewise" };
export const dynamic = "force-dynamic";

export default async function NewAlertPage({
  params,
  searchParams,
}: {
  params: Promise<{ ws: string }>;
  searchParams: Promise<{ type?: string; q?: string }>;
}) {
  const { ws: slug } = await params;
  const sp = await searchParams;
  const { ws } = await requireWorkspace(slug);
  const { accountId, tier, plan } = await accountPlan(ws.id);
  const [qs, used] = await Promise.all([queriesOf(ws.id), alertCount(accountId)]);
  const h1 = <h1 className="text-[30px] font-semibold leading-[38px]">New alert</h1>;
  const back = (
    <Link
      href={`/w/${slug}/alerts`}
      className="text-sm text-[var(--primary)] underline underline-offset-2"
    >
      ← Back to alerts
    </Link>
  );

  if (!canEdit(ws.role))
    return (
      <div className="mx-auto max-w-3xl" data-testid="alert-permission">
        {back}
        {h1}
        <p className="mt-3 text-[var(--text-muted)]">
          Your role can view alerts but not create them. Ask a workspace admin for editor access.
        </p>
      </div>
    );
  if (qs.length === 0)
    return (
      <div className="mx-auto max-w-3xl" data-testid="alert-no-queries">
        {back}
        {h1}
        <p className="mt-3 text-[var(--text-muted)]">
          Alerts watch a query, and this workspace doesn&apos;t have one yet.
        </p>
        <Link
          href={`/w/${slug}/queries/new?entry=list`}
          className="mt-4 inline-flex min-h-9 items-center rounded-md bg-[var(--primary)] px-4 text-sm font-medium text-[var(--primary-contrast)]"
        >
          Create a query
        </Link>
      </div>
    );

  const allowed = Object.fromEntries(
    ALERT_TYPES.map((t) => [t, !TYPE_INFO[t].feature || plan.features[TYPE_INFO[t].feature!]]),
  ) as Record<AlertType, boolean>;
  const limit = can(tier, "create_alert", {
    activeQueries: 0,
    seats: 0,
    workspaces: 0,
    alerts: used,
  });
  const initialType = (ALERT_TYPES as readonly string[]).includes(sp.type ?? "")
    ? (sp.type as AlertType)
    : "volume_spike";

  return (
    <div className="mx-auto max-w-5xl">
      {back}
      {h1}
      {!limit.ok ? (
        <section
          className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6"
          data-testid="alert-limit"
        >
          <h2 className="text-lg font-semibold">You&apos;ve reached your alert limit</h2>
          <p className="mt-1 text-[var(--text-muted)]">
            {limit.reason} Delete one you no longer need, or{" "}
            <Link href="/upgrade?from=alert_limit" className="underline">
              see plans
            </Link>
            .
          </p>
        </section>
      ) : (
        <div className="mt-6">
          <AlertBuilder
            ws={slug}
            queries={qs.map((q) => ({ id: q.id, name: q.name }))}
            allowed={allowed}
            limit={plan.alerts}
            used={used}
            initialType={initialType}
            initialQuery={qs.some((q) => q.id === sp.q) ? sp.q! : ""}
          />
        </div>
      )}
    </div>
  );
}
