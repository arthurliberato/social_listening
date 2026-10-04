"use server";

import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { accounts, db } from "@/db/client";
import { requireWorkspace } from "@/lib/auth/session";
import { simNow } from "@/lib/simclock";

/** "Not now": hides the sales card. It comes back only if sales is flagged again after this. */
export async function dismissSalesCard(slug: string) {
  const { ws } = await requireWorkspace(slug);
  if (ws.realRole !== "owner" && ws.realRole !== "admin") return;
  await db
    .update(accounts)
    .set({
      lifecycle: sql`lifecycle || ${JSON.stringify({ pqaCardDismissedAt: simNow().toISOString() })}::jsonb`,
    })
    .where(eq(accounts.id, ws.accountId));
  revalidatePath(`/w/${slug}/home`);
}
