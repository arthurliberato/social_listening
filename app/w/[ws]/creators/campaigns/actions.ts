"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { campaignCreators, campaigns, creatorListItems, creatorLists, db } from "@/db/client";
import { trackServer } from "@/lib/analytics/server";
import { auditIn } from "@/lib/audit";
import { requireWorkspace } from "@/lib/auth/session";
import {
  CAMPAIGN_NEXT,
  CAMPAIGN_STATUSES,
  OBJECTIVES,
  STATUS_LABEL,
  checkMove,
  isCreatorStatus,
  type CampaignStatus,
} from "@/lib/creators/campaign-flow";
import {
  accountActiveCampaigns,
  getCampaign,
  snapshotOf,
  type CampaignSnapshot,
} from "@/lib/creators/campaigns";
import { PLANS, canCreateCampaign, type PlanTier } from "@/lib/entitlements/plans";
import { accountPlan, canEdit } from "@/lib/queries";

export type Result<T = object> =
  ({ ok: true } & T) | { ok: false; error: string; upgradeTo?: PlanTier; upgradeLabel?: string };

/** The campaign as it is now, for the client to show without waiting on a page re-render. */
async function fresh(workspaceId: string, id: string): Promise<CampaignSnapshot> {
  return snapshotOf((await getCampaign(workspaceId, id))!);
}

const NoEdit = {
  ok: false as const,
  error: "Your role can look at campaigns but not change them. Ask an editor or admin.",
};

const CampaignInput = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Give the campaign a name.")
    .max(100, "Keep the name under 100 characters."),
  objective: z.enum(OBJECTIVES),
  brief: z.string().trim().max(4000, "Keep the brief under 4,000 characters.").default(""),
  budgetUsd: z.coerce
    .number()
    .int("Enter the budget in whole dollars.")
    .min(0, "The budget can't be negative.")
    .max(100_000_000),
  startsOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  endsOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
});

function datesOk(v: { startsOn?: string | null; endsOn?: string | null }) {
  return !v.startsOn || !v.endsOn || v.endsOn >= v.startsOn;
}

export async function createCampaign(
  slug: string,
  input: z.input<typeof CampaignInput>,
): Promise<Result<{ id: string }>> {
  const { user, ws } = await requireWorkspace(slug);
  if (!canEdit(ws.role)) return NoEdit;
  const v = CampaignInput.safeParse(input);
  if (!v.success) return { ok: false, error: v.error.issues[0]!.message };
  if (!datesOk(v.data)) return { ok: false, error: "The end date can't be before the start date." };
  const { accountId, tier } = await accountPlan(ws.id);
  const gate = canCreateCampaign(tier, await accountActiveCampaigns(accountId));
  if (!gate.ok) {
    await trackServer(
      "Paywall Viewed",
      { userId: user.id, workspaceId: ws.id },
      { paywall_trigger: "campaign_limit", required_plan: gate.upgradeTo },
    );
    return {
      ok: false,
      error: gate.reason,
      upgradeTo: gate.upgradeTo,
      upgradeLabel: PLANS[gate.upgradeTo].label,
    };
  }
  const [row] = await db
    .insert(campaigns)
    .values({
      workspaceId: ws.id,
      name: v.data.name,
      objective: v.data.objective,
      brief: v.data.brief,
      budgetUsd: v.data.budgetUsd,
      startsOn: v.data.startsOn || null,
      endsOn: v.data.endsOn || null,
      createdBy: user.id,
    })
    .returning({ id: campaigns.id });
  const id = row!.id;
  await trackServer(
    "Campaign Created",
    { userId: user.id, workspaceId: ws.id },
    { campaign_id: id, objective: v.data.objective, budget_usd: v.data.budgetUsd },
  );
  await auditIn(ws, user.id, "campaign.created", { type: "campaign", id }, { name: v.data.name });
  revalidatePath(`/w/${slug}/creators/campaigns`);
  return { ok: true, id };
}

