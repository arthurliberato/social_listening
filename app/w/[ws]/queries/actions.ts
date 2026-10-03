"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db, queries } from "@/db/client";
import { trackServer } from "@/lib/analytics/server";
import { requireWorkspace } from "@/lib/auth/session";
import { can, PLANS, type PlanTier } from "@/lib/entitlements/plans";
import { enqueueBackfill } from "@/lib/jobs/boss";
import {
  accountPlan,
  activeQueryCount,
  canEdit,
  COUNTRIES,
  LANGUAGES,
  SOURCE_TYPES,
} from "@/lib/queries";
import { stats } from "@/lib/query/ast";
import { analyze } from "@/lib/query/lint";
import { previewQuery, type Preview } from "@/lib/query/preview";

const Filters = z.object({
  sources: z.array(z.enum(SOURCE_TYPES)).default([]),
  languages: z.array(z.enum(LANGUAGES)).default([]),
  countries: z.array(z.enum(COUNTRIES)).default([]),
});

export async function previewAction(
  slug: string,
  booleanText: string,
  filters: unknown,
): Promise<Preview> {
  const { ws } = await requireWorkspace(slug);
  const f = Filters.safeParse(filters);
  const { tier } = await accountPlan(ws.id);
  return previewQuery({
    booleanText: booleanText.slice(0, 4000),
    filters: f.success ? f.data : {},
    planTier: tier,
  });
}

const SaveInput = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, "Give the query a name").max(100),
  booleanText: z.string().max(4000),
  builderMode: z.enum(["guided", "advanced"]),
  filters: Filters,
  isFromTemplate: z.boolean().default(false),
  noiseScore: z.number().min(0).max(1).optional(),
  previewCount: z.number().int().min(0).optional(),
});

export type SaveResult =
  | { ok: true; id: string }
  | { ok: false; error: string; upgradeTo?: PlanTier; upgradeLabel?: string };

export async function saveQuery(slug: string, input: unknown): Promise<SaveResult> {
  const { user, ws } = await requireWorkspace(slug);
  if (!canEdit(ws.role))
    return {
      ok: false,
      error: "Your role can view queries but not change them. Ask an admin for editor access.",
    };
  const parsed = SaveInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]!.message };
  const v = parsed.data;
  const analysis = analyze(v.booleanText);
  if (!analysis.ok || !analysis.ast)
    return {
      ok: false,
      error:
        analysis.issues.find((i) => i.severity === "error")?.message ??
        "Fix the query errors before saving.",
    };

  const { accountId, tier } = await accountPlan(ws.id);
  const existing = v.id
    ? (
        await db
          .select()
          .from(queries)
          .where(and(eq(queries.id, v.id), eq(queries.workspaceId, ws.id)))
      )[0]
    : undefined;
  if (v.id && !existing) return { ok: false, error: "That query no longer exists." };

  // A new query, or one being made live again, needs a free slot on the plan.
  if (!existing || existing.status !== "live") {
    const gate = can(tier, "create_query", {
      activeQueries: await activeQueryCount(accountId),
      seats: 0,
      workspaces: 0,
      alerts: 0,
    });
    if (!gate.ok) {
      await trackServer(
        "Paywall Viewed",
        { userId: user.id, workspaceId: ws.id },
        { paywall_trigger: "query_limit", required_plan: gate.upgradeTo },
      );
      return {
        ok: false,
        error: gate.reason,
        upgradeTo: gate.upgradeTo,
        upgradeLabel: PLANS[gate.upgradeTo].label,
      };
    }
  }

  const s = stats(analysis.ast);
  const values = {
    name: v.name,
    booleanText: v.booleanText.trim(),
    astJson: analysis.ast,
    builderMode: v.builderMode,
    sources: v.filters.sources,
    languages: v.filters.languages,
    countries: v.filters.countries,
    status: "live",
    updatedAt: new Date(),
  };
  const changed =
    !existing ||
    existing.status !== "live" ||
    existing.booleanText !== values.booleanText ||
    JSON.stringify([existing.sources, existing.languages, existing.countries]) !==
      JSON.stringify([values.sources, values.languages, values.countries]);

  let id: string;
  if (existing) {
    await db
      .update(queries)
      .set({ ...values, ...(changed ? { backfillStatus: "pending" } : {}) })
      .where(eq(queries.id, existing.id));
    id = existing.id;
    await trackServer(
      "Query Edited",
      { userId: user.id, workspaceId: ws.id },
      { query_id: id, builder_mode: v.builderMode },
    );
  } else {
    const [row] = await db
      .insert(queries)
      .values({
        ...values,
        workspaceId: ws.id,
        isFromTemplate: v.isFromTemplate,
        createdBy: user.id,
      })
      .returning({ id: queries.id });
    id = row!.id;
  }
  await trackServer(
    "Query Saved",
    { userId: user.id, workspaceId: ws.id },
    {
      query_id: id,
      builder_mode: v.builderMode,
      operator_count: s.operators,
      has_near: s.hasNear,
      exclusion_count: s.exclusions,
      noise_score: v.noiseScore,
      languages: v.filters.languages,
      sources: v.filters.sources,
      is_from_template: v.isFromTemplate,
    },
  );
  if (changed) await enqueueBackfill(id);
  revalidatePath(`/w/${slug}/queries`);
  return { ok: true, id };
}

export async function setQueryStatus(
  slug: string,
  id: string,
  status: "paused" | "live",
): Promise<SaveResult> {
  const { user, ws } = await requireWorkspace(slug);
  if (!canEdit(ws.role)) return { ok: false, error: "Your role can't change queries." };
  const q = (
    await db
      .select()
      .from(queries)
      .where(and(eq(queries.id, id), eq(queries.workspaceId, ws.id)))
  )[0];
  if (!q) return { ok: false, error: "That query no longer exists." };
  if (status === "live" && q.status !== "live") {
    const { accountId, tier } = await accountPlan(ws.id);
    const gate = can(tier, "create_query", {
      activeQueries: await activeQueryCount(accountId),
      seats: 0,
      workspaces: 0,
      alerts: 0,
    });
    if (!gate.ok) {
      await trackServer(
        "Paywall Viewed",
        { userId: user.id, workspaceId: ws.id },
        { paywall_trigger: "query_limit", required_plan: gate.upgradeTo },
      );
      return {
        ok: false,
        error: gate.reason,
        upgradeTo: gate.upgradeTo,
        upgradeLabel: PLANS[gate.upgradeTo].label,
      };
    }
  }
  await db
    .update(queries)
    .set({
      status,
      updatedAt: new Date(),
      ...(status === "live" ? { backfillStatus: "pending" } : {}),
    })
    .where(eq(queries.id, id));
  if (status === "paused")
    await trackServer("Query Paused", { userId: user.id, workspaceId: ws.id }, { query_id: id });
  else await enqueueBackfill(id);
  revalidatePath(`/w/${slug}/queries`);
  return { ok: true, id };
}

export async function deleteQuery(slug: string, id: string): Promise<SaveResult> {
  const { user, ws } = await requireWorkspace(slug);
  if (!canEdit(ws.role)) return { ok: false, error: "Your role can't delete queries." };
  const gone = await db
    .delete(queries)
    .where(and(eq(queries.id, id), eq(queries.workspaceId, ws.id)))
    .returning({ id: queries.id });
  if (!gone.length) return { ok: false, error: "That query no longer exists." };
  await trackServer("Query Deleted", { userId: user.id, workspaceId: ws.id }, { query_id: id });
  revalidatePath(`/w/${slug}/queries`);
  return { ok: true, id };
}
