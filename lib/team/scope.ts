// Which workspace a settings page is acting on, and what the signed-in person may do there.
import { and, asc, eq } from "drizzle-orm";
import { db, memberships, workspaces } from "@/db/client";
import { can, type Capability } from "@/lib/permissions";
import type { Actor } from "./invites";

export interface MyWorkspace {
  id: string;
  slug: string;
  name: string;
  role: string;
  accountId: string;
  archivedAt: Date | null;
  type: string;
}

/** Every workspace the person belongs to, archived ones included (so they can be restored). */
export async function myWorkspacesAll(userId: string): Promise<MyWorkspace[]> {
  return db
    .select({
      id: workspaces.id,
      slug: workspaces.slug,
      name: workspaces.name,
      role: memberships.role,
      accountId: workspaces.accountId,
      archivedAt: workspaces.archivedAt,
      type: workspaces.workspaceType,
    })
    .from(memberships)
    .innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId))
    .where(eq(memberships.userId, userId))
    .orderBy(asc(workspaces.createdAt));
}

/**
 * The workspace a settings page should act on: the one in `?ws=` if the person belongs to it, else the
 * first active one where they hold a role with `cap`, else the first active one.
 */
export async function pickWorkspace(userId: string, slug: string | undefined, cap: Capability) {
  const all = await myWorkspacesAll(userId);
  const active = all.filter((w) => !w.archivedAt);
  const selected =
    active.find((w) => w.slug === slug) ??
    active.find((w) => can(w.role, cap)) ??
    active[0] ??
    null;
  return { all, active, selected, allowed: !!selected && can(selected.role, cap) };
}

/** The acting person in a given workspace, from the database, never from the request. */
export async function actorIn(
  userId: string,
  userName: string,
  slug: string,
): Promise<{ actor: Actor; ws: MyWorkspace } | null> {
  const ws = (await myWorkspacesAll(userId)).find((w) => w.slug === slug);
  return ws ? { actor: { id: userId, name: userName, role: ws.role }, ws } : null;
}

export const isMember = async (userId: string, workspaceId: string) =>
  !!(
    await db
      .select({ u: memberships.userId })
      .from(memberships)
      .where(and(eq(memberships.userId, userId), eq(memberships.workspaceId, workspaceId)))
  )[0];