export async function updateCampaign(
  slug: string,
  id: string,
  input: z.input<typeof CampaignInput>,
): Promise<Result<{ snapshot: CampaignSnapshot }>> {
  const { user, ws } = await requireWorkspace(slug);
  if (!canEdit(ws.role)) return NoEdit;
  const v = CampaignInput.safeParse(input);
  if (!v.success) return { ok: false, error: v.error.issues[0]!.message };
  if (!datesOk(v.data)) return { ok: false, error: "The end date can't be before the start date." };
  const data = await getCampaign(ws.id, id);
  if (!data) return { ok: false, error: "That campaign no longer exists." };
  await db
    .update(campaigns)
    .set({
      name: v.data.name,
      objective: v.data.objective,
      brief: v.data.brief,
      budgetUsd: v.data.budgetUsd,
      startsOn: v.data.startsOn || null,
      endsOn: v.data.endsOn || null,
    })
    .where(and(eq(campaigns.id, id), eq(campaigns.workspaceId, ws.id)));
  await auditIn(ws, user.id, "campaign.updated", { type: "campaign", id }, { name: v.data.name });
  revalidatePath(`/w/${slug}/creators/campaigns`);
  return { ok: true, snapshot: await fresh(ws.id, id) };
}

export async function setCampaignStatus(
  slug: string,
  id: string,
  to: string,
): Promise<Result<{ snapshot: CampaignSnapshot }>> {
  const { user, ws } = await requireWorkspace(slug);
  if (!canEdit(ws.role)) return NoEdit;
  const data = await getCampaign(ws.id, id);
  if (!data) return { ok: false, error: "That campaign no longer exists." };
  const from = data.campaign.status as CampaignStatus;
  if (
    !(CAMPAIGN_STATUSES as readonly string[]).includes(to) ||
    !CAMPAIGN_NEXT[from].includes(to as CampaignStatus)
  )
    return { ok: false, error: `A ${from} campaign can't move to ${to}.` };
  // Re-opening a campaign takes a slot on the plan again.
  if ((to === "active" || to === "draft") && from !== "draft" && from !== "active") {
    const { accountId, tier } = await accountPlan(ws.id);
    const gate = canCreateCampaign(tier, await accountActiveCampaigns(accountId));
    if (!gate.ok)
      return {
        ok: false,
        error: gate.reason,
        upgradeTo: gate.upgradeTo,
        upgradeLabel: PLANS[gate.upgradeTo].label,
      };
  }
  await db
    .update(campaigns)
    .set({ status: to })
    .where(and(eq(campaigns.id, id), eq(campaigns.workspaceId, ws.id)));
  await trackServer(
    "Campaign Status Changed",
    { userId: user.id, workspaceId: ws.id },
    { campaign_id: id, from_status: from, to_status: to },
  );
  await auditIn(ws, user.id, "campaign.status_changed", { type: "campaign", id }, { from, to });
  revalidatePath(`/w/${slug}/creators/campaigns`);
  return { ok: true, snapshot: await fresh(ws.id, id) };
}

/** Adds every creator in a list to the campaign as "shortlisted". Creators already on it are left alone. */
export async function addListToCampaign(
  slug: string,
  id: string,
  listId: string,
): Promise<Result<{ added: number; skipped: number; snapshot: CampaignSnapshot }>> {
  const { user, ws } = await requireWorkspace(slug);
  if (!canEdit(ws.role)) return NoEdit;
  const data = await getCampaign(ws.id, id);
  if (!data) return { ok: false, error: "That campaign no longer exists." };
  if (data.campaign.status === "archived" || data.campaign.status === "completed")
    return { ok: false, error: "Re-open the campaign before adding creators." };
  const [list] = await db
    .select({ id: creatorLists.id })
    .from(creatorLists)
    .where(and(eq(creatorLists.id, listId), eq(creatorLists.workspaceId, ws.id)));
  if (!list) return { ok: false, error: "That list no longer exists." };
  const items = await db
    .select({ creatorId: creatorListItems.creatorId })
    .from(creatorListItems)
    .where(eq(creatorListItems.listId, list.id));
  if (!items.length) return { ok: false, error: "That list is empty. Add creators to it first." };
  const inserted = await db
    .insert(campaignCreators)
    .values(items.map((i) => ({ campaignId: id, creatorId: i.creatorId, addedBy: user.id })))
    .onConflictDoNothing()
    .returning({ creatorId: campaignCreators.creatorId });
  if (inserted.length)
    await trackServer(
      "Campaign Creators Added",
      { userId: user.id, workspaceId: ws.id },
      { campaign_id: id, creator_count: inserted.length, source: "list" },
    );
  revalidatePath(`/w/${slug}/creators/campaigns`);
  return {
    ok: true,
    added: inserted.length,
    skipped: items.length - inserted.length,
    snapshot: await fresh(ws.id, id),
  };
}

