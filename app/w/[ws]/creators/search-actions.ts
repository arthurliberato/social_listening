"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { creatorSavedSearches, db, workspaces } from "@/db/client";
import { trackServer } from "@/lib/analytics/server";
import { auditIn } from "@/lib/audit";
import { requireWorkspace } from "@/lib/auth/session";
import {
  accountSavedCount,
  canonicalSearch,
  checkSearchName,
  findSavedSearch,
} from "@/lib/creators/saved-searches";
import { PLANS, canSaveSearch, type PlanTier } from "@/lib/entitlements/plans";
import { accountPlan, canEdit } from "@/lib/queries";

export type SaveResult =
  | { ok: true; id: string }
  | { ok: false; error: string; upgradeTo?: PlanTier; upgradeLabel?: string };

/** Save the filters of the current discovery page under a name. The plan caps how many an account keeps. */
export async function saveSearchAction(
  slug: string,
  name: string,
  params: Record<string, string>,
): Promise<SaveResult> {
  const { user, ws } = await requireWorkspace(slug);
  if (!canEdit(ws.role))
    return {
      ok: false,
      error: "Your role can browse creators but not save searches. Ask an editor or admin.",
    };
  const n = checkSearchName(String(name ?? ""));
  if (!n.ok) return { ok: false, error: n.reason };
  const { query, filterCount } = canonicalSearch(params ?? {});
  if (filterCount === 0)
    return {
      ok: false,
      error: "Set at least one filter first. A search with no filters is just the whole directory.",
    };

  const { accountId, tier } = await accountPlan(ws.id);
  const wsIds = (
    await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.accountId, accountId))
  ).map((w) => w.id);
  const gate = canSaveSearch(tier, await accountSavedCount(wsIds));
  if (!gate.ok) {
    await trackServer(
      "Paywall Viewed",
      { userId: user.id, workspaceId: ws.id },
      { paywall_trigger: "saved_search_limit", required_plan: gate.upgradeTo },
    );
    return {
      ok: false,
      error: gate.reason,
      upgradeTo: gate.upgradeTo,
      upgradeLabel: PLANS[gate.upgradeTo].label,
    };
  }

  const inserted = await db
    .insert(creatorSavedSearches)
    .values({ workspaceId: ws.id, name: n.name, query, createdBy: user.id })
    .onConflictDoNothing()
    .returning({ id: creatorSavedSearches.id });
  if (!inserted.length)
    return {
      ok: false,
      error: `You already have a saved search called “${n.name}”. Pick another name.`,
    };
  const id = inserted[0]!.id;
  await trackServer(
    "Creator Search Saved",
    { userId: user.id, workspaceId: ws.id },
    { saved_search_id: id, filter_count: filterCount },
  );
  await auditIn(
    ws,
    user.id,
    "creator_search.saved",
    { type: "creator_search", id },
    { name: n.name },
  );
  revalidatePath(`/w/${slug}/creators`);
  return { ok: true, id };
}

export async function deleteSavedSearchAction(
  slug: string,
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { user, ws } = await requireWorkspace(slug);
  if (!canEdit(ws.role))
    return { ok: false, error: "Your role can browse creators but not change saved searches." };
  const found = await findSavedSearch(ws.id, id);
  if (!found) return { ok: false, error: "That saved search no longer exists." };
  await db
    .delete(creatorSavedSearches)
    .where(and(eq(creatorSavedSearches.id, id), eq(creatorSavedSearches.workspaceId, ws.id)));
  await trackServer(
    "Saved Search Deleted",
    { userId: user.id, workspaceId: ws.id },
    { saved_search_id: id },
  );
  await auditIn(
    ws,
    user.id,
    "creator_search.deleted",
    { type: "creator_search", id },
    { name: found.name },
  );
  revalidatePath(`/w/${slug}/creators`);
  return { ok: true };
}
