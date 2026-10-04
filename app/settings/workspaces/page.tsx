import { WorkspacesPanel } from "@/components/team/WorkspacesPanel";
import { requireUser } from "@/lib/auth/session";
import { accountOf } from "@/lib/billing/context";
import { can as planCan, limits, type PlanTier } from "@/lib/entitlements/plans";
import { can, type Role } from "@/lib/permissions";
import { myWorkspacesAll } from "@/lib/team/scope";
import { activeWorkspaceCount } from "@/lib/team/workspaces";

export const metadata = { title: "Workspaces · Ripplewise" };
export const dynamic = "force-dynamic";

export default async function WorkspacesPage() {
  const user = await requireUser();
  const all = await myWorkspacesAll(user.id);
  const active = all.filter((w) => !w.archivedAt);
  const home = active.find((w) => can(w.role, "workspace.manage")) ?? active[0];
  if (!home) return <p>You don&apos;t have an active workspace.</p>;
  const acct = await accountOf(home.accountId);
  const usedNow = await activeWorkspaceCount(home.accountId);
  const gate = planCan(acct.planTier as PlanTier, "create_workspace", {
    activeQueries: 0,
    seats: 0,
    workspaces: usedNow,
    alerts: 0,
  });
  return (
    <div className="max-w-3xl">
      <h1 className="text-[30px] font-semibold leading-[38px]">Workspaces</h1>
      <p className="mt-1 text-[var(--text-muted)]">
        One per brand or client, each with its own queries, dashboards and people.
      </p>
      <div className="mt-6">
        <WorkspacesPanel
          from={home.slug}
          workspaces={all.map((w) => ({
            id: w.id,
            slug: w.slug,
            name: w.name,
            role: w.role as Role,
            type: "",
            archived: !!w.archivedAt,
            canManage: can(w.role, "workspace.manage"),
          }))}
          used={usedNow}
          upgradeTo={gate.ok ? null : gate.upgradeTo}
          limit={limits(acct.planTier as PlanTier).workspaces}
          canCreate={can(home.role, "workspace.manage")}
        />
      </div>
    </div>
  );
}
