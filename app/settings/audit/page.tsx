import { and, desc, eq, like, lt, or, type SQL } from "drizzle-orm";
import Link from "next/link";
import { auditLog, db, users, workspaces } from "@/db/client";
import { requireUser } from "@/lib/auth/session";
import { AUDIT_CATEGORIES, AUDIT_LABEL, auditDetail } from "@/lib/audit";
import { accountOf } from "@/lib/billing/context";
import { limits, PLANS, planUnlocking, type PlanTier } from "@/lib/entitlements/plans";
import { pickWorkspace } from "@/lib/team/scope";

export const metadata = { title: "Audit log · Ripplewise" };
export const dynamic = "force-dynamic";
const PAGE = 25;
const stamp = (d: Date) => d.toISOString().slice(0, 16).replace("T", " ");

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ cat?: string; before?: string }>;
}) {
  const sp = await searchParams;
  const user = await requireUser();
  const { selected, allowed } = await pickWorkspace(user.id, undefined, "audit.view");
  const h1 = <h1 className="text-[30px] font-semibold leading-[38px]">Audit log</h1>;
  if (!selected || !allowed)
    return (
      <div data-testid="audit-forbidden">
        {h1}
        <p className="mt-3 text-[var(--text-muted)]">
          Only owners and admins can see the audit log.
        </p>
      </div>
    );
  const acct = await accountOf(selected.accountId);
  if (!limits(acct.planTier as PlanTier).features.auditLog) {
    const need = PLANS[planUnlocking("auditLog")];
    return (
      <div className="max-w-2xl" data-testid="audit-locked">
        {h1}
        <section className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
          <h2 className="text-lg font-semibold">See who changed what</h2>
          <p className="mt-2 text-[var(--text-muted)]">
            The audit log records invitations, role changes, workspace and plan changes, and
            sharing, with who did it and when. It&apos;s part of the {need.label} plan and above. We
            keep recording from today, so the history will be there when you upgrade.
          </p>
          <Link
            href={`/upgrade?from=audit_log&plan=${planUnlocking("auditLog")}`}
            className="mt-4 inline-flex min-h-9 items-center rounded-md bg-[var(--primary)] px-4 text-sm font-medium text-[var(--primary-contrast)]"
            data-testid="audit-upgrade"
          >
            See plans
          </Link>
        </section>
      </div>
    );
  }
  const cat = AUDIT_CATEGORIES[sp.cat ?? "all"] ? (sp.cat ?? "all") : "all";
  const before = Number(sp.before);
  const conds: (SQL | undefined)[] = [eq(auditLog.accountId, acct.id)];
  const prefixes = AUDIT_CATEGORIES[cat]!.prefixes;
  if (prefixes.length) conds.push(or(...prefixes.map((p) => like(auditLog.action, `${p}%`))));
  if (Number.isFinite(before) && before > 0) conds.push(lt(auditLog.seq, before));
  const rows = await db
    .select({ e: auditLog, who: users.name, ws: workspaces.name })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.actorUserId))
    .leftJoin(workspaces, eq(workspaces.id, auditLog.workspaceId))
    .where(and(...conds))
    .orderBy(desc(auditLog.seq))
    .limit(PAGE + 1);
  const page = rows.slice(0, PAGE);
  const next = rows.length > PAGE ? page[page.length - 1]!.e.seq : null;

  return (
    <div className="max-w-5xl">
      {h1}
      <p className="mt-1 text-[var(--text-muted)]">
        Everything that changed in your account, newest first. Times are UTC.
      </p>
      <nav
        aria-label="Filter the log"
        className="mt-4 flex flex-wrap gap-2"
        data-testid="audit-filters"
      >
        {Object.entries(AUDIT_CATEGORIES).map(([k, c]) => (
          <Link
            key={k}
            href={k === "all" ? "/settings/audit" : `/settings/audit?cat=${k}`}
            aria-current={k === cat ? "page" : undefined}
            className={`inline-flex min-h-8 items-center rounded-full border px-3 text-sm ${k === cat ? "border-[var(--primary)] bg-[var(--surface-2)] font-medium" : "border-[var(--border)] hover:bg-[var(--surface-2)]"}`}
            data-testid={`audit-cat-${k}`}
          >
            {c.label}
          </Link>
        ))}
      </nav>
      {page.length === 0 ? (
        <p
          className="mt-6 rounded-lg border border-dashed border-[var(--border)] p-6 text-sm text-[var(--text-muted)]"
          data-testid="audit-empty"
        >
          Nothing here yet. Changes to people, workspaces, your plan and sharing will appear as they
          happen.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface)]">
          <table className="w-full text-left text-sm" data-testid="audit-table">
            <caption className="sr-only">Audit log</caption>
            <thead className="text-[var(--text-muted)]">
              <tr className="border-b border-[var(--border)]">
                <th scope="col" className="px-3 py-2 font-medium">
                  When (UTC)
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Who
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  What
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Details
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Workspace
                </th>
              </tr>
            </thead>
            <tbody>
              {page.map(({ e, who, ws }) => (
                <tr
                  key={e.id}
                  className="border-b border-[var(--border)] last:border-0"
                  data-testid="audit-row"
                  data-action={e.action}
                >
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums">{stamp(e.createdAt)}</td>
                  <td className="px-3 py-2">{who ?? "System"}</td>
                  <th scope="row" className="px-3 py-2 font-medium">
                    {AUDIT_LABEL[e.action] ?? e.action}
                  </th>
                  <td className="px-3 py-2 text-[var(--text-muted)]">
                    {auditDetail(e.action, e.meta as Record<string, unknown>, e.targetId)}
                  </td>
                  <td className="px-3 py-2 text-[var(--text-muted)]">{ws ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {next && (
        <p className="mt-4">
          <Link
            href={`/settings/audit?${cat !== "all" ? `cat=${cat}&` : ""}before=${next}`}
            className="underline"
            data-testid="audit-older"
          >
            Older entries
          </Link>
        </p>
      )}
    </div>
  );
}
