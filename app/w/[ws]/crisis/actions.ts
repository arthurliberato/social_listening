"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { crises, crisisTasks, crisisUpdates, db, memberships, queries, users } from "@/db/client";
import { requireWorkspace } from "@/lib/auth/session";
import { PLANS, planUnlocking, type PlanTier } from "@/lib/entitlements/plans";
import { sendEmail } from "@/lib/email/service";
import { accountPlan, canEdit } from "@/lib/queries";
import { simNow } from "@/lib/simclock";

type Fail = { ok: false; error: string; upgradeTo?: PlanTier };

/** Loads a crisis the caller may change: right workspace, editor role, plan includes Crisis Rooms. */
async function editableCrisis(slug: string, id: string) {
  const { user, ws } = await requireWorkspace(slug);
  if (!canEdit(ws.role))
    return {
      fail: { ok: false, error: "Your role can view crisis rooms but not change them." } as Fail,
    };
  const { tier } = await accountPlan(ws.id);
  if (!PLANS[tier].features.crisisRoom)
    return {
      fail: {
        ok: false,
        error: "Crisis Rooms aren't included in your plan.",
        upgradeTo: planUnlocking("crisisRoom"),
      } as Fail,
    };
  const [c] = await db
    .select()
    .from(crises)
    .where(and(eq(crises.id, id), eq(crises.workspaceId, ws.id)));
  if (!c) return { fail: { ok: false, error: "That crisis room no longer exists." } as Fail };
  return { user, ws, c };
}

/** Start a room straight from a query (no alert needed): it covers the last day of data. */
export async function openCrisis(
  slug: string,
  queryId: string,
): Promise<{ ok: true; id: string } | Fail> {
  const { user, ws } = await requireWorkspace(slug);
  if (!canEdit(ws.role)) return { ok: false, error: "Your role can't open crisis rooms." };
  const { tier } = await accountPlan(ws.id);
  if (!PLANS[tier].features.crisisRoom)
    return {
      ok: false,
      error: `Crisis Rooms are on the ${PLANS[planUnlocking("crisisRoom")].label} plan and above.`,
      upgradeTo: planUnlocking("crisisRoom"),
    };
  const [q] = await db
    .select()
    .from(queries)
    .where(and(eq(queries.id, queryId), eq(queries.workspaceId, ws.id)));
  if (!q) return { ok: false, error: "Choose a query to monitor." };
  const end = q.releasedThrough ?? simNow();
  const [row] = await db
    .insert(crises)
    .values({
      workspaceId: ws.id,
      queryId,
      title: `${q.name}: situation room`,
      windowStart: new Date(end.getTime() - 24 * 3_600_000),
      openedBy: user.id,
    })
    .returning({ id: crises.id });
  revalidatePath(`/w/${slug}/crisis`);
  return { ok: true, id: row!.id };
}

export async function addTask(
  slug: string,
  crisisId: string,
  title: string,
  assigneeId: string | null,
): Promise<{ ok: true; id: string } | Fail> {
  const r = await editableCrisis(slug, crisisId);
  if (r.fail) return r.fail;
  const t = z.string().trim().min(1, "Describe the task").max(200).safeParse(title);
  if (!t.success) return { ok: false, error: t.error.issues[0]!.message };
  if (assigneeId) {
    const [m] = await db
      .select({ u: memberships.userId })
      .from(memberships)
      .where(and(eq(memberships.workspaceId, r.ws.id), eq(memberships.userId, assigneeId)));
    if (!m) return { ok: false, error: "That person isn't in this workspace." };
  }
  const [row] = await db
    .insert(crisisTasks)
    .values({ crisisId, title: t.data, assigneeId, createdBy: r.user.id })
    .returning({ id: crisisTasks.id });
  revalidatePath(`/w/${slug}/crisis/${crisisId}`);
  return { ok: true, id: row!.id };
}

export async function toggleTask(
  slug: string,
  crisisId: string,
  taskId: string,
  done: boolean,
): Promise<{ ok: true } | Fail> {
  const r = await editableCrisis(slug, crisisId);
  if (r.fail) return r.fail;
  await db
    .update(crisisTasks)
    .set({ doneAt: done ? new Date() : null })
    .where(and(eq(crisisTasks.id, taskId), eq(crisisTasks.crisisId, crisisId)));
  revalidatePath(`/w/${slug}/crisis/${crisisId}`);
  return { ok: true };
}

const UpdateInput = z.object({
  subject: z.string().trim().min(1, "Add a subject").max(150),
  body: z.string().trim().min(1, "Write the update").max(5000),
  recipientIds: z.array(z.string().uuid()).min(1, "Choose at least one recipient").max(100),
});

/** Email a stakeholder update to workspace members; each lands in their /inbox. */
export async function sendUpdate(
  slug: string,
  crisisId: string,
  input: unknown,
): Promise<{ ok: true; sent: number } | Fail> {
  const r = await editableCrisis(slug, crisisId);
  if (r.fail) return r.fail;
  const p = UpdateInput.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]!.message };
  const rows = await db
    .select({ id: users.id, email: users.email })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(eq(memberships.workspaceId, r.ws.id), inArray(memberships.userId, p.data.recipientIds)),
    );
  if (!rows.length) return { ok: false, error: "None of those people are in this workspace." };
  for (const u of rows)
    await sendEmail({
      toUserId: u.id,
      to: u.email,
      type: "alert",
      subject: p.data.subject,
      text: `${p.data.body}\n\n— Sent from the "${r.c.title}" crisis room on Ripplewise`,
    });
  await db.insert(crisisUpdates).values({
    crisisId,
    subject: p.data.subject,
    body: p.data.body,
    recipientsCount: rows.length,
    sentBy: r.user.id,
  });
  revalidatePath(`/w/${slug}/crisis/${crisisId}`);
  return { ok: true, sent: rows.length };
}

export async function setResolved(
  slug: string,
  crisisId: string,
  resolved: boolean,
): Promise<{ ok: true; durationMs: number } | Fail> {
  const r = await editableCrisis(slug, crisisId);
  if (r.fail) return r.fail;
  const now = new Date();
  await db
    .update(crises)
    .set(
      resolved
        ? { status: "resolved", resolvedAt: now, resolvedBy: r.user.id }
        : { status: "open", resolvedAt: null, resolvedBy: null },
    )
    .where(eq(crises.id, crisisId));
  revalidatePath(`/w/${slug}/crisis/${crisisId}`);
  revalidatePath(`/w/${slug}/crisis`);
  return { ok: true, durationMs: now.getTime() - r.c.openedAt.getTime() };
}
