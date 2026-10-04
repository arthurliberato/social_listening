"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { authorWatchlist, db } from "@/db/client";
import { requireWorkspace } from "@/lib/auth/session";
import { canEdit } from "@/lib/queries";

export async function setWatched(
  slug: string,
  authorId: number,
  watch: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { user, ws } = await requireWorkspace(slug);
  if (!canEdit(ws.role))
    return { ok: false, error: "Your role can view authors but not change the watchlist." };
  if (!Number.isInteger(authorId)) return { ok: false, error: "Unknown author." };
  if (watch)
    await db
      .insert(authorWatchlist)
      .values({ workspaceId: ws.id, authorId, addedBy: user.id })
      .onConflictDoNothing();
  else
    await db
      .delete(authorWatchlist)
      .where(and(eq(authorWatchlist.workspaceId, ws.id), eq(authorWatchlist.authorId, authorId)));
  revalidatePath(`/w/${slug}/authors`);
  return { ok: true };
}
