"use server";

import { requireWorkspace } from "@/lib/auth/session";
import { db, users } from "@/db/client";
import { eq } from "drizzle-orm";
import { submitSupport } from "@/lib/help/service";

/** Any member, including client viewers, can ask for help. */
export async function sendSupport(slug: string, input: unknown) {
  const { user, ws } = await requireWorkspace(slug);
  const [u] = await db.select({ email: users.email }).from(users).where(eq(users.id, user.id));
  return submitSupport(input, {
    userId: user.id,
    email: u!.email,
    accountId: ws.accountId,
    workspaceId: ws.id,
  });
}
