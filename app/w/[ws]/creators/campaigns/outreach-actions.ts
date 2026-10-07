"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireWorkspace } from "@/lib/auth/session";
import { freshSnapshot, type CampaignSnapshot } from "@/lib/creators/campaigns";
import {
  resolveCounter,
  revokeInvitation,
  reviewContent,
  sendInvitation,
  type Fail,
} from "@/lib/creators/outreach";
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
    slug,
    tier,
    ws: { id: ws.id, accountId, name: ws.name },
    actor: { id: user.id, name: user.name, email: user.email },
  };
}

const Ids = z.object({ campaignId: z.string().uuid(), creatorId: z.number().int().positive() });

async function done(slug: string, ws: { id: string }, campaignId: string): Promise<Result> {
  revalidatePath(`/w/${slug}/creators/campaigns`);
  return { ok: true, snapshot: await freshSnapshot(ws.id, campaignId) };
}

export async function sendInvitationAction(
  slug: string,
  input: z.input<typeof Ids> & { offeredUsd: unknown; message: string },
): Promise<Result> {
  const s = await setup(slug);
  if (!s.ok) return NoEdit;
  const ids = Ids.safeParse(input);
  if (!ids.success) return { ok: false, error: "Pick a creator on a campaign." };
  const r = await sendInvitation({
    ...s,
    ...ids.data,
    offeredUsd: input.offeredUsd,
    message: String(input.message ?? ""),
  });
  return r.ok ? done(slug, s.ws, ids.data.campaignId) : r;
}

export async function revokeInvitationAction(
  slug: string,
  input: z.input<typeof Ids>,
): Promise<Result> {
  const s = await setup(slug);
  if (!s.ok) return NoEdit;
  const ids = Ids.safeParse(input);
  if (!ids.success) return { ok: false, error: "Pick a creator on a campaign." };
  const r = await revokeInvitation({ ...s, ...ids.data });
  return r.ok ? done(slug, s.ws, ids.data.campaignId) : r;
}

export async function resolveCounterAction(
  slug: string,
  input: z.input<typeof Ids> & {
    decision: "accept" | "revise" | "decline";
    revisedUsd?: unknown;
    message?: string;
  },
): Promise<Result> {
  const s = await setup(slug);
  if (!s.ok) return NoEdit;
  const ids = Ids.safeParse(input);
  if (!ids.success || !["accept", "revise", "decline"].includes(input.decision))
    return { ok: false, error: "Pick a creator on a campaign." };
  const r = await resolveCounter({
    ...s,
    ...ids.data,
    decision: input.decision,
    revisedUsd: input.revisedUsd,
    message: input.message,
  });
  return r.ok ? done(slug, s.ws, ids.data.campaignId) : r;
}

export async function reviewContentAction(
  slug: string,
  input: z.input<typeof Ids> & { decision: "approve" | "changes"; feedback: string },
): Promise<Result> {
  const s = await setup(slug);
  if (!s.ok) return NoEdit;
  const ids = Ids.safeParse(input);
  if (!ids.success || !["approve", "changes"].includes(input.decision))
    return { ok: false, error: "Pick a creator on a campaign." };
  const r = await reviewContent({
    ...s,
    ...ids.data,
    decision: input.decision,
    feedback: String(input.feedback ?? ""),
  });
  return r.ok ? done(slug, s.ws, ids.data.campaignId) : r;
}