const MoveInput = z.object({
  to: z.string(),
  feeUsd: z.coerce.number().int().min(0).max(10_000_000).nullable().optional(),
  note: z.string().max(500).optional(),
});

/** Move one creator along the pipeline (and/or set their fee or note). The rules live in campaign-flow. */
export async function updateCampaignCreator(
  slug: string,
  campaignId: string,
  creatorId: number,
  input: z.input<typeof MoveInput>,
): Promise<Result<{ warning?: string; snapshot: CampaignSnapshot }>> {
  const { user, ws } = await requireWorkspace(slug);
  if (!canEdit(ws.role)) return NoEdit;
  const v = MoveInput.safeParse(input);
  if (!v.success) return { ok: false, error: "Enter the fee in whole dollars." };
  const data = await getCampaign(ws.id, campaignId);
  if (!data) return { ok: false, error: "That campaign no longer exists." };
  if (data.campaign.status !== "draft" && data.campaign.status !== "active")
    return { ok: false, error: "Re-open the campaign before changing its creators." };
  const row = data.roster.find((r) => r.creatorId === creatorId);
  if (!row) return { ok: false, error: "That creator isn't on this campaign." };
  const from = isCreatorStatus(row.status) ? row.status : "shortlisted";
  const fee = v.data.feeUsd === undefined ? row.feeUsd : v.data.feeUsd;
  const to = v.data.to;
  const moving = to !== row.status;
  if (moving) {
    if (!isCreatorStatus(to)) return { ok: false, error: "Unknown status." };
    const check = checkMove(from, to, fee);
    if (!check.ok) return { ok: false, error: check.reason };
  }
  await db
    .update(campaignCreators)
    .set({
      feeUsd: fee,
      ...(v.data.note !== undefined ? { note: v.data.note } : {}),
      ...(moving ? { status: to, statusChangedAt: new Date() } : {}),
    })
    .where(
      and(eq(campaignCreators.campaignId, campaignId), eq(campaignCreators.creatorId, creatorId)),
    );
  if (moving) {
    await trackServer(
      "Campaign Creator Status Changed",
      { userId: user.id, workspaceId: ws.id },
      { campaign_id: campaignId, creator_id: creatorId, from_status: from, to_status: to },
    );
    await auditIn(
      ws,
      user.id,
      "campaign.creator_status_changed",
      { type: "campaign", id: campaignId },
      { creator: creatorId, from, to: STATUS_LABEL[to as keyof typeof STATUS_LABEL] ?? to },
    );
  }
  // Budget is advisory: confirming over budget is allowed, but the person is told.
  const snapshot = await fresh(ws.id, campaignId);
  const warning = snapshot.budget.over
    ? `This puts the campaign $${Math.abs(snapshot.budget.remaining).toLocaleString("en-US")} over its budget.`
    : undefined;
  revalidatePath(`/w/${slug}/creators/campaigns`);
  return { ok: true, warning, snapshot };
}

export async function removeCampaignCreator(
  slug: string,
  campaignId: string,
  creatorId: number,
): Promise<Result<{ snapshot: CampaignSnapshot }>> {
  const { user, ws } = await requireWorkspace(slug);
  if (!canEdit(ws.role)) return NoEdit;
  const data = await getCampaign(ws.id, campaignId);
  if (!data) return { ok: false, error: "That campaign no longer exists." };
  if (data.campaign.status !== "draft" && data.campaign.status !== "active")
    return { ok: false, error: "Re-open the campaign before changing its creators." };
  const gone = await db
    .delete(campaignCreators)
    .where(
      and(eq(campaignCreators.campaignId, campaignId), eq(campaignCreators.creatorId, creatorId)),
    )
    .returning({ id: campaignCreators.creatorId });
  if (gone.length)
    await trackServer(
      "Campaign Creator Removed",
      { userId: user.id, workspaceId: ws.id },
      { campaign_id: campaignId, creator_id: creatorId },
    );
  revalidatePath(`/w/${slug}/creators/campaigns`);
  return { ok: true, snapshot: await fresh(ws.id, campaignId) };
}
