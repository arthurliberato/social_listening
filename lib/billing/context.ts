// Which account the Billing and Usage pages act on, and whether this person may manage it.
import { asc, eq } from "drizzle-orm";
import { accounts, db, memberships, workspaces } from "@/db/client";

export interface BillingScope {
  accountId: string;
  role: string;
  canManage: boolean;
  workspaceSlug: string;
  workspaceName: string;
}

/** Owners and admins manage billing. Anyone else in the account gets a read-only explanation. */
export async function billingScope(userId: string): Promise<BillingScope | null> {
  const rows = await db
    .select({
      accountId: memberships.accountId,
      role: memberships.role,
      slug: workspaces.slug,
      name: workspaces.name,
    })
    .from(memberships)
    .innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId))
    .where(eq(memberships.userId, userId))
    .orderBy(asc(workspaces.createdAt));
  if (!rows.length) return null;
  const pick = rows.find((r) => r.role === "owner" || r.role === "admin") ?? rows[0]!;
  return {
    accountId: pick.accountId,
    role: pick.role,
    canManage: pick.role === "owner" || pick.role === "admin",
    workspaceSlug: pick.slug,
    workspaceName: pick.name,
  };
}

export async function accountOf(accountId: string) {
  const [a] = await db.select().from(accounts).where(eq(accounts.id, accountId));
  return a!;
}
