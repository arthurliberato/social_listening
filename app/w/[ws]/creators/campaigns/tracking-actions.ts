"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { campaigns, db } from "@/db/client";
import { trackServer } from "@/lib/analytics/server";
import { auditIn } from "@/lib/audit";
import { requireWorkspace } from "@/lib/auth/session";
import { getCampaign } from "@/lib/creators/campaigns";
import { ensureConversionKey, ensureLinksForCampaign } from "@/lib/creators/tracking";
import { checkDestination } from "@/lib/creators/tracking-flow";
import { PLANS, planUnlocking, type PlanTier } from "@/lib/entitlements/plans";
import { accountPlan, canEdit } from "@/lib/queries";

export type SetDestinationResult =
  | { ok: true; destinationUrl: string; conversionKey: string }
  | { ok: false; error: string; upgradeTo?: PlanTier; upgradeLabel?: string };

/** Where this campaign's tracking links send people. Setting it also creates links for creators already confirmed. */
export async function setDestinationAction(
  slug: string,
  campaignId: string,
  url: string,
): Promise<SetDestinationResult> {
  const { user, ws } = await requireWorkspace(slug);
  if (!canEdit(ws.role))
    return {
      ok: false,
      error: "Your role can look at results but not change the setup. Ask an editor or admin.",
    };
  const { plan } = await accountPlan(ws.id);
  if (!plan.features.campaignResults) {
    const to = planUnlocking("campaignResults");
    await trackServer(
      "Paywall Viewed",
      { userId: user.id, workspaceId: ws.id },
      { paywall_trigger: "campaign_results", required_plan: to },
    );
    return {
      ok: false,
      error: `Tracking links and results are part of ${PLANS[to].label}.`,
      upgradeTo: to,
      upgradeLabel: PLANS[to].label,
    };
  }
  const data = await getCampaign(ws.id, campaignId);
  if (!data) return { ok: false, error: "That campaign no longer exists." };
  const check = checkDestination(url);
  if (!check.ok) return { ok: false, error: check.reason };
  await db
    .update(campaigns)
    .set({ destinationUrl: check.url })
    .where(and(eq(campaigns.id, campaignId), eq(campaigns.workspaceId, ws.id)));
  const key = await ensureConversionKey(campaignId);
  await ensureLinksForCampaign(campaignId);
  await trackServer(
    "Campaign Destination Set",
    { userId: user.id, workspaceId: ws.id },
    { campaign_id: campaignId },
  );
  await auditIn(
    ws,
    user.id,
    "campaign.destination_set",
    { type: "campaign", id: campaignId },
    { name: data.campaign.name },
  );
  revalidatePath(`/w/${slug}/creators/campaigns/${campaignId}/results`);
  return { ok: true, destinationUrl: check.url, conversionKey: key };
}
