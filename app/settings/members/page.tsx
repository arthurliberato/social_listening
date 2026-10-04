import { MembersPanel } from "@/components/team/MembersPanel";
import { WorkspacePicker } from "@/components/team/WorkspacePicker";
import { requireUser } from "@/lib/auth/session";
import { limits, type PlanTier } from "@/lib/entitlements/plans";
import { accountOf } from "@/lib/billing/context";
import { ROLE_LABEL, type Role } from "@/lib/permissions";
import { listInvites, listMembers } from "@/lib/team/members";
import { pickWorkspace } from "@/lib/team/scope";
import { seatUsage } from "@/lib/team/seats";

export const metadata = { title: "Members · Ripplewise" };
export const dynamic = "force-dynamic";

const day = (d: Date) => d.toISOString().slice(0, 10);

export default async function MembersPage({
  searchParams,
}: {
  searchParams: Promise<{ ws?: string }>;
}) {
  const sp = await searchParams;
  const user = await requireUser();
  const { selected, active, allowed } = await pickWorkspace(user.id, sp.ws, "members.view");
  const h1 = <h1 className="text-[30px] font-semibold leading-[38px]">Members</h1>;
  if (!selected)
    return (
      <div>
        {h1}
        <p className="mt-3 text-[var(--text-muted)]">You don&apos;t have an active workspace.</p>
      </div>
    );
  if (!allowed)
    return (
      <div data-testid="members-forbidden">
        {h1}
        <p className="mt-3 text-[var(--text-muted)]">
          You&apos;re {ROLE_LABEL[selected.role as Role] === "Editor" ? "an" : "a"}{" "}
          {ROLE_LABEL[selected.role as Role]?.toLowerCase()} in {selected.name}. Only owners and
          admins can manage people. Ask one of them if you need someone added or a role changed.
        </p>
      </div>
    );
  const acct = await accountOf(selected.accountId);
  const [members, invites, seats] = await Promise.all([
    listMembers(selected.id),
    listInvites(selected.id),
    seatUsage(selected.accountId),
  ]);
  return (
    <div className="max-w-4xl">
      {h1}
      <p className="mt-1 text-[var(--text-muted)]">
        Who can see and change <strong>{selected.name}</strong>.
      </p>
      <WorkspacePicker base="/settings/members" active={active} current={selected.slug} />
      <div className="mt-6">
        <MembersPanel
          ws={selected.slug}
          myId={user.id}
          myRole={selected.role as Role}
          members={members.map((m) => ({
            userId: m.userId,
            name: m.name,
            email: m.email,
            role: m.role,
            joined: day(m.joinedAt),
          }))}
          invites={invites.map((i) => ({
            id: i.id,
            email: i.email,
            role: i.role as Role,
            expires: day(i.expiresAt),
          }))}
          seats={{
            used: seats.used,
            limit: limits(acct.planTier as PlanTier).seats,
            clientViewers: seats.clientViewers,
          }}
        />
      </div>
    </div>
  );
}
