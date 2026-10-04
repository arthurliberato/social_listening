"use server";

import { auth } from "@/auth";
import { eq } from "drizzle-orm";
import { db, memberships } from "@/db/client";
import { submitRequest } from "@/lib/sales/service";

/** Anyone can ask. If they're signed in the request is tied to their account, so sales sees the usage. */
export async function submitSalesRequest(input: unknown) {
  const session = await auth();
  const userId = session?.user?.id ?? null;
  let accountId: string | null = null;
  let workspaceId: string | null = null;
  if (userId) {
    const [m] = await db.select().from(memberships).where(eq(memberships.userId, userId)).limit(1);
    accountId = m?.accountId ?? null;
    workspaceId = m?.workspaceId ?? null;
  }
  return submitRequest(input, { userId, accountId, workspaceId });
}
