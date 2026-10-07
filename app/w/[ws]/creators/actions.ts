"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { creatorListItems, creatorLists, creators, db, workspaces } from "@/db/client";
import { trackServer } from "@/lib/analytics/server";
import { auditIn } from "@/lib/audit";
import { requireWorkspace } from "@/lib/auth/session";
import { accountListCount, getList } from "@/lib/creators/service";
import { PLANS, canCreateCreatorList, type PlanTier } from "@/lib/entitlements/plans";
import { accountPlan, canEdit } from "@/lib/queries";

export type ActionResult<T = object> =
  ({ ok: true } & T) | { ok: false; error: string; upgradeTo?: PlanTier; upgradeLabel?: string };

const NoEdit = {
  ok: false as const,
  error: "Your role can look at creators but not change lists. Ask an editor or admin.",
};

const ListName = z
  .string()
  .trim()
  .min(1, "Give the list a name.")
  .max(80, "Keep the name under 80 characters.");

async function accountWorkspaceIds(accountId: string) {
  return (
    await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.accountId, accountId))
  ).map((w) => w.id);
}

/** Creates a list, checking the plan's list limit on the server (the UI mirrors it with a paywall). */
async function createListFor(
  slug: string,
  name: string,
  source: "lists_page" | "add_menu",
): Promise<ActionResult<{ id: string }>> {
  const { user, ws } = await requireWorkspace(slug);
  if (!canEdit(ws.role)) return NoEdit;
  const parsed = ListName.safeParse(name);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]!.message };
  const { accountId, tier } = await accountPlan(ws.id);
  const gate = canCreateCreatorList(
    tier,
    await accountListCount(await accountWorkspaceIds(accountId)),
  );
  if (!gate.ok) {
    await trackServer(
      "Paywall Viewed",
      { userId: user.id, workspaceId: ws.id },
      { paywall_trigger: "creator_list_limit", required_plan: gate.upgradeTo },
    );
    return {
      ok: false,
      error: gate.reason,
      upgradeTo: gate.upgradeTo,
      upgradeLabel: PLANS[gate.upgradeTo].label,
    };
  }
  const [row] = await db
    .insert(creatorLists)
    .values({ workspaceId: ws.id, name: parsed.data, createdBy: user.id })
    .returning({ id: creatorLists.id });
  const id = row!.id;
  await trackServer(
    "Creator List Created",
    { userId: user.id, workspaceId: ws.id },
    { list_id: id, source },
  );
  await auditIn(
    ws,
    user.id,
    "creator_list.created",
    { type: "creator_list", id },
    { name: parsed.data },
  );
  revalidatePath(`/w/${slug}/creators/lists`);
  return { ok: true, id };
}

export async function createList(slug: string, name: string) {
  return createListFor(slug, name, "lists_page");
}

const AddInput = z.object({
  listId: z.string().uuid().nullable(),
  newListName: z.string().optional(),
  creatorIds: z.array(z.number().int().positive()).min(1).max(100),
  source: z.enum(["discovery", "profile"]),
});

/** Adds creators to an existing list, or to a new one created in the same step. */
export async function addToList(
  slug: string,
  input: z.input<typeof AddInput>,
): Promise<ActionResult<{ listId: string; added: number; listName: string }>> {
  const { user, ws } = await requireWorkspace(slug);
  if (!canEdit(ws.role)) return NoEdit;
  const v = AddInput.safeParse(input);
  if (!v.success) return { ok: false, error: "Pick a list and at least one creator." };
  let listId = v.data.listId;
  if (!listId) {
    const made = await createListFor(slug, v.data.newListName ?? "", "add_menu");
    if (!made.ok) return made;
    listId = made.id;
  }
  const [list] = await db
    .select()
    .from(creatorLists)
    .where(and(eq(creatorLists.id, listId), eq(creatorLists.workspaceId, ws.id)));
  if (!list) return { ok: false, error: "That list no longer exists." };

  // Only real creators; ignore ids that aren't in the directory.
  const real = (
    await db
      .select({ id: creators.id })
      .from(creators)
      .where(inArray(creators.id, v.data.creatorIds))
  ).map((r) => r.id);
  const inserted = real.length
    ? await db
        .insert(creatorListItems)
        .values(real.map((creatorId) => ({ listId: list.id, creatorId, addedBy: user.id })))
        .onConflictDoNothing()
        .returning({ creatorId: creatorListItems.creatorId })
    : [];
  for (const r of inserted)
    await trackServer(
      "Creator Added To List",
      { userId: user.id, workspaceId: ws.id },
      { list_id: list.id, creator_id: r.creatorId, source: v.data.source },
    );
  revalidatePath(`/w/${slug}/creators`);
  revalidatePath(`/w/${slug}/creators/lists`);
  return { ok: true, listId: list.id, added: inserted.length, listName: list.name };
}

export async function removeFromList(
  slug: string,
  listId: string,
  creatorId: number,
  source: "list" | "discovery" | "profile" = "list",
): Promise<ActionResult> {
  const { user, ws } = await requireWorkspace(slug);
  if (!canEdit(ws.role)) return NoEdit;
  if (!(await getList(ws.id, listId))) return { ok: false, error: "That list no longer exists." };
  const gone = await db
    .delete(creatorListItems)
    .where(and(eq(creatorListItems.listId, listId), eq(creatorListItems.creatorId, creatorId)))
    .returning({ id: creatorListItems.creatorId });
  if (gone.length)
    await trackServer(
      "Creator Removed From List",
      { userId: user.id, workspaceId: ws.id },
      { list_id: listId, creator_id: creatorId, source },
    );
  revalidatePath(`/w/${slug}/creators`);
  revalidatePath(`/w/${slug}/creators/lists/${listId}`);
  return { ok: true };
}

export async function deleteList(slug: string, listId: string): Promise<ActionResult> {
  const { user, ws } = await requireWorkspace(slug);
  if (!canEdit(ws.role)) return NoEdit;
  const list = await getList(ws.id, listId);
  if (!list) return { ok: false, error: "That list no longer exists." };
  await db
    .delete(creatorLists)
    .where(and(eq(creatorLists.id, listId), eq(creatorLists.workspaceId, ws.id)));
  await auditIn(
    ws,
    user.id,
    "creator_list.deleted",
    { type: "creator_list", id: listId },
    { name: list.list.name },
  );
  revalidatePath(`/w/${slug}/creators/lists`);
  return { ok: true };
}
