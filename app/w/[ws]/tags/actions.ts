"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { categories, db } from "@/db/client";
import { trackServer } from "@/lib/analytics/server";
import { auditIn } from "@/lib/audit";
import { requireWorkspace } from "@/lib/auth/session";
import { categoryCount, categoryOwnedBy, countFor, MAX_CATEGORIES } from "@/lib/categories/service";
import { accountPlan, canEdit } from "@/lib/queries";
import { analyze } from "@/lib/query/lint";
import { eq } from "drizzle-orm";

type Fail = { ok: false; error: string; field?: "name" | "booleanText" };

const Input = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Give the category a name")
    .max(60, "Keep the name under 60 characters"),
  booleanText: z.string().trim().min(1, "Enter at least one search term").max(1000),
});

/** Check a category's Boolean text and say how many mentions it matches, before saving. */
export async function previewCategory(
  slug: string,
  booleanText: string,
): Promise<{ ok: true; total: number; negative: number } | Fail> {
  const { ws } = await requireWorkspace(slug);
  const { plan } = await accountPlan(ws.id);
  const a = analyze(booleanText);
  if (!a.ok)
    return {
      ok: false,
      field: "booleanText",
      error: a.issues.find((i) => i.severity === "error")?.message ?? "That search isn't valid.",
    };
  const n = await countFor({ workspaceId: ws.id, booleanText, historyDays: plan.historyDays });
  if ("error" in n) return { ok: false, field: "booleanText", error: n.error };
  return { ok: true, total: n.total, negative: n.negative };
}

export async function createCategory(
  slug: string,
  input: unknown,
): Promise<{ ok: true; id: string } | Fail> {
  const { user, ws } = await requireWorkspace(slug);
  if (!canEdit(ws.role))
    return { ok: false, error: "Your role can view categories but not change them." };
  const p = Input.safeParse(input);
  if (!p.success) {
    const i = p.error.issues[0]!;
    return { ok: false, error: i.message, field: i.path[0] === "name" ? "name" : "booleanText" };
  }
  const a = analyze(p.data.booleanText);
  if (!a.ok)
    return {
      ok: false,
      field: "booleanText",
      error: a.issues.find((i) => i.severity === "error")?.message ?? "That search isn't valid.",
    };
  if ((await categoryCount(ws.id)) >= MAX_CATEGORIES)
    return {
      ok: false,
      error: `A workspace can hold ${MAX_CATEGORIES} categories. Delete one to add another.`,
    };
  const [row] = await db
    .insert(categories)
    .values({
      workspaceId: ws.id,
      name: p.data.name,
      booleanText: p.data.booleanText,
      createdBy: user.id,
    })
    .onConflictDoNothing()
    .returning({ id: categories.id });
  if (!row) return { ok: false, field: "name", error: "A category with that name already exists." };
  await auditIn(
    ws,
    user.id,
    "category.created",
    { type: "category", id: row.id },
    { name: p.data.name },
  );
  await trackServer(
    "Category Created",
    { userId: user.id, workspaceId: ws.id },
    {
      term_count: p.data.booleanText.split(/\s+/).length,
    },
  );
  revalidatePath(`/w/${slug}/tags`);
  return { ok: true, id: row.id };
}

export async function deleteCategory(slug: string, id: string): Promise<{ ok: true } | Fail> {
  const { user, ws } = await requireWorkspace(slug);
  if (!canEdit(ws.role)) return { ok: false, error: "Your role can't delete categories." };
  const c = await categoryOwnedBy(ws.id, id);
  if (!c) return { ok: false, error: "That category no longer exists." };
  await db.delete(categories).where(eq(categories.id, id));
  await auditIn(ws, user.id, "category.deleted", { type: "category", id }, { name: c.name });
  await trackServer("Category Deleted", { userId: user.id, workspaceId: ws.id }, {});
  revalidatePath(`/w/${slug}/tags`);
  return { ok: true };
}
