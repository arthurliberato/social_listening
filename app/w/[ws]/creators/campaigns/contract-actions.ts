"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireWorkspace } from "@/lib/auth/session";
import { freshSnapshot, type CampaignSnapshot } from "@/lib/creators/campaigns";
import { sendContract, withdrawContract } from "@/lib/creators/contracts";
import { initiatePayout } from "@/lib/creators/payouts";
import type { Fail } from "@/lib/creators/outreach";
import { accountPlan, canEdit } from "@/lib/queries";

type Result = { ok: true; snapshot: CampaignSnapshot } | Fail;

const NoEdit: Fail = {
  ok: false,
  error: "Your role can look at campaigns but not change them. Ask an editor or admin.",
};

async function setup(slug: string) {
  const { user, ws } = await requireWorkspace(slug);
  const { accountId, tier } = await accountPlan(ws.id);
  return {
    ok: canEdit(ws.role),
    tier,
    ws: { id: ws.id, accountId, name: ws.name },
    actor: { id: user.id, name: user.name, email: user.email },
  };
}

const Ids = z.object({ campaignId: z.string().uuid(), creatorId: z.number().int().positive() });

async function done(slug: string, wsId: string, campaignId: string): Promise<Result> {
  revalidatePath(`/w/${slug}/creators/campaigns`);
  return { ok: true, snapshot: await freshSnapshot(wsId, campaignId) };
}

export async function sendContractAction(
  slug: string,
  input: z.input<typeof Ids> & { terms: Record<string, unknown> },
): Promise<Result> {
  const s = await setup(slug);
  if (!s.ok) return NoEdit;
  const ids = Ids.safeParse(input);
  if (!ids.success) return { ok: false, error: "Pick a creator on a campaign." };
  const r = await sendContract({
    ws: s.ws,
    tier: s.tier,
    actor: s.actor,
    ...ids.data,
    terms: input.terms ?? {},
  });
  return r.ok ? done(slug, s.ws.id, ids.data.campaignId) : r;
}

export async function withdrawContractAction(
  slug: string,
  input: z.input<typeof Ids>,
): Promise<Result> {
  const s = await setup(slug);
  if (!s.ok) return NoEdit;
  const ids = Ids.safeParse(input);
  if (!ids.success) return { ok: false, error: "Pick a creator on a campaign." };
  const r = await withdrawContract({ ws: s.ws, actor: s.actor, ...ids.data });
  return r.ok ? done(slug, s.ws.id, ids.data.campaignId) : r;
}

export async function initiatePayoutAction(
  slug: string,
  input: z.input<typeof Ids>,
): Promise<Result> {
  const s = await setup(slug);
  if (!s.ok) return NoEdit;
  const ids = Ids.safeParse(input);
  if (!ids.success) return { ok: false, error: "Pick a creator on a campaign." };
  const r = await initiatePayout({ ws: s.ws, tier: s.tier, actor: s.actor, ...ids.data });
  return r.ok ? done(slug, s.ws.id, ids.data.campaignId) : r;
}
