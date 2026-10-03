import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db, memberships, users, workspaces } from "@/db/client";

export async function requireUser() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const user = (await db.select().from(users).where(eq(users.id, session.user.id)).limit(1))[0];
  if (!user) redirect("/login");
  return user;
}

/** The user's workspaces, oldest first. */
export async function userWorkspaces(userId: string) {
  return db
    .select({
      id: workspaces.id,
      slug: workspaces.slug,
      name: workspaces.name,
      accountId: workspaces.accountId,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(workspaces, eq(memberships.workspaceId, workspaces.id))
    .where(eq(memberships.userId, userId))
    .orderBy(workspaces.createdAt);
}

/** Resolve a /w/:slug route to a workspace the signed-in user belongs to, or redirect. */
export async function requireWorkspace(slug: string) {
  const user = await requireUser();
  const ws = (await userWorkspaces(user.id)).find((w) => w.slug === slug);
  if (!ws) redirect("/403");
  return { user, ws };
}
